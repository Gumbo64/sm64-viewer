// node --test src/oss/*.test.js (npm run test:oss)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, prepareCells, parse, runQuery, insertCondition, formatValue, completions, fieldRef } from './query.js';

const model = buildModel([
  { id: 0, kind: 'Root', name: 'root', params: { grid_log2: 10 }, children: [1], fields: ['level', 'keys', 'pos'] },
  { id: 1, kind: 'BljLens', name: 'LobbyBLJ', params: { grid_log2: 6 }, children: [2], fields: ['pos', 'hspeed', 'action', 'payoff'] },
  { id: 2, kind: 'Door', name: '', params: {}, children: [], fields: ['side'] },
]);

const cells = prepareCells([
  { id: 0, key: [[0, 0, 6 * 256 + 1], [0, 1, 0], [1, 1, -2]], frames: 100, visits: 3, succ: 1, p: 0.4 },
  { id: 1, key: [[0, 0, 6 * 256 + 1], [0, 1, 1], [1, 1, 3]], frames: 90, visits: 1, succ: 0, p: 0.2 },
  { id: 2, key: [[0, 0, 16 * 256 + 1], [0, 1, 0]], frames: 50, visits: 9, succ: 5, p: 0.6 },
  { id: 3, key: [[0, 1, 0], [2, 0, 1]], frames: 70, visits: 2, succ: 2, p: 0.7 },
]);

const ids = (q) => {
  const r = runQuery(model, cells, q);
  assert.equal(r.error, null, q);
  return r.cells.map((c) => c.id);
};

test('comparisons, and/or/not, precedence', () => {
  assert.deepEqual(ids(''), [0, 1, 2, 3]);
  assert.deepEqual(ids('LobbyBLJ.hspeed <= -2 and keys = 0'), [0]);
  assert.deepEqual(ids('keys = 1 or keys = 0 and frames < 60'), [1, 2]);
  assert.deepEqual(ids('(keys = 1 or keys = 0) and frames < 60'), [2]);
  assert.deepEqual(ids('not keys = 0'), [1]);
  assert.deepEqual(ids('p >= 0.5'), [2, 3]);
  assert.deepEqual(ids('root.keys != 0'), [1]);
});

test('missing fields never match', () => {
  assert.deepEqual(ids('LobbyBLJ.hspeed != 99'), [0, 1]);
});

test('has() covers descendants; unnamed objectives are kind#id', () => {
  assert.deepEqual(ids('has(LobbyBLJ)'), [0, 1, 3]);
  assert.deepEqual(ids('has(Door#2)'), [3]);
  assert.deepEqual(ids('Door#2.side = 1'), [3]);
});

test('levels as 6.1, hex numbers', () => {
  assert.deepEqual(ids('level = 6.1'), [0, 1]);
  assert.deepEqual(ids('level = 0x601'), [0, 1]);
});

test('errors carry a position', () => {
  const at = (q) => {
    try {
      parse(model, q);
    } catch (e) {
      return [e.message, e.pos];
    }
    assert.fail(`no error for ${q}`);
  };
  assert.equal(at('keys =')[1], 6);
  assert.equal(at('Nope.x = 1')[1], 0);
  assert.equal(at('keys = 1 frames = 2')[1], 9);
  assert.equal(at('has(Nope)')[1], 4);
  assert.equal(at('(keys = 1')[1], 9);
  assert.equal(at('keys $ 1')[1], 5);
});

test('formatting', () => {
  const root = model.byId.get(0);
  const packed = ((2 & 0x3ff) << 20) | ((-1 & 0x3ff) << 10) | (-3 & 0x3ff);
  assert.equal(formatValue(root, 'pos', packed), '(2048,-1024,-3072)');
  assert.equal(formatValue(root, 'level', 6 * 256 + 1), 'L6 A1');
  assert.equal(formatValue(root, 'action', 0x0c400201), '0x0c400201');
  assert.equal(fieldRef(model, 0, 1), 'keys');
  assert.equal(fieldRef(model, 1, 1), 'LobbyBLJ.hspeed');
});

test('inserting conditions', () => {
  const ins = (text, snippet, cursor = text.length) => insertCondition(text, cursor, snippet).text;
  assert.equal(ins('', 'has(LobbyBLJ)'), 'has(LobbyBLJ)');
  assert.equal(ins('keys = 0', 'LobbyBLJ.hspeed '), 'keys = 0 and LobbyBLJ.hspeed ');
  assert.equal(ins('keys = 0 and ', 'level = 1537'), 'keys = 0 and level = 1537');
  assert.equal(ins('LobbyBLJ.hspeed ', 'LobbyBLJ.hspeed = -2'), 'LobbyBLJ.hspeed = -2');
  assert.equal(ins('not (', 'keys = 0'), 'not (keys = 0');
  assert.equal(ins('keys = 0 or frames < 9', 'p > 0', 8), 'keys = 0 and p > 0 or frames < 9');
});

test('completions', () => {
  assert.deepEqual(completions(model, 'Lobby'), ['LobbyBLJ.pos', 'LobbyBLJ.hspeed', 'LobbyBLJ.action', 'LobbyBLJ.payoff']);
  assert.ok(completions(model, 'ha').includes('has(LobbyBLJ)'));
});

