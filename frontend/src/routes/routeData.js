// Landmark-route runs of objective-rrt-v2's `legs` solver (tools/spec/README.md
// "Landmark routes and legs"): route.json, paths.json and regions.json under
// oss2's runs/<run>/, served by oss2/tools/serve.py through the /oss proxy.
// Plain data here (no React, no three.js), so it can be checked with node.

export const OSS_API = import.meta.env?.VITE_OSS_API ?? '/oss';
export const runUrl = (run, file) => `${OSS_API}/runs/${encodeURIComponent(run)}/${file}`;

// legs.rs's region colours, in order (used when regions.json is missing).
const COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#22d3ee', '#facc15', '#fb7185', '#4ade80', '#c084fc'];

/** An area as the viewer keys it: level * 256 + area. */
export const zoneKey = (level, area) => level * 256 + area;

async function getJson(url, optional) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    if (optional) return null;
    throw new Error(`${url}: HTTP ${r.status}`);
  }
  try {
    return await r.json();
  } catch (e) {
    if (optional) return null;
    throw new Error(`${url}: ${e.message}`);
  }
}

/** The runs with a route.json (oss2's /api/routes), newest first. */
export const listRoutes = () => getJson(`${OSS_API}/api/routes`);

/** A run's files, as one model (see buildModel). */
export async function loadRoute(run, opts) {
  return (await pollRoute(run, null, opts)).model;
}

// What says a route.json changed: `updated` (written by a live `legs`), else its size and leg count.
const versionOf = (route) => JSON.stringify([route.updated ?? null, route.live ?? null, route.legs?.length, route.totals?.frames, route.totals?.ga_frames]);

/**
 * One poll of a run: re-reads route.json, and paths.json / regions.json only
 * when route.json's version changed since `prev` (the last result; null the
 * first time). A file caught mid-write (unparsable) or missing keeps the
 * previous one. Returns { changed, model, version, route, paths, regions }.
 * Throws only on the first load without a readable route.json.
 */
export async function pollRoute(run, prev, opts) {
  let route = null;
  try {
    route = await getJson(runUrl(run, 'route.json'), !!prev);
  } catch (e) {
    if (!prev) throw e;
  }
  if (!route) {
    if (!prev) throw new Error(`${run}: no readable route.json`);
    return { ...prev, changed: false };
  }
  const version = versionOf(route);
  if (prev && version === prev.version) return { ...prev, changed: false };
  const [paths, regions] = await Promise.all([getJson(runUrl(run, 'paths.json'), true), getJson(runUrl(run, 'regions.json'), true)]);
  const p = paths ?? prev?.paths ?? null, g = regions ?? prev?.regions ?? null;
  return { changed: true, version, route, paths: p, regions: g, model: buildModel(route, p, g, opts) };
}

// paths.json's points are [frame, level, area, x, y, z]; here [frame, zone, x, y, z].
// With `hasZone`, a point in an area it rejects (a warp's few frames with the
// new level and the old area, e.g. "9:2" entering BoB from the lobby) keeps
// the previous point's area.
function toPts(points, hasZone) {
  let last = null;
  return (points ?? []).map((p) => {
    let z = zoneKey(p[1], p[2]);
    if (hasZone && !hasZone(z) && last != null) z = last;
    else last = z;
    return [p[0], z, p[3], p[4], p[5]];
  });
}

/** The point at `frame` on a track sorted by frame (interpolated between two in one area), or null. */
export function pointAt(track, frame) {
  if (!track?.length || frame < track[0][0]) return null;
  let lo = 0, hi = track.length - 1;
  if (frame >= track[hi][0]) return track[hi];
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid][0] <= frame) lo = mid;
    else hi = mid;
  }
  const a = track[lo], b = track[hi];
  if (a[1] !== b[1] || b[0] === a[0]) return a;
  const u = (frame - a[0]) / (b[0] - a[0]);
  return [frame, a[1], a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u];
}

/** Runs of consecutive points in `zone`, as flat [x, y, z, ...] arrays (one per run of 2+ points). */
export function segmentsIn(points, zone) {
  const out = [];
  let cur = null;
  for (const p of points) {
    if (p[1] !== zone) {
      cur = null;
      continue;
    }
    if (!cur) out.push((cur = []));
    cur.push(p[2], p[3], p[4]);
  }
  return out.filter((s) => s.length >= 6);
}

