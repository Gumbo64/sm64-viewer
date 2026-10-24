// The Objective-RRT tree view, mounted into a container by TreeView.jsx.
// Generated from objective-rrt/viz/index.html by objective-rrt/tools/port_tree.py:
// edit that page and rerun the script instead of editing this file.
//
// opts: { api, staticBase, staticOnly?, geometry?(level, area), run?, zone?, node?, onPlay({ url, start, title, state }), onBack(), onState({ run, zone, node }) }
/* eslint-disable */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './tree.css';

const TEMPLATE = "<header>\n    <button id=\"back\" title=\"Back to the replay list\">\u2190 Replays</button>\n    <h1>Objective-RRT tree</h1>\n    <select id=\"run\" aria-label=\"Run\"></select>\n    <span class=\"live\"><span class=\"dot\" id=\"dot\"></span><span id=\"updated\">\u2014</span></span>\n    <span class=\"stat\">states <b id=\"s-nodes\">\u2014</b></span>\n    <span class=\"stat\">frontier <b id=\"s-front\">\u2014</b></span>\n    <span class=\"stat\">search <b id=\"s-time\">\u2014</b></span>\n    <span class=\"stat\">emulated <b id=\"s-fps\">\u2014</b></span>\n  </header>\n\n  <aside>\n    <h2>World map</h2>\n    <svg id=\"map\" aria-label=\"Zones and the transitions between them\"></svg>\n    <h2>Levels and areas</h2>\n    <div id=\"zones\"></div>\n    <h2>Transitions from this area</h2>\n    <div id=\"trans\"></div>\n  </aside>\n\n  <main>\n    <div id=\"view\"></div>\n    <div class=\"overlay\">\n      <span class=\"title\" id=\"zone-title\">\u2014</span>\n      <span class=\"muted\">colour</span>\n      <button data-mode=\"via\" aria-pressed=\"true\">Objective</button>\n      <button data-mode=\"frame\">Game time</button>\n      <button data-mode=\"start\">Times started from</button>\n      <button data-mode=\"rate\">Success rate</button>\n      <button data-mode=\"progress\">Stars &amp; keys</button>\n      <button id=\"edges\" aria-pressed=\"true\">Edges</button>\n      <button id=\"geom\" title=\"Level collision geometry from the decomp\">Geometry: solid</button>\n      <button id=\"fit\">Fit</button>\n    </div>\n    <div id=\"tip\"></div>\n    <div class=\"scale\" id=\"scale\"></div>\n  </main>\n\n  <aside class=\"right\">\n    <h2>State</h2>\n    <div id=\"node\" class=\"empty\">Click a state.</div>\n    <h2 id=\"legend-title\">Objectives that made the states here</h2>\n    <div class=\"legend\" id=\"legend\"></div>\n    <h2>Objective types (whole run)</h2>\n    <div id=\"kinds\"></div>\n  </aside>";

export function mountTree(root, opts) {
root.classList.add('tree-app');
root.innerHTML = TEMPLATE;
const api = opts.api;
const $ = (id) => root.querySelector('#' + id);
let disposed = false, timer = null;
// Tells the app the run, area and selection, so the page URL can restore them.
const report = () => opts.onState?.({ run, zone: zoneKey, node: selected });


const NAMES = {
  'Castle Grounds': 'Castle grounds', 'Castle': 'Castle', 'Castle Courtyard': 'Courtyard',
  'Bob': 'Bob-omb Battlefield', 'Wf': "Whomp's Fortress", 'Jrb': 'Jolly Roger Bay', 'Ccm': 'Cool, Cool Mountain',
  'Bbh': "Big Boo's Haunt", 'Hmc': 'Hazy Maze Cave', 'Lll': 'Lethal Lava Land', 'Ssl': 'Shifting Sand Land',
  'Ddd': 'Dire, Dire Docks', 'Sl': "Snowman's Land", 'Wdw': 'Wet-Dry World', 'Ttm': 'Tall, Tall Mountain',
  'Thi': 'Tiny-Huge Island', 'Ttc': 'Tick Tock Clock', 'Rr': 'Rainbow Ride', 'Pss': "Peach's Secret Slide",
  'Sa': 'Secret Aquarium', 'Wmotr': 'Wing Mario over the Rainbow', 'Totwc': 'Tower of the Wing Cap',
  'Cotmc': 'Cavern of the Metal Cap', 'Vcutm': 'Vanish Cap under the Moat', 'Bitdw': 'Bowser in the Dark World',
  'Bitfs': 'Bowser in the Fire Sea', 'Bits': 'Bowser in the Sky',
};
// Categorical colours come from a hash of the name (FNV-1a, spread round the
// hue circle by the golden ratio), so a category has the same colour in every
// run, area and session.
function hashColor(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const hue = ((h * 0.6180339887) % 1) * 360;
  const light = 52 + (h >>> 8) % 3 * 8;
  return `hsl(${hue.toFixed(0)}, 68%, ${light}%)`;
}
// Continuous scales (stops from matplotlib's viridis and magma; red-yellow-green for rates).
const SCALES = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  magma: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'],
  rdylgn: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
};
function scaleColor(name, t) {
  const stops = SCALES[name];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = new THREE.Color(stops[i]), b = new THREE.Color(stops[i + 1]);
  return a.lerp(b, x - i);
}
const progressLabel = (n) => `${n.stars}★ ${n.keys}🔑`;

