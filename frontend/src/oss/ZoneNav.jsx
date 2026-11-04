import { clock, levelName, shortName, zoneName } from './zones';

const W = 270;
const H = 190;

// Ring layout in order of first arrival; castle areas in a row in the middle.
function layout(zs) {
  const pos = new Map();
  const castle = zs.filter((z) => [6, 16, 26].includes(z.level));
  const rest = zs.filter((z) => !castle.includes(z));
  castle.forEach((z, i) => pos.set(z.key, [W / 2 + (i - (castle.length - 1) / 2) * 62, H / 2]));
  rest.forEach((z, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, rest.length)) * Math.PI * 2;
    pos.set(z.key, [W / 2 + Math.cos(a) * (W / 2 - 34), H / 2 + Math.sin(a) * (H / 2 - 22)]);
  });
  return pos;
}

/**
 * The tree view's left panel (render it in an `<aside>`): the world map, the
 * levels and areas, and the transitions out of the chosen area. `empty`
 * (optional) is what the area list says while there are none.
 */
export default function ZoneNav({ zones, zone, onZone, empty }) {
  const zs = [...zones].sort((a, b) => a.first - b.first);
  // The world map leaves out the boot and menu phases (levels 0 to 3); they stay in the list.
  const onMap = zs.filter((z) => z.level > 3);
  const pos = layout(onMap);
  const max = Math.max(1, ...zs.map((z) => z.n));
  const byLevel = new Map();
  for (const z of zs) {
    if (!byLevel.has(z.level)) byLevel.set(z.level, []);
    byLevel.get(z.level).push(z);
  }
  const cur = zs.find((z) => z.key === zone);
  const rows = cur ? [...cur.out].sort((a, b) => b[1].n - a[1].n) : [];

  return (
    <>
      <h2>World map</h2>
      <svg className="map" viewBox={`0 0 ${W} ${H}`} aria-label="Areas and the transitions between them">
        <defs>
          <marker id="oss-arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="#8b93a7" />
          </marker>
        </defs>
        {onMap.flatMap((z) =>
          [...z.out].filter(([k]) => pos.has(k)).map(([k, { n }]) => {
            const [x1, y1] = pos.get(z.key);
            const [x2, y2] = pos.get(k) ?? [x1, y1];
            const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
            const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
            return (
              <path
                key={`${z.key}>${k}`}
                d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`}
                fill="none"
                stroke="#8b93a7"
                strokeOpacity={Math.min(0.9, 0.25 + Math.log10(n + 1) / 3)}
                strokeWidth={1 + Math.log10(n + 1)}
                markerEnd="url(#oss-arr)"
              >
                <title>{`${zoneName(z.key)} → ${zoneName(k)}: ${n} cells`}</title>
              </path>
            );
          }),
        )}
        {onMap.map((z) => {
          const [x, y] = pos.get(z.key);
          const r = 9 + 11 * Math.sqrt(z.n / max); // at least 9 so small areas can be clicked
          const sel = z.key === zone;
          return (
            <g key={z.key} className="z" onClick={() => onZone(z.key)}>
              <title>{`${zoneName(z.key)}: ${z.n} cells`}</title>
              <circle cx={x} cy={y} r={r} fill={sel ? '#f7c948' : '#2b3242'} stroke={sel ? '#f7c948' : '#4a5368'} />
              <text x={x} y={y + r + 9} textAnchor="middle">
                {shortName(z.key)}
              </text>
            </g>
          );
        })}
      </svg>
      <h2>Levels and areas</h2>
      {!zs.length && empty && <div className="empty">{empty}</div>}
      {[...byLevel].map(([l, list]) => (
        <div key={l}>
          <div className="lvl">{levelName(l)}</div>
          {list.map((z) => (
            <div key={z.key} className={`zone${z.key === zone ? ' sel' : ''}`} onClick={() => onZone(z.key)}>
              <span>
                Area {z.area} <span className="area">· from {clock(z.first)}{z.stars ? ` · ${z.stars}★` : ''}</span>
              </span>
              <span className="n">{z.n.toLocaleString()}</span>
              <span className="bar">
                <i style={{ width: `${((100 * z.n) / max).toFixed(1)}%` }} />
              </span>
            </div>
          ))}
        </div>
      ))}
      <h2>Transitions from this area</h2>
      {rows.length ? (
        <table>
          <thead>
            <tr>
              <th>To</th>
              <th className="r">Cells</th>
              <th className="r">From</th>
              <th>Via</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, e]) => (
              <tr key={k}>
                <td>
                  <span className="jump" onClick={() => onZone(k)}>
                    {zoneName(k)}
                  </span>
                </td>
                <td className="r">{e.n}</td>
                <td className="r">{clock(e.first)}</td>
                <td className="muted">
                  {[...e.via]
                    .sort((a, b) => b[1] - a[1])
                    .map(([v, n]) => `${v} ${n}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty">None yet.</div>
      )}
    </>
  );
}
