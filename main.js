import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Config ----------
const FOODS = {
  // raw = RGB tint over the cooked texture (>1 brightens, so raw looks pale/pink)
  chorizo:   { name: 'Chorizo',   price: 15, cook: 9,  burn: 8, raw: [1.7, 1.2, 1.2] },
  vacio:     { name: 'Vacío',     price: 25, cook: 13, burn: 8, raw: [1.9, 1.2, 1.25] },
  provoleta: { name: 'Provoleta', price: 20, cook: 7,  burn: 6, raw: [1.15, 1.15, 1.2] },
};
const FOOD_KEYS = Object.keys(FOODS);
const QUEUE_PATIENCE = 40, WAIT_PATIENCE = 75, EAT_TIME = 6;
const EYE = 1.6, PLAYER_R = 0.3, SPEED = 4, NPC_SPEED = 1.6;
const DOOR_IN = new THREE.Vector3(-6, 0, 5.2), OUTSIDE = new THREE.Vector3(-6, 0, 8.5);
const COUNTER_SPOT = new THREE.Vector3(-4.5, 0, -2.6);

const UPGRADES = [
  { id: 'grill',    name: 'Bigger Grill',    cost: 60,  bought: false },
  { id: 'charcoal', name: 'Better Charcoal', cost: 80,  bought: false },
  { id: 'tables',   name: 'More Tables',     cost: 120, bought: false },
  { id: 'chimi',    name: 'Chimichurri',     cost: 50,  bought: false },
];
const has = id => UPGRADES.find(u => u.id === id).bought;

// ---------- State ----------
let money = 0;
let held = null;          // { type, mesh }
const grillFood = [];     // { type, t, mesh, slot, bar }
const customers = [];
const queue = [];
let spawnTimer = 2;
let msgTimer = 0;

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5d9);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 100);
camera.rotation.order = 'YXZ';
camera.position.set(0, EYE, -1.5);
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xfff4e0, 0x604030, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(4, 10, 6);
sun.castShadow = true;
sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -10;
scene.add(sun);
const grillLight = new THREE.PointLight(0xff7a2a, 3, 6);
grillLight.position.set(4.5, 1.6, -4.8);
scene.add(grillLight);

// ---------- Helpers ----------
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
const colliders = [];

// Textures generated with Higgsfield (public/textures)
const loader = new THREE.TextureLoader();
function tex(name, rx = 1, ry = 1) {
  const t = loader.load(`textures/${name}.jpg`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
const texMat = (name, rx, ry) => new THREE.MeshStandardMaterial({ map: tex(name, rx, ry), roughness: 0.9 });
// per-face tiling so bricks keep their size on every face (BoxGeometry order: ±x, ±y, ±z)
function brickMats(w, h, d, s = 1.2) {
  const x = texMat('brick', d / s, h / s), y = texMat('brick', w / s, d / s), z = texMat('brick', w / s, h / s);
  return [x, x, y, y, z, z];
}

function box(w, h, d, color, x, y, z, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, on: true });
  return m;
}

function makeLabel(text, scale = 0.5, bg = '#0009', fg = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  let size = lines.length > 1 ? 90 : 150;
  g.font = `bold ${size}px system-ui`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width));
  if (widest > 470) { size = Math.floor(size * 470 / widest); g.font = `bold ${size}px system-ui`; }
  lines.forEach((l, i) => g.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * size * 1.1));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
  s.scale.set(scale * 2, scale, 1);
  return s;
}

function makeBar(w = 0.6) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.08), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.08), new THREE.MeshBasicMaterial({ color: 0x44dd44 }));
  fill.position.z = 0.001;
  g.add(bg, fill);
  g.userData = { fill, w };
  return g;
}
function setBar(bar, p, color) {
  p = THREE.MathUtils.clamp(p, 0, 1);
  const { fill, w } = bar.userData;
  fill.scale.x = Math.max(p, 0.001);
  fill.position.x = -(1 - p) * w / 2;
  fill.material.color.setHex(color);
  // billboard: cancel parent's rotation (customers turn), then face camera
  bar.quaternion.copy(bar.parent.quaternion).invert().multiply(camera.quaternion);
}