let levelNames = {};
let run = null, nodes = [], byId = [], zones = new Map(), kindsSeen = [], lastSize = -1, lastIds = 0;
let zoneKey = null, mode = 'via', showEdges = true, hidden = new Set(), selected = null, newSince = 0;
const colorOf = new Map();
const kindColor = (k) => { if (!colorOf.has(k)) colorOf.set(k, hashColor(k)); return colorOf.get(k); };
// The category a state belongs to in a categorical mode.
const category = (n) => (mode === 'progress' ? progressLabel(n) : n.via);
const categorical = () => mode === 'via' || mode === 'progress';

const zk = (n) => `${n.level}:${n.area}`;
const levelName = (l) => NAMES[levelNames[l]] ?? levelNames[l] ?? `Level ${l}`;
const zoneName = (key) => { const [l, a] = key.split(':'); return `${levelName(+l)} · area ${a}`; };
const clock = (f) => { const s = f / 30; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- data sources ----------
// Live: the tree server (tools/viz.py) at `api`. Static: files written by
// tools/export_tree.py under `base` (index.json, levels.json, <run>/...), for
// a static host such as GitHub Pages; replays are rebuilt from tree.bin here.
const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
function liveSource(api) {
  return {
    live: true,
    runs: () => getJson(`${api}/api/runs`),
    levels: () => getJson(`${api}/api/levels`),
    nodesCsv: async (run) => { const r = await fetch(`${api}/runs/${run}/nodes.csv`); return r.ok ? r.text() : null; },
    summary: (run) => getJson(`${api}/runs/${run}/summary.json`),
    node: (run, id) => getJson(`${api}/api/node?run=${encodeURIComponent(run)}&id=${id}`),
    geometry: (level, area) => getJson(`${api}/api/geometry?level=${level}&area=${area}`),
    m64: async (run, id) => `${api}/api/m64?run=${encodeURIComponent(run)}&node=${id}`,
  };
}
function staticSource(base) {
  const trees = new Map();
  // tree.bin: u32 count, then per record i32 parent (-1 = boot) and u32 n,
  // then n inputs of 4 bytes; record 0 is the boot inputs, record i+1 node i.
  async function tree(run) {
    if (!trees.has(run)) trees.set(run, (async () => {
      const buf = await (await fetch(`${base}${run}/tree.bin`)).arrayBuffer();
      const dv = new DataView(buf);
      const count = dv.getUint32(0, true);
      const parent = new Int32Array(count), at = new Uint32Array(count), len = new Uint32Array(count);
      let pos = 4;
      for (let i = 0; i < count; i++) {
        parent[i] = dv.getInt32(pos, true); len[i] = dv.getUint32(pos + 4, true); at[i] = pos + 8;
        pos += 8 + 4 * len[i];
      }
      return { buf, parent, at, len };
    })());
    return trees.get(run);
  }
  return {
    live: false,
    runs: () => getJson(`${base}index.json`),
    levels: () => getJson(`${base}levels.json`),
    nodesCsv: async (run) => { const r = await fetch(`${base}${run}/nodes.csv`); return r.ok ? r.text() : null; },
    summary: (run) => getJson(`${base}${run}/summary.json`),
    node: async (run, id) => (await getJson(`${base}${run}/info/${Math.floor(id / 1000)}.json`))[id] ?? { made: null, tried: [] },
    geometry: (level, area) => getJson(`${base}geometry/${level}-${area}.json`),
    m64: async (run, id) => {
      const t = await tree(run);
      const chain = [];
      for (let i = id; i >= 0; i = t.parent[i + 1]) chain.push(i + 1);
      chain.push(0);
      const parts = chain.reverse().map((r) => new Uint8Array(t.buf, t.at[r], 4 * t.len[r]));
      return URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
    },
  };
}
let data = null;

// ---------- data ----------
async function loadRuns() {
  const runs = await data.runs();
  const sel = $('run');
  const cur = sel.value;
  sel.innerHTML = runs.map((r) => `<option value="${r.name}">${r.name}${r.live ? ' · live' : ''}</option>`).join('');
  sel.value = cur && runs.some((r) => r.name === cur) ? cur : runs[0]?.name;
  return runs;
}

function parseCsv(text) {
  const lines = text.split('\n');
  const head = lines[0].split(',');
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    out.push({
      id: +c[idx.id], parent: +c[idx.parent], depth: +c[idx.depth], x: +c[idx.x], y: +c[idx.y], z: +c[idx.z],
      level: +c[idx.level], area: +c[idx.area], stars: +c[idx.stars], keys: +c[idx.keys], coins: +c[idx.coins],
      frame: +c[idx.frame], via: c[idx.via], as_b: +c[idx.as_b], as_start: +c[idx.as_start],
      successes: +c[idx.successes], added: +c[idx.added], barren: +c[idx.barren],
    });
  }
  return out;
}

