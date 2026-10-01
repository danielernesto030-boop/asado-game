import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Config ----------
// Dishes: what guests order and what goes on the grill
const FOODS = {
  // raw = RGB tint over the cooked texture (>1 brightens, so raw looks pale/pink)
  chorizo:   { name: 'Chorizo',   price: 15, cook: 9,  burn: 8, raw: [1.7, 1.2, 1.2] },
  vacio:     { name: 'Vacío',     price: 25, cook: 13, burn: 8, raw: [1.9, 1.2, 1.25] },
  provoleta: { name: 'Provoleta', price: 20, cook: 7,  burn: 6, raw: [1.15, 1.15, 1.2] },
  filet:     { name: 'Filet',     price: 35, cook: 11, burn: 7, raw: [2, 1.15, 1.2], tex: 'vacio' },
  bife:      { name: 'Bife de Chorizo', price: 30, cook: 12, burn: 7, raw: [1.9, 1.2, 1.2], tex: 'vacio' },
};
// Wholesale items kept in cold storage; whole cuts are cut into portions at the prep station
const ITEMS = {
  filet_whole: { name: 'Whole Filet',     dish: 'filet',     whole: true, pack: 1, cost: 90 },
  vacio_whole: { name: 'Whole Vacío',     dish: 'vacio',     whole: true, pack: 1, cost: 60 },
  bife:        { name: 'Bife de Chorizo', dish: 'bife',      pack: 4, cost: 56 },
  chorizo:     { name: 'Chorizo',         dish: 'chorizo',   pack: 6, cost: 36 },
  provoleta:   { name: 'Provoleta',       dish: 'provoleta', pack: 4, cost: 32, plain: true }, // no meat quality
};
const ITEM_KEYS = Object.keys(ITEMS);
const QUALITY = [
  { name: 'Standard', cost: 1, price: 1 },
  { name: 'Premium', cost: 1.5, price: 1.3 },
  { name: 'Angus', cost: 2.2, price: 1.7 },
  { name: 'Dry-Aged', cost: 3.2, price: 2.3 },
];
const STARTER = [['chorizo', 6], ['provoleta', 4], ['vacio_whole', 1], ['filet_whole', 1]]; // free crates on day 1
const TIME_SCALE = 1.7;           // game minutes per real second: the 12:00-22:00 shift lasts about 6 minutes
const DAY_START = 11 * 60, OPEN_AT = 12 * 60, CLOSE_AT = 22 * 60;
const COOK_WAGE = 30;
const QUEUE_PATIENCE = 40, WAIT_PATIENCE = 75, EAT_TIME = 6;
const EYE = 1.6, PLAYER_R = 0.3, SPEED = 4, NPC_SPEED = 1.6;
const DOOR_IN = new THREE.Vector3(-6, 0, 5.2), OUTSIDE = new THREE.Vector3(-6, 0, 8.5);
const COUNTER_SPOT = new THREE.Vector3(-4.5, 0, -2.6);

const UPGRADES = [
  { id: 'grill', cat: 'KITCHEN', name: 'Bigger Grill', desc: '+1 grill slot', cost: [150] },
  { id: 'grillq', cat: 'KITCHEN', name: 'Better Grill', desc: 'Food cooks 35% faster', cost: [120] },
  { id: 'prep', cat: 'KITCHEN', name: 'Better Prep Station', desc: '8 portions per whole cut, cutting twice as fast', cost: [100] },
  { id: 'cold', cat: 'STORAGE', name: 'Bigger Cold Storage', desc: '+20 storage space (extra freezer)', cost: [80] },
  { id: 'storage', cat: 'STORAGE', name: 'More Storage Capacity', desc: '+30 storage space (extra shelving)', cost: [150] },
  { id: 'tables', cat: 'RESTAURANT', name: 'More Tables', desc: 'Adds table 4', cost: [200] },
  { id: 'interior', cat: 'RESTAURANT', name: 'Better Interior', desc: 'Guests are 30% more patient and tip more', cost: [180] },
  { id: 'quality', cat: 'FOOD', name: 'Better Meat Quality', desc: 'Unlocks Premium, then Angus, then Dry-Aged meat', cost: [100, 250, 500] },
  { id: 'menu', cat: 'FOOD', name: 'More Food Options', desc: 'Adds Bife de Chorizo to the menu and wholesale', cost: [120] },
  { id: 'cook', cat: 'STAFF', name: 'Hire Prep Cook', desc: `Cuts whole meat for you · $${COOK_WAGE}/day wage`, cost: [60] },
];
UPGRADES.forEach(u => { u.level = 0; });
const lvl = id => UPGRADES.find(u => u.id === id).level;
const has = id => lvl(id) > 0;
const portionsPer = () => (has('prep') ? 8 : 6);
const capacity = () => 30 + (has('cold') ? 20 : 0) + (has('storage') ? 30 : 0);
const menu = () => Object.keys(FOODS).filter(d => d !== 'bife' || has('menu'));
const patienceMult = () => (has('interior') ? 1.3 : 1);
const spawnGap = () => Math.max(7, 30 - day * 4) + Math.random() * 8; // guests arrive faster every day

// ---------- State ----------
let money = 0;
let held = null;          // { kind: 'crate' | 'whole' | 'portion' | 'cooked', type, q, mesh, qs }
const grillFood = [];     // { type, q, t, mesh, slot, bar }
const customers = [];
const queue = [];
let spawnTimer = 2;
let msgTimer = 0;
let day = 1, isOpen = false, dayDone = false, everOpened = false, warnedClosing = false, clockMin = DAY_START;
const stock = Object.fromEntries(ITEM_KEYS.map(k => [k, []])); // cold storage: one quality level per unit
const trays = { filet: [], vacio: [] };                          // cut portions waiting at the prep station
const crates = [];                                               // crates standing in the delivery area
let delivery = null;                                             // wholesale order on its way: { t, list }
let busy = null;                                                 // cutting in progress at the prep station
let uiMode = null, summaryTimer = 0;                             // uiMode: 'os' | 'summary'
let today = { revenue: 0, food: 0, staff: 0, upgrades: 0 };
const history = [];

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
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const grillLight = new THREE.PointLight(0xff7a2a, 3, 6);
grillLight.position.set(4.5, 1.6, -4.8);
scene.add(grillLight);
const kitchenLight = new THREE.PointLight(0xf4f8ff, 12, 14);
kitchenLight.position.set(2.5, 3.2, -9);
scene.add(kitchenLight);
const officeLight = new THREE.PointLight(0xffe2b0, 6, 7);
officeLight.position.set(-6.2, 3, -10.4);
scene.add(officeLight);

// ---------- Helpers ----------
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
const colliders = [], solids = []; // solids also block the interaction ray

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
  if (collide) {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, on: true });
    solids.push(m);
  }
  return m;
}

function makeLabel(text, scale = 0.5, bg = '#0009', fg = '#fff') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  let size = lines.length > 2 ? 68 : lines.length > 1 ? 90 : 150;
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
  door: () => beep(90, 0.3, 'triangle', 0.25),
  sign: () => { beep(620, 0.05, 'square', 0.05); beep(460, 0.06, 'square', 0.05, 0.15); },
  chop: () => beep(1500, 0.03, 'square', 0.035),
  store: () => beep(150, 0.14, 'triangle', 0.2),
  truck: () => { beep(330, 0.25, 'sawtooth', 0.05); beep(262, 0.35, 'sawtooth', 0.05, 0.28); },
  ui: () => beep(1200, 0.04, 'square', 0.035),
};

// ---------- Restaurant ----------
// Layout: dining room (z -6..6, front door at x -7..-5) · back of house behind the brick grill wall
// (z -12..-6: kitchen/prep, cold storage, storage, office) · delivery yard outside the back door (x 8..14)
function flat(w, d, material, x, z, y = 0) { // floor / ground patch
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), typeof material === 'number' ? mat(material) : material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
flat(70, 70, 0x6d7a58, 0, 0, -0.02);             // grass
flat(16, 6, 0x777777, 0, 9, -0.01);              // street
flat(16, 12, texMat('floor', 6.7, 5), 0, 0);     // dining room
const kitchenTiles = texMat('floor', 6.7, 2.5);
kitchenTiles.color.set(0xbfc8c8);
flat(16, 6, kitchenTiles, 0, -9);                // back of house
flat(3.6, 3.2, 0x8a6040, -6.2, -10.4, 0.003);    // office floor
flat(6, 8, 0x9a9a95, 11, -9, 0.002);             // delivery yard