// ---------- Audio (tiny WebAudio placeholders) ----------
let actx = null, sizzleGain = null;
function initAudio() {
  if (actx) return;
  actx = new AudioContext();
  const buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = actx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const filt = actx.createBiquadFilter();
  filt.type = 'highpass'; filt.frequency.value = 3000;
  sizzleGain = actx.createGain(); sizzleGain.gain.value = 0;
  src.connect(filt).connect(sizzleGain).connect(actx.destination);
  src.start();
}
function beep(freq, dur = 0.12, type = 'square', vol = 0.08, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur);
}
const sfx = {
  cook: () => beep(220, 0.15, 'sawtooth'),
  pick: () => beep(660, 0.1),
  serve: () => { beep(523, 0.1); beep(784, 0.15, 'square', 0.08, 0.1); },
  pay: () => { beep(988, 0.08, 'triangle', 0.15); beep(1319, 0.2, 'triangle', 0.15, 0.08); },
  bad: () => beep(110, 0.3, 'sawtooth'),
};

// ---------- Restaurant ----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), texMat('floor', 6.7, 5));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const street = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), mat(0x777777));
street.rotation.x = -Math.PI / 2;
street.position.set(0, -0.01, 9);
scene.add(street);

const WALL = 0xf0e0c0, WH = 3.5;
box(16, WH, 0.2, brickMats(16, WH, 0.2), 0, WH / 2, -6); // back (brick)
box(0.2, WH, 12, WALL, -8, WH / 2, 0);          // left
box(0.2, WH, 12, WALL, 8, WH / 2, 0);           // right
box(0.8, WH, 0.2, WALL, -7.6, WH / 2, 6);       // front, left of door
box(11, WH, 0.2, WALL, 2.5, WH / 2, 6);         // front, right of door
box(2, 1, 0.2, WALL, -6, WH - 0.5, 6, false);   // above door
colliders.push({ minX: -7.2, maxX: -4.8, minZ: 5.9, maxZ: 6.1, on: true }); // keep player inside

// Counter
const counter = box(3, 1, 0.8, 0x7a4a25, -4.5, 0.5, -3.5);
box(3.1, 0.06, 0.9, 0x3a2a1a, -4.5, 1.03, -3.5, false);
counter.userData.kind = 'counter';
const counterLabel = makeLabel('PEDIDOS', 0.4);
counterLabel.position.set(-4.5, 2.2, -3.5);
scene.add(counterLabel);

// Grill — low-poly Argentine parrilla: brick base (collider + interaction target), iron grate, crank, side brasero, hood
const grill = box(3, 0.9, 0.9, brickMats(3, 0.9, 0.9), 4.5, 0.45, -5.3);
grill.userData.kind = 'grill';
const coalTex = tex('coals');
const emberMat = new THREE.MeshStandardMaterial({ map: coalTex, emissiveMap: coalTex, emissive: 0xffffff, emissiveIntensity: 0.8 });
const coals = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), emberMat);
coals.rotation.x = -Math.PI / 2;
coals.position.set(4.5, 0.905, -5.3);
coals.userData.kind = 'grill';
scene.add(coals);

const iron = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, metalness: 0.7, roughness: 0.45 });
function part(geo, material, x, y, z, parent = scene) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}
const rod = (r, len) => new THREE.CylinderGeometry(r, r, len, 6);
const grateBar = rod(0.012, 0.84).rotateX(Math.PI / 2);
for (let i = 0; i < 15; i++) part(grateBar, iron, 3.1 + i * 0.2, 0.935, -5.3);
for (const z of [-4.88, -5.72]) part(new THREE.BoxGeometry(2.9, 0.05, 0.04), iron, 4.5, 0.94, z); // frame
for (const x of [3.05, 5.95]) part(new THREE.BoxGeometry(0.04, 0.05, 0.86), iron, x, 0.94, -5.3);
// height crank on the front
const crank = new THREE.Group();
crank.position.set(3.3, 0.68, -4.82);
part(new THREE.TorusGeometry(0.11, 0.014, 6, 14), iron, 0, 0, 0, crank);
part(new THREE.BoxGeometry(0.22, 0.02, 0.02), iron, 0, 0, 0, crank);
part(new THREE.BoxGeometry(0.02, 0.22, 0.02), iron, 0, 0, 0, crank);
part(rod(0.015, 0.1).rotateX(Math.PI / 2), iron, 0.08, 0.08, 0.05, crank);
scene.add(crank);
// side brasero: brick pedestal + iron basket with burning logs
box(0.7, 0.9, 0.9, brickMats(0.7, 0.9, 0.9), 6.4, 0.45, -5.3);
part(new THREE.PlaneGeometry(0.6, 0.6), emberMat, 6.4, 0.905, -5.3).rotation.x = -Math.PI / 2;
const cageBar = rod(0.01, 0.45);
for (let i = 0; i < 5; i++) {
  const o = -0.25 + i * 0.125;
  for (const [dx, dz] of [[o, -0.25], [o, 0.25], [-0.25, o], [0.25, o]]) part(cageBar, iron, 6.4 + dx, 1.13, -5.3 + dz);
}
for (const y of [0.92, 1.35]) {
  for (const dz of [-0.25, 0.25]) part(new THREE.BoxGeometry(0.52, 0.02, 0.02), iron, 6.4, y, -5.3 + dz);
  for (const dx of [-0.25, 0.25]) part(new THREE.BoxGeometry(0.02, 0.02, 0.52), iron, 6.4 + dx, y, -5.3);
}
const logGeo = rod(0.045, 0.42).rotateZ(Math.PI / 2);
for (const [y, dz, ry] of [[0.96, 0.1, 0.4], [0.96, -0.1, -0.3], [1.04, 0, 1.4]]) part(logGeo, mat(0x5a3b22), 6.4, y, -5.3 + dz).rotation.y = ry;
const flames = [[0, 0, 0.34, 0xff8a1a], [0.1, 0.06, 0.22, 0xff6a10], [-0.09, -0.05, 0.26, 0xff8a1a], [0, 0, 0.18, 0xffd23a]].map(([dx, dz, h, c]) => {
  const f = part(new THREE.ConeGeometry(0.07, h, 6).translate(0, h / 2, 0), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 }), 6.4 + dx, 1.02, -5.3 + dz);
  f.castShadow = false;
  return f;
});
// hood + chimney
const hoodMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
const hood = part(new THREE.CylinderGeometry(0.5, 1.9, 0.7, 4, 1, true).rotateY(Math.PI / 4), hoodMat, 4.8, 2.95, -5.3);
hood.scale.set(1.49, 1, 0.45);
hood.castShadow = false;
part(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 10), hoodMat, 4.8, 3.85, -5.3).castShadow = false;
const grillLabel = makeLabel('PARRILLA', 0.4);
grillLabel.position.set(4.5, 2.4, -5.2);
scene.add(grillLabel);
const SLOTS = [3.6, 4.5, 5.4];
const slotCount = () => (has('grill') ? 3 : 2);