async function refresh(force) {
  if (!run) return;
  let text;
  try {
    text = await data.nodesCsv(run);
    if (text == null) return;
  } catch { return; }
  if (!force && text.length === lastSize) return;
  lastSize = text.length;
  const prevCount = nodes.length;
  nodes = parseCsv(text);
  byId = []; for (const n of nodes) byId[n.id] = n;
  newSince = force ? nodes.length : prevCount;
  zones = new Map();
  for (const n of nodes) {
    const k = zk(n);
    if (!zones.has(k)) zones.set(k, { key: k, level: n.level, area: n.area, nodes: [], first: n.frame, stars: 0, out: new Map() });
    const z = zones.get(k);
    z.nodes.push(n); z.first = Math.min(z.first, n.frame); z.stars = Math.max(z.stars, n.stars);
    const p = byId[n.parent];
    if (p && zk(p) !== k) {
      const from = zones.get(zk(p));
      if (from) { const e = from.out.get(k) ?? { n: 0, via: new Map() }; e.n++; e.via.set(n.via, (e.via.get(n.via) ?? 0) + 1); from.out.set(k, e); }
    }
  }
  for (const n of nodes) kindColor(n.via);
  if (!zoneKey || !zones.has(zoneKey)) zoneKey = [...zones.values()].sort((a, b) => b.nodes.length - a.nodes.length)[0]?.key;
  await loadSummary();
  renderZones(); renderMap(); renderTrans(); renderLegend(); buildScene(force);
  if (selected != null && byId[selected]) showNode(selected, false);
}

async function loadSummary() {
  try {
    const s = await data.summary(run);
    $('s-nodes').textContent = s.nodes.toLocaleString();
    $('s-front').textContent = `${s.frontier.keys} keys · ${s.frontier.stars} stars`;
    $('s-time').textContent = `${Math.floor(s.secs / 60)}m ${Math.round(s.secs % 60)}s`;
    $('s-fps').textContent = `${Math.round(s.frames / Math.max(1, s.secs)).toLocaleString()} frames/s`;
    renderKinds(s);
  } catch { /* summary not written yet */ }
}

// ---------- side panels ----------
function renderZones() {
  const max = Math.max(...[...zones.values()].map((z) => z.nodes.length));
  const byLevel = new Map();
  for (const z of [...zones.values()].sort((a, b) => a.first - b.first)) {
    if (!byLevel.has(z.level)) byLevel.set(z.level, []);
    byLevel.get(z.level).push(z);
  }
  $('zones').innerHTML = [...byLevel].map(([l, zs]) =>
    `<div class="lvl">${esc(levelName(l))}</div>` + zs.map((z) => `
      <div class="zone${z.key === zoneKey ? ' sel' : ''}" data-zone="${z.key}">
        <span>Area ${z.area} <span class="area">· from ${clock(z.first)}${z.stars ? ` · ${z.stars}★` : ''}</span></span>
        <span class="n">${z.nodes.length.toLocaleString()}</span>
        <span class="bar"><i style="width:${(100 * z.nodes.length / max).toFixed(1)}%"></i></span>
      </div>`).join('')).join('');
}

function renderTrans() {
  const z = zones.get(zoneKey);
  const rows = z ? [...z.out].sort((a, b) => b[1].n - a[1].n) : [];
  $('trans').innerHTML = rows.length ? `<table><tr><th>To</th><th class="r">States</th><th>Via</th></tr>` +
    rows.map(([k, e]) => `<tr><td><span class="jump" data-zone="${k}">${esc(zoneName(k))}</span></td><td class="r">${e.n}</td>
      <td class="muted">${[...e.via].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${esc(v)} ${n}`).join(', ')}</td></tr>`).join('') + '</table>'
    : '<div class="empty">None yet.</div>';
}

function renderMap() {
  const svg = $('map');
  const W = svg.clientWidth || 270, H = 190;
  const zs = [...zones.values()].sort((a, b) => a.first - b.first);
  // Ring layout in order of first arrival; castle zones near the middle.
  const pos = new Map();
  const castle = zs.filter((z) => [6, 16, 26].includes(z.level));
  const rest = zs.filter((z) => !castle.includes(z));
  castle.forEach((z, i) => pos.set(z.key, [W / 2 + (i - (castle.length - 1) / 2) * 62, H / 2]));
  rest.forEach((z, i) => { const a = -Math.PI / 2 + (i / Math.max(1, rest.length)) * Math.PI * 2;
    pos.set(z.key, [W / 2 + Math.cos(a) * (W / 2 - 34), H / 2 + Math.sin(a) * (H / 2 - 22)]); });
  const max = Math.max(1, ...zs.map((z) => z.nodes.length));
  let edges = '';
  for (const z of zs) for (const [k, e] of z.out) {
    const [x1, y1] = pos.get(z.key), [x2, y2] = pos.get(k) ?? [0, 0];
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15, my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
    edges += `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke="#8b93a7" stroke-opacity="${Math.min(0.9, 0.25 + Math.log10(e.n + 1) / 3)}" stroke-width="${1 + Math.log10(e.n + 1)}" marker-end="url(#arr)"/>`;
  }
  const circles = zs.map((z) => { const [x, y] = pos.get(z.key); const r = 5 + 10 * Math.sqrt(z.nodes.length / max);
    const sel = z.key === zoneKey;
    return `<g class="z" data-zone="${z.key}"><title>${esc(zoneName(z.key))}: ${z.nodes.length} states</title>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${sel ? '#f7c948' : '#2b3242'}" stroke="${sel ? '#f7c948' : '#4a5368'}"/>
      <text x="${x}" y="${y + r + 9}" text-anchor="middle">${esc(shortName(z))}</text></g>`; }).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#8b93a7"/></marker></defs>${edges}${circles}`;
}
const shortName = (z) => { const n = levelNames[z.level] ?? `L${z.level}`; return `${n.length <= 4 ? n.toUpperCase() : n.split(' ').map((w) => w[0]).join('')} ${z.area}`; };

