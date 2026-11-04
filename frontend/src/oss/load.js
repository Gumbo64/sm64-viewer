// Loading a run's cells.jsonl without holding all of it: the response is
// streamed line by line (a long run is hundreds of MB and millions of cells),
// every line's id, node, level and parent are noted with a regex, and only
// every `stride`-th cell is parsed into an object.
import { parseTreeBin } from '../lib/treebin.js';
import { prepareCells } from './query.js';

// An area's first RARE cells are always kept, however the sampling goes, so small
// areas (the lobby, a boss room) and the cells that enter them are not lost.
const RARE = 30000;

const re = {
  node: /"node":(\d+)/,
  frames: /"frames":(\d+)/,
  stars: /\[0,2,(-?\d+)\]/,
  parent: /"parent":(-?\d+)/,
  level: /"key":\[\[0,0,(-?\d+)\]/,
};

class Ints {
  constructor() {
    this.a = new Int32Array(1 << 16);
    this.n = 0;
  }
  push(v) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
}

/**
 * Streams `url` (cells.jsonl) keeping every `stride`-th cell. `getTree()`
 * returns tree.bin's ArrayBuffer, needed only for runs from before the
 * search wrote each cell's `parent`. Returns { cells, total, stride }: each
 * kept cell has `parent` (the nearest kept ancestor cell, or null) and `from`
 * (the area of its actual parent cell, or null). `exact` has the true
 * per-area totals and area-to-area transitions over all cells. Every cell of a
 * small area is kept (see RARE).
 */
export async function loadCells(url, stride, getTree) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const kept = [];
  const node = new Ints();
  const level = new Ints();
  const parent = new Ints();
  const frames = new Ints();
  const stars = new Ints();
  const seen = new Map();
  let hasParent = true;
  let rest = '';
  const line = (s) => {
    if (!s) return;
    const id = node.n;
    node.push(+(re.node.exec(s)?.[1] ?? -1));
    const lv = +(re.level.exec(s)?.[1] ?? 0);
    level.push(lv);
    frames.push(+(re.frames.exec(s)?.[1] ?? 0));
    stars.push(+(re.stars.exec(s)?.[1] ?? 0));
    const p = re.parent.exec(s);
    if (!p) hasParent = false;
    parent.push(p ? +p[1] : -1);
    const n = (seen.get(lv) ?? 0) + 1;
    seen.set(lv, n);
    if (id % stride === 0 || n <= RARE) kept.push(JSON.parse(s));
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = rest + decoder.decode(value, { stream: true });
    let from = 0;
    for (let nl = text.indexOf('\n'); nl >= 0; nl = text.indexOf('\n', from)) {
      line(text.slice(from, nl));
      from = nl + 1;
    }
    rest = text.slice(from);
  }
  line(rest + decoder.decode());
  const total = node.n;

  const parents = parent.a.subarray(0, total);
  if (!hasParent && total) {
    // Older runs: the nearest ancestor cell of each cell's node, from tree.bin.
    try {
      const tree = parseTreeBin(await getTree());
      const n = tree.parent.length;
      const cellAt = new Int32Array(n).fill(-1);
      for (let i = 0; i < total; i++) if (node.a[i] < n) cellAt[node.a[i]] = i;
      const anc = new Int32Array(n).fill(-1);
      for (let j = 0; j < n; j++) anc[j] = cellAt[j] >= 0 ? cellAt[j] : tree.parent[j] >= 0 ? anc[tree.parent[j]] : -1;
      for (let i = 0; i < total; i++) {
        const p = node.a[i] < n ? tree.parent[node.a[i]] : -1;
        parents[i] = p >= 0 ? anc[p] : -1;
      }
    } catch {
      /* no tree.bin yet: no lines */
    }
  }
  const byId = new Map(kept.map((c) => [c.id, c]));
  for (const c of kept) {
    const p = parents[c.id];
    c.from = p >= 0 ? level.a[p] : null;
    let q = p;
    while (q >= 0 && !byId.has(q)) q = parents[q];
    c.parent = q >= 0 ? byId.get(q) : null;
  }
  // Exact totals over every cell, sampled or not: cells and first time per
  // area, and the cells whose parent is in another area (the transitions).
  const areas = new Map();
  const transitions = new Map();
  for (let i = 0; i < total; i++) {
    const a = areas.get(level.a[i]) ?? { n: 0, first: Infinity, stars: 0 };
    a.n++;
    a.first = Math.min(a.first, frames.a[i]);
    a.stars = Math.max(a.stars, stars.a[i]);
    areas.set(level.a[i], a);
    const p = parents[i];
    if (p >= 0 && level.a[p] !== level.a[i]) {
      const key = `${level.a[p]}>${level.a[i]}`;
      const t = transitions.get(key) ?? { from: level.a[p], to: level.a[i], n: 0, first: Infinity };
      t.n++;
      t.first = Math.min(t.first, frames.a[i]);
      transitions.set(key, t);
    }
  }
  return { cells: prepareCells(kept), total, stride, exact: { areas, transitions } };
}