// Tables
const clothTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#b8342c';
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) g.fillRect(i * 8, j * 8, 8, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
})();
const clothMat = new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.95 });
const tables = [
  { x: 0, z: 0.5 }, { x: 4, z: 0.5 }, { x: 0, z: 3.8 }, { x: 4, z: 3.8 },
].map((t, i) => {
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), clothMat);
  top.position.y = 0.75;
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.75, 0.15), mat(0x5a3a1a));
  leg.position.y = 0.37;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), mat(0x6b4423));
  seat.position.set(-1, 0.45, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.5), mat(0x6b4423));
  back.position.set(-1.25, 0.75, 0);
  const cleg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.1), mat(0x5a3a1a));
  cleg.position.set(-1, 0.22, 0);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.012, 16), mat(0xf4f4f0));
  plate.position.set(-0.3, 0.797, 0);
  g.add(top, leg, seat, back, cleg, plate);
  g.traverse(o => { o.castShadow = o.receiveShadow = true; });
  const label = makeLabel(String(i + 1), 0.3);
  label.position.set(0, 1.2, 0);
  g.add(label);
  g.userData.kind = 'table';
  scene.add(g);
  const col = { minX: t.x - 0.6, maxX: t.x + 0.6, minZ: t.z - 0.6, maxZ: t.z + 0.6, on: i < 3 };
  colliders.push(col);
  const table = { n: i + 1, x: t.x, z: t.z, group: g, col, customer: null, active: i < 3, seat: new THREE.Vector3(t.x - 1, 0, t.z) };
  g.userData.ref = table;
  g.visible = table.active;
  return table;
});

// Upgrade board (left wall) — flat panels so they don't clip into the wall
function wallPanel(text, z, y, w, h, bg) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: makeLabel(text, 1, bg).material.map }));
  m.rotation.y = Math.PI / 2;
  m.position.set(-7.88, y, z);
  scene.add(m);
  return m;
}
const upgradePanels = UPGRADES.map((u, i) => {
  const m = wallPanel(`${u.name}\n$${u.cost}`, -1.5 + i * 1.05, 1.7, 0.9, 0.45, '#2b5d34');
  m.userData = { kind: 'upgrade', ref: u };
  return m;
});
wallPanel('MEJORAS', 0.08, 2.3, 1.2, 0.3, '#000a');