// The legend for the current colour mode: categories with counts (click to
// hide), or the continuous scale as a gradient with its range.
let scaleRange = null;
function renderLegend() {
  const z = zones.get(zoneKey);
  const title = { via: 'Objectives that made the states here', progress: 'Stars and keys of the states here',
    frame: 'Game time', start: 'Times used as an attempt start', rate: 'Success rate of attempts started here' }[mode];
  $('legend-title').textContent = title;
  if (categorical()) {
    const counts = new Map();
    for (const n of z?.nodes ?? []) { const k = category(n); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const order = mode === 'progress'
      ? [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      : [...counts].sort((a, b) => b[1] - a[1]);
    $('legend').innerHTML = order.map(([k, n]) =>
      `<div class="row${hidden.has(k) ? ' off' : ''}" data-kind="${esc(k)}"><span class="sw" style="background:${kindColor(k)}"></span>${esc(k)}<span class="n">${n.toLocaleString()}</span></div>`).join('')
      || '<div class="empty">No states.</div>';
    return;
  }
  const name = { frame: 'viridis', start: 'magma', rate: 'rdylgn' }[mode];
  const grad = SCALES[name].join(', ');
  const [lo, hi] = scaleRange ?? ['', ''];
  const note = { frame: 'early → late', start: 'log scale; grey = never started from', rate: 'grey = never started from' }[mode];
  $('legend').innerHTML = `<div style="height:12px;border-radius:3px;background:linear-gradient(to right, ${grad})"></div>
    <div style="display:flex;justify-content:space-between" class="muted small"><span>${esc(lo)}</span><span>${esc(hi)}</span></div>
    <div class="muted small">${note}</div>`;
}

function renderKinds(s) {
  const ks = Object.entries(s.kinds).sort((a, b) => b[1].attempts - a[1].attempts);
  $('kinds').innerHTML = `<table><tr><th>Type</th><th class="r">Tries</th><th class="r">OK</th><th class="r">Added</th><th class="r">Yield</th></tr>` +
    ks.map(([k, v]) => { const y = (v.added + 20 * v.frontier + 10 * v.new_zones + v.value) / Math.max(1, (v.frames + 500 * v.attempts) / 1000);
      return `<tr><td><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${kindColor(k)};margin-right:5px"></span>${esc(k)}</td>
      <td class="r">${v.attempts.toLocaleString()}</td><td class="r">${v.attempts ? Math.round(100 * v.successes / v.attempts) + '%' : '—'}</td>
      <td class="r">${v.added.toLocaleString()}</td><td class="r">${y.toFixed(2)}</td></tr>`; }).join('') + '</table>' ;
}

async function showNode(id, focus = true) {
  selected = id;
  report();
  const n = byId[id];
  if (!n) return;
  if (zk(n) !== zoneKey) { zoneKey = zk(n); renderZones(); renderMap(); renderTrans(); renderLegend(); buildScene(true); }
  drawSelection();
  const el = $('node');
  el.className = '';
  el.innerHTML = `<div class="kv">
      <span>State</span><span><b>#${id}</b> · depth ${n.depth}</span>
      <span>Zone</span><span>${esc(zoneName(zk(n)))}</span>
      <span>Game time</span><span>${clock(n.frame)} (frame ${n.frame.toLocaleString()})</span>
      <span>Progress</span><span>${n.stars}★ · ${n.keys} keys · ${n.coins} coins</span>
      <span>Position</span><span>${n.x}, ${n.y}, ${n.z}</span>
      <span>Parent</span><span>${n.parent >= 0 ? `<span class="jump" data-node="${n.parent}">#${n.parent}</span>` : 'boot'}</span>
      <span>Sampled</span><span>as b ${n.as_b} · as start ${n.as_start} · ${n.successes} ok · ${n.added} added${n.barren >= 10 ? ` · <span class="bad">barren ${n.barren}</span>` : ''}</span>
    </div>
    <div class="btns"><button data-play="${id}">▶ Play in viewer</button><button data-download="${id}">Download .m64</button></div>
    <h2>Made by</h2><div id="made" class="muted">Loading…</div>
    <h2>Objectives tried from here</h2><div id="tried" class="muted">Loading…</div>`;
  try {
    const d = await data.node(run, id);
    if (selected !== id) return;
    const m = d.made;
    $('made').innerHTML = m
      ? `<div class="kv"><span>Objective</span><span><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${kindColor(m.kind)}"></span> ${esc(m.kind)}</span>
         <span>Key</span><span class="key">${esc(m.key)}</span>
         <span>Result</span><span>${m.success ? '<span class="ok">met</span>' : '<span class="muted">not met · kept for its progress</span>'}</span>
         <span>Chain</span><span>${m.len > 1 ? `goal ${m.stage + 1} of ${m.len} (attempt ${m.chain})` : 'single goal'}</span>
         <span>From</span><span><span class="jump" data-node="${m.start ?? n.parent}">#${m.start ?? n.parent}</span></span></div>`
      : (id === 0 ? 'The root: power-on, menus and intro.' : 'Not in events.jsonl.');
    const t = d.tried;
    const byKey = new Map();
    // Entries are single attempts (live server) or already grouped by
    // objective (static exports: n, ok, added[]).
    let attempts = 0;
    for (const e of t) {
      const g = byKey.get(e.key) ?? { kind: e.kind, key: e.key, n: 0, ok: 0, added: [] };
      g.n += e.n ?? 1; g.ok += e.ok ?? (e.success ? 1 : 0); attempts += e.n ?? 1;
      if (e.added != null) g.added.push(...[].concat(e.added));
      byKey.set(e.key, g);
    }
    $('tried').innerHTML = t.length
      ? `<div class="muted" style="margin-bottom:4px">${attempts.toLocaleString()} attempts, ${byKey.size} objectives</div><table><tr><th>Objective</th><th class="r">Tries</th><th class="r">Met</th><th>New states</th></tr>` +
        [...byKey.values()].sort((a, b) => b.n - a.n).map((g) => `<tr><td title="${esc(g.key)}"><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${kindColor(g.kind)};margin-right:4px"></span>${esc(g.kind)}<div class="key muted">${esc(g.key.replace(/^\S+\s/, ''))}</div></td>
          <td class="r">${g.n}</td><td class="r ${g.ok ? 'ok' : 'bad'}">${g.ok}</td>
          <td>${g.added.slice(0, 6).map((a) => `<span class="jump" data-node="${a}">#${a}</span>`).join(' ')}${g.added.length > 6 ? ` +${g.added.length - 6}` : ''}</td></tr>`).join('') + '</table>'
      : 'None yet.';
  } catch { $('made').textContent = 'Could not load events.'; }
}

// ---------- 3D ----------
const view = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch {
  // No WebGL: the panels still work; the 3D view says why it's empty.
  view.innerHTML = '<div class="empty" style="padding:60px 20px">This browser has no WebGL, so the 3D view is off. The panels still update.</div>';
  renderer = { domElement: document.createElement('canvas'), setSize() {}, setPixelRatio() {}, render() {} };
}
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1015');
const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Left drag pans in the screen plane, middle drag pans across the ground
// (the horizontal plane), right drag orbits, wheel zooms; a left click
// without dragging selects a state.
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
renderer.domElement.addEventListener('pointerdown', (e) => { controls.screenSpacePanning = e.button === 0; }, true);
// Stop the browser's middle-click autoscroll over the view.
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
let grid = null;
let points = null, lines = null, fresh = null, selMesh = null, pathLine = null, shown = [];
// Everything is drawn in game units inside `world`, so mirroring is one scale.
const world = new THREE.Group();
scene.add(world);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);
let geomMode = 'solid', mirror = false, geomMesh = null, geomKey = null;
// Geometry is solid by default; areas with a roof or ceiling over the play
// space start see-through so the tree inside shows ("level:area", or a level
// for all its areas). A choice made with the button is remembered per area.
const SEE_THROUGH = new Set([
  '6',     // castle inside: lobby, upstairs, basement
  '4',     // Big Boo's Haunt
  '7',     // Hazy Maze Cave
  '14',    // Tick Tock Clock
  '28',    // Cavern of the Metal Cap
  '18',    // Vanish Cap under the Moat
  '20',    // Secret Aquarium
  '27',    // Peach's Secret Slide
  '8:2',   // Shifting Sand Land, inside the pyramid
  '8:3',   // Shifting Sand Land, Eyerok's room
  '12:2',  // Jolly Roger Bay, the sunken ship
  '22:2',  // Lethal Lava Land, inside the volcano
  '5:2',   // Cool, Cool Mountain, the slide
  '10:2',  // Snowman's Land, the igloo
  '13:3',  // Tiny-Huge Island, Wiggler's room
  '23:1',  // Dire, Dire Docks, the first tunnel area
  '36:2', '36:3', '36:4', // Tall, Tall Mountain, the slide
]);
const GEOM_PREFS = 'obrrt-tree:geometry';
function geomPrefs() {
  try { return JSON.parse(localStorage.getItem(GEOM_PREFS) ?? '{}'); } catch { return {}; }
}
function defaultGeomMode(key) {
  const saved = geomPrefs()[key];
  if (saved) return saved;
  return SEE_THROUGH.has(key) || SEE_THROUGH.has(key.split(':')[0]) ? 'ghost' : 'solid';
}
const geomCache = new Map();

// Surface colours: floors light, walls darker, ceilings darkest; special
// surfaces by what they do.
function surfaceColor(type, ny) {
  if (/PAINTING/.test(type)) return '#c9a227';
  if (/BURNING/.test(type)) return '#b8442e';
  if (/WATER/.test(type)) return '#2f6fb0';
  if (/WARP/.test(type)) return '#8a5cc7';
  if (/HANGABLE/.test(type)) return '#4f8a6a';
  if (/SLIPPERY/.test(type) && !/NOT_SLIPPERY/.test(type)) return ny > 0.5 ? '#7d8fae' : '#4a5670';
  return ny > 0.5 ? '#6b7486' : ny < -0.5 ? '#2a2f3b' : '#454c5c';
}

async function loadGeometry() {
  const key = zoneKey;
  if (geomKey === key && geomMesh) { applyGeomMode(); return; }
  if (geomMesh) { world.remove(geomMesh); geomMesh.traverse((o) => o.geometry?.dispose()); geomMesh = null; }
  geomKey = key;
  if (key) geomMode = defaultGeomMode(key);
  if (!key) return;
  const [level, area] = key.split(':');
  let d = geomCache.get(key);
  if (!d) {
    try { d = await data.geometry(level, area); } catch { return; }
    geomCache.set(key, d);
  }
  if (geomKey !== key) return;
  const v = d.v, t = d.t;
  const pos = [], col = [], c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), e = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (let i = 0; i < t.length / 3; i++) {
    const type = d.types[d.s[i]] ?? '';
    if (/DEATH_PLANE/.test(type)) continue;
    const [i0, i1, i2] = [t[3 * i], t[3 * i + 1], t[3 * i + 2]];
    a.set(v[3 * i0], v[3 * i0 + 1], v[3 * i0 + 2]); b.set(v[3 * i1], v[3 * i1 + 1], v[3 * i1 + 2]); e.set(v[3 * i2], v[3 * i2 + 1], v[3 * i2 + 2]);
    nrm.subVectors(b, a).cross(new THREE.Vector3().subVectors(e, a)).normalize();
    c.set(surfaceColor(type, nrm.y));
    for (const p of [a, b, e]) { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })));
  for (const [x1, z1, x2, z2, y] of d.water) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(z2 - z1)),
      new THREE.MeshBasicMaterial({ color: 0x3d8bd9, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    w.rotation.x = -Math.PI / 2;
    w.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    group.add(w);
  }
  group.renderOrder = -1;
  geomMesh = group;
  world.add(group);
  applyGeomMode();
}

