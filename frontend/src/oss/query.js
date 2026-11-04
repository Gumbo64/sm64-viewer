// Objective-scattershot cell queries: the objective model, value formatting,
// and a small formula language over the cells.
//
//   expr := and ('or' and)*        and := term ('and' term)*
//   term := 'not' term | '(' expr ')' | 'has(' Name ')' | ref op number
//   ref  := Name.field | field of the root objective | frames visits succ p id
//           | route saved imp (oss2 speed runs: the cell's key's route frame,
//             frames saved vs the route, times improved; absent elsewhere)
//   op   := = != < <= > >=
//
// A comparison with a field the cell doesn't have is false. A level can be
// written as 6.1 (level 6 area 1).

export const META = ['frames', 'visits', 'succ', 'p', 'id', 'route', 'saved', 'imp'];
const KEYWORDS = ['and', 'or', 'not'];
const OPS = ['=', '!=', '<', '<=', '>', '>='];

/**
 * Indexes objectives.json ([{ id, kind, name, doc, params, children, fields }],
 * id 0 the root). Each objective gets `label` (its name, or kind#id),
 * `parent`, `depth` and `subtree` (its id and its descendants'); `refs` maps
 * every field reference to { obj, idx, field }.
 */
export function buildModel(objectives) {
  const byId = new Map(objectives.map((o) => [o.id, { ...o, label: o.name || `${o.kind}#${o.id}`, parent: null, depth: 0 }]));
  const root = byId.get(0) ?? byId.values().next().value;
  const order = [];
  const visit = (o, depth) => {
    o.depth = depth;
    order.push(o);
    o.subtree = new Set([o.id]);
    for (const c of o.children ?? []) {
      const child = byId.get(c);
      if (!child) continue;
      child.parent = o.id;
      visit(child, depth + 1);
      for (const id of child.subtree) o.subtree.add(id);
    }
  };
  if (root) visit(root, 0);
  const byLabel = new Map(order.map((o) => [o.label, o]));
  const refs = new Map();
  for (const o of order)
    (o.fields ?? []).forEach((field, idx) => {
      const ref = { obj: o, idx, field, name: refName(o, field, root) };
      refs.set(`${o.label}.${field}`, ref);
      refs.set(ref.name, ref);
    });
  return { root, order, byId, byLabel, refs };
}

// The root's fields are written without its name: `keys`, not `root.keys`.
function refName(o, field, root) {
  return o === root && !META.includes(field) ? field : `${o.label}.${field}`;
}

/** The reference used for an objective's field in queries. */
export function fieldRef(model, objId, idx) {
  const o = model.byId.get(objId);
  return refName(o, o.fields[idx], model.root);
}

// "obj:idx" -> [obj, idx], parsed once.
const refParts = new Map();
const parts = (k) => {
  let p = refParts.get(k);
  if (!p) refParts.set(k, (p = k.split(':').map(Number)));
  return p;
};

// A cell's key entries as a read-only map "obj:idx" -> value, and the
// objectives it has, without a Map and a Set per cell (a run has up to a
// million cells; a key is about ten entries, so a scan is cheap).
class Values {
  constructor(key) {
    this.key = key;
  }
  get(k) {
    const [o, i] = parts(k);
    for (const e of this.key) if (e[0] === o && e[1] === i) return e[2];
    return undefined;
  }
  has(k) {
    return this.get(k) !== undefined;
  }
  *keys() {
    for (const [o, i] of this.key) yield `${o}:${i}`;
  }
  *[Symbol.iterator]() {
    for (const [o, i, v] of this.key) yield [`${o}:${i}`, v];
  }
}
class Objs {
  constructor(key) {
    this.key = key;
  }
  has(id) {
    for (const e of this.key) if (e[0] === id) return true;
    return false;
  }
}
// `values` and `objs` appear on first use.
const CELL = {
  get values() {
    return Object.defineProperty(this, 'values', { value: new Values(this.key) }).values;
  },
  get objs() {
    return Object.defineProperty(this, 'objs', { value: new Objs(this.key) }).objs;
  },
};