// ---------- Food ----------
// Low-poly food: each model is ONE merged geometry (details via vertex colors), so the cooking tint on its single material still works.
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const merge = parts => mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)));
function planarUV(geo, size) { // top-down texture projection
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / size + 0.5, p.getZ(i) / size + 0.5);
  return geo;
}
const V2 = (x, y) => new THREE.Vector2(x, y);
const FOOD_GEO = {
  chorizo() { // curved sausage with rounded, tied ends
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.15, 0, 0), new THREE.Vector3(0, 0, 0.07), new THREE.Vector3(0.15, 0, 0));
    const parts = [paint(new THREE.TubeGeometry(curve, 10, 0.045, 8), 0xffffff)];
    for (const t of [0, 1]) {
      const p = curve.getPoint(t), d = curve.getTangent(t).multiplyScalar(t ? 1 : -1);
      parts.push(paint(new THREE.SphereGeometry(0.045, 8, 6).translate(p.x, p.y, p.z), 0xffffff));
      const k = p.clone().addScaledVector(d, 0.055);
      parts.push(paint(new THREE.SphereGeometry(0.016, 5, 4).translate(k.x, k.y, k.z), 0xe8d8b0));
    }
    return merge(parts).translate(0, 0.015, 0);
  },
  vacio() { // irregular beveled slab with grill marks
    const jitter = [1, 0.93, 1.04, 0.97, 1.07, 0.95, 1, 0.91, 1.05, 0.96, 1.06, 0.94, 1.02, 0.97];
    const shape = new THREE.Shape(jitter.map((j, i) => {
      const a = i / jitter.length * Math.PI * 2;
      return V2(Math.cos(a) * 0.17 * j, Math.sin(a) * 0.11 * j);
    }));
    const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2 });
    slab.rotateX(-Math.PI / 2).translate(0, -0.015, 0);
    const parts = [paint(planarUV(slab, 0.36), 0xffffff)];
    for (const [off, len] of [[-0.055, 0.15], [0, 0.22], [0.055, 0.15]]) {
      parts.push(paint(new THREE.BoxGeometry(len, 0.004, 0.014).translate(0, 0, off).rotateY(0.6).translate(0, 0.052, 0), 0x2a1a12));
    }
    return merge(parts);
  },
  provoleta() { // melted cheese puck in a small iron pan, with oregano
    const cheese = new THREE.LatheGeometry([V2(0.001, -0.015), V2(0.1, -0.015), V2(0.118, -0.004), V2(0.122, 0.01), V2(0.114, 0.026), V2(0.085, 0.036), V2(0.04, 0.041), V2(0.001, 0.042)], 16);
    const pan = new THREE.LatheGeometry([V2(0.001, -0.03), V2(0.13, -0.03), V2(0.142, -0.02), V2(0.145, 0.004), V2(0.137, 0.004), V2(0.132, -0.018), V2(0.001, -0.018)], 16);
    const parts = [paint(planarUV(cheese, 0.26), 0xffffff), paint(planarUV(pan, 0.3), 0x3a3a3a)];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = 0.02 + (i % 3) * 0.028;
      parts.push(paint(new THREE.BoxGeometry(0.014, 0.004, 0.009).rotateY(a).translate(Math.cos(a) * r, 0.043 - r * 0.06, Math.sin(a) * r), 0x3f5e22));
    }
    return merge(parts);
  },
};
const foodGeo = {}, foodTex = {};
function makeFoodMesh(type) {
  foodGeo[type] ||= FOOD_GEO[type]();
  foodTex[type] ||= tex(type);
  const m = new THREE.Mesh(foodGeo[type], new THREE.MeshStandardMaterial({ map: foodTex[type], roughness: 0.5, vertexColors: true }));
  m.material.color.setRGB(...FOODS[type].raw);
  m.castShadow = true;
  return m;
}
const foodState = f => {
  const d = FOODS[f.type];
  return f.t < d.cook ? 'cooking' : f.t < d.cook + d.burn ? 'ready' : 'burnt';
};

function neededFood() {
  const have = { chorizo: 0, vacio: 0, provoleta: 0 };
  grillFood.forEach(f => { if (foodState(f) !== 'burnt') have[f.type]++; });
  if (held) have[held.type]++;
  for (const c of pendingOrders()) {
    if (have[c.order] > 0) have[c.order]--;
    else return c.order;
  }
  return null;
}
const pendingOrders = () => customers.filter(c => c.state === 'toTable' || c.state === 'wait').sort((a, b) => a.orderedAt - b.orderedAt);

function startCooking(type) {
  const slot = [0, 1, 2].slice(0, slotCount()).find(s => !grillFood.some(f => f.slot === s));
  const mesh = makeFoodMesh(type);
  mesh.position.set(SLOTS[slot], 0.97, -5.3);
  mesh.userData.kind = 'food';
  const bar = makeBar(0.4);
  bar.position.set(SLOTS[slot], 1.35, -5.3);
  scene.add(mesh, bar);
  const f = { type, t: 0, mesh, slot, bar };
  mesh.userData.ref = f;
  grillFood.push(f);
  sfx.cook();
}