function applyGeomMode() {
  const label = { ghost: 'see-through', solid: 'solid', off: 'off' }[geomMode];
  $('geom').textContent = `Geometry: ${label}`;
  $('geom').setAttribute('aria-pressed', geomMode !== 'off');
  if (!geomMesh) return;
  geomMesh.visible = geomMode !== 'off';
  const m = geomMesh.children[0].material;
  m.transparent = geomMode === 'ghost';
  m.opacity = geomMode === 'ghost' ? 0.28 : 1;
  m.depthWrite = geomMode !== 'ghost';
  m.needsUpdate = true;
}

function nodeColor(n, stats) {
  const c = new THREE.Color();
  if (categorical()) return c.set(kindColor(category(n)));
  if (mode === 'frame') return scaleColor('viridis', (n.frame - stats.f0) / Math.max(1, stats.f1 - stats.f0));
  if (mode === 'start') return n.as_start ? scaleColor('magma', 0.15 + 0.85 * Math.log(1 + n.as_start) / Math.log(1 + stats.s1)) : c.set('#3a4152');
  if (mode === 'rate') return n.as_start ? scaleColor('rdylgn', n.successes / n.as_start) : c.set('#3a4152');
  return c;
}

function buildScene(fit) {
  for (const o of [points, lines, fresh]) if (o) { world.remove(o); o.geometry.dispose(); }
  const z = zones.get(zoneKey);
  $('zone-title').textContent = z ? `${zoneName(zoneKey)} · ${z.nodes.length.toLocaleString()} states` : '—';
  if (!z) return;
  shown = z.nodes.filter((n) => !(categorical() && hidden.has(category(n))));
  const stats = { f0: Infinity, f1: 0, s1: 1, st1: 0 };
  for (const n of shown) { stats.f0 = Math.min(stats.f0, n.frame); stats.f1 = Math.max(stats.f1, n.frame); stats.s1 = Math.max(stats.s1, n.as_start); stats.st1 = Math.max(stats.st1, n.stars); }
  const pos = new Float32Array(shown.length * 3), col = new Float32Array(shown.length * 3);
  const fpos = [];
  shown.forEach((n, i) => {
    pos.set([n.x, n.y, n.z], i * 3);
    nodeColor(n, stats).toArray(col, i * 3);
    if (n.id >= newSince && newSince > 0 && newSince < nodes.length) fpos.push(n.x, n.y, n.z);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  points = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }));
  world.add(points);
  if (fpos.length) {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fresh = new THREE.Points(fg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0.9 }));
    world.add(fresh);
    const born = performance.now();
    const fade = () => { if (!fresh || fresh.geometry !== fg) return; const t = (performance.now() - born) / 4000;
      fresh.material.opacity = Math.max(0, 0.9 * (1 - t)); if (t < 1) requestAnimationFrame(fade); };
    fade();
  } else fresh = null;
  if (showEdges) {
    const lp = [], lc = [];
    for (const n of shown) {
      const p = byId[n.parent];
      if (!p || zk(p) !== zoneKey) continue;
      lp.push(p.x, p.y, p.z, n.x, n.y, n.z);
      const c = new THREE.Color(kindColor(n.via)).multiplyScalar(0.5);
      lc.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
    world.add(lines);
  } else lines = null;
  if (fit) fitView();
  drawSelection();
  loadGeometry();
  scaleRange = { frame: [clock(stats.f0), clock(stats.f1)], start: ['1', String(stats.s1)], rate: ['0%', '100%'] }[mode] ?? null;
  renderLegend();
  const scale = { via: 'Colour: the objective that made each state (same colour in every run).', frame: 'Colour: game time (viridis, early to late).',
    start: 'Colour: times used as an attempt start (magma, log), grey = never.', rate: 'Colour: success rate of attempts from it (red 0% to green 100%).',
    progress: 'Colour: stars and keys (same colour in every run).' }[mode];
  $('scale').textContent = `${scale}  White = new since the last update.`;
}