/** The zone a track spends the most points in. */
function mainZone(points) {
  const n = new Map();
  for (const p of points) n.set(p[1], (n.get(p[1]) ?? 0) + 1);
  let best = null;
  for (const [z, c] of n) if (best === null || c > n.get(best)) best = z;
  return best;
}

/**
 * {
 *   name, run settings (start, start_frame, seed, beam, qd, totals),
 *   legs: [{ i, name, from, to, frames, refFrames[], delta, ga_frames, attempts, retries,
 *            bins, kept_by_gamma, differing (per γ after the first), failed, color,
 *            start (the previous leg's Done), done, end (frames of the best path), best (candidate index), zone }],
 *   candidates: [{ leg, idx, parent, best, origin, gamma, legFrames, points }],
 *   track: the best path's points, frame-sorted,
 *   refs: [{ label, frames, points, done_frames }],
 *   landmarks: [{ i, name, pos [x,y,z] | null, zone, frame }],
 *   zones: [zone keys of the best path in the order it reaches them, then any others],
 *   lastFrame, live, updated, runningLeg (-1 none), newestLeg,
 * }
 * Partial (live) files are fine: no paths.json (no paths, landmarks only),
 * fewer legs than landmarks, a leg with `status: "running"` and no beam yet.
 */
export function buildModel(route, paths, regions, { hasZone } = {}) {
  const best = paths?.best ?? [];
  const pathLegs = paths?.legs ?? [];
  const candidates = [];
  const legs = (route.legs ?? []).map((l, i) => {
    const b = best[i] ?? 0;
    const beam = l.beam ?? [];
    const prev = i > 0 ? (route.legs[i - 1].beam ?? [])[best[i - 1] ?? 0] : null;
    const running = l.status === 'running';
    // As regions.json and `frames`: a leg runs from the previous one's Done
    // (its search starts after that leg's cutscene tail, at the previous `end`).
    const start = i === 0 ? route.start_frame : prev?.done_frame ?? prev?.end_frame ?? null;
    const pl = pathLegs[i] ?? pathLegs.find((x) => x?.leg === i);
    const cands = (pl?.candidates ?? []).map((c, idx) => ({
      leg: i, idx, parent: c.parent, best: idx === b, running: false,
      origin: beam[idx]?.origin, gamma: beam[idx]?.gamma, legFrames: beam[idx]?.leg_frames,
      points: toPts(c.points, hasZone),
    }));
    // The leg in progress: its best-so-far path (paths.json's `best_so_far` /
    // `running` on that leg, else its candidates' first), drawn as running.
    if (running) {
      const so = pl?.best_so_far ?? pl?.running ?? (paths?.running?.leg === i ? paths.running : null);
      const pts = Array.isArray(so) ? so : so?.points;
      if (pts) cands.splice(0, cands.length, { leg: i, idx: 0, parent: so?.parent ?? best[i - 1] ?? 0, best: true, running: true, points: toPts(pts, hasZone) });
      else cands.forEach((c, idx) => Object.assign(c, { best: idx === 0, running: idx === 0 }));
    }
    candidates.push(...cands);
    const region = Array.isArray(regions) ? regions[i] : null;
    return {
      i, name: l.name, from: l.from, to: l.to, frames: l.frames, delta: l.delta,
      refFrames: (l.ref_frames ?? []).map((r) => r.frames),
      refDone: (l.ref_frames ?? []).map((r) => r.done_frame),
      expect: l.expect_frames, ga_frames: l.ga_frames, attempts: l.attempts, retries: l.retries,
      bins: l.distinct_done_bins, kept_by_gamma: l.kept_by_gamma ?? null,
      differing: l.done_bins_differing_by_gamma ?? l.done_bins_by_gamma ?? null,
      failed: l.failed, beamSize: beam.length, budget: l.budget,
      running, status: l.status ?? (l.failed ? 'failed' : 'done'),
      eta: l.best_eta_left ?? l.eta_left ?? l.best_eta ?? null,
      color: region?.color ?? COLORS[i % COLORS.length],
      start, done: running ? null : beam[b]?.done_frame ?? null, end: running ? null : beam[b]?.end_frame ?? null, best: b,
      zone: mainZone(cands.find((c) => c.best)?.points ?? []),
    };
  });
  const track = candidates.filter((c) => c.best).flatMap((c) => c.points).sort((a, b) => a[0] - b[0]);
  const refs = (paths?.references ?? []).map((r, k) => ({
    label: r.reference ?? `reference ${k + 1}`,
    frames: route.totals?.references?.[k]?.frames ?? null,
    points: toPts(r.points, hasZone),
    done_frames: r.done_frames ?? [],
  }));
  const landmarks = (route.landmarks ?? []).map((m, i) => {
    const frame = i === 0 ? route.start_frame : legs[i - 1]?.done;
    const at = frame != null ? pointAt(track, frame) : null;
    const lz = Array.isArray(m.zone?.[0]) ? m.zone[0] : m.zone;
    const zone = at ? at[1] : lz ? zoneKey(lz[0], lz[1] ?? 1) : null;
    const pos = m.target ?? (at ? [at[2], at[3], at[4]] : null);
    return { i, name: m.name, pos, zone, frame, target: m.target };
  });
  const order = [];
  for (const p of track) if (!order.includes(p[1])) order.push(p[1]);
  for (const c of candidates) for (const p of c.points) if (!order.includes(p[1])) order.push(p[1]);
  for (const m of landmarks) if (m.zone != null && !order.includes(m.zone)) order.push(m.zone);
  // Live, the route ends where the newest path does.
  const lastFrame = Math.max(route.totals?.end_frame ?? 0, track.at(-1)?.[0] ?? 0, route.start_frame ?? 0);
  const runningLeg = legs.findIndex((l) => l.running);
  return {
    name: route.name, start: route.start, start_frame: route.start_frame, seed: route.seed, beam: route.beam,
    threads: route.threads, qd: route.qd ?? null, every: paths?.every,
    // A live run may not have totals yet: GA frames summed over the legs so far.
    totals: { ...route.totals, ga_frames: route.totals?.ga_frames ?? (legs.length ? legs.reduce((a, l) => a + (l.ga_frames ?? 0), 0) : undefined) },
    legs, candidates, track, refs, landmarks, zones: order, lastFrame, hasPaths: !!paths,
    live: !!route.live, updated: route.updated ?? null, runningLeg,
    // The newest leg with a path (the running one, else the last solved).
    newestLeg: runningLeg >= 0 ? runningLeg : legs.length - 1,
  };
}