const WALL = 0xf0e0c0, WH = 3.5;
box(9, WH, 0.2, brickMats(9, WH, 0.2), -3.5, WH / 2, -6);    // brick wall behind the grill,
box(5.4, WH, 0.2, brickMats(5.4, WH, 0.2), 5.3, WH / 2, -6); // kitchen doorway at x 1..2.6
box(1.6, 1.1, 0.2, brickMats(1.6, 1.1, 0.2), 1.8, WH - 0.55, -6, false);
box(0.2, WH, 12, WALL, -8, WH / 2, 0);          // dining left
box(0.2, WH, 12, WALL, 8, WH / 2, 0);           // dining right
box(1, WH, 0.2, WALL, -7.5, WH / 2, 6);         // front, left of door
box(13, WH, 0.2, WALL, 1.5, WH / 2, 6);         // front, right of door
box(2, 1, 0.2, WALL, -6, WH - 0.5, 6, false);   // above door
colliders.push({ minX: -7, maxX: -5, minZ: 5.9, maxZ: 6.1, on: true }); // the player stays inside; guests use the door
box(0.2, WH, 6, WALL, -8, WH / 2, -9);          // back of house
box(16.2, WH, 0.2, WALL, 0, WH / 2, -12);
box(0.2, WH, 1.6, WALL, 8, WH / 2, -11.2);      // east wall, back door at z -10.4..-9
box(0.2, WH, 3, WALL, 8, WH / 2, -7.5);
box(0.2, 1.1, 1.4, WALL, 8, WH - 0.55, -9.7, false);
box(2, WH, 0.2, WALL, -7, WH / 2, -8.8);        // office, door at x -6..-4.8
box(0.4, WH, 0.2, WALL, -4.6, WH / 2, -8.8);
box(1.2, 1.1, 0.2, WALL, -5.4, WH - 0.55, -8.8, false);
box(0.2, WH, 3.2, WALL, -4.4, WH / 2, -10.4);
// delivery yard: low walls, painted loading zone, sign
for (const [w, d, x, z] of [[6, 0.15, 11, -13], [6, 0.15, 11, -5], [0.15, 8, 14, -9], [0.15, 1, 8, -12.5]]) box(w, 1.1, d, 0x9d9d98, x, 0.55, z);
const stripe = mat(0xf2c230);
for (const [w, d, x, z] of [[4.6, 0.1, 11, -12.25], [4.6, 0.1, 11, -6.75], [0.1, 5.6, 8.7, -9.5], [0.1, 5.6, 13.3, -9.5]]) flat(w, d, stripe, x, z, 0.004);
for (let i = 0; i < 5; i++) flat(0.12, 0.9, stripe, 9.4 + i * 0.85, -7.15, 0.004).rotation.z = 0.7;
box(0.1, 2.3, 0.1, 0x555555, 13.6, 1.15, -9.5, false);
const deliverySign = makeLabel('DELIVERY', 0.45, '#f2c230', '#1a1a1a');
deliverySign.position.set(13.6, 2.55, -9.5);
scene.add(deliverySign);

// Counter
const counter = box(3, 1, 0.8, 0x7a4a25, -4.5, 0.5, -3.5);
box(3.1, 0.06, 0.9, 0x3a2a1a, -4.5, 1.03, -3.5, false);
counter.userData.kind = 'counter';
const counterLabel = makeLabel('PEDIDOS', 0.4);
counterLabel.position.set(-4.5, 2.2, -3.5);
scene.add(counterLabel);
// order screens (counter POS + kitchen display) share one canvas, drawn by drawScreens()
const orderCanvas = document.createElement('canvas');
orderCanvas.width = 512;
orderCanvas.height = 360;
const orderTex = new THREE.CanvasTexture(orderCanvas);
orderTex.colorSpace = THREE.SRGBColorSpace;
function orderScreen(w, x, y, z, stand) { // faces -z, towards the staff side
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = Math.PI;
  part(new THREE.BoxGeometry(w + 0.05, w * 0.7 + 0.05, 0.04), mat(0x1a1a1a), 0, 0, -0.025, g);
  part(new THREE.PlaneGeometry(w, w * 0.7), new THREE.MeshBasicMaterial({ map: orderTex }), 0, 0, 0, g).castShadow = false;
  if (stand) part(new THREE.BoxGeometry(0.05, 0.26, 0.05), mat(0x1a1a1a), 0, -w * 0.35 - 0.13, -0.03, g);
  scene.add(g);
}
orderScreen(0.56, -3.5, 1.46, -3.72, true); // on the front counter
orderScreen(0.9, 4.2, 1.95, -6.13, false);  // kitchen display above the prep station

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
const plateGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.012, 16), plateMat = mat(0xf4f4f0);
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
  const plate = new THREE.Mesh(plateGeo, plateMat);
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

// ---------- Food ----------
// Low-poly food: each model is ONE merged geometry (details via vertex colors), so the cooking tint on its single material still works.
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
const merge = parts => mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)));
// top-down texture projection for the first `caps` vertices; the rest keep their own UVs (in metres) at the same scale
function planarUV(geo, size, caps = geo.attributes.position.count) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (i < caps) uv.setXY(i, p.getX(i) / size + 0.5, p.getZ(i) / size + 0.5);
    else uv.setXY(i, uv.getX(i) / size, uv.getY(i) / size);
  }
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
    const parts = [paint(planarUV(slab, 0.36, slab.groups[0].count), 0xffffff)]; // group 0 = top/bottom caps
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
  filet() { // thick medallion with grill marks
    const med = new THREE.LatheGeometry([V2(0.001, -0.03), V2(0.075, -0.03), V2(0.086, -0.012), V2(0.087, 0.018), V2(0.078, 0.038), V2(0.001, 0.04)], 12);
    const parts = [paint(planarUV(med, 0.2), 0xffffff)];
    for (const off of [-0.03, 0.03]) parts.push(paint(new THREE.BoxGeometry(0.12, 0.004, 0.012).translate(0, 0, off).rotateY(0.6).translate(0, 0.041, 0), 0x2a1a12));
    return merge(parts);
  },
  bife() { // strip steak with a fat cap along one side
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pts.push(V2(Math.sign(c) * Math.abs(c) ** 0.6 * 0.15, Math.sign(sn) * Math.abs(sn) ** 0.6 * 0.09));
    }
    const slab = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 });
    slab.rotateX(-Math.PI / 2).translate(0, -0.015, 0);
    const parts = [paint(planarUV(slab, 0.34, slab.groups[0].count), 0xffffff), paint(new THREE.BoxGeometry(0.26, 0.05, 0.03).translate(0, 0.012, 0.1), 0xf0e0c0)];
    for (const off of [-0.04, 0.02]) parts.push(paint(new THREE.BoxGeometry(0.2, 0.004, 0.013).translate(0, 0, off).rotateY(0.5).translate(0, 0.043, 0), 0x2a1a12));
    return merge(parts);
  },
};
const foodGeo = {}, foodTex = {};
function foodMat(type) {
  const tn = FOODS[type].tex || type;
  foodTex[tn] ||= tex(tn);
  const m = new THREE.MeshStandardMaterial({ map: foodTex[tn], roughness: 0.5, vertexColors: true });
  m.color.setRGB(...FOODS[type].raw);
  return m;
}
function makeFoodMesh(type) {
  foodGeo[type] ||= FOOD_GEO[type]();
  const m = new THREE.Mesh(foodGeo[type], foodMat(type));
  m.castShadow = true;
  return m;
}
// cold-storage items: whole cuts get their own shape, everything else looks like its dish
function makeItemMesh(it) {
  if (it === 'filet_whole') {
    foodGeo.filet_whole ||= paint(new THREE.LatheGeometry([V2(0.001, -0.22), V2(0.04, -0.2), V2(0.062, -0.1), V2(0.07, 0.04), V2(0.06, 0.15), V2(0.032, 0.21), V2(0.001, 0.225)], 10).rotateZ(Math.PI / 2), 0xffffff);
    const m = new THREE.Mesh(foodGeo.filet_whole, foodMat('filet'));
    m.castShadow = true;
    return m;
  }
  const m = makeFoodMesh(ITEMS[it].dish);
  if (it === 'vacio_whole') m.scale.set(1.8, 1.4, 1.7);
  return m;
}
const foodState = f => {
  const d = FOODS[f.type];
  return f.t < d.cook ? 'cooking' : f.t < d.cook + d.burn ? 'ready' : 'burnt';
};

