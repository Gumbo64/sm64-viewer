import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { romGeometry } from '../tree/romGeometry';
import { formatValue, isPos } from './query';
import { clock, nameColor, viaOf, zoneName } from './zones';
import { defaultGeomMode, nextGeomMode, saveGeomMode } from './geomPrefs';
import { cameraBox } from './region';

const SETTLE_MS = 300; // the camera is at rest this long before the cells in view are fetched

// Same surface colours as the tree view.
function surfaceColor(type, ny) {
  if (/PAINTING/.test(type)) return '#c9a227';
  if (/BURNING/.test(type)) return '#b8442e';
  if (/WATER/.test(type)) return '#2f6fb0';
  if (/WARP/.test(type)) return '#8a5cc7';
  if (/HANGABLE/.test(type)) return '#4f8a6a';
  if (/SLIPPERY/.test(type) && !/NOT_SLIPPERY/.test(type)) return ny > 0.5 ? '#7d8fae' : '#4a5670';
  return ny > 0.5 ? '#6b7486' : ny < -0.5 ? '#2a2f3b' : '#454c5c';
}

const VIRIDIS_HEX = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
const VIRIDIS = VIRIDIS_HEX.map((c) => new THREE.Color(c));
const RDYLGN_HEX = ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'];
const RDYLGN = RDYLGN_HEX.map((c) => new THREE.Color(c));
const GREY = new THREE.Color('#3a4152');
const progressLabel = (c) => `${c.values.get('0:2') ?? 0}★ ${c.values.get('0:1') ?? 0}🔑`;
const SURFACES = [['#6b7486', 'Floor'], ['#454c5c', 'Wall'], ['#2a2f3b', 'Ceiling'], ['#7d8fae', 'Slippery'], ['#b8442e', 'Burning'], ['#2f6fb0', 'Water'], ['#8a5cc7', 'Warp'], ['#4f8a6a', 'Hangable'], ['#c9a227', 'Painting']];
function ramp(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return stops[i].clone().lerp(stops[i + 1], x - i);
}


// Where a cell is: the finest position field it has, as the centre of its grid cell.
function cellPos(model, c) {
  let best = null;
  for (const [id] of c.values) {
    const [o, i] = id.split(':').map(Number);
    const obj = model.byId.get(o);
    const field = obj?.fields?.[i];
    if (!field || !isPos(field)) continue;
    const grid = obj.params?.[`${field}_grid_log2`] ?? obj.params?.grid_log2;
    if (grid == null) continue;
    if (!best || grid < best.grid) best = { obj, field, grid, v: c.values.get(id) };
  }
  if (!best) return null;
  const q = [(best.v >> 20) & 0x3ff, (best.v >> 10) & 0x3ff, best.v & 0x3ff].map((n) => (n << 22) >> 22);
  const s = 2 ** best.grid;
  return { x: q[0] * s + s / 2, y: q[1] * s + s / 2, z: q[2] * s + s / 2, grid: best.grid };
}

const COLOURS = { via: 'Objective', frames: 'Game time', visits: 'Times expanded', rate: 'Success rate', progress: 'Stars & keys' };
const CAPTIONS = {
  via: 'Colour: the deepest objective each cell is in (same colour as in the tree view).',
  frames: 'Colour: game time (viridis, early to late).',
  visits: 'Colour: times the search expanded from it (viridis, log), grey = never.',
  rate: 'Colour: share of expansions that added or improved a cell (red 0% to green 100%), grey = never expanded.',
  progress: 'Colour: stars and keys.',
};

/**
 * The matching cells in 3D on the level's collision geometry (read from the
 * user's ROM), as the tree view's middle and right columns: renders the page
 * grid's `<main>` (the 3D view with the overlay controls, tooltip and colour
 * caption) and `<aside class="right">` (the selected cell, the legend, the
 * whole-run objectives table of `runCells`, loaded every `stride`-th).
 * `selected` is a cell id; `onSelect(id)` and `onZone(area)` change it and
 * the area; `onWatch(cell)` and `onDownload(cell)` replay it.
 * Zoom streaming (optional): `onViewMove()` when the camera starts moving,
 * `onViewSettle({ zone, box, full })` once it rests (the box of the world in
 * view, see region.js; `full` when it takes in all of the area's cells);
 * `region` ({ loading } | { n, total, step } | { stale } | { error }) is shown
 * over the view.
 */