function fitView() {
  const z = zones.get(zoneKey);
  if (!z || !z.nodes.length) return;
  const box = new THREE.Box3();
  for (const n of z.nodes) box.expandByPoint(new THREE.Vector3(n.x, n.y, mirror ? -n.z : n.z));
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 500);
  controls.target.copy(c);
  camera.position.set(c.x, c.y + r * 0.8, c.z + (mirror ? -1 : 1) * r * 0.9);
  camera.near = r / 1000; camera.far = r * 50; camera.updateProjectionMatrix();
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
  // The camera starts behind and above the area's centre, looking towards
  // -z (into the castle from the grounds).
  grid = new THREE.GridHelper(Math.max(size.x, size.z) * 1.3 + 400, 24, 0x2b3242, 0x1b1f2a);
  grid.position.set(c.x, box.min.y - 5, c.z);
  scene.add(grid);
  raycaster.params.Points.threshold = r / 150;
}

function drawSelection() {
  for (const o of [selMesh, pathLine]) if (o) { world.remove(o); o.geometry.dispose(); }
  selMesh = pathLine = null;
  const n = byId[selected];
  if (!n || zk(n) !== zoneKey) return;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([n.x, n.y, n.z], 3));
  selMesh = new THREE.Points(sg, new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, color: 0xf7c948 }));
  world.add(selMesh);
  // The path from the zone's entry to it.
  const pts = [];
  for (let m = n; m && zk(m) === zoneKey; m = byId[m.parent]) pts.push(new THREE.Vector3(m.x, m.y, m.z));
  if (pts.length > 1) {
    pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff }));
    world.add(pathLine);
  }
}

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tip = $('tip');
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const hit = points ? raycaster.intersectObject(points)[0] : null;
  return hit ? shown[hit.index] : null;
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button === 0 && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) { const n = pick(e); if (n) showNode(n.id); }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) { tip.style.display = 'none'; return; }
  const n = pick(e);
  if (!n) { tip.style.display = 'none'; return; }
  const r = view.getBoundingClientRect();
  tip.style.display = 'block';
  tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`;
  tip.innerHTML = `#${n.id} · <span style="color:${kindColor(n.via)}">${esc(n.via)}</span> · ${clock(n.frame)}${n.as_start ? ` · started from ${n.as_start}×` : ''}`;
});

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
const resizeObs = new ResizeObserver(resize);
resizeObs.observe(view);
(function loop() { if (disposed) return; controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

// ---------- events ----------
// Play opens the state's replay in the viewer (a page of its own here; the
// viewer app hands it to its player instead).
async function playNode(id) {
  const n = byId[id];
  const url = await data.m64(run, id);
  const start = Math.max(0, n.frame - 300);
  if (playHook) return playHook({ url, start, title: `${run} · state #${id}`, state: { run, zone: zoneKey, node: id } });
  const abs = new URL(url, location.href).href;
  window.open(`${location.protocol}//${location.hostname}:5173/sm64-viewer/?m64=${encodeURIComponent(abs)}&start=${start}`, '_blank');
}
async function downloadNode(id) {
  const a = document.createElement('a');
  a.href = await data.m64(run, id);
  a.download = `${run}-node-${id}.m64`;
  a.click();
}
let playHook = opts.onPlay ?? null;

root.addEventListener('click', (e) => {
  const play = e.target.closest('[data-play]');
  if (play) { playNode(+play.dataset.play); return; }
  const dl = e.target.closest('[data-download]');
  if (dl) { downloadNode(+dl.dataset.download); return; }
  const z = e.target.closest('[data-zone]');
  if (z) { zoneKey = z.dataset.zone; renderZones(); renderMap(); renderTrans(); renderLegend(); buildScene(true); return; }
  const n = e.target.closest('[data-node]');
  if (n) { showNode(+n.dataset.node); return; }
  const k = e.target.closest('[data-kind]');
  if (k) { hidden.has(k.dataset.kind) ? hidden.delete(k.dataset.kind) : hidden.add(k.dataset.kind); renderLegend(); buildScene(false); }
});
for (const b of root.querySelectorAll('[data-mode]')) b.addEventListener('click', () => {
  mode = b.dataset.mode;
  for (const o of root.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', o === b);
  buildScene(false);
});
$('edges').addEventListener('click', (e) => {
  showEdges = !showEdges; e.target.setAttribute('aria-pressed', showEdges); buildScene(false);
});
$('fit').addEventListener('click', fitView);
$('geom').addEventListener('click', () => {
  geomMode = { solid: 'ghost', ghost: 'off', off: 'solid' }[geomMode]; applyGeomMode();
  if (geomKey) {
    try { localStorage.setItem(GEOM_PREFS, JSON.stringify({ ...geomPrefs(), [geomKey]: geomMode })); } catch { /* not remembered */ }
  }
});

$('run').addEventListener('change', (e) => {
  run = e.target.value; lastSize = -1; zoneKey = null; selected = null;
  $('node').className = 'empty'; $('node').textContent = 'Click a state.';
  refresh(true);
});
// The mouse wheel over the run selector steps through runs; the run loads
// once the wheel rests, so scrolling past several doesn't load each one.
let wheelTimer = null;
$('run').addEventListener('wheel', (e) => {
  e.preventDefault();
  const sel = e.currentTarget;
  const i = Math.max(0, Math.min(sel.options.length - 1, sel.selectedIndex + Math.sign(e.deltaY)));
  if (i === sel.selectedIndex) return;
  sel.selectedIndex = i;
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => sel.dispatchEvent(new Event('change')), 250);
}, { passive: false });

let lastChange = Date.now();
async function tick() {
  const runs = await loadRuns().catch(() => []);
  const r = runs.find((x) => x.name === run);
  $('dot').className = `dot${r?.live ? ' on' : ''}`;
  const before = lastSize;
  await refresh(false);
  if (lastSize !== before) lastChange = Date.now();
  const age = r ? Math.round(Date.now() / 1000 - r.mtime) : null;
  $('updated').textContent = r ? (r.live ? `live · written ${age}s ago` : `finished`) : '—';
}

$('back').addEventListener('click', () => opts.onBack?.());

(async () => {
  // The live server if it answers (and isn't turned off), else the static
  // exports (GitHub Pages).
  data = null;
  if (!opts.staticOnly) {
    const live = liveSource(api);
    try { if ((await live.runs()).length) data = live; } catch { /* no server */ }
  }
  if (!data) data = staticSource(opts.staticBase);
  // The app reads level geometry from the user's own ROM (never shipped).
  if (opts.geometry) data.geometry = opts.geometry;
  try {
    levelNames = await data.levels();
    await loadRuns();
  } catch {
    $('zones').innerHTML = `<div class="empty">No trees found: neither the tree server (${esc(api)}, start it with <code>python3 tools/viz.py</code> in objective-rrt) nor static exports (${esc(opts.staticBase)}, made by <code>tools/export_tree.py</code>).</div>`;
    return;
  }
  if (opts.run && [...$('run').options].some((o) => o.value === opts.run)) $('run').value = opts.run;
  run = $('run').value;
  if (opts.zone) zoneKey = opts.zone;
  await refresh(true);
  if (opts.node != null && byId[opts.node]) showNode(opts.node);
  report();
  if (!disposed && data.live) timer = setInterval(tick, 5000);
})();

return () => {
  disposed = true;
  clearInterval(timer);
  resizeObs.disconnect();
  controls.dispose();
  renderer.dispose?.();
  root.innerHTML = '';
  root.classList.remove('tree-app');
};
}