function startCooking(type, q = 0) {
  const slot = [0, 1, 2].slice(0, slotCount()).find(s => !grillFood.some(f => f.slot === s));
  const mesh = makeFoodMesh(type);
  mesh.position.set(SLOTS[slot], 0.97, -5.3);
  mesh.userData.kind = 'food';
  const bar = makeBar(0.4);
  bar.position.set(SLOTS[slot], 1.35, -5.3);
  scene.add(mesh, bar);
  const f = { type, q, t: 0, mesh, slot, bar };
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
  if (foodState(f) === 'burnt') { reach(); toast(`Burnt ${FOODS[f.type].name} tossed!`, '#f66'); sfx.bad(); return; }
  hold({ kind: 'cooked', type: f.type, q: f.q, mesh: f.mesh });
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
function makePerson(shirtColor) {
  const lp = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });
  const shirt = lp(shirtColor ?? pick(SHIRTS)), skin = lp(pick(SKINS)), pants = lp(pick(PANTS)), hair = lp(pick(HAIRS)), dark = lp(0x1a1a1a);
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
  if (c.state === 'eat' || c.state === 'prep') r.arms[1].rotation.x = -1.3 + Math.sin(r.t * 6) * 0.35;
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
    items: null, foods: [], patience: QUEUE_PATIENCE * patienceMult(), maxPatience: QUEUE_PATIENCE * patienceMult(),
    orderedAt: 0, bubble: null, eatT: 0, tipP: 1, rig,
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
  const items = makeOrder();
  if (!items.length) {
    leave(c, false);
    setBubble(c, 'No food?');
    toast('Out of stock! Store your crates or buy food at the office terminal.', '#f66', 4);
    sfx.bad();
    return;
  }
  c.items = items;
  c.state = 'toTable';
  c.orderedAt = performance.now();
  c.path = [new THREE.Vector3(c.table.seat.x, 0, -1), c.table.seat.clone()];
  setBubble(c, orderText(items));
  toast(`Order: ${orderText(items).replace(/\n/g, ', ')} → Mesa ${c.table.n}`);
  beep(880, 0.08);
}

// what can still be served: stock (whole cuts count their portions), cut portions, grill and hands, minus open orders
function availability() {
  const per = portionsPer(), a = Object.fromEntries(Object.keys(FOODS).map(d => [d, 0]));
  for (const k of ITEM_KEYS) a[ITEMS[k].dish] += stock[k].length * (ITEMS[k].whole ? per : 1);
  for (const d in trays) a[d] += trays[d].length;
  grillFood.forEach(f => { if (foodState(f) !== 'burnt') a[f.type]++; });
  if (held?.kind === 'whole') a[ITEMS[held.type].dish] += per;
  else if (held && held.kind !== 'crate') a[held.type]++;
  if (busy) a[ITEMS[busy.whole.type].dish] += per;
  if (cook?.carry) a[ITEMS[cook.carry.type].dish] += per;
  customers.forEach(c => c.items && c.state !== 'exit' && c.items.forEach(i => { if (!i.served) a[i.dish]--; }));
  return a;
}
function makeOrder() { // day 1: one dish per guest, bigger orders later
  const a = availability(), items = [], r = Math.random();
  for (let n = day === 1 ? 1 : day < 4 ? (r < 0.35 ? 2 : 1) : (r < 0.25 ? 3 : r < 0.6 ? 2 : 1); n > 0; n--) {
    const opts = menu().filter(d => a[d] > 0);
    if (!opts.length) break;
    const d = pick(opts);
    a[d]--;
    items.push({ dish: d, served: false, q: 0 });
  }
  return items;
}
function orderText(items) { // unserved dishes, one line each
  const n = {};
  items.forEach(i => { if (!i.served) n[i.dish] = (n[i.dish] || 0) + 1; });
  return Object.entries(n).map(([d, k]) => (k > 1 ? `${k}× ` : '') + FOODS[d].name).join('\n');
}

function serve(c, i) {
  const m = held.mesh, k = c.items.filter(it => it.served).length, z = c.table.z + [0, 0.3, -0.3][k % 3];
  c.items[i].served = true;
  c.items[i].q = held.q;
  dropHeld();
  m.position.set(c.table.x - 0.3, 0.82, z);
  scene.add(m);
  c.foods.push(m);
  if (k) { // extra dishes get their own plate
    const p = new THREE.Mesh(plateGeo, plateMat);
    p.position.set(c.table.x - 0.3, 0.797, z);
    scene.add(p);
    c.foods.push(p);
  }
  sfx.serve();
  if (c.items.every(it => it.served)) {
    c.tipP = c.patience / c.maxPatience;
    c.state = 'eat';
    c.eatT = EAT_TIME;
    setBubble(c, null);
  } else setBubble(c, orderText(c.items));
}

function payFor(c) { // price × meat quality, plus a tip for quality and speed
  let total = 0, qs = 0;
  for (const it of c.items) { total += Math.round(FOODS[it.dish].price * QUALITY[it.q].price); qs += it.q + 1; }
  const tip = Math.round(total * 0.05 * (qs / c.items.length) * c.tipP * (has('interior') ? 1.5 : 1));
  money += total + tip;
  today.revenue += total + tip;
  toast(`+${fmtMoney(total + tip)}${tip ? ` (incl. ${fmtMoney(tip)} tip)` : ''}`, '#ffd76a');
  sfx.pay();
}

function leave(c, angry) {
  c.state = 'exit';
  c.group.position.y = 0;
  c.table.customer = null;
  const qi = queue.indexOf(c);
  if (qi >= 0) queue.splice(qi, 1);
  c.path = [DOOR_IN.clone(), OUTSIDE.clone()];
  c.foods.forEach(m => scene.remove(m));
  c.foods = [];
  setBubble(c, angry ? '>:(' : null);
  c.bar.visible = false;
  if (angry) { toast('A guest left angry!', '#f66'); sfx.bad(); }
}

function stepPath(o, dt) { // walk a person along its path; true once arrived
  const target = o.path[0];
  if (target) {
    const p = o.group.position, dx = target.x - p.x, dz = target.z - p.z, dist = Math.hypot(dx, dz), step = NPC_SPEED * dt;
    if (dist <= step) { p.x = target.x; p.z = target.z; o.path.shift(); } else { p.x += dx / dist * step; p.z += dz / dist * step; }
    if (dist > 0.01) o.group.rotation.y = Math.atan2(dx, dz);
  }
  return o.path.length === 0;
}

function updateCustomer(c, dt) {
  // queue slot follows queue order
  if (c.state === 'queue' || c.state === 'order') {
    const i = queue.indexOf(c);
    c.path = [COUNTER_SPOT.clone().add(new THREE.Vector3(0, 0, i * 0.9))];
  }
  const arrived = stepPath(c, dt);

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
        c.patience = c.maxPatience = WAIT_PATIENCE * patienceMult() * (1 + 0.25 * (c.items.length - 1));
      }
      break;
    case 'eat':
      c.eatT -= dt;
      if (c.eatT <= 0) {
        payFor(c);
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

// ---------- Back of house, entrance, delivery ----------
function panel(text, w, h, bg = '#000a', fg = '#fff') { // flat canvas sign facing +z
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: makeLabel(text, 1, bg, fg).material.map, transparent: true }));
  scene.add(m);
  return m;
}
function setText(obj, text, bg = '#000a', fg = '#fff') { // re-letter a panel or label sprite
  obj.material.map.dispose();
  obj.material.map = makeLabel(text, 1, bg, fg).material.map;
}
for (const [t, x, y, z] of [['KITCHEN', 1.8, 2.75, -5.85], ['STORAGE', -2.2, 2.55, -11.3], ['OFFICE', -5.4, 2.75, -8.65], ['PREP STATION', 4.2, 2.6, -6.3]]) {
  const l = makeLabel(t, 0.28);
  l.position.set(x, y, z);
  scene.add(l);
}
const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.6, roughness: 0.35 });
const wood = mat(0x6b3f22), dark = mat(0x222222);
const hitMat = new THREE.MeshBasicMaterial({ visible: false }); // invisible, but still hit by the interaction ray

// front door (swings out while open) + an OPEN/CLOSED sign that physically turns around
const doorPivot = new THREE.Group();
doorPivot.position.set(-7, 0, 6);
part(new THREE.BoxGeometry(1.96, 2.45, 0.06), wood, 0.98, 1.225, 0, doorPivot);
part(new THREE.BoxGeometry(1.2, 0.8, 0.07), new THREE.MeshStandardMaterial({ color: 0x9fc8e0, roughness: 0.1, metalness: 0.3 }), 0.98, 1.65, 0, doorPivot);
part(new THREE.BoxGeometry(0.05, 0.05, 0.16), iron, 1.78, 1.05, 0, doorPivot);
doorPivot.userData.kind = 'door';
scene.add(doorPivot);
box(0.06, 0.06, 0.5, 0x222222, -4.2, 2.36, 5.65, false); // sign bracket
const signPivot = new THREE.Group();
signPivot.position.set(-4.2, 1.95, 5.4);
part(new THREE.BoxGeometry(0.02, 0.4, 0.02), iron, 0, 0.2, 0, signPivot);
part(new THREE.BoxGeometry(0.94, 0.48, 0.04), wood, 0, -0.1, 0, signPivot);
for (const [t, bg, z, ry] of [['CLOSED', '#b3261e', -0.021, Math.PI], ['OPEN', '#2e7d32', 0.021, 0]]) {
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.4), new THREE.MeshBasicMaterial({ map: makeLabel(t, 1, bg).material.map }));
  f.position.set(0, -0.1, z);
  f.rotation.y = ry;
  signPivot.add(f);
}
signPivot.userData.kind = 'sign';
scene.add(signPivot);

