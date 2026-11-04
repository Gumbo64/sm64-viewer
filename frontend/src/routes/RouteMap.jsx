import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { romGeometry } from '../tree/romGeometry';
import { defaultGeomMode, nextGeomMode, saveGeomMode } from '../oss/geomPrefs';
import { zoneName } from '../oss/zones';
import { pointAt, refColor, segmentsIn } from './routeData';

// The tree view's surface colours (as in oss/CellMap.jsx).
function surfaceColor(type, ny) {
  if (/PAINTING/.test(type)) return '#c9a227';
  if (/BURNING/.test(type)) return '#b8442e';
  if (/WATER/.test(type)) return '#2f6fb0';
  if (/WARP/.test(type)) return '#8a5cc7';
  if (/HANGABLE/.test(type)) return '#4f8a6a';
  if (/SLIPPERY/.test(type) && !/NOT_SLIPPERY/.test(type)) return ny > 0.5 ? '#7d8fae' : '#4a5670';
  return ny > 0.5 ? '#6b7486' : ny < -0.5 ? '#2a2f3b' : '#454c5c';
}

function geometryMesh(d) {
  const { v, t: tri } = d;
  const pos = [], col = [], c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), e = new THREE.Vector3(), n = new THREE.Vector3(), w = new THREE.Vector3();
  for (let i = 0; i < tri.length / 3; i++) {
    const type = d.types[d.s[i]] ?? '';
    if (/DEATH_PLANE/.test(type)) continue;
    const [i0, i1, i2] = [tri[3 * i], tri[3 * i + 1], tri[3 * i + 2]];
    a.set(v[3 * i0], v[3 * i0 + 1], v[3 * i0 + 2]);
    b.set(v[3 * i1], v[3 * i1 + 1], v[3 * i1 + 2]);
    e.set(v[3 * i2], v[3 * i2 + 1], v[3 * i2 + 2]);
    n.subVectors(b, a).cross(w.subVectors(e, a)).normalize();
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
  mesh.renderOrder = -1;
  return mesh;
}

function applyGeom(mesh, mode) {
  if (!mesh) return;
  mesh.visible = mode !== 'off';
  mesh.material.transparent = mode === 'ghost';
  mesh.material.opacity = mode === 'ghost' ? 0.28 : 1;
  mesh.material.depthWrite = mode !== 'ghost';
  mesh.material.needsUpdate = true;
}

// A numbered disc, a fixed size on screen.
function numberSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.arc(32, 32, 28, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = '#0e1015';
  g.stroke();
  g.fillStyle = '#0e1015';
  g.font = 'bold 30px ui-sans-serif, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false }));
  s.scale.set(0.045, 0.045, 1);
  s.renderOrder = 10;
  return s;
}

function dot(color, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false }));
  p.renderOrder = 11;
  p.visible = false;
  return p;
}

const disposeTree = (o) =>
  o.traverse((x) => {
    x.geometry?.dispose();
    if (x.material) {
      x.material.map?.dispose();
      x.material.dispose();
    }
  });

/**
 * `camLeg` is the leg the camera fits to (the focused one, or the newest while
 * following a live run); the camera only moves when `fitKey` changes, so live
 * updates of `model` redraw the paths without moving it.
 *
 * The route over one area's collision geometry: every beam candidate's path
 * (the best one bold, the others faint), the references dashed, the numbered
 * landmarks, and playhead dots for the route and each shown reference at `frame`.
 */
