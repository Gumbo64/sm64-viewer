import { useEffect, useMemo, useRef, useState } from 'react';
import RouteMap from './RouteMap';
import { deltaClass, legAt, listRoutes, liveView, mframes, pointAt, pollRoute, refColor, runUrl, settingsText, signed } from './routeData';
import { clock, shortName, zoneName } from '../oss/zones';
import { COLLISION } from '../tree/collisionTable';

import '../oss/oss.css';
import './routes.css';

// Areas with collision geometry (the others are a warp's in-between frames).
const hasZone = (z) => `${z >> 8}:${z & 0xff}` in COLLISION;
// A live run's files are rewritten after each leg and about every 30 s in one.
const LIST_POLL_MS = 5000;
// With no live run, how often the list checks for new ones.
const IDLE_POLL_MS = 15000;
const RUN_POLL_MS = 4000;

/** Seconds since a unix time, ticking every second while `on`. */
function useNow(on) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}
const ago = (now, t) => (t == null ? '' : `${Math.max(0, Math.round(now - t))} s ago`);

function LiveDot({ live, updated, now }) {
  return (
    <span className="live" title={live ? 'legs is running: this page re-reads the run every few seconds' : 'finished'}>
      <span className={`dot${live ? ' on' : ''}`} />
      {live ? `live${updated != null ? ` · updated ${ago(now, updated)}` : ''}` : 'finished'}
    </span>
  );
}

/**
 * Landmark-route runs of objective-rrt-v2's `legs` solver. Without a run, the
 * list (oss2's /api/routes); with one, its legs, the map and a frame slider.
 * `state` = { run, leg }; `onState` keeps the URL in step; `onPlay({ url,
 * start, title, state })` opens route.m64 in the replay player.
 */