// cold storage: open refrigerated shelving, one compartment per wholesale item
colliders.push({ minX: 0.45, maxX: 5.55, minZ: -11.95, maxZ: -11.15, on: true });
part(new THREE.BoxGeometry(5.1, 2.1, 0.06), new THREE.MeshStandardMaterial({ color: 0xe6f6ff, emissive: 0x9fd8ff, emissiveIntensity: 0.35 }), 3, 1.05, -11.92);
part(new THREE.BoxGeometry(5.1, 0.3, 0.8), steel, 3, 1.95, -11.55);
part(new THREE.BoxGeometry(5.1, 0.25, 0.8), steel, 3, 0.125, -11.55);
for (let i = 0; i <= 5; i++) part(new THREE.BoxGeometry(0.05, 2.1, 0.8), steel, 0.45 + i * 1.02, 1.05, -11.55);
for (const y of [0.5, 1.15]) part(new THREE.BoxGeometry(5.1, 0.03, 0.7), steel, 3, y, -11.6);
const capLabel = makeLabel('', 0.3);
capLabel.position.set(3, 2.5, -11.4);
scene.add(capLabel);
const bins = ITEM_KEYS.map((id, i) => {
  const x = 0.96 + i * 1.02;
  const hit = part(new THREE.BoxGeometry(0.95, 1.7, 0.75), hitMat, x, 0.95, -11.5);
  hit.userData = { kind: 'bin', ref: id };
  const label = panel('', 0.9, 0.27);
  label.position.set(x, 1.95, -11.14);
  const shows = [0, 1, 2, 3].map(k => {
    const m = makeItemMesh(id);
    m.position.set(x + (k % 2 ? 0.2 : -0.2), k < 2 ? 0.59 : 1.24, -11.55);
    m.scale.multiplyScalar(0.85);
    scene.add(m);
    return m;
  });
  return { id, x, hit, label, shows };
});
const freezer = box(1.1, 0.9, 0.7, new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.4 }), 6.4, 0.45, -11.4, false);
freezer.visible = false; // arrives with "Bigger Cold Storage"
const freezerCol = { minX: 5.85, maxX: 6.95, minZ: -11.75, maxZ: -11.05, on: false };
colliders.push(freezerCol);

// prep station: cutting board between two portion trays (whole cut → portions)
const prepTable = box(2, 0.9, 0.7, steel, 4.2, 0.45, -6.55);
prepTable.userData.kind = 'prep';
const board = part(new THREE.BoxGeometry(0.55, 0.03, 0.38), mat(0xc49a6c), 4.2, 0.915, -6.6);
board.userData.kind = 'prep';
const boardKnife = part(new THREE.BoxGeometry(0.03, 0.01, 0.26), steel, 4.42, 0.935, -6.62);
const trayObjs = ['filet', 'vacio'].map((d, i) => {
  const x = i ? 4.95 : 3.45;
  const t = part(new THREE.BoxGeometry(0.44, 0.03, 0.34), steel, x, 0.915, -6.55);
  t.userData = { kind: 'tray', ref: d };
  const label = makeLabel('', 0.2);
  label.position.set(x, 1.3, -6.55);
  scene.add(label);
  const shows = Array.from({ length: 8 }, (_, k) => {
    const m = makeFoodMesh(d);
    m.scale.setScalar(d === 'vacio' ? 0.4 : 0.55);
    m.position.set(x - 0.15 + (k % 4) * 0.1, 0.95, -6.62 + Math.floor(k / 4) * 0.13);
    scene.add(m);
    return m;
  });
  return { d, t, label, shows };
});

// dry storage shelving (a second unit arrives with "More Storage Capacity")
function shelf(x, z, w) {
  const g = new THREE.Group();
  for (const dx of [-w / 2, w / 2]) part(new THREE.BoxGeometry(0.05, 2, 0.5), steel, x + dx, 1, z, g);
  for (const y of [0.3, 0.95, 1.6]) {
    part(new THREE.BoxGeometry(w, 0.04, 0.5), steel, x, y, z, g);
    for (let i = 0; i < 3; i++) {
      const sz = 0.26 + ((i + y * 10) % 3) * 0.05;
      part(new THREE.BoxGeometry(sz, sz * 0.8, 0.36), mat([0xb08850, 0xa07845, 0xc4a070][i]), x - w / 2 + 0.35 + i * (w - 0.7) / 2, y + 0.02 + sz * 0.4, z, g);
    }
  }
  scene.add(g);
  const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - 0.25, maxZ: z + 0.25, on: true };
  colliders.push(col);
  return { g, col };
}
shelf(-2.2, -11.6, 3);
const extraShelf = shelf(-2.5, -6.36, 3);
extraShelf.g.visible = extraShelf.col.on = false;

// office: desk, chair, filing cabinet and the ASADO OS computer
const desk = box(1.6, 0.76, 0.8, mat(0x7a5230), -6.3, 0.38, -11.45);
desk.userData.kind = 'terminal';
part(new THREE.BoxGeometry(0.5, 0.08, 0.5), dark, -6.3, 0.48, -10.5);
part(new THREE.BoxGeometry(0.5, 0.55, 0.06), dark, -6.3, 0.8, -10.25);
part(rod(0.03, 0.44), iron, -6.3, 0.22, -10.5);
part(new THREE.BoxGeometry(0.45, 0.02, 0.15), dark, -6.3, 0.77, -11.25);
box(0.5, 1.2, 0.5, mat(0x5a5f66), -7.6, 0.6, -9.4);
const monitor = new THREE.Group();
monitor.position.set(-6.3, 1.12, -11.62);
part(new THREE.BoxGeometry(0.62, 0.42, 0.05), dark, 0, 0, 0, monitor);
part(new THREE.BoxGeometry(0.06, 0.2, 0.06), dark, 0, -0.28, -0.02, monitor);
const osScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), new THREE.MeshBasicMaterial({ map: makeLabel('ASADO OS\nUPGRADES · WHOLESALE\nFINANCES', 1, '#10231a', '#9fe0b0').material.map }));
osScreen.position.z = 0.026;
monitor.add(osScreen);
monitor.userData.kind = 'terminal';
scene.add(monitor);

// "Better Interior": plants, pendant lamps, framed pictures
const decor = new THREE.Group();
decor.visible = false;
scene.add(decor);
const leaf = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9, flatShading: true });
for (const [x, z] of [[-7.4, 5.3], [7.4, 5.3], [7.4, -4.9], [-2.4, -5.5]]) {
  part(new THREE.CylinderGeometry(0.22, 0.16, 0.4, 8), mat(0xa0522d), x, 0.2, z, decor);
  part(new THREE.IcosahedronGeometry(0.4, 0), leaf, x, 0.8, z, decor);
}
for (const t of tables) {
  part(rod(0.008, 1.1), iron, t.x, 2.95, t.z, decor);
  part(new THREE.ConeGeometry(0.28, 0.24, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x1f4d3a, side: THREE.DoubleSide }), t.x, 2.3, t.z, decor);
  part(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }), t.x, 2.22, t.z, decor);
}
for (const [x, ry] of [[-7.88, Math.PI / 2], [7.88, -Math.PI / 2]]) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), new THREE.MeshBasicMaterial({ map: makeLabel('ASADO\ndesde 1987', 1, '#5a2a1a', '#f4e4c8').material.map }));
  p.position.set(x, 1.9, 1.5);
  p.rotation.y = ry;
  decor.add(p);
}

