import { useCallback, useEffect, useState } from 'react';
import RomGate from './components/RomGate';
import ReplayPicker from './components/ReplayPicker';
import Viewer from './components/Viewer';
import { parseReplay } from './lib/m64';
import { savePending, takePending } from './lib/pending';

function makeReplay(name, buffer, source) {
  const { pads, header } = parseReplay(buffer);
  if (pads.length === 0) throw new Error(`${name} has no input frames.`);
  return { name, buffer, source, pads, header };
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

  const loadUrl = useCallback(async (url, start = 0, title) => {
    setError(null);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const name = title ?? decodeURIComponent(url.split('/').pop() || 'replay.m64');
      const rep = makeReplay(name, await r.arrayBuffer(), url);
      setQuery({ m64: url, start: start || undefined });
      setInitial({ frame: start, speed: 1, playing: true });
      setReplay(rep);
    } catch (e) {
      setError(`Couldn't load ${url}: ${e.message ?? e}`);
    }
  }, []);

  // A pending rewind (page reloaded on purpose) or ?m64=<url>&start=<frame>.
  useEffect(() => {
    (async () => {
      const pending = await takePending();
      if (pending) {
        try {
          setReplay(makeReplay(pending.name, pending.buffer, pending.source));
          setInitial({ frame: pending.frame, speed: pending.speed, playing: pending.playing });
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
      const rep = makeReplay(file.name, await file.arrayBuffer(), null);
      setQuery({});
      setInitial({ frame: 0, speed: 1, playing: true });
      setReplay(rep);
    } catch (e) {
      setError(String(e.message ?? e));
    }
  };

  // Going backwards needs a fresh emulator: reload the page and fast-forward.
  const rewind = useCallback(
    async (frame, speed, playing) => {
      await savePending({ name: replay.name, buffer: replay.buffer, source: replay.source, frame, speed, playing });
      window.location.reload();
    },
    [replay],
  );

  // Leaving a replay also reloads, so its emulator instance is released.
  const close = () => {
    setQuery({});
    window.location.reload();
  };

  if (booting) return null;
  if (!replay) return <ReplayPicker onFile={loadFile} onUrl={loadUrl} error={error} />;
  return <Viewer replay={replay} initial={initial} onRewind={rewind} onClose={close} />;
}

export default function App() {
  return (
    <RomGate>
      <Main />
    </RomGate>
  );
}
