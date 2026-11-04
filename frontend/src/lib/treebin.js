// Search trees written as tree.bin (objective-rrt, objective-scattershot):
// u32 count, then per record i32 parent (-1 for record 0) and u32 n
// (possibly 0) and n raw 4-byte inputs (see m64.js). A record's replay is
// the inputs of every record from 0 down to it.
//
// tree/treeview.js has its own copy (it's generated from objective-rrt's page).

/** Indexes a tree.bin buffer: `{ buf, parent, at, len }` per record. */
export function parseTreeBin(buf) {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const parent = new Int32Array(count);
  const at = new Uint32Array(count);
  const len = new Uint32Array(count);
  let pos = 4;
  for (let i = 0; i < count; i++) {
    parent[i] = dv.getInt32(pos, true);
    len[i] = dv.getUint32(pos + 4, true);
    at[i] = pos + 8;
    pos += 8 + 4 * len[i];
  }
  return { buf, parent, at, len };
}

/** The raw replay (from power-on) ending at `record`, as a Blob URL. */
export function recordM64Url(tree, record) {
  const chain = [];
  for (let r = record; r >= 0; r = tree.parent[r]) chain.push(r);
  const parts = chain.reverse().map((r) => new Uint8Array(tree.buf, tree.at[r], 4 * tree.len[r]));
  return URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
}