// delivery crates (free starter crates wait in the yard on day 1)
function makeCrate(item, qs, starter) {
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(0.55, 0.38, 0.42), mat(starter ? 0x9c6b3c : 0xb08850), 0, 0.19, 0, g);
  part(new THREE.BoxGeometry(0.57, 0.04, 0.44), mat(0x6b4a2a), 0, 0.37, 0, g);
  const label = makeLabel(`${ITEMS[item].name.toUpperCase()} ×${qs.length}${starter ? '\nFREE STARTER' : ''}`, 0.22);
  label.position.y = 0.62;
  g.add(label);
  const c = { item, qs, mesh: g, label, spot: -1 };
  g.userData = { kind: 'crate', ref: c };
  return c;
}
function placeCrate(c) {
  const used = new Set(crates.map(k => k.spot));
  let sp = 0;
  while (used.has(sp)) sp++;
  c.spot = sp;
  c.mesh.position.set(9.4 + (sp % 4) * 1.05, Math.floor(sp / 16) * 0.42, -11.6 + (Math.floor(sp / 4) % 4) * 1.25);
  c.mesh.rotation.set(0, ((sp * 7) % 5 - 2) * 0.08, 0);
  crates.push(c);
  scene.add(c.mesh);
}
const crateText = c => `${ITEMS[c.item].name} ×${c.qs.length}`;
STARTER.forEach(([it, n]) => placeCrate(makeCrate(it, Array(n).fill(0), true)));

// ---------- Storage, prep and carrying ----------
const usedSpace = () => ITEM_KEYS.reduce((n, k) => n + stock[k].length, 0);
const qTag = q => (q ? ` · ${QUALITY[q].name}` : '');
function refreshStorage() {
  for (const b of bins) {
    const n = stock[b.id].length;
    setText(b.label, `${ITEMS[b.id].name.toUpperCase()}\n×${n}`, n ? '#0b3d5c' : '#333a');
    b.shows.forEach((m, k) => { m.visible = k < n; });
  }
  setText(capLabel, `COLD STORAGE  ${usedSpace()}/${capacity()}`);
}
function refreshTrays() {
  for (const t of trayObjs) {
    const n = trays[t.d].length;
    setText(t.label, `${FOODS[t.d].name.toUpperCase()} ×${n}`);
    t.shows.forEach((m, k) => { m.visible = k < n; });
  }
}
refreshStorage();
refreshTrays();
function pickUpCrate(c) {
  crates.splice(crates.indexOf(c), 1);
  scene.remove(c.mesh);
  c.mesh.rotation.set(0, 0, 0);
  c.mesh.scale.setScalar(0.72);
  c.label.visible = false;
  hold({ kind: 'crate', type: c.item, qs: c.qs, crate: c, mesh: c.mesh });
}
function storeCrate() {
  const h = held;
  stock[h.type].push(...h.qs);
  dropHeld();
  refreshStorage();
  sfx.store();
  toast(`Stored ${crateText(h.crate)} in cold storage`);
}
function takeFromBin(id) {
  const it = ITEMS[id], q = stock[id].shift();
  refreshStorage();
  hold({ kind: it.whole ? 'whole' : 'portion', type: it.whole ? id : it.dish, q, mesh: makeItemMesh(id) });
}
function takeFromTray(d) {
  const q = trays[d].shift();
  refreshTrays();
  hold({ kind: 'portion', type: d, q, mesh: makeFoodMesh(d) });
}
const binOf = h => (h.kind === 'whole' ? h.type : ITEMS[h.type] && !ITEMS[h.type].whole ? h.type : null); // null: goes on a tray
function putBack() {
  const h = held, b = binOf(h);
  if (b) stock[b].unshift(h.q); else trays[h.type].unshift(h.q);
  dropHeld();
  refreshStorage();
  refreshTrays();
  sfx.store();
}
function startPrep() { // lay the whole cut on the board; hands + knife cut it while the view locks onto the board
  const h = held, p = camera.position;
  dropHeld();
  h.mesh.position.set(4.2, 0.99, -6.6);
  scene.add(h.mesh);
  busy = { t: 0, dur: has('prep') ? 1.5 : 3, whole: h, s0: h.mesh.scale.x, chop: 0,
    yaw: Math.atan2(p.x - 4.2, p.z + 6.6), pitch: -Math.atan2(EYE - 0.95, Math.hypot(4.2 - p.x, -6.6 - p.z)) };
}
function updateBusy(dt) {
  const b = busy, k = Math.min(1, dt * 6);
  b.t += dt;
  yaw += Math.atan2(Math.sin(b.yaw - yaw), Math.cos(b.yaw - yaw)) * k;
  pitch += (b.pitch - pitch) * k;
  camera.rotation.set(pitch, yaw, 0);
  b.whole.mesh.scale.x = b.s0 * (1 - 0.55 * Math.min(1, b.t / b.dur));
  if ((b.chop -= dt) <= 0) { b.chop = 0.2; sfx.chop(); }
  if (b.t < b.dur) return;
  scene.remove(b.whole.mesh);
  const d = ITEMS[b.whole.type].dish, n = portionsPer();
  for (let i = 0; i < n; i++) trays[d].push(b.whole.q);
  refreshTrays();
  toast(`${n} ${FOODS[d].name} portions ready on the tray`);
  sfx.pick();
  busy = null;
}

// ---------- Prep cook: wait → check for a prep task → fetch → prepare → return ----------
let cook = null;
const COOK_HOME = new THREE.Vector3(2.2, 0, -8.8), PREP_FRONT = new THREE.Vector3(4.2, 0, -7.35);
function hireCook() {
  const rig = makePerson(0xffffff);
  part(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 0, 1.86, 0, rig.body); // chef hat
  cook = { rig, group: rig.root, state: 'idle', path: [], t: 1, task: null, carry: null };
  cook.group.position.copy(COOK_HOME);
  scene.add(cook.group);
}
function updateCook(dt) {
  const c = cook, arrived = stepPath(c, dt);
  if (c.state === 'idle' && (c.t -= dt) <= 0) {
    c.task = ['filet', 'vacio'].find(d => trays[d].length < 4 && stock[d + '_whole'].length);
    if (c.task) { c.state = 'fetch'; c.path = [new THREE.Vector3(bins[ITEM_KEYS.indexOf(c.task + '_whole')].x, 0, -10.6)]; } else c.t = 1;
  } else if (c.state === 'fetch' && arrived) {
    const it = c.task + '_whole';
    if (stock[it].length) {
      c.carry = { type: it, q: stock[it].shift(), mesh: makeItemMesh(it) };
      c.carry.mesh.position.set(0, 1.05, 0.3);
      c.rig.body.add(c.carry.mesh);
      refreshStorage();
      c.state = 'toPrep';
      c.path = [PREP_FRONT.clone()];
    } else { c.state = 'back'; c.path = [COOK_HOME.clone()]; }
  } else if (c.state === 'toPrep' && arrived) {
    c.state = 'prep';
    c.t = has('prep') ? 2 : 4;
    c.group.rotation.y = 0;
  } else if (c.state === 'prep' && (c.t -= dt) <= 0) {
    for (let i = portionsPer(); i > 0; i--) trays[c.task].push(c.carry.q);
    c.rig.body.remove(c.carry.mesh);
    c.carry = null;
    refreshTrays();
    c.state = 'back';
    c.path = [COOK_HOME.clone()];
  } else if (c.state === 'back' && arrived) { c.state = 'idle'; c.t = 2; }
  poseCustomer(c, dt);
}

// ---------- Day cycle ----------
function openRestaurant() {
  isOpen = true; everOpened = true; warnedClosing = false;
  clockMin = OPEN_AT;
  spawnTimer = 3;
  sfx.sign();
  sfx.door();
  toast('Restaurant OPEN! Guests are on their way.', '#9f6', 3);
}
function closeRestaurant() { // guests who are eating pay, everyone else leaves; wages are paid
  isOpen = false;
  dayDone = true;
  for (const c of [...customers]) {
    if (c.state === 'eat') { payFor(c); leave(c, false); } else if (c.state !== 'exit') leave(c, false);
  }
  queue.length = 0;
  [...grillFood].forEach(removeGrillFood);
  if (has('cook')) { money -= COOK_WAGE; today.staff += COOK_WAGE; }
  sfx.sign();
  toast('Restaurant CLOSED', '#ffb347', 3);
  summaryTimer = 1.4; // let the sign turn back before the summary
}
function showSummary() {
  const profit = today.revenue - today.food - today.staff - today.upgrades;
  history.push({ day, ...today, profit });
  const row = (a, v) => `<tr><td>${a}</td><td class="num">${fmtMoney(v)}</td></tr>`;
  sumEl.innerHTML = `<div class="win"><div class="bar"><span>DAY ${day} COMPLETE</span><span>ASADO OS</span></div><div class="pane"><table>
    ${row('Revenue', today.revenue)}${row('Food cost', -today.food)}${row('Staff cost', -today.staff)}${row('Upgrade cost', -today.upgrades)}
    <tr><td class="big">PROFIT</td><td class="num big ${profit < 0 ? 'neg' : 'pos'}">${fmtMoney(profit)}</td></tr></table>
    <div class="foot"><span class="muted">Money: ${fmtMoney(money)} · Restock at the office terminal before you open tomorrow</span>
    <button data-a="next">CONTINUE TO NEXT DAY</button></div></div></div>`;
  uiMode = 'summary';
  sumEl.hidden = false;
  document.exitPointerLock();
}
function nextDay() {
  day++;
  dayDone = false;
  clockMin = DAY_START;
  today = { revenue: 0, food: 0, staff: 0, upgrades: 0 };
  closeUI();
  toast(`DAY ${day}: restock at the office terminal, then open the restaurant`, '#ffd76a', 5);
}

