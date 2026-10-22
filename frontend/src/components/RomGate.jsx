import { useEffect, useState } from 'react';
import {
  calculateFileHash,
  isRomCached,
  storeROM,
  updateWASMs,
} from 'sm64-binds-frontend';
import DropZone from './DropZone';

const EXPECTED_SHA1 = '9bef1128717f958171a4afac3ed78ee2bb4e86ce';

/** Asks for the US ROM once (it is cached in IndexedDB), then renders children. */
export default function RomGate({ children }) {
  const [status, setStatus] = useState('checking'); // checking | needed | loading | ready
  const [error, setError] = useState(null);

  useEffect(() => {
    isRomCached()
      .then(async () => {
        await updateWASMs();
        setStatus('ready');
      })
      .catch(() => setStatus('needed'));
  }, []);

  const onFile = async (file) => {
    setError(null);
    const buffer = await file.arrayBuffer();
    const hash = await calculateFileHash(buffer);
    if (hash !== EXPECTED_SHA1) {
      setError(`That isn't the US ROM (SHA-1 ${hash}).`);
      return;
    }
    setStatus('loading');
    await storeROM(buffer);
    setStatus('ready');
  };

  if (status === 'ready') return children;
  if (status !== 'needed') {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <p className="muted">{status === 'loading' ? 'Preparing the game…' : 'Loading…'}</p>
      </div>
    );
  }
  return (
    <div className="center-screen">
      <div className="card">
        <h1>Super Mario 64 replay viewer</h1>
        <p>
          The game runs in your browser from your own ROM. Choose a <b>Super Mario 64 (US) .z64</b> file
          (8 MB); it's kept in this browser so you only do this once.
        </p>
        <DropZone accept=".z64" onFile={onFile} label="Drop the ROM here or click to choose" />
        {error && <p className="error">{error}</p>}
        <p className="muted small">Expected SHA-1: {EXPECTED_SHA1}</p>
      </div>
    </div>
  );
}
