import { useCallback, useEffect, useRef, useState } from 'react';
import RomGate from './components/RomGate';
import ReplayPicker from './components/ReplayPicker';
import Viewer from './components/Viewer';
import TreeView from './components/TreeView';
import OssView from './oss/OssView';
import RoutesView from './routes/RoutesView';
import { parseReplay } from './lib/m64';
import { savePending, takePending } from './lib/pending';
import { regionsFor } from './lib/regions';

async function makeReplay(name, buffer, source) {
  const { pads, header } = parseReplay(buffer);
  if (pads.length === 0) throw new Error(`${name} has no input frames.`);
  return { name, buffer, source, pads, header, regions: await regionsFor(source, pads.length) };
}

function setQuery(params) {
  const url = new URL(window.location.href);
  url.search = '';
  // An empty ?tree= or ?oss= still opens that view (its run list).
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && (v !== '' || k === 'tree' || k === 'oss' || k === 'routes')) url.searchParams.set(k, v);
  window.history.replaceState(null, '', url);
}

// The tree view's state from the URL, and back.
const treeParams = (q) => ({ run: q.get('tree') || undefined, zone: q.get('zone') ?? undefined, node: q.get('node') ?? undefined, static: q.get('static') ?? undefined });
const treeUrl = (s) => ({ tree: s.run ?? '', zone: s.zone, node: s.node ?? undefined, static: s.static });

function Main() {
  const [replay, setReplay] = useState(null);
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);
  // ?tree[=run]&zone=&node= shows the search-tree view and ?oss[=run]&q= the
  // objective-scattershot cells; a replay opened from one carries `back=tree`
  // or `back=oss` and its params (`backTo`), so its back button returns there.
  const [tree, setTree] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.has('tree') && !q.get('m64') ? treeParams(q) : null;
  });
  const [oss, setOss] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.has('oss') && !q.get('m64') ? { run: q.get('oss'), q: q.get('q') ?? '', zone: q.get('zone') ?? undefined, node: q.get('node') ?? undefined } : null;
  });
  // ?routes[=run]&leg= shows objective-rrt-v2's landmark-route runs (back=routes).
  const [routes, setRoutes] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.has('routes') && !q.get('m64') ? { run: q.get('routes'), leg: q.get('leg') ?? undefined } : null;
  });
  const [backTo, setBackTo] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('back') === 'tree') return { back: 'tree', ...treeUrl(treeParams(q)) };
    if (q.get('back') === 'routes') return { back: 'routes', routes: q.get('routes') ?? '', leg: q.get('leg') ?? undefined };
    if (q.get('back') === 'oss') return { back: 'oss', oss: q.get('oss') ?? '', q: q.get('q') ?? undefined, zone: q.get('zone') ?? undefined, node: q.get('node') ?? undefined };
    return null;
  });

  const loadUrl = useCallback(async (url, start = 0, title, from) => {
    setError(null);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = title ?? decodeURIComponent(url.split('/').pop() || 'replay.m64');
      const rep = await makeReplay(name, await r.arrayBuffer(), url);
      const back = from ?? backTo;
      setQuery({ m64: url, start: start || undefined, ...back });
      if (from) setBackTo(from);
      setInitial({ frame: start, speed: 1, playing: true });
      setReplay(rep);
    } catch (e) {
      setError(`Couldn't load ${url}: ${e.message ?? e}`);
    }
  }, [backTo]);

  // A pending rewind (page reloaded on purpose) or ?m64=<url>&start=<frame>,
  // once: loadUrl changes when a replay sets backTo, which mustn't reload it.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const pending = await takePending();
      if (pending) {
        try {
          setReplay(await makeReplay(pending.name, pending.buffer, pending.source));
          if (pending.backTo) setBackTo(pending.backTo);
          setInitial({ frame: pending.frame, speed: pending.speed, playing: pending.playing, exportJob: pending.exportJob });
        } catch (e) {
          setError(String(e.message ?? e));
        }
      } else {
        const q = new URLSearchParams(window.location.search);
        if (q.get('m64')) await loadUrl(q.get('m64'), Number(q.get('start')) || 0);
      }
      setBooting(false);
    })();
  }, [loadUrl]);

  const loadFile = async (file) => {
    setError(null);
    try {
      const rep = await makeReplay(file.name, await file.arrayBuffer(), null);
      setQuery({});
      setInitial({ frame: 0, speed: 1, playing: true });
      setReplay(rep);
    } catch (e) {
      setError(String(e.message ?? e));
    }
  };

  // Going backwards needs a fresh emulator: reload the page and fast-forward.
  // `exportJob` reopens the export dialog there (exporting from an earlier frame).
  const rewind = useCallback(
    async (frame, speed, playing, exportJob) => {
      await savePending({ name: replay.name, buffer: replay.buffer, source: replay.source, frame, speed, playing, exportJob, backTo });
      window.location.reload();
    },
    [replay, backTo],
  );

  // Leaving a replay also reloads, so its emulator instance is released;
  // one opened from the tree or the cells goes back there.
  const close = () => {
    setQuery(backTo ? { ...backTo, back: undefined } : {});
    window.location.reload();
  };

  const openTree = () => {
    setQuery({ tree: '' });
    setTree({});
  };

  const openOss = () => {
    setQuery({ oss: '' });
    setOss({ run: '', q: '' });
  };

  const openRoutes = () => {
    setQuery({ routes: '' });
    setRoutes({ run: '' });
  };

  if (booting) return null;
  if (routes && !replay)
    return (
      <RoutesView
        state={routes}
        onState={(s) => {
          setRoutes(s);
          setQuery({ routes: s.run ?? '', leg: s.leg });
        }}
        onPlay={({ url, start, title, state }) => loadUrl(url, start, title, { back: 'routes', routes: state.run, leg: state.leg })}
        onBack={() => {
          setQuery({});
          window.location.reload();
        }}
      />
    );
  if (tree && !replay)
    return (
      <TreeView
        state={tree}
        onState={(s) => setQuery({ tree: s.run ?? '', zone: s.zone, node: s.node ?? undefined, static: tree.static })}
        onPlay={({ url, start, title, state }) => loadUrl(url, start, title, { back: 'tree', ...treeUrl({ ...state, static: tree.static }) })}
        onBack={() => {
          setQuery({});
          window.location.reload();
        }}
      />
    );
  if (oss && !replay)
    return (
      <OssView
        state={oss}
        onState={(s) => setQuery({ oss: s.run ?? '', q: s.q, zone: s.zone, node: s.node })}
        onPlay={({ url, start, title, state }) => loadUrl(url, start, title, { back: 'oss', oss: state.run, q: state.q || undefined, zone: state.zone, node: state.node })}
        onBack={() => {
          setQuery({});
          window.location.reload();
        }}
      />
    );
  if (!replay) return <ReplayPicker onFile={loadFile} onUrl={loadUrl} onTree={openTree} onOss={openOss} onRoutes={openRoutes} error={error} />;
  return <Viewer replay={replay} initial={initial} onRewind={rewind} onClose={close} backLabel={backTo ? ({ oss: '← Cells', routes: '← Route' }[backTo.back] ?? '← Tree') : '← Replays'} />;
}

export default function App() {
  return (
    <RomGate>
      <Main />
    </RomGate>
  );
}
