// Time since Mario entered a state's zone (level, area): the state's frame
// minus the frame of the first state of the unbroken chain of ancestors in
// that zone, i.e. the child side of the parent edge where the zone changed
// (or the root). Entries are memoised per state id and found iteratively, so
// asking for every state of a 1.7M-state tree costs one walk over each state.
//
// byId: sparse array of { id, parent, level, area, frame } indexed by id.
// Returns entry(n) -> the zone entry frame of state n.
export function zoneEntries(byId) {
  const memo = new Float64Array(byId.length).fill(-1);
  const stack = [];
  const sameZone = (a, b) => a.level === b.level && a.area === b.area;
  return function entry(n) {
    if (memo[n.id] >= 0) return memo[n.id];
    // Climb until a state with a known entry, or the first state of the zone.
    let m = n, e;
    for (;;) {
      const p = byId[m.parent];
      if (!p || !sameZone(p, m)) { e = m.frame; break; }
      if (memo[p.id] >= 0) { e = memo[p.id]; break; }
      stack.push(m);
      m = p;
    }
    memo[m.id] = e;
    while (stack.length) memo[stack.pop().id] = e;
    return e;
  };
}