test('prepareCells gives lazy values and objs without per-cell Maps', async () => {
  const { prepareCells } = await import('./query.js');
  const [c] = prepareCells([{ key: [[0, 0, 4097], [2, 3, -5]], frames: 1 }]);
  assert.equal(c.values.get('0:0'), 4097);
  assert.equal(c.values.get('2:3'), -5);
  assert.equal(c.values.get('9:9'), undefined);
  assert.deepEqual([...c.values], [['0:0', 4097], ['2:3', -5]]);
  assert.deepEqual([...c.values.keys()], ['0:0', '2:3']);
  assert.ok(c.objs.has(2) && !c.objs.has(1));
});

test('action classes show by name, old hex actions as hex', () => {
  const lens = { params: { actions: ['walking', 'long_jump'] } };
  assert.equal(formatValue(lens, 'action', 0), 'other');
  assert.equal(formatValue(lens, 'action', 1), 'walking');
  assert.equal(formatValue(lens, 'action', 2), 'long jump');
  assert.equal(formatValue({ params: {} }, 'action', 2), 'long jump');
  assert.equal(formatValue(lens, 'action', 0x03000888), '0x03000888');
});

test('areas are named as in the tree view', async () => {
  const { zoneName, shortName, levelName } = await import('./zones.js');
  assert.equal(shortName(16 * 256 + 1), 'CG 1');
  assert.equal(shortName(9 * 256 + 1), 'BOB 1');
  assert.equal(shortName(24 * 256 + 1), 'WF 1');
  assert.equal(shortName(6 * 256 + 1), 'C 1');
  assert.equal(shortName(99 * 256 + 2), 'L99 2'); // a level it does not know
  assert.equal(zoneName(16 * 256 + 1), 'Castle grounds · area 1');
  assert.equal(zoneName(9 * 256 + 2), 'Bob-omb Battlefield · area 2');
  assert.equal(levelName(30), 'Bowser 1');
  assert.equal(levelName(99), 'Level 99');
});

test('summarizeZones counts transitions with their first time and the objectives that made them', async () => {
  const { summarizeZones } = await import('./zones.js');
  const model = buildModel([
    { id: 0, kind: 'Root', name: 'Route', children: [1], fields: ['level'] },
    { id: 1, kind: 'Stage', name: 'Lobby', params: { level: 6 }, children: [], fields: ['pos'] },
  ]);
  const cell = (id, level, frames, from, withStage) => ({ id, frames, from, key: withStage ? [[0, 0, level], [1, 0, 5]] : [[0, 0, level]] });
  const cells = prepareCells([cell(0, 4097, 0, null), cell(1, 4097, 10, 4097), cell(2, 1537, 50, 4097, true), cell(3, 1537, 40, 4097, true), cell(4, 1537, 60, 1537, true)]);
  const zones = summarizeZones(cells, model);
  const grounds = zones.find((z) => z.key === 4097);
  assert.equal(grounds.n, 2);
  const e = grounds.out.get(1537);
  assert.equal(e.n, 2); // 4 stays inside 1537; only 2 and 3 crossed
  assert.equal(e.first, 40);
  assert.deepEqual([...e.via], [['Lobby', 2]]);
});

test('geometry preferences are the tree view\'s: same storage entry, same defaults, same format', async () => {
  const fs = await import('node:fs');
  const prefs = await import('./geomPrefs.js');
  // Against the tree view's own source (generated, so it can't import ours).
  const tree = fs.readFileSync(new URL('../tree/treeview.js', import.meta.url), 'utf8');
  assert.equal(/GEOM_PREFS = '([^']+)'/.exec(tree)[1], prefs.GEOM_PREFS);
  const list = (src) => [...src.replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(list(/SEE_THROUGH = new Set\(\[(.*?)\]\)/s.exec(tree)[1]), [...prefs.SEE_THROUGH].sort());
  // Behaviour, with a fake localStorage.
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const grounds = 16 * 256 + 1;
  assert.equal(prefs.defaultGeomMode(grounds), 'solid');
  assert.equal(prefs.defaultGeomMode(6 * 256 + 1), 'ghost', 'a whole level');
  assert.equal(prefs.defaultGeomMode(8 * 256 + 2), 'ghost', 'one area of a level');
  assert.equal(prefs.defaultGeomMode(8 * 256 + 1), 'solid', 'the other areas of it');
  // A choice made in the tree view (its format) applies here, and ours is written the same way.
  store.set(prefs.GEOM_PREFS, JSON.stringify({ '16:1': 'off' }));
  assert.equal(prefs.defaultGeomMode(grounds), 'off');
  prefs.saveGeomMode(6 * 256 + 1, prefs.nextGeomMode('ghost'));
  assert.deepEqual(JSON.parse(store.get(prefs.GEOM_PREFS)), { '16:1': 'off', '6:1': 'off' });
  assert.deepEqual(['solid', 'ghost', 'off'].map(prefs.nextGeomMode), ['ghost', 'off', 'solid']);
  delete globalThis.localStorage;
});
