import { useEffect, useState } from 'react';
import DropZone from './DropZone';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const PREFS_KEY = 'sm64-viewer:timeline';

function loadPrefs() {
  try {
    return { newestFirst: false, importantOnly: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { newestFirst: false, importantOnly: false };
  }
}

// `date` in index.json is an ISO timestamp (UTC, e.g. "2026-10-19T08:45:00Z"),
// shown in the viewer's own time zone, or a plain date ("2026-01-29") that
// means that calendar day everywhere and has no time of day.
const DATE_ONLY = /^(\d{4})-(\d\d)-(\d\d)$/;
const dateOnly = (ex) => typeof ex.date === 'string' && DATE_ONLY.test(ex.date);
const when = (ex) => {
  if (!ex.date) return null;
  const m = DATE_ONLY.exec(ex.date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(ex.date);
};
const validDate = (d) => d && !Number.isNaN(d.getTime());

function localDay(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Examples in date order, grouped by local day. Undated ones go last either way. */
function groupByDay(examples, newestFirst) {
  const time = (e) => (validDate(when(e)) ? when(e).getTime() : null);
  const dated = examples.filter((e) => time(e) !== null).sort((a, b) => (time(a) - time(b)) * (newestFirst ? -1 : 1));
  const sorted = [...dated, ...examples.filter((e) => time(e) === null)];
  const days = new Map();
  for (const ex of sorted) {
    const day = time(ex) !== null ? localDay(when(ex)) : 'undated';
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(ex);
  }
  return [...days.entries()];
}

function formatDay(day) {
  if (day === 'undated') return 'Undated';
  const d = new Date(`${day}T00:00:00`); // local midnight
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * One timeline entry. Every field is optional except `title`:
 * - `file` (+ `start`): a replay in public/replays, opened when the card is clicked
 * - `description`: a line of text
 * - `table`: { columns: [...], rows: [...], highlight?: rowIndex[], note? }; a row is
 *   either an array of cells or { cells: [...], file, start } to make it open a replay
 * - `links`: [{ label, url }] (and `video`, shown as "Watch the video")
 * - `image`: a path in public/ or a URL, with optional `alt`
 * - `regions`: [{ from, to?, label, note?, color? }] annotating frame ranges of the
 *   replay (on an entry or a table row with a `file`), shown on the viewer's
 *   timeline and over the picture; see lib/regions.js
 */
function TimelineEntry({ ex, onUrl }) {
  const at = when(ex);
  const time = validDate(at) && !dateOnly(ex) && (
    <time className="tl-time" dateTime={at.toISOString()} title={at.toString()}>
      {at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
    </time>
  );
  const head = (
    <>
      <b>
        {ex.important && (
          <span className="tl-star" title="Important">
            ★{' '}
          </span>
        )}
        {ex.title}
      </b>
      {ex.description && <span className="muted small">{ex.description}</span>}
    </>
  );
  const links = [...(ex.video ? [{ label: 'Watch the video', url: ex.video }] : []), ...(ex.links ?? [])];
  return (
    <>
      {time}
      {ex.file ? (
        <button className="tl-card" onClick={() => onUrl(`${BASE}replays/${ex.file}`, ex.start ?? 0, ex.title)}>
          {head}
          <span className="tl-kind small">Replay ▸</span>
        </button>
      ) : (
        <div className="tl-card tl-static">{head}</div>
      )}
      {ex.table && <ResultTable table={ex.table} onUrl={onUrl} title={ex.title} />}
      {ex.image && <img className="tl-image" src={ex.image.startsWith('http') ? ex.image : `${BASE}${ex.image}`} alt={ex.alt ?? ex.title} />}
      {links.length > 0 && (
        <div className="tl-links">
          {links.map((l) => (
            <a key={l.url} className="video-link small" href={l.url} target="_blank" rel="noreferrer">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function ResultTable({ table, onUrl, title }) {
  const hl = new Set(table.highlight ?? []);
  const rows = table.rows.map((r) => (Array.isArray(r) ? { cells: r } : r));
  const playable = rows.some((r) => r.file);
  const open = (r) => onUrl(`${BASE}replays/${r.file}`, r.start ?? 0, `${title}: ${r.cells[0]}`);
  return (
    <div className="tl-table-wrap">
      <table className={`tl-table${playable ? ' playable' : ''}`}>
        <thead>
          <tr>
            {playable && (
              <th>
                <span className="visually-hidden">Replay</span>
              </th>
            )}
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={[hl.has(i) && 'hl', r.file && 'clickable'].filter(Boolean).join(' ') || undefined}
              onClick={r.file ? () => open(r) : undefined}
              title={r.file ? `Play this run (${r.file})` : undefined}
            >
              {playable && (
                <td className="play-cell">
                  {r.file && (
                    <button
                      className="play-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        open(r);
                      }}
                    >
                      ▶ Play
                    </button>
                  )}
                </td>
              )}
              {r.cells.map((v, j) => (
                <td key={j} className={typeof v === 'number' ? 'num' : j === 0 ? 'label' : undefined}>
                  {typeof v === 'number' ? v.toLocaleString('en-US') : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.note && <p className="muted small tl-note">{table.note}</p>}
    </div>
  );
}

/** Start screen: open a file, pick a bundled example, or load from a URL. */
export default function ReplayPicker({ onFile, onUrl, error }) {
  const [examples, setExamples] = useState([]);
  const [url, setUrl] = useState('');
  const [prefs, setPrefs] = useState(loadPrefs);
  const toggle = (k) =>
    setPrefs((p) => {
      const next = { ...p, [k]: !p[k] };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // Preferences just won't persist.
      }
      return next;
    });
  const shown = prefs.importantOnly ? examples.filter((e) => e.important) : examples;
  const hasImportant = examples.some((e) => e.important);

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
        {examples.length > 0 && (
          <>
            <div className="tl-head">
              <h2>Examples</h2>
              <div className="tl-controls" role="group" aria-label="Timeline options">
                <button
                  id="tl-order"
                  className="toggle"
                  aria-pressed={prefs.newestFirst}
                  onClick={() => toggle('newestFirst')}
                >
                  {prefs.newestFirst ? '↓ Newest first' : '↓ Oldest first'}
                </button>
                {hasImportant && (
                  <button
                    id="tl-important"
                    className="toggle"
                    aria-pressed={prefs.importantOnly}
                    onClick={() => toggle('importantOnly')}
                  >
                    ★ Important only
                  </button>
                )}
              </div>
            </div>
            <ol className="tl">
              {groupByDay(shown, prefs.newestFirst).map(([day, items]) => (
                <li key={day} className="tl-day">
                  <h3 className="tl-date">
                    <time dateTime={day}>{formatDay(day)}</time>
                  </h3>
                  <ol className="tl-items">
                    {items.map((ex, i) => (
                      <li key={ex.file ?? `${day}-${i}`} className="tl-item">
                        <span
                          className={`tl-dot${ex.file ? '' : ' tl-dot-result'}${ex.important ? ' tl-dot-important' : ''}`}
                          aria-hidden="true"
                        />
                        <TimelineEntry ex={ex} onUrl={onUrl} />
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          </>
        )}

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