export default function CellMap({ model, cells, runCells, stride, zone, newFrom, selected, onSelect, onZone, onWatch, onDownload, onViewMove, onViewSettle, region }) {
  const host = useRef(null);
  const tipEl = useRef(null);
  const three = useRef(null);
  const [colour, setColour] = useState('via');
  const [edges, setEdges] = useState(true);
  const [hidden, setHidden] = useState(() => new Set());
  const [geomMode, setGeomMode] = useState('solid');
  const geomModeRef = useRef(geomMode);
  geomModeRef.current = geomMode;
  const [geomError, setGeomError] = useState(null);
  const [noGl, setNoGl] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const streamRef = useRef({});
  streamRef.current = { onViewMove, onViewSettle };

  const categorical = colour === 'via' || colour === 'progress';
  const category = (c) => (colour === 'progress' ? progressLabel(c) : viaOf(model, c));

  // Cells with a level and a position, grouped by area.
  const { zones, located, byId } = useMemo(() => {
    const zones = new Map();
    const located = [];
    const byId = new Map();
    for (const c of cells) {
      const level = c.values.get('0:0');
      const p = cellPos(model, c);
      if (level === undefined || !p) continue;
      const item = { c, level, p };
      located.push(item);
      byId.set(c.id, item);
      zones.set(level, (zones.get(level) ?? 0) + 1);
    }
    return { zones: [...zones].sort((a, b) => b[1] - a[1]), located, byId };
  }, [model, cells]);

  const active = zone != null && zones.some(([z]) => z === zone) ? zone : zones[0]?.[0] ?? null;
  const zoneItems = useMemo(() => located.filter((l) => l.level === active), [located, active]);
  // The legend can hide categories (click) in the categorical modes.
  const shown = useMemo(
    () => (categorical && hidden.size ? zoneItems.filter(({ c }) => !hidden.has(category(c))) : zoneItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoneItems, hidden, colour, model],
  );

  // Scene, once.
  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      // No WebGL: the panels still work; the 3D view says why it's empty (as in the tree view).
      setNoGl(true);
      renderer = { domElement: document.createElement('canvas'), setSize() {}, setPixelRatio() {}, render() {}, dispose() {} };
    }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1015');
    // The tree view's lights.
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(0.4, 1, 0.3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // As in the tree view: left drag pans in the screen plane, middle drag
    // pans across the ground, right drag orbits, wheel zooms; a left click
    // without dragging selects a cell.
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    const onDownCapture = (e) => (controls.screenSpacePanning = e.button === 0);
    const noAutoscroll = (e) => e.button === 1 && e.preventDefault();
    renderer.domElement.addEventListener('pointerdown', onDownCapture, true);
    renderer.domElement.addEventListener('mousedown', noAutoscroll);
    const world = new THREE.Group();
    scene.add(world);
    const raycaster = new THREE.Raycaster();
    const t = { renderer, scene, camera, controls, world, raycaster, points: null, lines: null, fresh: null, sel: null, path: null, grid: null, geom: null, items: [], fitted: null, box: null, r: 500, describe: () => '' };
    three.current = t;
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    loop();
    const pick = (e) => {
      if (!t.points) return null;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(t.points)[0];
      return hit ? t.items[hit.index] : null;
    };
    // Click selects the cell under the cursor; hovering shows a tooltip.
    let down = null;
    const onDown = (e) => (down = [e.clientX, e.clientY]);
    const onUp = (e) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const hit = pick(e);
      if (hit) onSelectRef.current(hit.c.id);
    };
    const onMove = (e) => {
      const tip = tipEl.current;
      if (!tip) return;
      const hit = e.buttons ? null : pick(e);
      if (!hit) {
        tip.style.display = 'none';
        return;
      }
      const r = el.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = `${e.clientX - r.left + 12}px`;
      tip.style.top = `${e.clientY - r.top + 12}px`;
      tip.innerHTML = t.describe(hit);
    };
    const onLeave = () => tipEl.current && (tipEl.current.style.display = 'none');
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    // Zoom streaming: the camera moved (cancel what was being fetched), then,
    // once it rests, the box in view around the orbit target.
    let settle = null;
    let moving = false;
    const onCamera = () => {
      if (!moving) {
        moving = true;
        streamRef.current.onViewMove?.();
      }
      clearTimeout(settle);
      settle = setTimeout(() => {
        moving = false;
        t.settle();
      }, SETTLE_MS);
    };
    t.settle = () => {
      const cb = streamRef.current.onViewSettle;
      if (!cb || t.zone == null || !t.box || t.box.isEmpty()) return;
      const pad = 64;
      const b = t.box;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const view = cameraBox({
        target: controls.target,
        distance: camera.position.distanceTo(controls.target),
        fov: camera.fov,
        aspect: camera.aspect,
        dirY: dir.y,
        bounds: [b.min.x - pad, b.min.y - pad, b.min.z - pad, b.max.x + pad, b.max.y + pad, b.max.z + pad],
      });
      if (view) cb({ zone: t.zone, ...view });
    };
    controls.addEventListener('change', onCamera);
    return () => {
      clearTimeout(settle);
      controls.removeEventListener('change', onCamera);
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDownCapture, true);
      renderer.domElement.removeEventListener('mousedown', noAutoscroll);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // Each area starts in its remembered (or default) geometry mode.
  useEffect(() => {
    if (active != null) setGeomMode(defaultGeomMode(active));
  }, [active]);
  const cycleGeom = () => {
    const next = nextGeomMode(geomMode);
    setGeomMode(next);
    if (active != null) saveGeomMode(active, next);
  };

  // The area's geometry.
  useEffect(() => {
    const t = three.current;
    if (!t || active == null) return;
    let stop = false;
    setGeomError(null);
    if (t.geom) {
      t.world.remove(t.geom);
      t.geom.traverse((o) => o.geometry?.dispose());
      t.geom = null;
    }
    romGeometry(active >> 8, active & 0xff).then(
      (d) => {
        if (stop) return;
        const { v, t: tri } = d;
        const pos = [], col = [], c = new THREE.Color();
        const a = new THREE.Vector3(), b = new THREE.Vector3(), e = new THREE.Vector3(), n = new THREE.Vector3();
        for (let i = 0; i < tri.length / 3; i++) {
          const type = d.types[d.s[i]] ?? '';
          if (/DEATH_PLANE/.test(type)) continue;
          const [i0, i1, i2] = [tri[3 * i], tri[3 * i + 1], tri[3 * i + 2]];
          a.set(v[3 * i0], v[3 * i0 + 1], v[3 * i0 + 2]);
          b.set(v[3 * i1], v[3 * i1 + 1], v[3 * i1 + 2]);
          e.set(v[3 * i2], v[3 * i2 + 1], v[3 * i2 + 2]);
          n.subVectors(b, a).cross(new THREE.Vector3().subVectors(e, a)).normalize();
          c.set(surfaceColor(type, n.y));
          for (const p of [a, b, e]) {
            pos.push(p.x, p.y, p.z);
            col.push(c.r, c.g, c.b);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
        const group = new THREE.Group();
        group.add(mesh);
        for (const [x1, z1, x2, z2, y] of d.water ?? []) {
          const w = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x2 - x1), Math.abs(z2 - z1)), new THREE.MeshBasicMaterial({ color: 0x3d8bd9, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
          w.rotation.x = -Math.PI / 2;
          w.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
          group.add(w);
        }
        group.renderOrder = -1;
        t.geom = group;
        t.world.add(group);
        applyGeom(t, geomModeRef.current);
      },
      (e) => !stop && setGeomError(`No geometry for ${zoneName(active)}: ${e.message}`),
    );
    return () => {
      stop = true;
    };
  }, [active]);

  useEffect(() => {
    if (three.current) applyGeom(three.current, geomMode);
  }, [geomMode]);

  // Points the camera at the area's cells, with the ground grid under them.
  const fit = () => {
    const t = three.current;
    if (!t?.box) return;
    const ctr = t.box.getCenter(new THREE.Vector3());
    const size = t.box.getSize(new THREE.Vector3());
    const r = t.r;
    t.controls.target.copy(ctr);
    t.camera.position.set(ctr.x, ctr.y + r * 0.8, ctr.z + r * 0.9);
    t.camera.near = r / 1000;
    t.camera.far = r * 50;
    t.camera.updateProjectionMatrix();
    if (t.grid) {
      t.scene.remove(t.grid);
      t.grid.geometry.dispose();
    }
    t.grid = new THREE.GridHelper(Math.max(size.x, size.z) * 1.3 + 400, 24, 0x2b3242, 0x1b1f2a);
    t.grid.position.set(ctr.x, t.box.min.y - 5, ctr.z);
    t.scene.add(t.grid);
  };

  // The cells as points, with lines to their parents and the new ones flashing.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const k of ['points', 'lines', 'fresh']) {
      if (t[k]) {
        t.world.remove(t[k]);
        t[k].geometry.dispose();
        t[k] = null;
      }
    }
    t.items = shown;
    // The tree view's tooltip: id, the objective in its colour, game time, use.
    t.describe = ({ c }) => {
      const via = viaOf(model, c);
      return `#${c.id} · <span style="color:${nameColor(via)}">${esc(via)}</span> · ${clock(c.frames)}${c.visits ? ` · expanded ${Math.round(c.visits)}×` : ''}`;
    };
    t.zone = shown.length ? active : null;
    if (!shown.length) return;
    let f0 = Infinity, f1 = -Infinity, v1 = 0;
    for (const { c } of zoneItems) {
      f0 = Math.min(f0, c.frames);
      f1 = Math.max(f1, c.frames);
      v1 = Math.max(v1, c.visits);
    }
    const pos = new Float32Array(shown.length * 3);
    const col = new Float32Array(shown.length * 3);
    const fresh = [];
    const box = new THREE.Box3();
    const tmp = new THREE.Vector3();
    shown.forEach(({ c, p }, i) => {
      pos.set([p.x, p.y, p.z], 3 * i);
      box.expandByPoint(tmp.set(p.x, p.y, p.z));
      const k =
        colour === 'via' ? new THREE.Color(nameColor(viaOf(model, c)))
        : colour === 'progress' ? new THREE.Color(nameColor(progressLabel(c)))
        : colour === 'frames' ? ramp(VIRIDIS, (c.frames - f0) / Math.max(1, f1 - f0))
        : colour === 'visits' ? (c.visits ? ramp(VIRIDIS, Math.log(1 + c.visits) / Math.log(1 + Math.max(1, v1))) : GREY)
        : c.visits ? ramp(RDYLGN, c.succ / c.visits) : GREY;
      col.set([k.r, k.g, k.b], 3 * i);
      if (newFrom != null && c.id >= newFrom) fresh.push(p.x, p.y, p.z);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    t.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true }));
    t.points.renderOrder = 1;
    t.world.add(t.points);
    // New since the last update: bigger white points that fade out over 4 s.
    if (fresh.length) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(fresh, 3));
      const f = new THREE.Points(fg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0.9 }));
      f.renderOrder = 2;
      t.fresh = f;
      t.world.add(f);
      const born = performance.now();
      const fade = () => {
        if (t.fresh !== f) return;
        const u = (performance.now() - born) / 4000;
        f.material.opacity = Math.max(0, 0.9 * (1 - u));
        if (u < 1) requestAnimationFrame(fade);
      };
      fade();
    }
    // A line from each cell to the cell it grew from, when both are shown.
    if (edges) {
      const at = new Map(shown.map((l, i) => [l.c, i]));
      const seg = [];
      const segCol = [];
      shown.forEach(({ c }, i) => {
        const j = at.get(c.parent);
        if (j === undefined) return;
        // As in the tree view: the objective's colour at half brightness, whatever the colour mode.
        const k = new THREE.Color(nameColor(viaOf(model, c))).multiplyScalar(0.5);
        for (const m of [j, i]) {
          seg.push(pos[3 * m], pos[3 * m + 1], pos[3 * m + 2]);
          segCol.push(k.r, k.g, k.b);
        }
      });
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      lg.setAttribute('color', new THREE.Float32BufferAttribute(segCol, 3));
      t.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
      t.world.add(t.lines);
    }
    const size = box.getSize(new THREE.Vector3());
    t.box = box;
    t.r = Math.max(size.x, size.y, size.z, 500);
    t.raycaster.params.Points.threshold = t.r / 150;
    if (t.fitted !== active) {
      t.fitted = active;
      fit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, zoneItems, colour, active, edges, newFrom]);

  // The selected cell: a marker and the path back to where the area was entered.
  const sel = selected != null ? byId.get(selected) : null;
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const k of ['sel', 'path']) {
      if (t[k]) {
        t.world.remove(t[k]);
        t[k].geometry.dispose();
        t[k] = null;
      }
    }
    if (!sel || sel.level !== active) return;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([sel.p.x, sel.p.y, sel.p.z], 3));
    t.sel = new THREE.Points(sg, new THREE.PointsMaterial({ size: 13, sizeAttenuation: false, color: 0xf7c948, depthTest: false }));
    t.sel.renderOrder = 3;
    t.world.add(t.sel);
    const pts = [];
    for (let m = sel.c; m; m = m.parent) {
      const it = byId.get(m.id);
      if (!it || it.level !== active) break;
      pts.push(new THREE.Vector3(it.p.x, it.p.y, it.p.z));
    }
    if (pts.length > 1) {
      t.path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
      t.path.renderOrder = 3;
      t.world.add(t.path);
    }
  }, [sel, active, byId]);

  // The legend for the colour mode: categories with counts (click to hide), or the scale.
  const legend = useMemo(() => {
    let f0 = Infinity, f1 = -Infinity, v1 = 0;
    const kinds = new Map();
    for (const { c } of zoneItems) {
      f0 = Math.min(f0, c.frames);
      f1 = Math.max(f1, c.frames);
      v1 = Math.max(v1, c.visits);
      if (colour === 'via' || colour === 'progress') {
        const k = colour === 'progress' ? progressLabel(c) : viaOf(model, c);
        kinds.set(k, (kinds.get(k) ?? 0) + 1);
      }
    }
    const order = [...kinds].sort(colour === 'progress' ? (a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }) : (a, b) => b[1] - a[1]);
    return { f0, f1, v1, kinds: order };
  }, [zoneItems, colour, model]);

  const toggle = (k) =>
    setHidden((h) => {
      const next = new Set(h);
      if (!next.delete(k)) next.add(k);
      return next;
    });
  const goto = (item) => {
    if (item.level !== active) onZone(item.level);
    onSelect(item.c.id);
  };
  const parentItem = sel?.c.parent ? byId.get(sel.c.parent.id) : null;
  const title = { via: 'Objectives that made the cells here', frames: 'Game time', visits: 'Times the search expanded from a cell', rate: 'Success rate of expansions', progress: 'Stars and keys of the cells here' }[colour];
  // The continuous scales as the tree view shows them: gradient, range, note.
  const scale = {
    frames: { stops: VIRIDIS_HEX, lo: Number.isFinite(legend.f0) ? clock(legend.f0) : '', hi: Number.isFinite(legend.f1) ? clock(legend.f1) : '', note: 'early → late (the fewest frames the search needed to reach the cell)' },
    visits: { stops: VIRIDIS_HEX, lo: '1', hi: String(Math.round(legend.v1)), note: 'log scale; grey = never expanded' },
    rate: { stops: RDYLGN_HEX, lo: '0%', hi: '100%', note: 'share of expansions that added or improved a cell; grey = never expanded' },
  }[colour];
  const sw = (name) => <span className="oss-sw" style={{ background: nameColor(name) }} />;

  return (
    <>
      <main>
        <div className="view oss-map-view" ref={host}>
          {noGl && (
            <div className="empty" style={{ padding: '60px 20px' }}>
              This browser has no WebGL, so the 3D view is off. The panels still update.
            </div>
          )}
        </div>
        <div className="overlay">
          <span className="title">{active != null ? `${zoneName(active)} · ${zoneItems.length.toLocaleString()} cells` : '—'}</span>
          {region && (
            <span
              className={`oss-stream small${region.error ? ' bad' : ''}`}
              title={region.n != null ? `Zoomed in: the cells in view, every ${region.step}th of each 256-unit square, on top of the loaded sample.` : region.error ?? ''}
            >
              {region.loading ? (
                <>
                  <span className="spinner" /> loading cells in view…
                </>
              ) : region.n != null ? (
                `${region.n.toLocaleString()} / ${region.total.toLocaleString()} in view`
              ) : region.stale ? (
                'in view: waiting for the update'
              ) : (
                "couldn't load the cells in view"
              )}
            </span>
          )}
          <span className="muted">colour</span>
          {Object.entries(COLOURS).map(([k, label]) => (
            <button key={k} aria-pressed={colour === k} onClick={() => setColour(k)}>
              {label}
            </button>
          ))}
          <button aria-pressed={edges} onClick={() => setEdges((e) => !e)}>
            Edges
          </button>
          <button aria-pressed={geomMode !== 'off'} onClick={cycleGeom} title="Level collision geometry from the decomp">
            Geometry: {{ solid: 'solid', ghost: 'see-through', off: 'off' }[geomMode]}
          </button>
          <button onClick={fit}>Fit</button>
          {geomError && <span className="bad small">{geomError}</span>}
        </div>
        {!zones.length && <div className="oss-map-empty muted">No matching cells have a level and a position.</div>}
        <div className="tip" ref={tipEl} />
        <div className="scale">{`${CAPTIONS[colour]}  White = new since the last update.`}</div>
      </main>

      <aside className="right">
        <h2>Cell</h2>
        {sel ? (
          <div>
            <div className="kv oss-kv">
              <span>Cell</span>
              <span>
                <b>#{sel.c.id}</b>{sel.c.node != null && ` · node ${sel.c.node.toLocaleString()}`}
              </span>
              <span>Zone</span>
              <span>{zoneName(sel.level)}</span>
              <span>Game time</span>
              <span>
                {clock(sel.c.frames)} (frame {sel.c.frames.toLocaleString()})
              </span>
              <span>Progress</span>
              <span>
                {sel.c.values.get('0:2') ?? 0}★ · {sel.c.values.get('0:1') ?? 0} keys
              </span>
              <span>Position</span>
              <span>{[sel.p.x, sel.p.y, sel.p.z].map(Math.round).join(', ')}</span>
              <span>Parent</span>
              <span>
                {parentItem ? (
                  <span className="jump" onClick={() => goto(parentItem)}>
                    #{parentItem.c.id}
                  </span>
                ) : sel.c.parent ? (
                  `#${sel.c.parent.id}`
                ) : (
                  'boot'
                )}
              </span>
              <span>Sampled</span>
              <span>
                expanded {Math.round(sel.c.visits)}× · {sel.c.succ.toFixed(1)} ok · p {(sel.c.p * 100).toFixed(1)}%
              </span>
            </div>
            <div className="btns">
              <button onClick={() => onWatch(sel.c)}>▶ Play in viewer</button>
              <button onClick={() => onDownload(sel.c)}>Download .m64</button>
            </div>
            <h2>Made by</h2>
            <div className="kv">
              <span>Objective</span>
              <span>
                {sw(viaOf(model, sel.c))}
                {viaOf(model, sel.c)}
              </span>
            </div>
            <h2>Key</h2>
            <div className="kv oss-fields">
              {[...sel.c.values].flatMap(([k, v]) => {
                const [o, i] = k.split(':').map(Number);
                const obj = model.byId.get(o);
                return [
                  <span key={`${k}k`} className="key">
                    {obj.label}.{obj.fields[i]}
                  </span>,
                  <span key={`${k}v`} className="key">
                    {formatValue(obj, obj.fields[i], v)}
                  </span>,
                ];
              })}
            </div>
          </div>
        ) : (
          <div className="empty">Click a cell.</div>
        )}
        <h2>{title}</h2>
        <div className="legend">
          {categorical &&
            legend.kinds.map(([k, n]) => (
              <div key={k} className={`row${hidden.has(k) ? ' off' : ''}`} onClick={() => toggle(k)}>
                <span className="sw" style={{ background: nameColor(k) }} />
                {k}
                <span className="n">{n.toLocaleString()}</span>
              </div>
            ))}
          {categorical && !legend.kinds.length && <div className="empty">No cells.</div>}
          {scale && (
            <>
              <div style={{ height: 12, borderRadius: 3, background: `linear-gradient(to right, ${scale.stops.join(', ')})` }} />
              <div style={{ display: 'flex', justifyContent: 'space-between' }} className="muted small">
                <span>{scale.lo}</span>
                <span>{scale.hi}</span>
              </div>
              <div className="muted small">{scale.note}</div>
            </>
          )}
        </div>
        <h2>Objectives (whole run)</h2>
        <RunObjectives model={model} cells={runCells ?? cells} stride={stride} />
        <h2>Level geometry</h2>
        <div className="legend oss-surfaces">
          {SURFACES.map(([c, label]) => (
            <div key={label} className="row">
              <span className="sw" style={{ background: c }} />
              {label}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

/**
 * The tree view's "Objective types (whole run)" table, for cells: per
 * objective that made cells, how many, how often the search expanded from
 * them, the share of those expansions that added or improved a cell, and the
 * earliest game time. Counts are of the loaded cells (about every `stride`-th).
 */
function RunObjectives({ model, cells, stride }) {
  const rows = useMemo(() => {
    const by = new Map();
    for (const c of cells) {
      const v = viaOf(model, c);
      const r = by.get(v) ?? { n: 0, visits: 0, succ: 0, first: Infinity };
      r.n++;
      r.visits += c.visits;
      r.succ += c.succ;
      r.first = Math.min(r.first, c.frames);
      by.set(v, r);
    }
    return [...by].sort((a, b) => b[1].n - a[1].n);
  }, [model, cells]);
  if (!rows.length) return <div className="empty">None yet.</div>;
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Objective</th>
            <th className="r">Cells</th>
            <th className="r">Expanded</th>
            <th className="r">OK</th>
            <th className="r">First</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, r]) => (
            <tr key={k}>
              <td>
                <span className="oss-sw" style={{ background: nameColor(k) }} />
                {k}
              </td>
              <td className="r">{r.n.toLocaleString()}</td>
              <td className="r">{Math.round(r.visits).toLocaleString()}</td>
              <td className="r">{r.visits ? `${Math.round((100 * r.succ) / r.visits)}%` : '—'}</td>
              <td className="r">{clock(r.first)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stride > 1 && <div className="muted small">Counts of the loaded cells (about every {stride}th of the run).</div>}
    </>
  );
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function applyGeom(t, mode) {
  if (!t.geom) return;
  t.geom.visible = mode !== 'off';
  const m = t.geom.children[0].material;
  m.transparent = mode === 'ghost';
  m.opacity = mode === 'ghost' ? 0.28 : 1;
  m.depthWrite = mode !== 'ghost';
  m.needsUpdate = true;
}
