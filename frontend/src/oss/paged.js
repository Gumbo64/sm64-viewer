// Paged loading from the data server's index (objective-scattershot/tools/serve.py):
// /api/view gives the exact per-area summary at once, /api/cells the sampled
// cells a page at a time, /api/region the cells of one area inside a box at a
// density that fits (for the 3D map's zoom). Runs written before the index
// have none (404): the page then streams cells.jsonl with load.js instead.
import { prepareCells } from './query.js';

export class HttpError extends Error {
  constructor(url, status) {
    super(`${url}: HTTP ${status}`);
    this.status = status;
  }
}

// Reads (and drops) a response body nobody needs, so the connection is freed.
const drain = (r) => r.arrayBuffer().catch(() => {});

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/**
 * summary.json's areas and transitions in the shape summarizeZones (zones.js)
 * takes as `exact`: areas Map(zone -> { n, first, stars }) and transitions
 * Map("from>to" -> { from, to, n, first }). The summary has no stars, so
 * `stars` is left undefined (the loaded cells' maximum is used).
 */
export function summaryToExact(summary) {
  const areas = new Map();
  const transitions = new Map();
  for (const a of summary?.areas ?? []) areas.set(a.zone, { n: a.n, first: a.first, stars: undefined });
  for (const t of summary?.transitions ?? []) transitions.set(`${t.from}>${t.to}`, { from: t.from, to: t.to, n: t.n, first: t.first });
  return { areas, transitions };
}

/** The objects of an NDJSON text (blank lines skipped). */
export function parseNdjson(text) {
  const out = [];
  let from = 0;
  for (;;) {
    const nl = text.indexOf('\n', from);
    const line = (nl < 0 ? text.slice(from) : text.slice(from, nl)).trim();
    if (line) out.push(JSON.parse(line));
    if (nl < 0) break;
    from = nl + 1;
  }
  return out;
}

/**
 * Links pages of /api/cells lines as they arrive, in any order: each cell's
 * `parent` becomes the loaded cell with id `vp` (null until that one
 * arrives, or for -1); `from` comes with the line. `byId` has every cell.
 */
export class Linker {
  constructor() {
    this.byId = new Map();
    this.waiting = new Map(); // vp -> cells waiting for it
  }
  add(cells) {
    prepareCells(cells);
    for (const c of cells) {
      this.byId.set(c.id, c);
      const kids = this.waiting.get(c.id);
      if (kids) {
        for (const k of kids) k.parent = c;
        this.waiting.delete(c.id);
      }
    }
    for (const c of cells) {
      if (c.from === undefined) c.from = null;
      const vp = c.vp ?? -1;
      const p = vp >= 0 ? this.byId.get(vp) : null;
      c.parent = p ?? null;
      if (vp >= 0 && !p) {
        const w = this.waiting.get(vp);
        if (w) w.push(c);
        else this.waiting.set(vp, [c]);
      }
    }
    return cells;
  }
}

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/**
 * /api/view for `run` at `stride`: { v, total, kept, stride, grid, summary },
 * or null when the run has no index. Retries while the search is mid-write (409).
 */
export async function fetchView(api, run, stride, signal) {
  for (let i = 0; ; i++) {
    const url = `${api}/api/view?${q({ run, stride })}`;
    const r = await fetch(url, { signal });
    if (!r.ok) await drain(r);
    if (r.status === 404) return null;
    if (r.status === 409 && i < 30) {
      await sleep(1000, signal);
      continue;
    }
    if (!r.ok) throw new HttpError(url, r.status);
    return r.json();
  }
}

/**
 * Loads `run`'s sampled cells page by page. `strideFor(total)` (optional)
 * re-picks the stride once the true total is known. `onView(view)` is called
 * as soon as the summary is in ({ v, total, kept, stride, grid, exact }),
 * `onPage(cells, view, byId)` after every page with all the cells so far (the
 * same growing array and id map). Starts over if the version goes away mid-load (410).
 * Returns { cells, byId, total, kept, stride, v, grid, exact }, or null when
 * the run has no index (use load.js).
 */
export async function loadPaged({ api, run, stride, strideFor, pageSize = 20000, inFlight = 2, signal, onView, onPage }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let view = await fetchView(api, run, stride, signal);
    if (!view) return null;
    const want = strideFor?.(view.total);
    if (want && want !== stride && Math.abs(want - stride) > 0.25 * stride) {
      stride = want;
      view = await fetchView(api, run, stride, signal);
      if (!view) return null;
    }
    const info = { v: view.v, total: view.total, kept: view.kept, stride: view.stride, grid: view.grid, exact: summaryToExact(view.summary) };
    onView?.(info);
    const linker = new Linker();
    const cells = [];
    const pages = Math.ceil(view.kept / pageSize);
    const page = (k) => {
      const url = `${api}/api/cells?${q({ run, stride: view.stride, v: view.v, offset: k * pageSize, limit: pageSize })}`;
      const p = fetch(url, { signal }).then(async (r) => {
        if (!r.ok) {
          await drain(r);
          throw new HttpError(url, r.status);
        }
        return r.text();
      });
      p.catch(() => {}); // awaited in order below; this keeps an early failure from being "unhandled"
      return p;
    };
    const queue = [];
    let next = 0;
    try {
      while (queue.length < inFlight && next < pages) queue.push(page(next++));
      while (queue.length) {
        const text = await queue.shift();
        if (next < pages) queue.push(page(next++));
        const got = linker.add(parseNdjson(text));
        for (const c of got) cells.push(c);
        onPage?.(cells, info, linker.byId);
      }
    } catch (e) {
      if (e.status === 410) continue;
      throw e;
    }
    return { ...info, cells, byId: linker.byId };
  }
  throw new Error(`${run} kept changing while loading`);
}

/**
 * /api/region: the cells of area `zone` inside `box` ([x0, y0, z0, x1, y1, z1])
 * thinned to about `max`, for the base view (`stride`, `v`). Returns { zone,
 * box, cells, total, step }; the cells are prepared but not linked (see
 * regionExtra in region.js). Throws HttpError (410: the version is gone).
 */
export async function fetchRegion({ api, run, stride, v, zone, box, max = 60000, signal }) {
  const url = `${api}/api/region?${q({ run, stride, v, zone, box: box.map((x) => Math.round(x)).join(','), max })}`;
  const r = await fetch(url, { signal });
  if (!r.ok) {
    await drain(r);
    throw new HttpError(url, r.status);
  }
  const total = +(r.headers.get('X-Region-Total') ?? 0);
  const step = +(r.headers.get('X-Region-Step') ?? 1);
  const cells = prepareCells(parseNdjson(await r.text()));
  for (const c of cells) if (c.from === undefined) c.from = null;
  return { zone, box, v, cells, total, step };
}
