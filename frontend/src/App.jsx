import { useCallback, useEffect, useState } from 'react';
import RomGate from './components/RomGate';
import ReplayPicker from './components/ReplayPicker';
import Viewer from './components/Viewer';
import TreeView from './components/TreeView';
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
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  window.history.replaceState(null, '', url);
}

function Main() {
  const [replay, setReplay] = useState(null);
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(null);
  const [booting, setBooting] = useState(true);
  // ?tree[=run]&zone=&node= shows the search-tree view; a replay opened from
  // it carries `back=tree` and those params, so its back button returns there.
  const [tree, setTree] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.has('tree') && !q.get('m64')
      ? { run: q.get('tree') || undefined, zone: q.get('zone') ?? undefined, node: q.get('node') ?? undefined, static: q.get('static') ?? undefined }
      : null;
  });
  const [backTo, setBackTo] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get('back') === 'tree'
      ? { run: q.get('tree') || undefined, zone: q.get('zone') ?? undefined, node: q.get('node') ?? undefined, static: q.get('static') ?? undefined }
      : null;
  });

  const loadUrl = useCallback(async (url, start = 0, title, from) => {
    setError(null);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = title ?? decodeURIComponent(url.split('/').pop() || 'replay.m64');
      const rep = await makeReplay(name, await r.arrayBuffer(), url);
      const back = from ?? backTo;
      setQuery({ m64: url, start: start || undefined, ...(back ? { back: 'tree', tree: back.run, zone: back.zone, node: back.node, static: back.static } : {}) });
      if (from) setBackTo(from);
      setInitial({ frame: start, speed: 1, playing: true });
      setReplay(rep);
    } catch (e) {
      setError(`Couldn't load ${url}: ${e.message ?? e}`);
    }
  }, [backTo]);

  // A pending rewind (page reloaded on purpose) or ?m64=<url>&start=<frame>.
  useEffect(() => {
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
  // one opened from the tree goes back to it.
  const close = () => {
    setQuery(backTo ? { tree: backTo.run ?? '', zone: backTo.zone, node: backTo.node, static: backTo.static } : {});
    window.location.reload();
  };

  const openTree = () => {
    setQuery({ tree: '' });
    setTree({});
  };

  if (booting) return null;
  if (tree && !replay)
    return (
      <TreeView
        state={tree}
        onState={(s) => setQuery({ tree: s.run ?? '', zone: s.zone, node: s.node ?? undefined, static: tree.static })}
        onPlay={({ url, start, title, state }) => loadUrl(url, start, title, { ...state, static: tree.static })}
        onBack={() => {
          setQuery({});
          window.location.reload();
        }}
      />
    );
  if (!replay) return <ReplayPicker onFile={loadFile} onUrl={loadUrl} onTree={openTree} error={error} />;
  return <Viewer replay={replay} initial={initial} onRewind={rewind} onClose={close} backLabel={backTo ? '← Tree' : '← Replays'} />;
}

export default function App() {
  return (
    <RomGate>
      <Main />
    </RomGate>
  );
}