/** Adds `values` (map "obj:idx" -> value) and `objs` (has(objective id)) to each cell, lazily. */
export function prepareCells(cells) {
  for (const c of cells) Object.setPrototypeOf(c, CELL);
  return cells;
}

export const isPos = (field) => field.endsWith('pos');

/** A key value as shown: positions as world coordinates, levels as "L6 A1", actions in hex. */
export function formatValue(obj, field, v) {
  if (isPos(field)) {
    const q = [(v >> 20) & 0x3ff, (v >> 10) & 0x3ff, v & 0x3ff].map((n) => (n << 22) >> 22);
    const grid = obj?.params?.[`${field}_grid_log2`] ?? obj?.params?.grid_log2;
    return grid == null ? `q(${q.join(',')})` : `(${q.map((n) => n * 2 ** grid).join(',')})`;
  }
  if (field === 'level') return `L${v >> 8} A${v & 0xff}`;
  if (field === 'action') {
    // A Lens's action is a class: 0 other, then the groups listed in its `actions`.
    if (v >= 0 && v < 16) return ['other', ...(obj?.params?.actions ?? ['walking', 'long_jump'])][v]?.replace('_', ' ') ?? String(v);
    return `0x${(v >>> 0).toString(16).padStart(8, '0')}`; // runs from before the classes
  }
  return String(v);
}

/** A value as written in a query. */
export function queryValue(field, v) {
  return field === 'action' && (v < 0 || v >= 16) ? `0x${(v >>> 0).toString(16)}` : String(v);
}

// ---------- tokens ----------