// ---------- ASADO OS: office terminal (upgrades, wholesale, finances) ----------
const osEl = document.getElementById('os'), sumEl = document.getElementById('summary');
let osTab = 'upgrades', osMsg = '', wsQ = 0;
const wsQty = Object.fromEntries(ITEM_KEYS.map(k => [k, 0]));
const packCost = (k, q) => Math.round(ITEMS[k].cost * (ITEMS[k].plain ? 1 : QUALITY[q].cost));
const wsItems = () => ITEM_KEYS.filter(k => k !== 'bife' || has('menu'));
const incoming = () => [...crates, ...(delivery ? delivery.list : [])].reduce((n, c) => n + c.qs.length, 0) + (held?.kind === 'crate' ? held.qs.length : 0);
function openTerminal() {
  uiMode = 'os';
  osMsg = '';
  renderOS();
  osEl.hidden = false;
  document.exitPointerLock();
  sfx.ui();
}
function closeUI() {
  osEl.hidden = sumEl.hidden = true;
  uiMode = null;
  startEl.style.display = document.pointerLockElement ? 'none' : 'flex';
  lockPointer();
}
function renderOS() {
  const tab = (id, t) => `<button data-a="tab" data-v="${id}" class="${osTab === id ? 'on' : ''}">${t}</button>`;
  let body;
  if (osTab === 'upgrades') {
    let cat = '';
    body = '<table>' + UPGRADES.map(u => {
      const max = u.level >= u.cost.length, cost = u.cost[u.level];
      const head = u.cat !== cat ? `<tr><td class="cat" colspan="3">${(cat = u.cat)}</td></tr>` : '';
      const lv = u.cost.length > 1 ? ` <span class="muted">level ${u.level}/${u.cost.length}</span>` : '';
      return `${head}<tr><td>${u.name}${lv}<br><span class="muted">${u.desc}</span></td><td class="num">${max ? 'OWNED' : fmtMoney(cost)}</td>
        <td class="num">${max ? '' : `<button data-a="buy" data-v="${u.id}"${money < cost ? ' disabled' : ''}>BUY</button>`}</td></tr>`;
    }).join('') + '</table>';
  } else if (osTab === 'wholesale') {
    const units = wsItems().reduce((n, k) => n + wsQty[k] * ITEMS[k].pack, 0);
    const total = wsItems().reduce((n, k) => n + wsQty[k] * packCost(k, wsQ), 0);
    const free = Math.max(0, capacity() - usedSpace() - incoming());
    const qBtns = QUALITY.map((q, i) => `<button data-a="q" data-v="${i}" class="${wsQ === i ? 'on' : ''}"${i > lvl('quality') ? ' disabled' : ''}>${q.name}</button>`).join(' ');
    body = `<p class="muted">MEAT QUALITY ${qBtns}</p>
      <table><tr><th>ITEM</th><th>PACK</th><th class="num">PRICE</th><th class="num">QUANTITY</th><th class="num">TOTAL</th></tr>
      ${wsItems().map(k => `<tr><td>${ITEMS[k].name}</td><td class="muted">${ITEMS[k].whole ? `whole · ${portionsPer()} portions` : `${ITEMS[k].pack} pieces`}</td>
        <td class="num">${fmtMoney(packCost(k, wsQ))}</td>
        <td class="num"><button data-a="qty" data-v="${k}" data-d="-1">−</button> ${wsQty[k]} <button data-a="qty" data-v="${k}" data-d="1">+</button></td>
        <td class="num">${fmtMoney(wsQty[k] * packCost(k, wsQ))}</td></tr>`).join('')}</table>
      <div class="foot"><span class="muted">Uses ${units} of ${free} free storage spaces · Money ${fmtMoney(money)}</span>
        <span>TOTAL <b class="big">${fmtMoney(total)}</b> <button data-a="order"${!units || total > money || units > free ? ' disabled' : ''}>ORDER</button></span></div>`;
  } else {
    const profit = today.revenue - today.food - today.staff - today.upgrades;
    const rows = [['Current money', money], ["Today's revenue", today.revenue], ['Food cost', -today.food], ['Staff cost', -today.staff], ['Upgrade cost', -today.upgrades]];
    body = `<table>${rows.map(([a, v]) => `<tr><td>${a}</td><td class="num">${fmtMoney(v)}</td></tr>`).join('')}
      <tr><td class="big">Today's profit</td><td class="num big ${profit < 0 ? 'neg' : 'pos'}">${fmtMoney(profit)}</td></tr></table>
      ${history.length ? `<p class="cat">PREVIOUS DAYS</p><table><tr><th>DAY</th><th class="num">REVENUE</th><th class="num">COSTS</th><th class="num">PROFIT</th></tr>
      ${history.map(d => `<tr><td>${d.day}</td><td class="num">${fmtMoney(d.revenue)}</td><td class="num">${fmtMoney(d.food + d.staff + d.upgrades)}</td><td class="num ${d.profit < 0 ? 'neg' : 'pos'}">${fmtMoney(d.profit)}</td></tr>`).join('')}</table>` : ''}`;
  }
  osEl.innerHTML = `<div class="win"><div class="bar"><span>ASADO OS 1.0 · DAY ${day} · ${fmtTime(clockMin)}</span><button data-a="exit">EXIT ✕</button></div>
    <div class="tabs">${tab('upgrades', 'UPGRADES')}${tab('wholesale', 'FOOD WHOLESALE')}${tab('finances', 'FINANCES')}</div>
    <div class="pane">${osMsg ? `<p class="pos">${osMsg}</p>` : ''}${body}</div></div>`;
}
function buyUpgrade(u) {
  const cost = u.cost[u.level];
  if (money < cost) return;
  money -= cost;
  if (u.id === 'cook') today.staff += cost; else today.upgrades += cost;
  u.level++;
  if (u.id === 'tables') tables[3].active = tables[3].col.on = tables[3].group.visible = true;
  if (u.id === 'interior') decor.visible = true;
  if (u.id === 'cold') freezer.visible = freezerCol.on = true;
  if (u.id === 'storage') extraShelf.g.visible = extraShelf.col.on = true;
  if (u.id === 'cook') hireCook();
  if (u.id === 'quality') wsQ = u.level;
  refreshStorage();
  refreshTrays();
  osMsg = `${u.name} purchased!`;
  sfx.pay();
}
function placeOrder() { // pay now; one crate per item arrives in the delivery area shortly
  const list = [];
  let total = 0;
  for (const k of wsItems()) {
    if (!wsQty[k]) continue;
    total += wsQty[k] * packCost(k, wsQ);
    list.push(makeCrate(k, Array(wsQty[k] * ITEMS[k].pack).fill(ITEMS[k].plain ? 0 : wsQ), false));
    wsQty[k] = 0;
  }
  money -= total;
  today.food += total;
  delivery = { t: 4, list: delivery ? delivery.list.concat(list) : list };
  osMsg = `Order placed for ${fmtMoney(total)}. The truck will drop the crates in the DELIVERY area.`;
}
function onUIClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const { a, v } = b.dataset;
  sfx.ui();
  osMsg = '';
  if (a === 'exit') return closeUI();
  if (a === 'next') return nextDay();
  if (a === 'tab') osTab = v;
  if (a === 'buy') buyUpgrade(UPGRADES.find(u => u.id === v));
  if (a === 'q') wsQ = +v;
  if (a === 'qty') wsQty[v] = Math.max(0, Math.min(20, wsQty[v] + +b.dataset.d));
  if (a === 'order') placeOrder();
  renderOS();
}
osEl.addEventListener('click', onUIClick);
sumEl.addEventListener('click', onUIClick);

// ---------- Interaction ----------
function customerTarget(obj) {
  let o = obj;
  while (o && !o.userData.kind) o = o.parent;
  return o;
}

