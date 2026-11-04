// Areas as the cells' `level` field encodes them: level * 256 + area.
// Level names as the tree view has them (public/trees/levels.json from
// objective-rrt), and its table of long names; 0 to 3 are the boot and menu
// phases before the first level, which that file leaves out.
export const LEVELS = {"0": "Menu", "1": "Menu", "2": "Menu", "3": "Menu", "6": "Castle", "16": "Castle Grounds", "26": "Castle Courtyard", "9": "Bob", "24": "Wf", "12": "Jrb", "5": "Ccm", "4": "Bbh", "7": "Hmc", "22": "Lll", "8": "Ssl", "23": "Ddd", "10": "Sl", "11": "Wdw", "36": "Ttm", "13": "Thi", "14": "Ttc", "15": "Rr", "27": "Pss", "20": "Sa", "31": "Wmotr", "29": "Totwc", "28": "Cotmc", "18": "Vcutm", "17": "Bitdw", "19": "Bitfs", "21": "Bits", "30": "Bowser 1", "33": "Bowser 2", "34": "Bowser 3"};
const NAMES = {
  'Castle Grounds': 'Castle grounds', Castle: 'Castle', 'Castle Courtyard': 'Courtyard',
  Bob: 'Bob-omb Battlefield', Wf: "Whomp's Fortress", Jrb: 'Jolly Roger Bay', Ccm: 'Cool, Cool Mountain',
  Bbh: "Big Boo's Haunt", Hmc: 'Hazy Maze Cave', Lll: 'Lethal Lava Land', Ssl: 'Shifting Sand Land',
  Ddd: 'Dire, Dire Docks', Sl: "Snowman's Land", Wdw: 'Wet-Dry World', Ttm: 'Tall, Tall Mountain',
  Thi: 'Tiny-Huge Island', Ttc: 'Tick Tock Clock', Rr: 'Rainbow Ride', Pss: "Peach's Secret Slide",
  Sa: 'Secret Aquarium', Wmotr: 'Wing Mario over the Rainbow', Totwc: 'Tower of the Wing Cap',
  Cotmc: 'Cavern of the Metal Cap', Vcutm: 'Vanish Cap under the Moat', Bitdw: 'Bowser in the Dark World',
  Bitfs: 'Bowser in the Fire Sea', Bits: 'Bowser in the Sky',
};
/** The level's full name, as in the tree view. */
export const levelName = (l) => NAMES[LEVELS[l]] ?? LEVELS[l] ?? `Level ${l}`;
/** An area (level * 256 + area): "Castle grounds · area 1". */
export const zoneName = (key) => `${levelName(key >> 8)} · area ${key & 0xff}`;
/** The label on the world map, as in the tree view: "CG 1", "BOB 1". */
export const shortName = (key) => {
  const n = LEVELS[key >> 8] ?? `L${key >> 8}`;
  return `${n.length <= 4 ? n.toUpperCase() : n.split(' ').map((w) => w[0]).join('')} ${key & 0xff}`;
};
export const clock = (f) => {
  const s = f / 30;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/**
 * The objective a cell is "made by" (the tree view's "via"): the deepest one
 * in its key, the last of equal depth. Cached on the cell.
 */
export function viaOf(model, c) {
  if (c.via !== undefined) return c.via;
  let best = null;
  for (const [o] of c.key) {
    const ob = model.byId.get(o);
    if (ob && (!best || ob.depth > best.depth || (ob.depth === best.depth && ob.id > best.id))) best = ob;
  }
  return (c.via = best ? best.label : 'none');
}

// Categorical colours from a hash of the name (FNV-1a spread round the hue
// circle by the golden ratio), as in the tree view, so a name has the same
// colour there and here, in every run.
export function nameColor(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = ((h * 0.6180339887) % 1) * 360;
  const light = 52 + (((h >>> 8) % 3) * 8);
  return `hsl(${hue.toFixed(0)}, 68%, ${light}%)`;
}

/**
 * The areas the cells are in, with counts, first game time, most stars and
 * the transitions out of them (a cell's `from` is the area of its parent
 * cell, when that differs): [{ key, level, area, n, first, stars,
 * out: Map(to -> { n, first, via: Map(objective -> n) }) }]. `model` names
 * the objectives that made the crossing cells.
 */
export function summarizeZones(cells, model, exact) {
  const zones = new Map();
  const get = (key) => {
    if (!zones.has(key)) zones.set(key, { key, level: key >> 8, area: key & 0xff, n: 0, first: Infinity, stars: 0, out: new Map() });
    return zones.get(key);
  };
  for (const c of cells) {
    const key = c.values.get('0:0');
    if (key === undefined) continue;
    const z = get(key);
    z.n++;
    z.first = Math.min(z.first, c.frames);
    z.stars = Math.max(z.stars, c.values.get('0:2') ?? 0);
    if (c.from != null && c.from !== key) {
      const o = get(c.from).out;
      const e = o.get(key) ?? { n: 0, first: Infinity, via: new Map() };
      e.n++;
      e.first = Math.min(e.first, c.frames);
      if (model) {
        const v = viaOf(model, c);
        e.via.set(v, (e.via.get(v) ?? 0) + 1);
      }
      o.set(key, e);
    }
  }
  // With the true totals (every cell of the run, not just the loaded ones),
  // use them for the counts; the loaded cells still say what made each crossing.
  if (exact) {
    // (The paged loader's summary has no stars: then the loaded cells' maximum stays.)
    for (const [key, a] of exact.areas) {
      const z = get(key);
      Object.assign(z, { n: a.n, first: a.first, stars: a.stars ?? z.stars });
    }
    for (const z of zones.values()) for (const e of z.out.values()) e.n = 0;
    for (const t of exact.transitions.values()) {
      const o = get(t.from).out;
      const e = o.get(t.to) ?? { n: 0, first: Infinity, via: new Map() };
      Object.assign(e, { n: t.n, first: t.first });
      o.set(t.to, e);
    }
    for (const z of zones.values()) for (const [k, e] of z.out) if (!e.n) z.out.delete(k);
  }
  return [...zones.values()];
}
