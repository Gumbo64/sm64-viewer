import { useMemo, useState } from 'react';
import { fieldRef, formatValue, isPos, queryValue } from './query';

const TOP_VALUES = 6;

// Parameters as one short line: center=(-2230,0,303) radius=1500.
function paramsText(params) {
  return Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `(${v.join(',')})` : typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
}

// Per objective the cells that have it (or a descendant), per field its values' counts.
function tally(model, cells) {
  const has = new Map(model.order.map((o) => [o.id, 0]));
  const values = new Map();
  for (const c of cells) {
    for (const o of model.order) for (const id of o.subtree) if (c.objs.has(id)) {
      has.set(o.id, has.get(o.id) + 1);
      break;
    }
    for (const [k, v] of c.values) {
      if (!values.has(k)) values.set(k, new Map());
      const m = values.get(k);
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  return { has, values };
}

const COL = 200; // x distance between levels
const ROW = 40; // y distance between rows
const BOX_W = 170;
const BOX_H = 30;
const PAD = 14;

// Left-to-right tidy layout of the visible tree: a leaf (or collapsed node)
// takes the next row, a parent sits at the middle of its children.
function layout(model, open) {
  const pos = new Map();
  let row = 0;
  const visit = (o) => {
    const kids = open.has(o.id) ? (o.children ?? []).map((c) => model.byId.get(c)).filter(Boolean) : [];
    let y;
    if (!kids.length) y = row++;
    else {
      const ys = kids.map(visit);
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.set(o.id, { x: o.depth * COL, y: y * ROW });
    return y;
  };
  if (model.root) visit(model.root);
  return { pos, rows: row };
}

/**
 * The objectives as a 2D tree (root at the left; click a ▸ to expand an
 * objective's children) with, for the cells matching the query, how many
 * have each objective: the page grid's `<main>`. Selecting one shows its
 * parameters and the commonest values of each field in `<aside class="right">`. Clicking an objective, field or value
 * adds it to the query through `onInsert(text)`.
 */
export default function ObjectiveTree({ model, cells, onInsert }) {
  // Starts open down to the stages.
  const [open, setOpen] = useState(() => new Set(model.order.filter((o) => o.depth < 1).map((o) => o.id)));
  const [selId, setSelId] = useState(null);
  const { has, values } = useMemo(() => tally(model, cells), [model, cells]);
  const { pos, rows } = useMemo(() => layout(model, open), [model, open]);

  const toggle = (id) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const visible = model.order.filter((o) => pos.has(o.id));
  const width = Math.max(...visible.map((o) => o.depth + 1), 1) * COL + PAD * 2;
  const height = Math.max(rows, 1) * ROW + PAD * 2;
  const sel = selId != null ? model.byId.get(selId) : null;
  const parents = model.order.filter((o) => o.children?.length);

  return (
    <>
      <main>
        <div className="oss-scroll">
          <div className="oss-tree-bar">
            <button onClick={() => setOpen(new Set(parents.map((o) => o.id)))}>Expand all</button>
            <button onClick={() => setOpen(new Set(model.root ? [model.root.id] : []))}>Collapse all</button>
            <span className="muted">Click ▸ to expand, a name to select it.</span>
          </div>
          <div className="oss-tree-plane" style={{ width, height }}>
            <svg width={width} height={height}>
              {visible.flatMap((o) =>
                open.has(o.id)
                  ? (o.children ?? []).filter((c) => pos.has(c)).map((c) => {
                      const a = pos.get(o.id);
                      const b = pos.get(c);
                      const x1 = PAD + a.x + BOX_W;
                      const y1 = PAD + a.y + BOX_H / 2;
                      const x2 = PAD + b.x;
                      const y2 = PAD + b.y + BOX_H / 2;
                      const mx = (x1 + x2) / 2;
                      return <path key={`${o.id}-${c}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="#4a5368" strokeWidth="1.5" />;
                    })
                  : [],
              )}
            </svg>
            {visible.map((o) => {
              const p = pos.get(o.id);
              const n = has.get(o.id);
              const kids = o.children?.length ?? 0;
              return (
                <div
                  key={o.id}
                  className={`oss-node${o.id === selId ? ' sel' : ''}${n ? '' : ' none'}`}
                  style={{ left: PAD + p.x, top: PAD + p.y, width: BOX_W, height: BOX_H }}
                  title={o.doc || undefined}
                >
                  <button className="oss-node-toggle" disabled={!kids} onClick={() => toggle(o.id)} title={kids ? `${open.has(o.id) ? 'Collapse' : 'Expand'} ${kids} children` : undefined}>
                    {kids ? (open.has(o.id) ? '▾' : '▸') : '·'}
                  </button>
                  <button className="oss-node-name" onClick={() => setSelId(o.id)}>
                    <b>{o.label}</b>
                    <span className="muted small">{o.kind}{kids && !open.has(o.id) ? ` · ${kids}` : ''}</span>
                  </button>
                  <span className="oss-count" title="Matching cells with this objective or one below it">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <aside className="right oss-tree">
        <h2>Objective</h2>
        {sel ? (
          <div>
            <div className="kv">
              <span>Name</span>
              <span>
                <b>{sel.label}</b>
              </span>
              <span>Kind</span>
              <span>{sel.kind}</span>
              <span>Cells</span>
              <span>{(has.get(sel.id) ?? 0).toLocaleString()} matching, with it or one below it</span>
              {paramsText(sel.params) && (
                <>
                  <span>Parameters</span>
                  <span className="key">{paramsText(sel.params)}</span>
                </>
              )}
            </div>
            <div className="btns">
              <button onClick={() => onInsert(`has(${sel.label})`)}>Filter: has({sel.label})</button>
            </div>
            {sel.doc && <div className="muted small oss-doc">{sel.doc}</div>}
            <h2>Field values</h2>
            {!(sel.fields ?? []).length && <div className="empty">No fields.</div>}
            {(sel.fields ?? []).map((field, idx) => {
              const ref = fieldRef(model, sel.id, idx);
              const counts = [...(values.get(`${sel.id}:${idx}`) ?? new Map())].sort((a, b) => b[1] - a[1]);
              const max = counts[0]?.[1] ?? 1;
              return (
                <div key={field} className="oss-field">
                  <button className="plain oss-fname key" title={`Add ${ref} to the query`} onClick={() => onInsert(`${ref} `)}>
                    {field}
                  </button>
                  {isPos(field) ? (
                    <span className="muted">{counts.length} distinct</span>
                  ) : (
                    <div className="oss-hist">
                      {counts.slice(0, TOP_VALUES).map(([v, n]) => (
                        <button key={v} className="plain oss-bar" title={`${ref} = ${queryValue(field, v)}: ${n} cells`} onClick={() => onInsert(`${ref} = ${queryValue(field, v)}`)}>
                          <span className="key">{formatValue(sel, field, v)}</span>
                          <i style={{ width: `${(100 * n) / max}%` }} />
                          <span className="muted">{n}</span>
                        </button>
                      ))}
                      {counts.length > TOP_VALUES && <span className="muted small">+{counts.length - TOP_VALUES} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty">Click an objective.</div>
        )}
      </aside>
    </>
  );
}