/** The leg the best path is in at `frame` (by its start..end), or -1. */
export function legAt(model, frame) {
  for (let i = model.legs.length - 1; i >= 0; i--) {
    const l = model.legs[i];
    if (l.start != null && frame >= l.start) return i;
  }
  return -1;
}

/** "QD · γ 0.99 · beam 4" from a route (or /api/routes entry). */
export function settingsText(r) {
  const parts = [r.qd ? 'QD' : 'QD off'];
  if (r.qd?.gammas?.length) parts.push(`γ ${r.qd.gammas.join(', ')}`);
  if (r.beam != null) parts.push(`beam ${r.beam}`);
  if (r.seed != null) parts.push(`seed ${r.seed}`);
  return parts.join(' · ');
}

/** "+12" / "−54" / "±0". */
export const signed = (d) => (d == null ? '—' : d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '±0');
export const deltaClass = (d) => (d == null ? 'muted' : d < 0 ? 'ok' : d > 0 ? 'bad' : '');
export const mframes = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} k` : String(n));

// The references' dashed lines and playhead dots.
const REF_COLORS = ['#e3e6ee', '#f7c948', '#7fb2ff'];
export const refColor = (k) => REF_COLORS[k % REF_COLORS.length];

/**
 * Where the page's slider goes after a live update from `old` to `m`, given
 * the user's { frame, follow }: following, the new live end (and `refit` when
 * a newer leg started); at the old live end, the new one; else where it was
 * (clamped to the route). Returns { frame, refit }.
 */
export function liveView(old, m, { frame, follow }) {
  if (follow) return { frame: m.lastFrame, refit: m.newestLeg !== old.newestLeg };
  if (frame >= old.lastFrame) return { frame: m.lastFrame, refit: false };
  return { frame: Math.min(frame, m.lastFrame), refit: false };
}
