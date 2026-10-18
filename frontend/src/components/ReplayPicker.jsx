import { useEffect, useState } from 'react';
import DropZone from './DropZone';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** Start screen: open a file, pick a bundled example, or load from a URL. */
export default function ReplayPicker({ onFile, onUrl, error }) {
  const [examples, setExamples] = useState([]);
  const [url, setUrl] = useState('');

  useEffect(() => {
    fetch(`${BASE}replays/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setExamples)
      .catch(() => setExamples([]));
  }, []);

  return (
    <div className="center-screen">
      <div className="card wide">
        <h1>Load a replay</h1>
        <DropZone accept=".m64" onFile={onFile} label="Drop an .m64 here or click to choose" />
        <p className="muted small">
          Raw input files (4 bytes per frame, as written by sm64-AI-binds and sm64-twin) and Mupen64 .m64
          files (with the 0x400-byte header) are both detected automatically.
        </p>

        {examples.length > 0 && (
          <>
            <h2>Examples</h2>
            <ul className="examples">
              {examples.map((ex) => (
                <li key={ex.file} className="example">
                  <button onClick={() => onUrl(`${BASE}replays/${ex.file}`, ex.start ?? 0, ex.title)}>
                    <b>{ex.title}</b>
                    {ex.description && <span className="muted"> — {ex.description}</span>}
                  </button>
                  {ex.video && (
                    <a className="video-link small" href={ex.video} target="_blank" rel="noreferrer">
                      Watch the video ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>From a URL</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onUrl(url.trim(), 0);
          }}
        >
          <input
            className="grow"
            type="url"
            placeholder="https://…/replay.m64"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit">Load</button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
