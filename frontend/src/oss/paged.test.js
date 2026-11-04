// node --test src/oss/*.test.js (npm run test:oss)
import test from 'node:test';
import assert from 'node:assert/strict';
import { Linker, parseNdjson, summaryToExact } from './paged.js';
import { cameraBox, covers, mergeRegion, nearlySame, regionExtra } from './region.js';
import { summarizeZones } from './zones.js';
import { prepareCells } from './query.js';

test('summary -> exact, as summarizeZones takes it', () => {
  const exact = summaryToExact({
    cells: 12,
    areas: [{ zone: 256, n: 2, first: 0 }, { zone: 1537, n: 10, first: 40 }],
    transitions: [{ from: 256, to: 1537, n: 3, first: 40 }],
  });
  assert.deepEqual([...exact.areas.keys()], [256, 1537]);
  assert.equal(exact.areas.get(1537).n, 10);
  assert.deepEqual(exact.transitions.get('256>1537'), { from: 256, to: 1537, n: 3, first: 40 });
  // No cells loaded yet: the summary alone gives the areas and the transitions.
  const zs = summarizeZones([], null, exact);
  const z = zs.find((x) => x.key === 256);
  assert.equal(z.n, 2);
  assert.equal(z.stars, 0);
  assert.equal(z.out.get(1537).n, 3);
  // With cells, stars come from them (the summary has none).
  const cells = prepareCells([{ id: 5, key: [[0, 0, 1537], [0, 2, 4]], frames: 50, from: 256 }]);
  assert.equal(summarizeZones(cells, null, exact).find((x) => x.key === 1537).stars, 4);
  assert.equal(summaryToExact(undefined).areas.size, 0);
});

test('NDJSON pages: parse, then link vp across pages in any order', () => {
  const page1 = '{"id":0,"key":[[0,0,256]],"frames":0,"vp":-1,"from":null}\n{"id":10,"key":[[0,0,257]],"frames":3,"vp":0,"from":256}\n';
  const page2 = '{"id":20,"key":[[0,0,257]],"frames":9,"vp":30,"from":257}\n\n{"id":30,"key":[[0,0,257]],"frames":5,"vp":10,"from":257}';
  const page3 = '{"id":40,"key":[[0,0,257]],"frames":9,"vp":50,"from":257}';
  const page4 = '{"id":50,"key":[[0,0,257]],"frames":7,"vp":10,"from":257}\n';
  assert.equal(parseNdjson(page2).length, 2);
  assert.deepEqual(parseNdjson(''), []);
  const l = new Linker();
  l.add(parseNdjson(page1));
  l.add(parseNdjson(page3)); // arrives before its parent
  l.add(parseNdjson(page2));
  l.add(parseNdjson(page4));
  const c = (id) => l.byId.get(id);
  assert.equal(c(0).parent, null);
  assert.equal(c(10).parent, c(0));
  assert.equal(c(20).parent, c(30)); // later in the same page
  assert.equal(c(40).parent, c(50)); // a later page
  assert.equal(c(10).from, 256);
  assert.equal(c(0).from, null);
  assert.equal(c(30).values.get('0:0'), 257); // prepared for queries
  assert.equal(l.waiting.size, 0);
});

test('camera -> box', () => {
  const target = { x: 1000, y: 0, z: -500 };
  // tan(45 deg / 2) * 1000 * margin 1, aspect 2: half 828
  const { box, full } = cameraBox({ target, distance: 1000, fov: 45, aspect: 2, margin: 1 });
  assert.equal(full, false);
  assert.ok(Math.abs(box[3] - box[0] - 2 * 828.4) < 1);
  assert.ok(Math.abs(box[0] - (1000 - 828.4)) < 1);
  assert.ok(Math.abs(box[4] - box[1] - 2 * 828.4) < 1); // level camera: as tall as wide
  // Looking straight down: a taller box.
  const down = cameraBox({ target, distance: 1000, fov: 45, aspect: 2, margin: 1, dirY: -1 }).box;
  assert.ok(down[4] - down[1] > 3.9 * (box[4] - box[1]));
  // Very close: at least `min`.
  const near = cameraBox({ target, distance: 1, fov: 45, aspect: 1, min: 300 }).box;
  assert.equal(near[3] - near[0], 600);
  // Clamped to the area's bounds; whole area in view -> full.
  const bounds = [0, -100, -1000, 2000, 100, 0];
  const c = cameraBox({ target, distance: 1000, fov: 45, aspect: 1, margin: 1, bounds });
  assert.equal(c.full, false);
  assert.deepEqual(c.box.slice(1, 2), [-100]);
  assert.ok(covers(bounds, c.box));
  assert.equal(cameraBox({ target, distance: 1e5, fov: 45, aspect: 1, bounds }).full, true);
  assert.equal(cameraBox({ target: { x: 1e6, y: 0, z: 0 }, distance: 100, fov: 45, aspect: 1, bounds }), null);
  assert.ok(nearlySame([0, 0, 0, 100, 100, 100], [5, 0, 0, 104, 100, 100]));
  assert.ok(!nearlySame([0, 0, 0, 100, 100, 100], [50, 0, 0, 150, 100, 100]));
  assert.ok(!nearlySame(null, [0, 0, 0, 1, 1, 1]));
});

test('region answers: bounded, deduped against the base and each other, linked', () => {
  const base = new Map(prepareCells([{ id: 1, key: [[0, 0, 7]], frames: 0 }, { id: 2, key: [[0, 0, 7]], frames: 1 }]).map((c) => [c.id, c]));
  const ans = (zone, ids) => ({ zone, cells: prepareCells(ids.map(([id, vp]) => ({ id, vp, key: [[0, 0, zone]], frames: id }))) });
  const a1 = ans(7, [[2, 1], [5, 2], [6, 5]]);
  const a2 = ans(7, [[5, 2], [8, 5], [9, -1]]);
  const a3 = ans(7, [[11, 8]]);
  const other = ans(9, [[100, -1]]);
  let kept = mergeRegion([], a1);
  kept = mergeRegion(kept, a2);
  assert.deepEqual(kept, [a2, a1]);
  const extra = regionExtra(kept, base);
  assert.deepEqual(extra.map((c) => c.id).sort((a, b) => a - b), [5, 6, 8, 9]); // 2 is in the base, 5 once
  const byId = new Map(extra.map((c) => [c.id, c]));
  assert.equal(byId.get(5), a2.cells[0]); // the newest answer's object
  assert.equal(byId.get(5).parent, base.get(2));
  assert.equal(byId.get(6).parent, byId.get(5)); // relinked to the kept copy
  assert.equal(byId.get(8).parent, byId.get(5));
  assert.equal(byId.get(9).parent, null);
  // At most two answers, the oldest dropped; another area drops them all.
  kept = mergeRegion(kept, a3);
  assert.deepEqual(kept, [a3, a2]);
  assert.equal(regionExtra(kept, base).find((c) => c.id === 11).parent.id, 8);
  assert.deepEqual(mergeRegion(kept, other), [other]);
  // The base grew to include a region cell: it's no longer extra.
  base.set(8, prepareCells([{ id: 8, key: [[0, 0, 7]], frames: 8 }])[0]);
  const again = regionExtra([a3, a2], base);
  assert.ok(!again.some((c) => c.id === 8));
  assert.equal(again.find((c) => c.id === 11).parent, base.get(8));
});
