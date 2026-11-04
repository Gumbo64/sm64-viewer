// Per-map level geometry visibility, shared with the tree view: the same
// localStorage entry (one mode per "level:area") and the same defaults, so a
// choice made in either view applies in the other. query.test.js checks this
// against src/tree/treeview.js (which is generated, so it can't import this).

export const GEOM_PREFS = 'obrrt-tree:geometry';

// Solid by default; areas with a roof or ceiling over the play space start
// see-through so the cells inside show ("level:area", or a level for all its areas).
export const SEE_THROUGH = new Set([
  '6', '4', '7', '14', '28', '18', '20', '27',
  '8:2', '8:3', '12:2', '22:2', '5:2', '10:2', '13:3', '23:1', '36:2', '36:3', '36:4',
]);

/** The saved modes: { "16:1": "solid" | "ghost" | "off", ... }. */
export function geomPrefs() {
  try {
    return JSON.parse(localStorage.getItem(GEOM_PREFS) ?? '{}');
  } catch {
    return {};
  }
}

/** An area (level * 256 + area) as the tree names it: "16:1". */
export const prefKey = (zone) => `${zone >> 8}:${zone & 0xff}`;

/** The mode an area opens in: the saved one, else see-through for the roofed areas, else solid. */
export function defaultGeomMode(zone) {
  const key = prefKey(zone);
  const saved = geomPrefs()[key];
  if (saved) return saved;
  return SEE_THROUGH.has(key) || SEE_THROUGH.has(String(zone >> 8)) ? 'ghost' : 'solid';
}

/** The button's cycle: solid, see-through, off. */
export const nextGeomMode = (mode) => ({ solid: 'ghost', ghost: 'off', off: 'solid' })[mode];

/** Remembers an area's mode, as the tree view does. */
export function saveGeomMode(zone, mode) {
  try {
    localStorage.setItem(GEOM_PREFS, JSON.stringify({ ...geomPrefs(), [prefKey(zone)]: mode }));
  } catch {
    /* not remembered */
  }
}