export default function RoutesView({ state, onState, onPlay, onBack }) {
  const run = state.run || '';
  const [runs, setRuns] = useState(null);
  const [listError, setListError] = useState(null);
  useEffect(() => {
    listRoutes().then(setRuns, (e) => setListError(String(e.message ?? e)));
  }, []);
  // Re-read the list all the time, so runs started after the page opened show
  // up: often while any run is live (which also notices it finishing), slowly
  // otherwise.
  const anyLive = !!runs?.some((r) => r.live);
  useEffect(() => {
    const t = setInterval(() => listRoutes().then(setRuns, () => {}), anyLive ? LIST_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [anyLive]);
  const pick = (r) => onState({ run: r, leg: undefined });

  return (
    <div className={`oss-app routes-app${run ? '' : ' routes-list-app'}`}>
      {run ? (
        <RouteRun key={run} run={run} runs={runs} leg={state.leg} onState={onState} onPlay={onPlay} onPick={pick} />
      ) : (
        <>
          <header>
            <button onClick={onBack} title="Back to the replay list">
              ← Replays
            </button>
            <h1>Landmark routes</h1>
            <span className="stat">
              objective-rrt-v2 <b>legs</b> runs in oss2/runs
            </span>
          </header>
          <main className="routes-list">
            <RunList runs={runs} error={listError} onPick={pick} />
          </main>
        </>
      )}
    </div>
  );
}

export function RunList({ runs, error, onPick }) {
  const now = useNow(!!runs?.some((r) => r.live));
  if (error) return <div className="empty bad">Couldn't list the runs: {error} (is oss2/tools/serve.py on port 8091, with /api/routes?)</div>;
  if (!runs) return <div className="empty">Loading…</div>;
  if (!runs.length) return <div className="empty">No legs run in oss2/runs yet.</div>;
  return (
    <table className="routes-table">
      <thead>
        <tr>
          <th>Run</th>
          <th>Route</th>
          <th>Start</th>
          <th className="r">Frames</th>
          <th className="r" title="The first reference's frames over the same legs">Reference</th>
          <th className="r">Δ</th>
          <th>Legs</th>
          <th>Settings</th>
          <th className="r">GA frames</th>
          <th className="r">Time</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => {
          const tot = r.totals ?? {};
          const ref = tot.references?.find((x) => x.frames != null);
          const failed = (r.legs ?? []).filter((l) => l.failed);
          const running = (r.legs ?? []).find((l) => l.status === 'running');
          const d = ref && tot.frames != null && tot.legs_solved === tot.legs ? tot.frames - ref.frames : null;
          return (
            <tr key={r.name} className="clickable" onClick={() => onPick(r.name)}>
              <td>
                <a href={`?routes=${encodeURIComponent(r.name)}`} onClick={(e) => e.preventDefault()}>
                  {r.name}
                </a>
              </td>
              <td>{r.error ? <span className="bad">{r.error}</span> : r.route}</td>
              <td className="muted">
                {r.start}
                {r.start_frame != null && ` (frame ${r.start_frame})`}
              </td>
              <td className="r">
                <b>{tot.frames ?? '—'}</b>
              </td>
              <td className="r" title={(tot.references ?? []).map((x) => `${x.reference}: ${x.frames ?? 'legs not reached'}`).join('\n')}>
                {ref ? ref.frames : '—'}
                {(tot.references?.length ?? 0) > 1 && <span className="muted small"> (of {tot.references.length} refs)</span>}
              </td>
              <td className={`r ${deltaClass(d)}`}>{signed(d)}</td>
              <td>
                <span className={tot.legs_solved === tot.legs ? 'ok' : 'bad'}>
                  {r.starting ? 'starting' : `${tot.legs_solved ?? '?'}/${tot.legs ?? '?'} solved`}
                </span>
                {failed.length > 0 && <span className="bad"> · failed {failed.map((l) => l.name).join(', ')}</span>}
              </td>
              <td className="muted">{settingsText(r)}</td>
              <td className="r">{mframes(tot.ga_frames)}</td>
              <td className="r">{tot.seconds != null ? `${Math.round(tot.seconds)} s` : '—'}</td>
              <td className="muted">
                <LiveDot live={r.live} updated={r.updated} now={now} />
                {!r.live && ` · ${new Date((r.updated ?? r.mtime) * 1000).toLocaleString()}`}
                {r.live && running && <span> · {running.name}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RouteRun({ run, runs, leg, onState, onPlay, onPick }) {
  const [model, setModel] = useState(null);
  const [zone, setZone] = useState(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showAlt, setShowAlt] = useState(true);
  const [refsOn, setRefsOn] = useState(() => new Set([0]));
  // Live runs: keep the slider and camera on the newest leg (off once the user
  // picks a leg or moves the slider). `fitTick` re-fits the camera.
  const [follow, setFollow] = useState(true);
  const [fitTick, setFitTick] = useState(0);
  const focus = leg != null && leg !== '' ? Number(leg) : null;
  const poll = useRef(null);
  const view = useRef({ frame: 0, follow: true });
  view.current = { frame, follow };

  useEffect(() => {
    let cancelled = false;
    let retry = null;
    const load = () => pollRoute(run, null, { hasZone }).then(
      (res) => {
        if (cancelled) return;
        poll.current = res;
        const m = res.model;
        setModel(m);
        const f = focus != null ? m.legs[focus]?.start : null;
        const live = m.live && focus == null;
        const fr = f ?? (live ? m.lastFrame : m.start_frame);
        setFollow(live);
        setFrame(fr);
        setZone(pointAt(m.track, fr)?.[1] ?? m.zones[0] ?? null);
        // The first reference (the one `delta` uses) starts shown.
        setRefsOn(new Set(m.refs.length ? [0] : []));
      },
      // A run that has just started has no route.json yet: keep trying.
      () => {
        if (!cancelled) retry = setTimeout(load, RUN_POLL_MS);
      },
    );
    load();
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
    // Only on load; focus changes are handled by focusLeg.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // While live: re-read route.json every few seconds, the rest only when it
  // changed; the camera, selected leg and slider stay unless following (or
  // the slider sits at the live end). The update with live false is the last.
  const live = !!model?.live;
  useEffect(() => {
    if (!live) return;
    let busy = false, stop = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await pollRoute(run, poll.current, { hasZone });
        if (stop || !res.changed) return;
        const old = poll.current.model;
        poll.current = res;
        const m = res.model;
        setModel(m);
        const next = liveView(old, m, view.current);
        setFrame(next.frame);
        if (next.refit) setFitTick((n) => n + 1);
      } catch {
        // Try again next time.
      } finally {
        busy = false;
      }
    };
    const t = setInterval(tick, RUN_POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, run]);
  const now = useNow(live);

  // The map follows the route's playhead into each area it enters.
  const playZone = model ? pointAt(model.track, frame)?.[1] ?? null : null;
  const lastPlayZone = useRef(null);
  useEffect(() => {
    if (playZone != null && playZone !== lastPlayZone.current) {
      lastPlayZone.current = playZone;
      setZone(playZone);
    }
  }, [playZone]);

  // In-page playback of the slider at 30 frames/s.
  useEffect(() => {
    if (!playing || !model) return;
    let raf, last = performance.now(), acc = 0;
    const step = (now) => {
      acc += ((now - last) / 1000) * 30;
      last = now;
      if (acc >= 1) {
        const n = Math.floor(acc);
        acc -= n;
        setFrame((f) => {
          const next = Math.min(model.lastFrame, f + n);
          if (next >= model.lastFrame) setPlaying(false);
          return next;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, model]);

  const focusLeg = (i) => {
    const next = focus === i ? null : i;
    setFollow(false);
    onState({ run, leg: next ?? undefined });
    if (next != null && model) {
      const l = model.legs[next];
      const f = l.start ?? model.start_frame;
      setFrame(f);
      const z = pointAt(model.track, f + 1)?.[1] ?? l.zone;
      lastPlayZone.current = z;
      setZone(z);
    }
  };

  const play = (start) =>
    onPlay({ url: runUrl(run, 'route.m64'), start: start || 0, title: `${run} · route.m64`, state: { run, leg: focus ?? undefined } });

  const toggleFollow = () => {
    const on = !follow;
    setFollow(on);
    if (on && model) {
      if (focus != null) onState({ run, leg: undefined });
      setFrame(model.lastFrame);
      setFitTick((n) => n + 1);
    }
  };

  const toggleRef = (k) =>
    setRefsOn((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const cur = model ? legAt(model, frame) : -1;
  const here = model ? pointAt(model.track, frame) : null;
  const tot = model?.totals ?? {};
  const ref0 = tot.references?.find((x) => x.frames != null);

  // Zones with how many of the best path's points are in each.
  const zoneCounts = useMemo(() => {
    const n = new Map();
    for (const p of model?.track ?? []) n.set(p[1], (n.get(p[1]) ?? 0) + 1);
    return n;
  }, [model]);

  return (
    <>
      <header>
        <button onClick={() => onState({ run: '', leg: undefined })} title="All landmark-route runs">
          ← Routes
        </button>
        <h1>Landmark route</h1>
        <select value={run} onChange={(e) => onPick(e.target.value)} aria-label="Run">
          {!runs?.some((x) => x.name === run) && <option value={run}>{run}</option>}
          {runs?.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
        {model && (
          <>
            <span className="stat">
              route <b>{model.name}</b>
            </span>
            <span className="stat">
              start <b>{model.start}</b> @ {model.start_frame}
            </span>
            <span className="stat" title={(tot.references ?? []).map((x) => `${x.reference}: ${x.frames ?? 'legs not reached'}`).join('\n')}>
              frames <b>{tot.frames ?? '—'}</b>
              {ref0 && (
                <>
                  {' '}
                  vs ref <b>{ref0.frames}</b>{' '}
                  {tot.frames != null && tot.legs_solved === tot.legs && <span className={deltaClass(tot.frames - ref0.frames)}>{signed(tot.frames - ref0.frames)}</span>}
                </>
              )}
            </span>
            <span className="stat">
              legs <b className={tot.legs_solved === tot.legs ? 'ok' : 'bad'}>{tot.legs_solved}/{tot.legs}</b>
            </span>
            <span className="stat">{settingsText(model)}</span>
            {(model.live || model.updated != null) && <LiveDot live={model.live} updated={model.updated} now={now} />}
            {model.live && (
              <button aria-pressed={follow} onClick={toggleFollow} title="Keep the slider and the camera on the newest leg as the run goes on">
                Follow live
              </button>
            )}
            <span className="stat">
              GA <b>{mframes(tot.ga_frames)}</b> frames · {tot.seconds != null ? `${Math.round(tot.seconds)} s` : '—'}
            </span>
            <button className="routes-play" onClick={() => play(0)} title="Open route.m64 in the replay player, with the legs on its timeline">
              ▶ Play route
            </button>
          </>
        )}
      </header>
      {!model && <main className="routes-list"><div className="empty">Loading {run}…</div></main>}
      {model && (
        <>
          <main className="routes-main">
            <RouteMap
              model={model}
              zone={zone}
              focus={focus}
              camLeg={focus ?? (follow && model.live ? model.newestLeg : null)}
              fitKey={`${zone}|${focus}|${fitTick}`}
              frame={frame}
              showAlt={showAlt}
              refsOn={refsOn}
            />
            <div className="overlay">
              <span className="title">{zone != null ? zoneName(zone) : '—'}</span>
              {model.zones.length > 1 &&
                model.zones.map((z) => (
                  <button key={z} aria-pressed={z === zone} onClick={() => setZone(z)} title={`${zoneName(z)} · ${zoneCounts.get(z) ?? 0} points of the best path`}>
                    {shortName(z)}
                    {z === playZone ? ' ●' : ''}
                  </button>
                ))}
              <button aria-pressed={showAlt} onClick={() => setShowAlt((v) => !v)} title="The other beam candidates of each leg, faint">
                Alternatives
              </button>
              {model.refs.map((r, k) => (
                <button key={k} aria-pressed={refsOn.has(k)} onClick={() => toggleRef(k)} title={r.label}>
                  <span className="routes-dash" style={{ borderColor: refColor(k) }} /> Ref {k + 1}
                </button>
              ))}
              {focus != null && <button onClick={() => focusLeg(focus)}>All legs</button>}
            </div>
            {!model.hasPaths && <div className="oss-map-empty">This run has no paths.json: only the landmarks are drawn.</div>}
            <div className="routes-bar">
              <button onClick={() => setPlaying((p) => !p)} title="Move the playhead at 30 frames/s">
                {playing ? '❚❚' : '▶'}
              </button>
              <input
                type="range"
                min={model.start_frame}
                max={model.lastFrame}
                value={frame}
                onChange={(e) => {
                  setPlaying(false);
                  setFollow(false);
                  setFrame(Number(e.target.value));
                }}
                aria-label="Frame"
              />
              <span className="routes-frame">
                <b>{frame}</b> <span className="muted">({clock(frame)})</span>
              </span>
              <span className="muted routes-where">
                {cur >= 0 ? <span style={{ color: model.legs[cur].color }}>● {model.legs[cur].name}</span> : '—'}
                {here && <> · {shortName(here[1])} ({here[2].toFixed(0)}, {here[3].toFixed(0)}, {here[4].toFixed(0)})</>}
                {model.refs.map((r, k) => {
                  if (!refsOn.has(k)) return null;
                  const p = pointAt(r.points, frame);
                  const dist = p && here && p[1] === here[1] ? Math.hypot(p[2] - here[2], p[3] - here[3], p[4] - here[4]) : null;
                  return (
                    <span key={k} style={{ color: refColor(k) }}>
                      {' '}
                      · ref {k + 1}: {p ? `${shortName(p[1])}${dist != null ? `, ${dist.toFixed(0)} away` : ''}` : '—'}
                    </span>
                  );
                })}
              </span>
              <button onClick={() => play(frame)} title="Open the replay player at this frame">
                ▶ Play from here
              </button>
            </div>
          </main>
          <aside className="right routes-side">
            <h2>Legs</h2>
            <LegTable model={model} focus={focus} current={cur} onFocus={focusLeg} onPlay={play} />
            <h2>References</h2>
            <div className="kv">
              {model.refs.length === 0 && <span className="muted">none</span>}
              {(tot.references ?? []).map((r, k) => (
                <FragmentKV key={k} k={`Ref ${k + 1}`} color={refColor(k)}>
                  {r.reference} · {r.frames != null ? `${r.frames} frames` : <span className="muted">legs not reached</span>}
                </FragmentKV>
              ))}
            </div>
            <h2>Landmarks</h2>
            <table>
              <tbody>
                {model.landmarks.map((m) => (
                  <tr key={m.i} className="clickable" onClick={() => m.zone != null && setZone(m.zone)}>
                    <td className="r">
                      <span className="routes-num" style={{ background: m.i === 0 ? '#e3e6ee' : model.legs[m.i - 1]?.color }}>{m.i}</span>
                    </td>
                    <td>{m.name}</td>
                    <td className="muted">{m.zone != null ? shortName(m.zone) : '—'}</td>
                    <td className="muted">{m.target ? m.target.map((v) => v.toFixed(0)).join(', ') : 'zone / event'}</td>
                    <td className="r">{m.frame ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </aside>
        </>
      )}
    </>
  );
}

function FragmentKV({ k, color, children }) {
  return (
    <>
      <span>
        <span className="routes-dash" style={{ borderColor: color }} /> {k}
      </span>
      <span>{children}</span>
    </>
  );
}

export function LegTable({ model, focus, current, onFocus, onPlay }) {
  const gammas = model.qd?.gammas ?? [];
  const multiGamma = gammas.length > 1;
  return (
    <table className="routes-legs">
      <thead>
        <tr>
          <th>#</th>
          <th>Leg</th>
          <th className="r">Frames</th>
          <th className="r" title="The first reference's frames over this leg (hover a cell for all)">Ref</th>
          <th className="r">Δ</th>
          <th className="r" title="GA frames spent on this leg · attempts / retries">GA</th>
          <th className="r" title="Distinct Done bins (QD archive)">Bins</th>
          {multiGamma && <th title={`Done bins whose best differs under γ ${gammas.slice(1).join(' / ')} · beam states kept per γ`}>per γ</th>}
          <th />
        </tr>
      </thead>
      <tbody>
        {model.legs.map((l) => (
          <tr
            key={l.i}
            className={`clickable${focus === l.i ? ' sel' : ''}${current === l.i ? ' cur' : ''}${l.failed ? ' failed' : ''}${l.running ? ' running' : ''}`}
            onClick={() => onFocus(l.i)}
            title={`${l.from} → ${l.to}${l.start != null ? ` · frames ${l.start}–${l.done ?? '?'} (end ${l.end ?? '?'})` : ''}${l.failed ? `\nfailed: ${JSON.stringify(l.failed)}` : ''}`}
          >
            <td className="r">
              <span className="routes-sw" style={{ background: l.color }} />
              {l.i + 1}
            </td>
            <td>
              <b>{l.name}</b>
              <div className="muted small">
                {l.from} → {l.to}
                {l.failed && <span className="bad"> · failed</span>}
                {l.running && (
                  <span className="routes-running">
                    {' '}
                    · <span className="routes-spin" /> running
                  </span>
                )}
              </div>
            </td>
            <td className="r">
              {l.running ? <span className="muted">…</span> : l.frames ?? '—'}
              {l.running && l.eta != null && (
                <div className="routes-running small" title="The best rollout's ETA left to this leg's Done">
                  ETA {Math.round(l.eta)}
                </div>
              )}
            </td>
            <td className="r" title={l.refFrames.map((f, k) => `ref ${k + 1}: ${f ?? '—'}`).join('\n')}>
              {l.refFrames[0] ?? '—'}
            </td>
            <td className={`r ${deltaClass(l.delta)}`}>{signed(l.delta)}</td>
            <td className="r">
              {mframes(l.ga_frames)}
              <div className="muted small">
                {l.attempts ?? 0}
                {l.retries ? ` / ${l.retries}r` : ''}
              </div>
            </td>
            <td className="r">{model.qd ? (l.bins ?? '—') : <span className="muted" title="QD off: one candidate per parent">—</span>}</td>
            {multiGamma && (
              <td className="small">
                {Array.isArray(l.differing) && <div title={gammas.slice(1).map((g, k) => `γ ${g}: ${l.differing[k] ?? 0} bins`).join('\n')}>≠ {l.differing.join(' / ')}</div>}
                {l.kept_by_gamma && (
                  <div className="muted" title="Beam states kept, per γ">
                    {Object.entries(l.kept_by_gamma)
                      .map(([g, n]) => `${g}:${n}`)
                      .join(' ')}
                  </div>
                )}
              </td>
            )}
            <td>
              <button
                className="routes-mini"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay(l.start ?? 0);
                }}
                title="Play route.m64 from this leg's start"
              >
                ▶
              </button>
            </td>
          </tr>
        ))}
        {model.landmarks.slice(model.legs.length + 1).map((m) => (
          <tr key={`p${m.i}`} className="pending">
            <td className="r muted">{m.i}</td>
            <td colSpan={multiGamma ? 8 : 7}>
              <span className="muted">{m.name}</span>
              <span className="muted small"> · pending</span>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td />
          <td>
            <b>Total</b>
          </td>
          <td className="r">
            <b>{model.totals.frames ?? '—'}</b>
          </td>
          <td className="r">{model.totals.references?.[0]?.frames ?? '—'}</td>
          <td className={`r ${deltaClass(model.totals.frames != null && model.totals.references?.[0]?.frames != null ? model.totals.frames - model.totals.references[0].frames : null)}`}>
            {model.totals.frames != null && model.totals.references?.[0]?.frames != null ? signed(model.totals.frames - model.totals.references[0].frames) : '—'}
          </td>
          <td className="r">{mframes(model.totals.ga_frames)}</td>
          <td colSpan={multiGamma ? 3 : 2} />
        </tr>
      </tfoot>
    </table>
  );
}
