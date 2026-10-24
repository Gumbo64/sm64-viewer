// An area's collision geometry, read from the user's own ROM (cached by
// RomGate), so the site never ships Nintendo's level data: the ROM offsets
// come from collisionTable.js (objective-rrt/tools/rom_collision_table.py).
// Returns the tree view's geometry shape: { v: [x,y,z,...], t: [i0,i1,i2,...],
// s: [type index per triangle], types: [surface name], water: [] }.
import { getROM } from 'sm64-binds-frontend';
import { COLLISION, FORCE_TYPES, SURFACE_NAMES } from './collisionTable';

const FORCE = new Set(FORCE_TYPES);
let romPromise = null;
const blocks = new Map();

async function rom() {
  romPromise ??= getROM().then((r) => new Uint8Array(r instanceof ArrayBuffer ? r : r.buffer ?? r));
  return romPromise;
}

/** MIO0 decompression (the format of the ROM's compressed level segments). */
function mio0(data, off) {
  const dv = new DataView(data.buffer, data.byteOffset);
  const size = dv.getUint32(off + 4), comp = dv.getUint32(off + 8), uncomp = dv.getUint32(off + 12);
  const out = new Uint8Array(size);
  let n = 0, layout = off + 16, cp = off + comp, up = off + uncomp;
  while (n < size) {
    const word = dv.getUint32(layout);
    layout += 4;
    for (let b = 0; b < 32 && n < size; b++) {
      if (word & (0x80000000 >>> b)) out[n++] = data[up++];
      else {
        const v = dv.getUint16(cp);
        cp += 2;
        const len = (v >> 12) + 3, dist = (v & 0xfff) + 1;
        for (let k = 0; k < len; k++, n++) out[n] = out[n - dist];
      }
    }
  }
  return out;
}

export async function romGeometry(level, area) {
  const where = COLLISION[`${level}:${area}`];
  if (!where) return { v: [], t: [], s: [], types: [], water: [] };
  const [blockOff, pos] = where;
  if (!blocks.has(blockOff)) blocks.set(blockOff, mio0(await rom(), blockOff));
  const d = blocks.get(blockOff);
  const dv = new DataView(d.buffer);
  // surface_load.c: 0x40, vertex count, vertices (3 s16); then per surface
  // type: type, count, triangles (3 indices, a 4th for force types); 0x41 ends.
  let q = pos + 2;
  const nv = dv.getUint16(q);
  q += 2;
  const v = new Array(nv * 3);
  for (let i = 0; i < nv * 3; i++, q += 2) v[i] = dv.getInt16(q);
  const t = [], s = [], types = [], typeIndex = new Map();
  for (let type = dv.getUint16(q); type !== 0x41; type = dv.getUint16(q)) {
    const n = dv.getUint16(q + 2);
    q += 4;
    const name = SURFACE_NAMES[type] ?? `SURFACE_${type}`;
    if (!typeIndex.has(name)) { typeIndex.set(name, types.length); types.push(name); }
    for (let i = 0; i < n; i++) {
      t.push(dv.getUint16(q), dv.getUint16(q + 2), dv.getUint16(q + 4));
      s.push(typeIndex.get(name));
      q += FORCE.has(type) ? 8 : 6;
    }
  }
  return { v, t, s, types, water: [] };
}