export default function RouteMap({ model, zone, focus, camLeg = focus, fitKey, frame, showAlt, refsOn }) {
  const host = useRef(null);
  const three = useRef(null);
  const [geomMode, setGeomMode] = useState('solid');
  const [geomError, setGeomError] = useState(null);
  const [noGl, setNoGl] = useState(false);
  const geomModeRef = useRef(geomMode);
  geomModeRef.current = geomMode;

  useEffect(() => {
    const el = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setNoGl(true);
      renderer = { domElement: document.createElement('canvas'), setSize() {}, setPixelRatio() {}, render() {}, dispose() {} };
    }
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1015');
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(0.4, 1, 0.3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // As in the tree and cells views: left drag pans in the screen plane,
    // middle drag pans across the ground, right drag orbits, wheel zooms.
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    const onDownCapture = (e) => (controls.screenSpacePanning = e.button === 0);
    const noAutoscroll = (e) => e.button === 1 && e.preventDefault();
    renderer.domElement.addEventListener('pointerdown', onDownCapture, true);
    renderer.domElement.addEventListener('mousedown', noAutoscroll);
    const overlay = new THREE.Group();
    scene.add(overlay);
    const heads = new THREE.Group();
    scene.add(heads);
    const t = { renderer, scene, camera, controls, overlay, heads, geom: null, mats: [], size: [1, 1], route: dot(0xffffff, 14), refs: [], running: [] };
    heads.add(t.route);
    three.current = t;
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      // The running leg's best-so-far path: dashes that crawl along it.
      for (const m of t.running) m.dashOffset -= 3;
      controls.update();
      renderer.render(scene, camera);
    };
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      t.size = [w, h];
      for (const m of t.mats) m.resolution.set(w, h);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDownCapture, true);
      renderer.domElement.removeEventListener('mousedown', noAutoscroll);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  // The area's geometry, in its remembered (or default) mode.
  useEffect(() => {
    if (zone != null) setGeomMode(defaultGeomMode(zone));
  }, [zone]);
  useEffect(() => {
    const t = three.current;
    if (!t || zone == null) return;
    let stop = false;
    setGeomError(null);
    if (t.geom) {
      t.scene.remove(t.geom);
      disposeTree(t.geom);
      t.geom = null;
    }
    romGeometry(zone >> 8, zone & 0xff).then(
      (d) => {
        if (stop) return;
        if (!d.t.length) setGeomError(`No collision geometry for ${zoneName(zone)}`);
        t.geom = geometryMesh(d);
        t.scene.add(t.geom);
        applyGeom(t.geom, geomModeRef.current);
      },
      (e) => !stop && setGeomError(`No geometry for ${zoneName(zone)}: ${e.message}`),
    );
    return () => {
      stop = true;
    };
  }, [zone]);
  useEffect(() => {
    if (three.current) applyGeom(three.current.geom, geomMode);
  }, [geomMode]);

  // The paths, references and landmarks in this area.
  useEffect(() => {
    const t = three.current;
    if (!t || !model || zone == null) return;
    disposeTree(t.overlay);
    t.overlay.clear();
    t.mats = [];
    t.running = [];
    const box = new THREE.Box3();
    const focusBox = new THREE.Box3();
    const grow = (b, flat) => {
      for (let i = 0; i < flat.length; i += 3) b.expandByPoint(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]));
    };
    const dim = (leg) => focus != null && leg !== focus;
    // Alternatives first (faint, thin), then the best path (bold) over them.
    for (const c of model.candidates) {
      if (c.best || !showAlt) continue;
      for (const seg of segmentsIn(c.points, zone)) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: model.legs[c.leg].color, transparent: true, opacity: dim(c.leg) ? 0.08 : 0.35, depthTest: false }));
        line.renderOrder = 2;
        t.overlay.add(line);
        grow(box, seg);
      }
    }
    for (const c of model.candidates) {
      if (!c.best) continue;
      for (const seg of segmentsIn(c.points, zone)) {
        const g = new LineGeometry();
        g.setPositions(seg);
        const m = new LineMaterial({ color: new THREE.Color(model.legs[c.leg].color).getHex(), linewidth: focus === c.leg ? 5 : 3.5, transparent: true, opacity: dim(c.leg) ? 0.25 : 1, depthTest: false });
        if (c.running) {
          Object.assign(m, { dashed: true, dashSize: 60, gapSize: 40 });
          t.running.push(m);
        }
        m.resolution.set(...t.size);
        t.mats.push(m);
        const line = new Line2(g, m);
        line.computeLineDistances();
        line.renderOrder = 4;
        t.overlay.add(line);
        grow(box, seg);
        if (camLeg === c.leg) grow(focusBox, seg);
      }
    }
    model.refs.forEach((r, k) => {
      if (!refsOn.has(k)) return;
      for (const seg of segmentsIn(r.points, zone)) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: refColor(k), dashSize: 70, gapSize: 50, transparent: true, opacity: 0.55, depthTest: false }));
        line.computeLineDistances();
        line.renderOrder = 3;
        t.overlay.add(line);
        grow(box, seg);
      }
    });
    for (const m of model.landmarks) {
      if (!m.pos || m.zone !== zone) continue;
      const col = m.i === 0 ? '#e3e6ee' : model.legs[m.i - 1]?.color ?? '#e3e6ee';
      const s = numberSprite(String(m.i), col);
      s.position.set(m.pos[0], m.pos[1] + 60, m.pos[2]);
      t.overlay.add(s);
      const p = dot(col, 7);
      p.position.set(m.pos[0], m.pos[1], m.pos[2]);
      p.visible = true;
      t.overlay.add(p);
      box.expandByPoint(new THREE.Vector3(...m.pos));
      if (camLeg != null && (m.i === camLeg || m.i === camLeg + 1)) focusBox.expandByPoint(new THREE.Vector3(...m.pos));
    }
    t.box = box;
    t.focusBox = focusBox;
  }, [model, zone, focus, camLeg, showAlt, refsOn]);

  // Camera: the focused leg in this area, else everything drawn in it.
  const fit = () => {
    const t = three.current;
    if (!t) return;
    let b = t.focusBox && !t.focusBox.isEmpty() ? t.focusBox : t.box;
    if (!b || b.isEmpty()) {
      if (!t.geom) return;
      t.geom.geometry.computeBoundingBox();
      b = t.geom.geometry.boundingBox;
    }
    const ctr = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const r = Math.max(500, size.x, size.y, size.z);
    t.controls.target.copy(ctr);
    t.camera.position.set(ctr.x, ctr.y + r * 0.8, ctr.z + r * 0.9);
    t.camera.near = r / 1000;
    t.camera.far = r * 50;
    t.camera.updateProjectionMatrix();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fit, [fitKey ?? `${zone}|${camLeg}`]);

  // The playheads.
  useEffect(() => {
    const t = three.current;
    if (!t || !model) return;
    const place = (d, p) => {
      d.visible = !!p && p[1] === zone;
      if (d.visible) d.position.set(p[2], p[3], p[4]);
    };
    place(t.route, pointAt(model.track, frame));
    while (t.refs.length < model.refs.length) {
      const d = dot(refColor(t.refs.length), 11);
      t.refs.push(d);
      t.heads.add(d);
    }
    t.refs.forEach((d, k) => {
      const r = model.refs[k];
      if (!r || !refsOn.has(k)) d.visible = false;
      else place(d, pointAt(r.points, frame));
    });
  }, [model, zone, frame, refsOn]);

  return (
    <>
      <div className="view routes-map-view" ref={host} />
      <div className="routes-map-tools">
        <button onClick={fit} title="Point the camera at the route (or the focused leg) in this area">Fit</button>
        <button
          onClick={() => {
            const next = nextGeomMode(geomMode);
            setGeomMode(next);
            if (zone != null) saveGeomMode(zone, next);
          }}
          title="Level geometry: solid, see-through, off"
        >
          Geometry: {geomMode === 'ghost' ? 'see-through' : geomMode}
        </button>
      </div>
      {noGl && <div className="oss-map-empty">No WebGL in this browser: the 3D map is empty.</div>}
      {geomError && !noGl && <div className="oss-map-empty">{geomError}</div>}
      <div className="scale">left drag pan · middle drag pan across the ground · right drag orbit · wheel zoom</div>
    </>
  );
}