function removeGrillFood(f) {
  grillFood.splice(grillFood.indexOf(f), 1);
  scene.remove(f.bar);
  scene.remove(f.mesh);
}

function pickUp(f) {
  removeGrillFood(f);
  if (foodState(f) === 'burnt') { toast(`Burnt ${FOODS[f.type].name} tossed!`, '#f66'); sfx.bad(); return; }
  held = { type: f.type, mesh: f.mesh };
  f.mesh.position.set(0.3, -0.3, -0.6);
  camera.add(f.mesh);
  sfx.pick();
}

function dropHeld() {
  camera.remove(held.mesh);
  held = null;
}

// ---------- Customers ----------
// One reusable low-poly person (shared geometry); only colors, scale and accessories vary.
const SHIRTS = [0x3a6ea5, 0xc94c4c, 0x4c9c5a, 0xd9a13b, 0x8a5ca8, 0x2f8f8f, 0xf0f0f0];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const HAIRS = [0x2b1d0e, 0x4a3020, 0x111111, 0x8a6a3a, 0xa8a8a8];
const PANTS = [0x2d3a4f, 0x3b3b3b, 0x5a4632, 0x1f2f5a, 0x6b6b5a];
const pick = a => a[Math.floor(Math.random() * a.length)];
const PG = {
  thigh: new THREE.CylinderGeometry(0.075, 0.065, 0.35, 6).translate(0, -0.175, 0),
  shin: new THREE.CylinderGeometry(0.063, 0.052, 0.43, 6).translate(0, -0.215, 0),
  foot: new THREE.BoxGeometry(0.1, 0.07, 0.2).translate(0, -0.465, 0.04),
  pelvis: new THREE.BoxGeometry(0.3, 0.14, 0.18),
  torso: new THREE.CylinderGeometry(0.2, 0.16, 0.5, 7).scale(1, 1, 0.7),
  upperArm: new THREE.CylinderGeometry(0.058, 0.05, 0.3, 6).translate(0, -0.15, 0),
  foreArm: new THREE.CylinderGeometry(0.045, 0.04, 0.24, 6).translate(0, -0.42, 0),
  hand: new THREE.IcosahedronGeometry(0.05, 0).translate(0, -0.57, 0),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6),
  head: new THREE.IcosahedronGeometry(0.15, 1),
  hair: new THREE.SphereGeometry(0.158, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55),
  eye: new THREE.BoxGeometry(0.03, 0.035, 0.03),
  nose: new THREE.ConeGeometry(0.025, 0.06, 4).rotateX(Math.PI / 2),
  mustache: new THREE.BoxGeometry(0.1, 0.022, 0.025),
  boina: new THREE.CylinderGeometry(0.165, 0.175, 0.05, 10),
};
function makePerson() {
  const lp = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });
  const shirt = lp(pick(SHIRTS)), skin = lp(pick(SKINS)), pants = lp(pick(PANTS)), hair = lp(pick(HAIRS)), dark = lp(0x1a1a1a);
  const root = new THREE.Group(), body = new THREE.Group();
  body.scale.setScalar(0.94 + Math.random() * 0.12);
  root.add(body);
  const legs = [-1, 1].map(side => {
    const hip = new THREE.Group(), knee = new THREE.Group();
    hip.position.set(side * 0.09, 0.85, 0);
    knee.position.y = -0.35;
    part(PG.thigh, pants, 0, 0, 0, hip);
    part(PG.shin, pants, 0, 0, 0, knee);
    part(PG.foot, dark, 0, 0, 0, knee);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  });
  part(PG.pelvis, pants, 0, 0.88, 0, body);
  part(PG.torso, shirt, 0, 1.19, 0, body);
  const arms = [-1, 1].map(side => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.235, 1.4, 0);
    sh.rotation.z = side * 0.08;
    part(PG.upperArm, shirt, 0, 0, 0, sh);
    part(PG.foreArm, skin, 0, 0, 0, sh);
    part(PG.hand, skin, 0, 0, 0, sh);
    body.add(sh);
    return sh;
  });
  part(PG.neck, skin, 0, 1.47, 0, body);
  part(PG.head, skin, 0, 1.62, 0, body);
  part(PG.hair, hair, 0, 1.635, -0.012, body).rotation.x = -0.35;
  for (const x of [-0.05, 0.05]) part(PG.eye, dark, x, 1.635, 0.14, body);
  part(PG.nose, skin, 0, 1.6, 0.155, body);
  const r = Math.random();
  if (r < 0.3) part(PG.boina, lp(pick([0x1a1a2a, 0x7a1f1f, 0x2b3a2b])), 0, 1.765, -0.01, body).rotation.z = 0.15;
  else if (r < 0.55) part(PG.mustache, hair, 0, 1.565, 0.14, body);
  return { root, body, legs, arms, t: Math.random() * 10, lx: 0, lz: 0 };
}

