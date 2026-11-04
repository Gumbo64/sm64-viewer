// The 3D map's zoom streaming, the pure parts: the box of the world the camera
// shows, and the region answers (from /api/region) kept on top of the base sample.

/**
 * The box ([x0, y0, z0, x1, y1, z1], game units, y up) the camera shows around
 * its orbit target: half as wide as the view at the target's distance (times
 * `margin`, for the parts of an oblique view beyond the target), at least
 * `min`; taller the more the camera looks down (a column seen from above is
 * all on screen). Clamped to `bounds` (the area's cells) when given: returns
 * { box, full } with `full` when the box takes in all of `bounds`, or null
 * when the view is off the area.
 */
export function cameraBox({ target, distance, fov, aspect, dirY = 0, bounds = null, margin = 1.6, min = 300 }) {
  const half = Math.max(min, distance * Math.tan((fov * Math.PI) / 360) * Math.max(1, aspect) * margin);
  const hy = half * (1 + 3 * Math.min(1, Math.abs(dirY)));
  let box = [target.x - half, target.y - hy, target.z - half, target.x + half, target.y + hy, target.z + half];
  if (!bounds) return { box, full: false };
  const full = covers(box, bounds);
  box = [0, 1, 2].map((i) => Math.max(box[i], bounds[i])).concat([3, 4, 5].map((i) => Math.min(box[i], bounds[i])));
  if (box[0] > box[3] || box[1] > box[4] || box[2] > box[5]) return null;
  return { box, full };
}

/** Whether box `a` contains box `b`. */
export const covers = (a, b) => a[0] <= b[0] && a[1] <= b[1] && a[2] <= b[2] && a[3] >= b[3] && a[4] >= b[4] && a[5] >= b[5];

/** Whether two boxes differ by less than `tol` of their size on every side (no new request needed). */
export function nearlySame(a, b, tol = 0.1) {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const size = Math.max(1, a[i + 3] - a[i], b[i + 3] - b[i]);
    if (Math.abs(a[i] - b[i]) > tol * size || Math.abs(a[i + 3] - b[i + 3]) > tol * size) return false;
  }
  return true;
}

/**
 * The region answers kept after `next` arrives: newest first, only those of
 * the same area, at most `keep` (memory stays bounded: a wider older answer
 * keeps the surroundings denser while a closer one fills the view).
 */
export function mergeRegion(answers, next, keep = 2) {
  return [next, ...answers.filter((a) => a.zone === next.zone)].slice(0, keep);
}

/**
 * The region cells to show on top of the base sample: one object per id,
 * newest answer first, none that the base already has (`baseById`), each
 * `parent` the base or region cell with id `vp`.
 */
export function regionExtra(answers, baseById) {
  const canon = new Map();
  for (const a of answers) for (const c of a.cells) if (!baseById.has(c.id) && !canon.has(c.id)) canon.set(c.id, c);
  for (const c of canon.values()) {
    const vp = c.vp ?? -1;
    c.parent = vp >= 0 ? baseById.get(vp) ?? canon.get(vp) ?? null : null;
  }
  return [...canon.values()];
}