/** Splits a query into { t: 'id'|'num'|'op'|'(' |')', text, pos }; throws { message, pos }. */
export function tokenize(text) {
  const out = [];
  const re = /\s*(?:(0x[0-9a-f]+|-?\d+(?:\.\d+)?|-?\.\d+)|([A-Za-z_][\w.#]*)|(!=|<=|>=|=|<|>)|([()]))/iy;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw { message: `Unexpected "${text.slice(pos).trim()[0]}"`, pos: pos + text.slice(pos).search(/\S/) };
    const start = m.index + m[0].length - m[0].trimStart().length;
    const t = m[1] ? 'num' : m[2] ? 'id' : m[3] ? 'op' : m[4];
    out.push({ t, text: m[0].trim(), pos: start });
    pos = re.lastIndex;
  }
  return out;
}

// ---------- parser ----------

/** Parses a query into an AST; an empty query gives null. Throws { message, pos }. */
export function parse(model, text) {
  const toks = tokenize(text);
  let i = 0;
  const peek = () => toks[i];
  const end = () => ({ pos: text.length });
  const fail = (message, tok = peek() ?? end()) => {
    throw { message, pos: tok.pos };
  };
  const isKw = (tok, kw) => tok?.t === 'id' && tok.text.toLowerCase() === kw;

  function expr() {
    let a = and();
    while (isKw(peek(), 'or')) {
      i++;
      a = { type: 'or', a, b: and() };
    }
    return a;
  }
  function and() {
    let a = term();
    while (isKw(peek(), 'and')) {
      i++;
      a = { type: 'and', a, b: term() };
    }
    return a;
  }
  function term() {
    const tok = peek();
    if (!tok) fail('Expected a condition');
    if (isKw(tok, 'not')) {
      i++;
      return { type: 'not', a: term() };
    }
    if (tok.t === '(') {
      i++;
      const a = expr();
      if (peek()?.t !== ')') fail('Expected ")"');
      i++;
      return a;
    }
    if (tok.t !== 'id' || KEYWORDS.includes(tok.text.toLowerCase())) fail(`Expected a field, has(…) or "(" instead of "${tok.text}"`, tok);
    i++;
    if (tok.text.toLowerCase() === 'has' && peek()?.t === '(') {
      i++;
      const name = peek();
      const obj = name?.t === 'id' && model.byLabel.get(name.text);
      if (!obj) fail(name ? `No objective "${name.text}"` : 'Expected an objective name', name);
      i++;
      if (peek()?.t !== ')') fail('Expected ")"');
      i++;
      return { type: 'has', obj };
    }
    const ref = META.includes(tok.text) ? { meta: tok.text } : model.refs.get(tok.text);
    if (!ref) fail(`No field "${tok.text}"`, tok);
    const op = peek();
    if (op?.t !== 'op') fail(`Expected one of ${OPS.join(' ')} after ${tok.text}`);
    i++;
    const num = peek();
    if (num?.t !== 'num') fail('Expected a number');
    i++;
    return { type: 'cmp', ref, op: op.text, value: literal(ref, num.text) };
  }

  if (toks.length === 0) return null;
  const ast = expr();
  if (i < toks.length) fail(`Expected "and" or "or" instead of "${peek().text}"`);
  return ast;
}

function literal(ref, text) {
  if (/^0x/i.test(text)) return parseInt(text, 16) | 0;
  if (ref.field === 'level' && text.includes('.')) {
    const [l, a] = text.split('.');
    return Number(l) * 256 + Number(a);
  }
  return Number(text);
}

// ---------- evaluation ----------

const CMP = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
};

/** Does a prepared cell match the AST (null matches everything)? */
export function matches(ast, cell) {
  if (!ast) return true;
  switch (ast.type) {
    case 'and':
      return matches(ast.a, cell) && matches(ast.b, cell);
    case 'or':
      return matches(ast.a, cell) || matches(ast.b, cell);
    case 'not':
      return !matches(ast.a, cell);
    case 'has':
      for (const id of ast.obj.subtree) if (cell.objs.has(id)) return true;
      return false;
    case 'cmp': {
      const v = ast.ref.meta ? cell[ast.ref.meta] : cell.values.get(`${ast.ref.obj.id}:${ast.ref.idx}`);
      return v !== undefined && CMP[ast.op](v, ast.value);
    }
  }
  return false;
}

/** Parses and filters: { cells, error } where error is { message, pos } or null. */
export function runQuery(model, cells, text) {
  try {
    const ast = parse(model, text);
    return { cells: cells.filter((c) => matches(ast, c)), error: null };
  } catch (e) {
    if (e?.message === undefined || e.pos === undefined) throw e;
    return { cells, error: e };
  }
}

// ---------- editing ----------

/**
 * Inserts a condition at the cursor, joining it with " and " when it follows
 * a complete term (and replacing a bare reference it starts with). Returns
 * { text, cursor }.
 */
export function insertCondition(text, cursor, snippet) {
  let before = text.slice(0, cursor).trimEnd();
  const after = text.slice(cursor);
  let toks = [];
  try {
    toks = tokenize(before);
  } catch {
    // A half-typed query: just insert.
  }
  const last = toks[toks.length - 1];
  if (last?.t === 'id' && snippet.startsWith(`${last.text} `)) {
    before = before.slice(0, last.pos).trimEnd();
    toks.pop();
  }
  const prev = toks[toks.length - 1];
  const complete = prev && (prev.t === 'num' || prev.t === ')');
  const sep = !before ? '' : complete ? ' and ' : before.endsWith('(') ? '' : ' ';
  const head = before + sep + snippet;
  const tail = after && !/^\s/.test(after) && !snippet.endsWith(' ') ? ` ${after}` : after;
  return { text: head + tail, cursor: head.length };
}

/** Completions for the word being typed: field references, has(…), meta fields, keywords. */
export function completions(model, word) {
  if (!word) return [];
  const w = word.toLowerCase();
  const all = [
    ...[...new Set([...model.refs.values()].map((r) => r.name))],
    ...model.order.map((o) => `has(${o.label})`),
    ...META,
    ...KEYWORDS,
  ];
  return all.filter((s) => s.toLowerCase().startsWith(w) && s !== word).slice(0, 12);
}