// Simple procedural pose: walk swing, sitting, eating (visual only)
function poseCustomer(c, dt) {
  const r = c.rig, p = c.group.position;
  const moving = Math.hypot(p.x - r.lx, p.z - r.lz) > 1e-4;
  r.lx = p.x; r.lz = p.z; r.t += dt;
  const sitting = c.state === 'wait' || c.state === 'eat';
  const s = moving && !sitting ? Math.sin(r.t * 9) * 0.5 : 0;
  r.body.position.y = sitting ? -0.09 : 0;
  r.legs.forEach((l, i) => {
    l.hip.rotation.x = sitting ? -Math.PI / 2 : (i ? -s : s);
    l.knee.rotation.x = sitting ? Math.PI / 2 : Math.max(0, i ? -s : s) * 0.8;
  });
  r.arms.forEach((a, i) => { a.rotation.x = sitting ? -0.7 : (i ? s : -s) * 0.8; });
  if (c.state === 'eat') r.arms[1].rotation.x = -1.3 + Math.sin(r.t * 6) * 0.35;
}
function spawnCustomer() {
  const free = tables.filter(t => t.active && !t.customer);
  if (!free.length) return;
  const table = free[Math.floor(Math.random() * free.length)];
  const rig = makePerson();
  const g = rig.root;
  g.position.copy(OUTSIDE);
  const bar = makeBar();
  bar.position.y = 2.0;
  g.add(bar);
  const c = {
    group: g, bar, table, state: 'enter', path: [DOOR_IN.clone()],
    order: FOOD_KEYS[Math.floor(Math.random() * 3)], patience: QUEUE_PATIENCE, maxPatience: QUEUE_PATIENCE,
    orderedAt: 0, bubble: null, food: null, eatT: 0, rig,
  };
  g.userData = { kind: 'customer', ref: c };
  table.customer = c;
  customers.push(c);
  scene.add(g);
}

function setBubble(c, text) {
  if (c.bubble) c.group.remove(c.bubble);
  c.bubble = null;
  if (!text) return;
  c.bubble = makeLabel(text, 0.35, '#fff', '#222');
  c.bubble.position.y = 2.25;
  c.group.add(c.bubble);
}

function takeOrder(c) {
  queue.shift();
  c.state = 'toTable';
  c.orderedAt = performance.now();
  c.path = [new THREE.Vector3(c.table.seat.x, 0, -1), c.table.seat.clone()];
  setBubble(c, FOODS[c.order].name);
  toast(`Order: ${FOODS[c.order].name} → Mesa ${c.table.n}`);
  beep(880, 0.08);
}

function serve(c) {
  const m = held.mesh;
  dropHeld();
  m.position.set(c.table.x - 0.3, 0.82, c.table.z);
  scene.add(m);
  c.food = m;
  c.state = 'eat';
  c.eatT = EAT_TIME;
  setBubble(c, null);
  sfx.serve();
}

function leave(c, angry) {
  c.state = 'exit';
  c.group.position.y = 0;
  c.table.customer = null;
  const qi = queue.indexOf(c);
  if (qi >= 0) queue.splice(qi, 1);
  c.path = [DOOR_IN.clone(), OUTSIDE.clone()];
  setBubble(c, angry ? '>:(' : null);
  c.bar.visible = false;
  if (angry) { toast('A customer left angry!', '#f66'); sfx.bad(); }
}

