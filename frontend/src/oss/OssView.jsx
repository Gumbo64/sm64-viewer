import { useEffect, useMemo, useRef, useState } from 'react';
import ObjectiveTree from './ObjectiveTree';
import QueryBar from './QueryBar';
import CellTable from './CellTable';
import CellMap from './CellMap';
import ZoneNav from './ZoneNav';
import { summarizeZones } from './zones';
import { buildModel, insertCondition, runQuery } from './query';
import { loadCells } from './load';
import { fetchRegion, loadPaged } from './paged';
import { mergeRegion, nearlySame, regionExtra } from './region';
import { parseTreeBin, recordM64Url } from '../lib/treebin';
import './oss.css';

// The objective-scattershot data server (objective-scattershot/tools/serve.py),
// reached through the dev server's /oss proxy (vite.config.js).
const OSS_API = import.meta.env.VITE_OSS_API ?? '/oss';
const POLL_MS = 5000; // the run list
const CELLS_POLL_MS = 2000; // cells.jsonl: the search rewrites it every 30 s
const SHOW_MS = 1000; // the first load shows its first page at once, then at most this often (each show re-renders every cell)
const REGION_MAX = 60000; // cells per zoom answer (the server thins the box to about this)

async function get(path, as = 'json') {
  const r = await fetch(`${OSS_API}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r[as]();
}

const bytes = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(1)} GB` : `${Math.round(n / 2 ** 20)} MB`);

// Rates over the last two stats.json writes, as short strings.
const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
function rates(s) {
  const p = s?.prev;
  if (!p || s.elapsed_s <= p.elapsed_s) return null;
  const dt = s.elapsed_s - p.elapsed_s;
  return { frames: short((s.frames - p.frames) / dt), rollouts: short((s.rollouts - p.rollouts) / dt), cells: short((s.cells - p.cells) / dt) };
}

// cells.jsonl's size and date, to notice a running search rewriting it.
async function cellsStamp(run) {
  const r = await fetch(`${OSS_API}/runs/${run}/cells.jsonl`, { method: 'HEAD' });
  return { stamp: `${r.headers.get('content-length')} ${r.headers.get('last-modified')}`, bytes: +r.headers.get('content-length') || 0 };
}

// The runs, newest first, refreshed so a new search appears in the menu.
function useRuns(setError) {
  const [runs, setRuns] = useState(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      get('/api/runs').then(
        (r) => !stop && setRuns(r),
        (e) => !stop && setError(`Couldn't list runs (is objective-scattershot/tools/serve.py running?): ${e.message}`),
      );
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [setError]);
  return runs;
}

/**
 * The cells of a run, laid out as the tree view (src/tree/treeview.js): the
 * header with the run and its counters, the areas on the left, the matching
 * cells in 3D (or the objective tree, or a table) in the middle and the
 * selection on the right; the query bar is the header's second row.
 * `state` ({ run, q }) restores the view and `onState` reports changes;
 * `onPlay({ url, start, title, state })` opens a replay; `onBack` returns to the replays.
 */
export default function OssView({ state, onState, onPlay, onBack }) {
  const [run, setRun] = useState(state.run || null);
  const [query, setQuery] = useState(state.q ?? '');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('map');
  const [zone, setZone] = useState(state.zone != null && state.zone !== '' ? Number(state.zone) : null);
  const [selected, setSelected] = useState(state.node != null && state.node !== '' ? Number(state.node) : null);
  const [newFrom, setNewFrom] = useState(null); // ids from here on are new since the last update
  const [now, setNow] = useState(() => Date.now());
  const lastCount = useRef(null);
  const [stats, setStats] = useState(null);
  const [waiting, setWaiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [maxCells, setMaxCells] = useState(300000); // 0: all
  const maxCellsRef = useRef(300000);
  maxCellsRef.current = maxCells;
  const [sample, setSample] = useState(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const input = useRef(null);
  const picker = useRef(null);
  const runs = useRuns(setError);
  const wheelTimer = useRef(null);
  // Zoom streaming (runs with the server's index): the latest answers for
  // what the 3D map shows, kept on top of the base sample.
  const [region, setRegion] = useState([]);
  const [regionInfo, setRegionInfo] = useState(null);
  const regionCtl = useRef(null);
  const lastView = useRef(null); // the camera's last settled { zone, box, full }
  const lastDone = useRef(null); // the last answered { run, v, zone, box, info }
  const dataRef = useRef(null);
  dataRef.current = data;
  const sampleRef = useRef(null);
  sampleRef.current = sample;
  const zoneCounts = useRef(new WeakMap()); // data -> Map(zone -> loaded cells)

  // Without a run in the URL, open the newest.
  useEffect(() => {
    if (!run && runs?.length) {
      setRun(runs[0].name);
      onState({ run: runs[0].name, q: query });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  const pick = (r) => {
    setRun(r);
    setData(null);
    lastCount.current = null;
    setSample(null);
    setNewFrom(null);
    setStats(null);
    setSelectedReset();
    setZone(null);
    setSelected(null);
    regionCtl.current?.abort();
    setRegion([]);
    setRegionInfo(null);
    lastDone.current = null;
    onState({ run: r, q: query });
  };
  const setSelectedReset = () => setError(null);

  // The wheel over the run menu steps through runs; the run loads once the
  // wheel rests, as in the tree view.
  useEffect(() => {
    const sel = picker.current;
    if (!sel) return;
    const onWheel = (e) => {
      e.preventDefault();
      const i = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + Math.sign(e.deltaY)));
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => pick(sel.value), 250);
    };
    sel.addEventListener('wheel', onWheel, { passive: false });
    return () => sel.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, query]);

  // Load the run, then reload its cells whenever the search rewrites them.
  // With the server's index (/api/view) the summary comes first and the cells
  // a page at a time: the first load shows them as they come, a reload keeps
  // the old cells on screen and swaps when the new ones are all in. Older
  // runs stream cells.jsonl (load.js).
  useEffect(() => {
    if (!run) return;
    let stamp = null;
    let stop = false;
    let busy = false;
    let first = true;
    const ctl = new AbortController();
    const load = async () => {
      // A paged load can outlast the poll interval.
      if (busy) return;
      busy = true;
      try {
        // A reload re-reads the whole sample, so skip it while the tab is hidden or paused.
        if (document.hidden || pausedRef.current) return;
        const { stamp: next, bytes } = await cellsStamp(run);
        const key = `${next} ${maxCellsRef.current}`;
        if (key === stamp) return;
        // The search's memory use and counters, if it writes stats.json (older runs don't).
        const nextStats = await get(`/runs/${run}/stats.json`).catch(() => null);
        // Keep about maxCells cells: every stride-th one.
        const max = maxCellsRef.current;
        const strideFor = (n) => (max ? Math.max(1, Math.round(n / max)) : 1);
        const estimate = nextStats?.cells ?? Math.round(bytes / 200);
        const stride = strideFor(estimate);
        const model = buildModel(await get(`/runs/${run}/objectives.json`));
        if (stop) return;
        const progressive = first;
        let shown = 0;
        const paged = await loadPaged({
          api: OSS_API,
          run,
          stride,
          strideFor,
          signal: ctl.signal,
          // The world map, areas and transitions at once, from the exact summary.
          onView: (info) => {
            if (stop) return;
            setWaiting(false);
            setSample({ total: info.total, stride: info.stride, exact: info.exact, v: info.v, kept: info.kept, loaded: progressive ? 0 : null });
          },
          onPage: (cells, info, byId) => {
            if (stop || !progressive) return;
            const t = performance.now();
            if (cells.length < info.kept && t - shown < SHOW_MS) return;
            shown = t;
            setSample((s) => s && { ...s, loaded: cells.length });
            setData({ model, cells: cells.slice(), byId, run, v: info.v, stride: info.stride });
          },
        });
        let cells, total, exact, sampled, v = null, byId = null;
        if (paged) ({ cells, total, exact, stride: sampled, v, byId } = paged);
        else {
          ({ cells, total, exact } = await loadCells(`${OSS_API}/runs/${run}/cells.jsonl`, stride, () => get(`/runs/${run}/tree.bin`, 'arrayBuffer')));
          sampled = stride;
        }
        if (stop) return;
        stamp = key;
        first = false;
        setWaiting(false);
        setSample({ total, stride: sampled, exact, v, kept: cells.length, loaded: null });
        setStats((prev) => (nextStats ? { ...nextStats, prev: prev?.elapsed_s < nextStats.elapsed_s ? { ...prev, prev: null } : null } : null));
        // The search only appends cells (ids are never reused), so the
        // ones past the previous count are what this update added.
        setNewFrom(lastCount.current != null && total > lastCount.current ? lastCount.current : null);
        lastCount.current = total;
        setData({ model, cells: paged ? cells.slice() : cells, byId, run, v, stride: sampled });
        setError(null);
      } catch (e) {
        if (stop || e?.name === 'AbortError') return;
        // A search writes its first snapshot after a while; keep polling.
        if (/HTTP 404/.test(e.message)) {
          setWaiting(true);
          setError(null);
        } else setError(`Couldn't load ${run}: ${e.message}`);
      } finally {
        busy = false;
      }
    };
    load();
    const timer = setInterval(load, CELLS_POLL_MS);
    return () => {
      stop = true;
      ctl.abort();
      clearInterval(timer);
    };
  }, [run]);

  // Loaded cells per area, once per data.
  const loadedIn = (d, zone) => {
    let m = zoneCounts.current.get(d);
    if (!m) {
      m = new Map();
      for (const c of d.cells) {
        const z = c.values.get('0:0');
        m.set(z, (m.get(z) ?? 0) + 1);
      }
      zoneCounts.current.set(d, m);
    }
    return m.get(zone) ?? 0;
  };

  // The 3D map's camera settled on `view` ({ zone, box, full }): fetch that
  // box's cells at the density that fits, unless the base sample already has
  // every cell of the area or the view takes in all of it (then the base
  // sample is what's shown). `force` re-asks after an update.
  const streamView = async (view, force = false) => {
    lastView.current = view;
    regionCtl.current?.abort();
    regionCtl.current = null;
    const d = dataRef.current;
    if (!view || view.zone == null || !d?.v || d.run !== run) return;
    const n = sampleRef.current?.exact?.areas.get(view.zone)?.n;
    if (view.full || (n != null && loadedIn(d, view.zone) >= n)) {
      lastDone.current = null;
      setRegion([]);
      setRegionInfo(null);
      return;
    }
    const done = lastDone.current;
    if (!force && done && done.run === d.run && done.v === d.v && done.zone === view.zone && nearlySame(done.box, view.box)) {
      setRegionInfo(done.info); // (a move may have cancelled a request; the answer shown still fits)
      return;
    }
    const ctl = new AbortController();
    regionCtl.current = ctl;
    setRegionInfo({ loading: true });
    try {
      const ans = await fetchRegion({ api: OSS_API, run: d.run, stride: d.stride, v: d.v, zone: view.zone, box: view.box, max: REGION_MAX, signal: ctl.signal });
      if (ctl.signal.aborted || dataRef.current?.run !== d.run) return;
      const info = { n: ans.cells.length, total: ans.total, step: ans.step };
      lastDone.current = { run: d.run, v: d.v, zone: view.zone, box: view.box, info };
      setRegion((prev) => mergeRegion(prev, ans));
      setRegionInfo(info);
    } catch (e) {
      if (ctl.signal.aborted || e?.name === 'AbortError') return;
      // 410: the run moved on; the next update re-asks (see below).
      setRegionInfo(e?.status === 410 ? { stale: true } : { error: e.message });
    } finally {
      if (regionCtl.current === ctl) regionCtl.current = null;
    }
  };
  const stopStreaming = () => {
    regionCtl.current?.abort();
    regionCtl.current = null;
  };
  // A new version of the base sample: ask again for what's on screen (the
  // old answer stays shown until then).
  useEffect(() => {
    if (data?.v && lastView.current) streamView(lastView.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.v]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const result = useMemo(() => data && runQuery(data.model, data.cells, query), [data, query]);

  // The furthest progress any cell has: most keys and stars.
  const frontier = useMemo(() => {
    if (!data) return null;
    let keys = 0, stars = 0;
    for (const c of data.cells) {
      keys = Math.max(keys, c.values.get('0:1') ?? 0);
      stars = Math.max(stars, c.values.get('0:2') ?? 0);
    }
    return { keys, stars };
  }, [data]);
  // Before the first cells arrive the summary alone fills the areas and the world map.
  const zones = useMemo(
    () => (result && !result.error ? summarizeZones(result.cells, data.model, query.trim() === '' ? sample?.exact : undefined) : !data && sample?.exact ? summarizeZones([], null, sample.exact) : []),
    [result, data, query, sample],
  );
  // The 3D map's cells: the matching base cells plus the matching zoom-streamed ones.
  const extra = useMemo(() => (data?.byId && region.length ? regionExtra(region, data.byId) : []), [data, region]);
  const extraMatching = useMemo(() => (extra.length && result && !result.error ? runQuery(data.model, extra, query).cells : []), [extra, data, query, result]);
  // The chosen area, or the one with the most cells.
  const activeZone = zones.some((z) => z.key === zone) ? zone : [...zones].sort((a, b) => b.n - a.n)[0]?.key ?? null;

  const report = (next = {}) => onState({ run, q: query, zone: zone ?? undefined, node: selected ?? undefined, ...next });
  const changeQuery = (q) => {
    setQuery(q);
    report({ q });
  };
  const chooseZone = (z) => {
    setZone(z);
    report({ zone: z });
  };
  const chooseNode = (id) => {
    setSelected(id);
    report({ node: id ?? undefined });
  };
  const insert = (snippet) => {
    const el = input.current;
    // The input keeps its cursor when a click elsewhere takes the focus.
    const at = el?.selectionStart ?? query.length;
    const next = insertCondition(query, at, snippet);
    changeQuery(next.text);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
  };
  const download = async (cell) => {
    try {
      const tree = parseTreeBin(await get(`/runs/${run}/tree.bin`, 'arrayBuffer'));
      const a = document.createElement('a');
      a.href = recordM64Url(tree, cell.node);
      a.download = `${run}-cell-${cell.id}.m64`;
      a.click();
    } catch (e) {
      setError(`Couldn't build the replay: ${e.message}`);
    }
  };
  const watch = async (cell) => {
    try {
      const tree = parseTreeBin(await get(`/runs/${run}/tree.bin`, 'arrayBuffer'));
      onPlay({ url: recordM64Url(tree, cell.node), start: Math.max(0, cell.frames - 300), title: `${run} · cell #${cell.id}`, state: { run, q: query, zone: zone ?? undefined, node: selected ?? undefined } });
    } catch (e) {
      setError(`Couldn't build the replay: ${e.message}`);
    }
  };

  const runInfo = runs?.find((r) => r.name === run);
  const r = rates(stats);
  const cellsOf = result && !result.error ? result.cells : [];
  // (Memoized: the clock re-renders the page every second.)
  const mapCells = useMemo(() => {
    const base = result && !result.error ? result.cells : [];
    return extraMatching.length ? base.concat(extraMatching) : base;
  }, [result, extraMatching]);
  const message = error ? (
    <span className="bad">{error}</span>
  ) : waiting ? (
    `Waiting for ${run}'s first snapshot (the search writes about every 30 s)…`
  ) : (
    <>
      <span className="spinner" /> Loading {run ?? 'the runs'}…
    </>
  );

  // The tree view's page: header, the areas on the left, the 3D view in the
  // middle with its controls over it, the selection and legend on the right.
  return (
    <div className="oss-app">
      <header>
        <button onClick={onBack} title="Back to the replay list">
          ← Replays
        </button>
        <h1>Objective scattershot</h1>
        <select ref={picker} value={run ?? ''} onChange={(e) => pick(e.target.value)} aria-label="Run">
          {!runs?.some((x) => x.name === run) && <option value={run ?? ''}>{run || '…'}</option>}
          {runs?.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
              {x.live ? ' · live' : ''}
            </option>
          ))}
        </select>
        <span className="live oss-status" title="The page re-reads the run every 2 s; the search rewrites it about every 30 s.">
          <span className={`dot${runInfo?.live ? ' on' : ''}`} />
          <span>
            {runInfo ? (runInfo.live ? `live · written ${Math.max(0, Math.round(now / 1000 - runInfo.mtime))}s ago` : 'finished') : '—'}
            {paused ? ' · paused' : ''}
          </span>
        </span>
        <span className="stat">
          cells <b>{sample ? sample.total.toLocaleString() : '—'}</b>
        </span>
        <span className="stat">
          frontier <b>{frontier ? `${frontier.keys} keys · ${frontier.stars} stars` : '—'}</b>
        </span>
        <span className="stat">
          search <b>{stats?.elapsed_s > 0 ? `${Math.floor(stats.elapsed_s / 60)}m ${Math.round(stats.elapsed_s % 60)}s` : '—'}</b>
        </span>
        <span className="stat" title={r ? `${r.frames} frames/s over the last update` : 'Averaged over the whole search'}>
          emulated <b>{stats?.elapsed_s > 0 ? `${Math.round(stats.frames / Math.max(1, stats.elapsed_s)).toLocaleString()} frames/s` : '—'}</b>
        </span>
        {r && (
          <span className="stat" title="Averaged over the last update (the search writes about every 30 s). Samples are rollouts, each started from one sampled cell; new cells are cells added or improved.">
            samples <b>{r.rollouts}/s</b> · new cells <b>{r.cells}/s</b>
          </span>
        )}
        {stats?.rss_bytes > 0 && (
          <span className="stat" title={`Whole search process. Saved states: ${bytes(stats.save_bytes)} in ${stats.checkpoints.toLocaleString()} of ${stats.nodes.toLocaleString()} nodes.`}>
            memory <b>{bytes(stats.rss_bytes)}</b>
          </span>
        )}
        <span className="oss-tabs" role="group" aria-label="View">
          <button aria-pressed={tab === 'map'} onClick={() => setTab('map')}>3D map</button>
          <button aria-pressed={tab === 'tree'} onClick={() => setTab('tree')}>Objectives</button>
          <button aria-pressed={tab === 'table'} onClick={() => setTab('table')}>Table</button>
        </span>
        <span className="stat" title="Loading every cell of a long run is too much for the browser: this many are kept (every n-th), but the area counts and transitions still use all of them.">
          load
          <select value={maxCells} onChange={(e) => setMaxCells(Number(e.target.value))} aria-label="Cells to load">
            <option value={100000}>~100k cells</option>
            <option value={300000}>~300k cells</option>
            <option value={1000000}>~1M cells</option>
            <option value={0}>all cells</option>
          </select>
          {sample?.loaded != null ? (
            <>
              {' '}
              <span className="spinner" /> <b>{sample.loaded.toLocaleString()}</b> / {sample.kept.toLocaleString()} loaded
              {sample.stride > 1 && ` (every ${sample.stride}th)`}
            </>
          ) : (
            sample?.stride > 1 && (
              <>
                {' '}
                every {sample.stride}th, <b>{data ? data.cells.length.toLocaleString() : '…'}</b> loaded
              </>
            )
          )}
        </span>
        <button aria-pressed={paused} onClick={() => setPaused((p) => !p)} title="Stop re-reading the run while you look around: each update parses the whole run">
          {paused ? 'Resume' : 'Pause'}
        </button>
        {data && (
          <QueryBar
            model={data.model}
            value={query}
            onChange={changeQuery}
            error={result.error}
            inputRef={input}
            matched={result.error ? '—' : result.cells.length}
            total={data.cells.length}
          />
        )}
        {data && error && <span className="bad small">{error}</span>}
      </header>

      <aside className="oss-nav">
        <ZoneNav zones={zones} zone={activeZone} onZone={chooseZone} empty={data ? 'No matching cells have an area.' : null} />
      </aside>

      {data && run ? (
        tab === 'map' ? (
          <CellMap
            model={data.model}
            cells={mapCells}
            runCells={data.cells}
            stride={sample?.stride ?? 1}
            zone={activeZone}
            newFrom={newFrom}
            selected={selected}
            onSelect={chooseNode}
            onZone={chooseZone}
            onWatch={watch}
            onDownload={download}
            onViewMove={data.v ? stopStreaming : undefined}
            onViewSettle={data.v ? streamView : undefined}
            region={regionInfo}
          />
        ) : tab === 'tree' ? (
          <ObjectiveTree model={data.model} cells={cellsOf} onInsert={insert} />
        ) : (
          <CellTable model={data.model} cells={cellsOf} onInsert={insert} onWatch={watch} />
        )
      ) : (
        <>
          <main>
            <div className="oss-wait">{message}</div>
          </main>
          <aside className="right">
            <h2>Cell</h2>
            <div className="empty">Click a cell.</div>
          </aside>
        </>
      )}
    </div>
  );
}