function getAction(o) {
  const { kind, ref } = o.userData, h = held;
  if (kind === 'customer') {
    if (ref.state === 'queue' || ref.state === 'order') return getAction(counter);
    if (ref.state === 'wait' || ref.state === 'eat' || ref.state === 'toTable') return getAction(ref.table.group);
    return null;
  }
  if (kind === 'counter') {
    const c = queue[0];
    if (c && c.state === 'order') return { label: '[E] Take order', fn: () => takeOrder(c) };
    return { label: !isOpen ? 'Counter: the restaurant is closed' : queue.length ? 'Guest coming…' : 'No guests waiting' };
  }
  if (kind === 'food') {
    if (h) return getAction(grill);
    const st = foodState(ref), name = FOODS[ref.type].name;
    if (st === 'cooking') return { label: `${name} cooking… ${Math.floor(ref.t / FOODS[ref.type].cook * 100)}%` };
    if (st === 'ready') return { label: `[E] Pick up ${name}`, fn: () => pickUp(ref) };
    return { label: `[E] Toss burnt ${name}`, fn: () => pickUp(ref) };
  }
  if (kind === 'grill') {
    if (!h) return { label: 'Parrilla: bring a raw portion to grill it' };
    if (h.kind === 'portion') {
      if (grillFood.length >= slotCount()) return { label: 'Grill full' };
      return { label: `[E] Grill ${FOODS[h.type].name}`, fn: () => { dropHeld(); startCooking(h.type, h.q); } };
    }
    if (h.kind === 'cooked') return { label: `[E] Discard ${FOODS[h.type].name}`, fn: dropHeld };
    if (h.kind === 'whole') return { label: `Cut the ${ITEMS[h.type].name} at the prep station first` };
    return { label: 'Hands full' };
  }
  if (kind === 'table') {
    const c = ref.customer;
    if (!c || !['wait', 'eat', 'toTable'].includes(c.state)) return { label: `Mesa ${ref.n}` };
    if (c.state === 'eat') return { label: `Mesa ${ref.n} is eating` };
    const wants = orderText(c.items).replace(/\n/g, ', ');
    if (c.state === 'toTable' || h?.kind !== 'cooked') return { label: `Mesa ${ref.n} wants: ${wants}` };
    const i = c.items.findIndex(it => !it.served && it.dish === h.type);
    if (i < 0) return { label: `Mesa ${ref.n} didn't order ${FOODS[h.type].name} (wants ${wants})` };
    return { label: `[E] Serve ${FOODS[h.type].name}`, fn: () => serve(c, i) };
  }
  if (kind === 'sign' || kind === 'door') {
    if (isOpen) return { label: '[E] CLOSE RESTAURANT', fn: closeRestaurant };
    if (dayDone) return { label: 'Closed for today' };
    return { label: '[E] OPEN RESTAURANT', fn: openRestaurant };
  }
  if (kind === 'crate') return h ? { label: 'Hands full' } : { label: `[E] Pick up crate: ${crateText(ref)}`, fn: () => pickUpCrate(ref) };
  if (kind === 'bin') {
    const n = stock[ref].length, name = ITEMS[ref].name;
    if (h?.kind === 'crate') return { label: `[E] Store ${crateText(h.crate)}`, fn: storeCrate };
    if (h && (h.kind === 'whole' || h.kind === 'portion') && binOf(h) === ref) return { label: `[E] Put back ${name}`, fn: putBack };
    if (h) return { label: 'Hands full' };
    if (!n) return { label: `${name}: empty. Order more at the office terminal` };
    return { label: `[E] Take ${name}${qTag(stock[ref][0])} (${n} left)`, fn: () => takeFromBin(ref) };
  }
  if (kind === 'prep') {
    if (h?.kind === 'whole') return { label: `[E] PREPARE ${ITEMS[h.type].name.toUpperCase()}`, fn: startPrep };
    return { label: 'Prep station: bring a whole cut from cold storage' };
  }
  if (kind === 'tray') {
    const n = trays[ref].length, name = FOODS[ref].name;
    if (h?.kind === 'portion' && h.type === ref) return { label: `[E] Put back ${name} portion`, fn: putBack };
    if (h) return { label: 'Hands full' };
    if (!n) return { label: `No ${name} portions yet: cut a whole ${name} first` };
    return { label: `[E] Take ${name} portion${qTag(trays[ref][0])} (${n} left)`, fn: () => takeFromTray(ref) };
  }
  if (kind === 'terminal') return { label: '[E] USE TERMINAL', fn: openTerminal };
  return null;
}
function heldName() {
  const h = held;
  if (h.kind === 'crate') return crateText(h.crate);
  if (h.kind === 'whole') return ITEMS[h.type].name + qTag(h.q);
  return `${h.kind === 'cooked' ? 'grilled' : 'raw'} ${FOODS[h.type].name}${qTag(h.q)}`;
}

const raycaster = new THREE.Raycaster();
raycaster.far = 3.2;
const center = new THREE.Vector2();
const fixedTargets = [...solids, coals, doorPivot, signPivot, board, monitor, ...bins.map(b => b.hit), ...trayObjs.map(t => t.t)];
let currentAction = null;
function updateInteraction() {
  raycaster.setFromCamera(center, camera);
  const targets = [...fixedTargets, ...grillFood.map(f => f.mesh), ...tables.filter(t => t.active).map(t => t.group),
    ...customers.filter(c => c.state !== 'exit').map(c => c.group), ...crates.map(c => c.mesh)];
  const hit = raycaster.intersectObjects(targets, true)[0];
  const o = hit && customerTarget(hit.object);
  currentAction = o && !busy ? getAction(o) : null;
  promptEl.textContent = currentAction ? currentAction.label : held ? `Carrying: ${heldName()}` : '';
}