function updateCustomer(c, dt) {
  // queue slot follows queue order
  if (c.state === 'queue' || c.state === 'order') {
    const i = queue.indexOf(c);
    c.path = [COUNTER_SPOT.clone().add(new THREE.Vector3(0, 0, i * 0.9))];
  }
  // move along path
  const target = c.path[0];
  if (target) {
    const p = c.group.position;
    const dx = target.x - p.x, dz = target.z - p.z, dist = Math.hypot(dx, dz);
    const step = NPC_SPEED * dt;
    if (dist <= step) { p.x = target.x; p.z = target.z; c.path.shift(); }
    else { p.x += dx / dist * step; p.z += dz / dist * step; }
    if (dist > 0.01) c.group.rotation.y = Math.atan2(dx, dz);
  }
  const arrived = c.path.length === 0;

  switch (c.state) {
    case 'enter':
      if (arrived) { c.state = 'queue'; queue.push(c); }
      break;
    case 'queue':
      if (arrived && queue[0] === c) { c.state = 'order'; c.group.rotation.y = Math.PI; setBubble(c, '?'); }
      break;
    case 'toTable':
      if (arrived) {
        c.state = 'wait';
        c.group.position.y = -0.2;
        c.group.rotation.y = Math.PI / 2;
        c.patience = c.maxPatience = WAIT_PATIENCE;
      }
      break;
    case 'eat':
      c.eatT -= dt;
      if (c.eatT <= 0) {
        scene.remove(c.food);
        const earned = FOODS[c.order].price + (has('chimi') ? 8 : 0);
        money += earned;
        toast(`+$${earned}`, '#ffd76a');
        sfx.pay();
        leave(c, false);
      }
      break;
    case 'exit':
      if (arrived) { scene.remove(c.group); customers.splice(customers.indexOf(c), 1); }
      break;
  }

  if (['queue', 'order', 'wait'].includes(c.state)) {
    c.patience -= dt;
    const p = c.patience / c.maxPatience;
    setBar(c.bar, p, p > 0.5 ? 0x44dd44 : p > 0.25 ? 0xffcc33 : 0xff4444);
    if (c.patience <= 0) leave(c, true);
  } else if (c.state !== 'exit') {
    setBar(c.bar, 1, 0x44dd44);
  }
  poseCustomer(c, dt);
}

// ---------- Interaction ----------
function customerTarget(obj) {
  let o = obj;
  while (o && !o.userData.kind) o = o.parent;
  return o;
}

function getAction(o) {
  const { kind, ref } = o.userData;
  if (kind === 'customer') {
    if (ref.state === 'queue' || ref.state === 'order') return getAction(counter);
    if (ref.state === 'wait' || ref.state === 'eat' || ref.state === 'toTable') return getAction(ref.table.group);
    return null;
  }
  if (kind === 'counter') {
    const c = queue[0];
    if (c && c.state === 'order') return { label: '[E] Take order', fn: () => takeOrder(c) };
    return { label: queue.length ? 'Customer coming…' : 'No customers waiting' };
  }
  if (kind === 'food') {
    if (held) return getAction(grill);
    const st = foodState(ref), name = FOODS[ref.type].name;
    if (st === 'cooking') return { label: `${name} cooking… ${Math.floor(ref.t / FOODS[ref.type].cook * 100)}%` };
    if (st === 'ready') return { label: `[E] Pick up ${name}`, fn: () => pickUp(ref) };
    return { label: `[E] Toss burnt ${name}`, fn: () => pickUp(ref) };
  }
  if (kind === 'grill') {
    if (held) return { label: `[E] Discard ${FOODS[held.type].name}`, fn: () => { scene.remove(held.mesh); dropHeld(); } };
    const need = neededFood();
    if (!need) return { label: 'Nothing to cook' };
    if (grillFood.length >= slotCount()) return { label: 'Grill full' };
    return { label: `[E] Cook ${FOODS[need].name}`, fn: () => startCooking(need) };
  }
  if (kind === 'table') {
    const c = ref.customer;
    if (!c || !['wait', 'eat', 'toTable'].includes(c.state)) return { label: `Mesa ${ref.n}` };
    if (c.state === 'eat') return { label: 'Eating… ' };
    if (c.state === 'toTable') return { label: `Mesa ${ref.n}: ${FOODS[c.order].name}` };
    if (!held) return { label: `Mesa ${ref.n} wants ${FOODS[c.order].name}` };
    if (held.type !== c.order) return { label: `Wrong food! Wants ${FOODS[c.order].name}` };
    return { label: `[E] Serve ${FOODS[held.type].name}`, fn: () => serve(c) };
  }
  if (kind === 'upgrade') {
    if (ref.bought) return { label: `${ref.name} — owned` };
    if (money < ref.cost) return { label: `${ref.name} $${ref.cost} (not enough money)` };
    return { label: `[E] Buy ${ref.name} $${ref.cost}`, fn: () => buyUpgrade(ref, o) };
  }
  return null;
}

function buyUpgrade(u, panel) {
  money -= u.cost;
  u.bought = true;
  panel.material.map = makeLabel(`${u.name}\nOWNED`, 0.45, '#555').material.map;
  if (u.id === 'tables') { tables[3].active = tables[3].col.on = tables[3].group.visible = true; }
  toast(`${u.name} bought!`, '#9f6');
  sfx.pay();
}

