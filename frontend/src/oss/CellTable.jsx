import { useMemo, useState } from 'react';
import { META, fieldRef, formatValue, queryValue } from './query';

const MAX_ROWS = 500;
const META_COLS = ['id', 'frames', 'p', 'visits', 'succ'];

/**
 * The cells matching the query, sortable by any column, as a `<main>` that
 * takes the page grid's middle and right columns. Clicking a value adds
 * it to the query (`onInsert`); Watch plays the cell's replay (`onWatch`).
 */
export default function CellTable({ model, cells, onInsert, onWatch }) {
  const [sort, setSort] = useState({ col: 'frames', dir: 1 });

  // A column per objective field any of these cells has, in tree order.
  const fields = useMemo(() => {
    const present = new Set(cells.flatMap((c) => [...c.values.keys()]));
    return model.order.flatMap((o) =>
      (o.fields ?? []).flatMap((field, idx) =>
        present.has(`${o.id}:${idx}`) ? [{ key: `${o.id}:${idx}`, obj: o, field, ref: fieldRef(model, o.id, idx) }] : [],
      ),
    );
  }, [model, cells]);

  const rows = useMemo(() => {
    const get = (c) => (META.includes(sort.col) ? c[sort.col] : c.values.get(sort.col));
    // Cells without the field go last either way.
    return [...cells].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === undefined || y === undefined) return (x === undefined) - (y === undefined);
      return (x - y) * sort.dir;
    });
  }, [cells, sort]);

  const header = (col, label) => (
    <th key={col} className="clickable" onClick={() => setSort((s) => ({ col, dir: s.col === col ? -s.dir : 1 }))}>
      {label}
      {sort.col === col && (sort.dir > 0 ? ' ▲' : ' ▼')}
    </th>
  );
  const metaCell = (c, m) => (
    <td key={m} className="r clickable" onClick={() => onInsert(`${m} ${m === 'frames' ? '<=' : '='} ${c[m]}`)}>
      {m === 'p' ? c.p.toFixed(3) : c[m]}
    </td>
  );

  return (
    <main className="oss-wide">
      <div className="oss-scroll oss-cells">
      <table className="oss-table">
        <thead>
          <tr>
            <th />
            {META_COLS.map((m) => header(m, m))}
            {fields.map((f) => header(f.key, f.ref))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_ROWS).map((c) => (
            <tr key={c.id}>
              <td>
                <button onClick={() => onWatch(c)} title={`Play the replay to cell #${c.id}`}>
                  ▶ Watch
                </button>
              </td>
              {META_COLS.map((m) => metaCell(c, m))}
              {fields.map((f) => {
                const v = c.values.get(f.key);
                return v === undefined ? (
                  <td key={f.key} />
                ) : (
                  <td key={f.key} className="key clickable" onClick={() => onInsert(`${f.ref} = ${queryValue(f.field, v)}`)}>
                    {formatValue(f.obj, f.field, v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && (
        <div className="muted small">
          Showing {MAX_ROWS} of {rows.length} cells.
        </div>
      )}
      </div>
    </main>
  );
}