// ---------- HUD ----------
const hudEl = document.getElementById('hud'), hintEl = document.getElementById('hint');
const promptEl = document.getElementById('prompt');
const msgEl = document.getElementById('msg');
function toast(text, color = '#9f6', secs = 2.5) { msgEl.textContent = text; msgEl.style.color = color; msgTimer = secs; }
const fmtMoney = v => (v < 0 ? '-$' : '$') + Math.abs(Math.round(v)).toLocaleString('en-US');
function fmtTime(min) {
  const h = Math.floor(min / 60) % 24, m = Math.floor(min % 60);
  return `${(h + 11) % 12 + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function hintText() { // one line telling the player what to do next
  if (dayDone) return '';
  if (isOpen) return clockMin >= CLOSE_AT ? 'Closing time: finish the last tables, then CLOSE at the sign by the front door' : '';
  if (held?.kind === 'crate') return 'Carry the crate to COLD STORAGE in the back of house and press E';
  if (crates.length) return 'Crates are waiting in the DELIVERY area: go through the KITCHEN and out the back door';
  if (!everOpened) return 'All stocked! Open the restaurant at the OPEN/CLOSED sign by the front door';
  return 'Buy food and upgrades at the OFFICE terminal, then open at the sign by the front door';
}
let hudKey = '';
function updateHUD() {
  const hint = hintText(), key = `${day}|${Math.floor(clockMin)}|${money}|${isOpen}|${hint}`;
  if (key === hudKey) return;
  hudKey = key;
  hudEl.innerHTML = `DAY ${day} · ${fmtTime(clockMin)} · <span class="money">${fmtMoney(money)}</span><span class="st ${isOpen ? 'open' : 'closed'}">${isOpen ? 'OPEN' : 'CLOSED'}</span>`;
  hintEl.textContent = hint;
}
let screenKey = '', screenT = 0;
function drawScreens(dt) { // counter POS + kitchen display: active orders per table
  if ((screenT -= dt) > 0) return;
  screenT = 0.3;
  const rows = [];
  for (const c of customers.filter(c => c.items && ['toTable', 'wait', 'eat'].includes(c.state)).sort((a, b) => a.table.n - b.table.n)) {
    rows.push([`TABLE ${c.table.n}`, c.state === 'eat' ? 'EATING' : c.state === 'toTable' ? 'SEATING' : 'WAITING', 1]);
    const n = {};
    c.items.forEach(i => { const e = (n[i.dish] ||= [0, 0]); e[0]++; if (i.served) e[1]++; });
    for (const [d, [k, sv]] of Object.entries(n)) rows.push([`  ${FOODS[d].name} ×${k}`, sv === k ? 'SERVED' : sv ? `${sv}/${k} served` : 'TO COOK', 0]);
  }
  const waiting = queue.filter(c => c.state === 'order').length;
  const key = JSON.stringify(rows) + waiting + isOpen + Math.floor(clockMin);
  if (key === screenKey) return;
  screenKey = key;
  const g = orderCanvas.getContext('2d'), W = 512, H = 360;
  g.fillStyle = '#0b1a12';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#3f7a55';
  g.fillRect(0, 0, W, 44);
  g.textBaseline = 'middle';
  g.font = 'bold 24px monospace';
  g.fillStyle = '#06120b';
  g.textAlign = 'left';
  g.fillText('ACTIVE ORDERS', 14, 23);
  g.textAlign = 'right';
  g.fillText(isOpen ? fmtTime(clockMin) : 'CLOSED', W - 14, 23);
  let y = 68;
  if (!rows.length) {
    g.textAlign = 'left'; g.font = '22px monospace'; g.fillStyle = '#7fa38c';
    g.fillText(isOpen ? 'No open orders' : 'Restaurant closed', 14, y);
  }
  for (const [a, b, head] of rows.slice(0, 10)) {
    g.font = head ? 'bold 22px monospace' : '21px monospace';
    g.textAlign = 'left'; g.fillStyle = head ? '#ffd76a' : '#cfe8d5'; g.fillText(a, 14, y);
    g.textAlign = 'right'; g.fillStyle = b === 'SERVED' ? '#6fdc8c' : head ? '#8fc0a0' : '#ffb347'; g.fillText(b, W - 14, y);
    y += 26;
  }
  if (waiting) {
    g.textAlign = 'left'; g.font = 'bold 20px monospace'; g.fillStyle = '#ffb347';
    g.fillText(`COUNTER: ${waiting} guest${waiting > 1 ? 's' : ''} waiting to order`, 14, H - 20);
  }
  orderTex.needsUpdate = true;
}

// ---------- Player ----------
const keys = {};
let yaw = 0, pitch = 0, velY = 0;
camera.rotation.set(0, yaw, 0);
const startEl = document.getElementById('start');
function lockPointer() {
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (e) { /* pointer lock unavailable */ }
}
startEl.addEventListener('click', () => { initAudio(); lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  startEl.style.display = document.pointerLockElement || uiMode ? 'none' : 'flex';
});
document.addEventListener('mousemove', e => {
  if (!document.pointerLockElement || uiMode || busy) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.5, 1.5);
  camera.rotation.set(pitch, yaw, 0);
});
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape' && uiMode === 'os') closeUI();
  if (e.code === 'KeyE' && document.pointerLockElement && !uiMode && !busy && currentAction && currentAction.fn) currentAction.fn();
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

// ---------- First-person hands ----------
const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.8, flatShading: true });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.9, flatShading: true });
function makeHand(side) { // chef-jacket forearm + low-poly hand pointing forward
  const g = new THREE.Group();
  for (const [geo, m] of [
    [new THREE.CylinderGeometry(0.036, 0.046, 0.36, 6).rotateX(Math.PI / 2).translate(0, 0, 0.2), sleeveMat],
    [new THREE.BoxGeometry(0.08, 0.032, 0.095), skinMat],
    [new THREE.BoxGeometry(0.075, 0.026, 0.055).translate(0, -0.004, -0.07), skinMat],
    [new THREE.BoxGeometry(0.024, 0.024, 0.055).rotateY(side * 0.5).translate(-side * 0.048, 0.004, -0.025), skinMat],
  ]) g.add(new THREE.Mesh(geo, m));
  return g;
}
const hands = new THREE.Group();
camera.add(hands);
const handL = makeHand(-1), handR = makeHand(1);
hands.add(handL, handR);
const knife = new THREE.Group();
knife.add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 0.2).translate(0, -0.01, -0.13), steel), new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.09).translate(0, 0, -0.01), mat(0x2a1a10)));
knife.visible = false;
handR.add(knife);
const handPlate = new THREE.Mesh(plateGeo, plateMat);
handPlate.visible = false;
hands.add(handPlate);
const HAND_POSE = { // camera space: hands [x, y, z, rotX, rotZ], held item [x, y, z]
  none: { L: [-0.3, -0.75, -0.42, 0, 0], R: [0.3, -0.75, -0.42, 0, 0], item: [0, -0.6, -0.5] },
  hold: { L: [-0.15, -0.31, -0.5, 0, 0.35], R: [0.15, -0.31, -0.5, 0, -0.35], item: [0, -0.265, -0.53] },
  crate: { L: [-0.22, -0.31, -0.6, 0, 1.45], R: [0.22, -0.31, -0.6, 0, -1.45], item: [0, -0.42, -0.62] },
  cut: { L: [-0.16, -0.36, -0.52, 0.3, 0.2], R: [0.13, -0.31, -0.5, 0, -0.15], item: [0, -0.6, -0.5] },
};
let reachT = 1, bobT = 0;
function reach() { reachT = 0; } // quick pick-up / place motion
function hold(h) { held = h; hands.add(h.mesh); reach(); sfx.pick(); }
function dropHeld() { if (held) hands.remove(held.mesh); held = null; reach(); }
const tmpV = new THREE.Vector3();
function updateHands(dt, moving) {
  reachT = Math.min(1, reachT + dt / 0.3);
  const r = Math.sin(Math.PI * reachT), k = Math.min(1, dt * 14);
  const P = HAND_POSE[busy ? 'cut' : !held ? 'none' : held.kind === 'crate' ? 'crate' : 'hold'];
  if (moving) bobT += dt * 9;
  const bob = Math.sin(bobT) * 0.012, chop = busy ? Math.abs(Math.sin(busy.t * 11)) : 0;
  for (const [h, p, c] of [[handL, P.L, 0], [handR, P.R, chop]]) {
    h.position.lerp(tmpV.set(p[0], p[1] + bob + r * 0.04 + c * 0.08, p[2] - r * 0.1), k);
    h.rotation.x += (p[3] - c * 0.7 - h.rotation.x) * k;
    h.rotation.z += (p[4] - h.rotation.z) * k;
  }
  knife.visible = !!busy;
  boardKnife.visible = !busy;
  handPlate.visible = held?.kind === 'cooked';
  const [x, y, z] = P.item;
  if (held) held.mesh.position.set(x, y + bob + r * 0.04, z - r * 0.1);
  handPlate.position.set(x, y - 0.025 + bob + r * 0.04, z - r * 0.1);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
const lastPos = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const playing = !!document.pointerLockElement && !uiMode;
  if (playing) {
    if (busy) updateBusy(dt); else updatePlayer(dt);
    if (isOpen) {
      clockMin = Math.min(clockMin + dt * TIME_SCALE, CLOSE_AT + 60);
      if (clockMin >= CLOSE_AT && !warnedClosing) {
        warnedClosing = true;
        toast('Closing time! No new guests. Finish up, then CLOSE at the front door sign.', '#ffb347', 5);
      }
      if ((spawnTimer -= dt) <= 0 && clockMin < CLOSE_AT) { spawnCustomer(); spawnTimer = spawnGap(); }
    }

    const speed = has('grillq') ? 1.35 : 1;
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
    if (cook) updateCook(dt);
    if (delivery && (delivery.t -= dt) <= 0) {
      delivery.list.forEach(placeCrate);
      delivery = null;
      toast('DELIVERY ARRIVED: crates are waiting in the delivery area', '#ffd76a', 4);
      sfx.truck();
    }
    if (summaryTimer > 0 && (summaryTimer -= dt) <= 0) showSummary();
    coals.material.emissiveIntensity = 0.7 + Math.sin(performance.now() / 200) * 0.15;
    flames.forEach((f, i) => { f.scale.y = 1 + Math.sin(performance.now() / 70 + i * 1.7) * 0.2; });
    if (msgTimer > 0 && (msgTimer -= dt) <= 0) msgEl.textContent = '';
  } else if (sizzleGain) sizzleGain.gain.value = 0;

  // the sign turns 180° and the door swings open/closed (it stays open until the last guest is out)
  signPivot.rotation.y += ((isOpen ? Math.PI : 0) - signPivot.rotation.y) * Math.min(1, dt * 3);
  doorPivot.rotation.y += ((isOpen || customers.length ? -Math.PI / 2 : 0) - doorPivot.rotation.y) * Math.min(1, dt * 2.5);
  const moving = camera.position.distanceToSquared(lastPos) > 1e-6;
  lastPos.copy(camera.position);
  updateHands(dt, moving);
  updateInteraction();
  updateHUD();
  drawScreens(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// debug/test hook
window.__game = {
  camera, customers, queue, grillFood, tables, stock, trays, crates, bins, trayObjs, UPGRADES, history,
  sign: signPivot, door: doorPivot, board, monitor, hands: { L: handL, R: handR, knife, plate: handPlate },
  get money() { return money; }, set money(v) { money = v; }, get held() { return held; }, get action() { return currentAction; },
  get day() { return day; }, get isOpen() { return isOpen; }, get clockMin() { return clockMin; }, set clockMin(v) { clockMin = v; },
  get today() { return today; }, get cook() { return cook; }, get busy() { return busy; }, get uiMode() { return uiMode; },
  get delivery() { return delivery; }, get screenKey() { return screenKey; }, set spawnTimer(v) { spawnTimer = v; },
  setLook(y, p) { yaw = y; pitch = p; camera.rotation.set(p, y, 0); },
  lookAt(x, y, z) { const p = camera.position; this.setLook(Math.atan2(p.x - x, p.z - z), Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z))); },
};