const raycaster = new THREE.Raycaster();
raycaster.far = 3.2;
let currentAction = null;
function updateInteraction() {
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const targets = [counter, grill, coals, ...grillFood.map(f => f.mesh), ...tables.filter(t => t.active).map(t => t.group),
    ...customers.filter(c => c.state !== 'exit').map(c => c.group), ...upgradePanels];
  const hit = raycaster.intersectObjects(targets, true)[0];
  const o = hit && customerTarget(hit.object);
  currentAction = o ? getAction(o) : null;
  promptEl.textContent = currentAction ? currentAction.label : '';
}

// ---------- HUD ----------
const moneyEl = document.getElementById('money');
const ordersEl = document.getElementById('orders');
const promptEl = document.getElementById('prompt');
const msgEl = document.getElementById('msg');
function toast(text, color = '#9f6') { msgEl.textContent = text; msgEl.style.color = color; msgTimer = 2; }
function updateHUD() {
  moneyEl.textContent = `Money: $${money}`;
  const lines = pendingOrders().map(c => `Mesa ${c.table.n} · ${FOODS[c.order].name}`);
  if (queue[0] && queue[0].state === 'order') lines.unshift('<i>Counter: ready to order</i>');
  if (held) lines.push(`<br>Holding: ${FOODS[held.type].name}`);
  ordersEl.innerHTML = `<b>Orders</b><br>${lines.join('<br>') || '—'}`;
}

// ---------- Player ----------
const keys = {};
let yaw = 0, pitch = 0, velY = 0;
camera.rotation.set(0, yaw, 0);
const startEl = document.getElementById('start');
startEl.addEventListener('click', () => { initAudio(); renderer.domElement.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  startEl.style.display = document.pointerLockElement ? 'none' : 'flex';
});
document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.5, 1.5);
  camera.rotation.set(pitch, yaw, 0);
});
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyE' && document.pointerLockElement && currentAction && currentAction.fn) currentAction.fn();
});
addEventListener('keyup', e => { keys[e.code] = false; });

function blocked(x, z) {
  return colliders.some(c => c.on && x > c.minX - PLAYER_R && x < c.maxX + PLAYER_R && z > c.minZ - PLAYER_R && z < c.maxZ + PLAYER_R);
}

function updatePlayer(dt) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let mx = fx * f - fz * s, mz = fz * f + fx * s;
  const len = Math.hypot(mx, mz);
  if (len > 0) {
    mx = mx / len * SPEED * dt; mz = mz / len * SPEED * dt;
    const p = camera.position;
    if (!blocked(p.x + mx, p.z)) p.x += mx;
    if (!blocked(p.x, p.z + mz)) p.z += mz;
  }
  // gravity
  velY -= 20 * dt;
  camera.position.y += velY * dt;
  if (camera.position.y <= EYE) { camera.position.y = EYE; velY = 0; }
}

// ---------- Loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const playing = !!document.pointerLockElement;
  if (playing) {
    updatePlayer(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnCustomer(); spawnTimer = 9 + Math.random() * 7; }

    const speed = has('charcoal') ? 1.4 : 1;
    for (const f of [...grillFood]) {
      f.t += dt * speed;
      const d = FOODS[f.type], st = foodState(f);
      const col = new THREE.Color().setRGB(...d.raw);
      if (st === 'cooking') col.lerp(new THREE.Color(1, 1, 1), f.t / d.cook);
      else if (st === 'ready') col.setRGB(1, 1, 1).lerp(new THREE.Color(0.3, 0.2, 0.15), (f.t - d.cook) / d.burn * 0.7);
      else col.setRGB(0.02, 0.018, 0.018);
      f.mesh.material.color.copy(col);
      if (st === 'cooking') setBar(f.bar, f.t / d.cook, 0xffcc33);
      else if (st === 'ready') setBar(f.bar, 1 - (f.t - d.cook) / d.burn, Math.floor(f.t * 4) % 2 && f.t - d.cook > d.burn * 0.6 ? 0xff4444 : 0x44dd44);
      else setBar(f.bar, 1, 0x000000);
    }
    if (sizzleGain) sizzleGain.gain.value = grillFood.length ? 0.015 * grillFood.length : 0;

    for (const c of [...customers]) updateCustomer(c, dt);
    coals.material.emissiveIntensity = 0.7 + Math.sin(performance.now() / 200) * 0.15;
    flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(performance.now() / 70 + i * 1.7) * 0.2; });
    if (msgTimer > 0 && (msgTimer -= dt) <= 0) msgEl.textContent = '';
  } else if (sizzleGain) sizzleGain.gain.value = 0;

  updateInteraction();
  updateHUD();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// debug/test hook
window.__game = { camera, customers, queue, grillFood, tables, get money() { return money; }, set money(v) { money = v; }, get held() { return held; }, get action() { return currentAction; }, setLook(y, p) { yaw = y; pitch = p; camera.rotation.set(p, y, 0); } };
