import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Config ----------
// Time: guest, grill and delivery timings are written in game minutes and converted with gm()
const TIME_SCALE = 1.25;                 // game minutes per real second: the 12:00-22:00 shift lasts 8 minutes
const gm = min => min / TIME_SCALE;      // game minutes → real seconds
// Dishes: what guests order and what goes on the grill
const FOODS = {
  // raw = RGB tint over the cooked texture (>1 brightens, so raw looks pale/pink)
  // burn = real seconds a ready piece lasts before it burns (the same for every dish)
  chorizo:   { name: 'Chorizo',   price: 15, cook: gm(15), burn: 20, raw: [1.7, 1.2, 1.2] },
  vacio:     { name: 'Vacío',     price: 25, cook: gm(20), burn: 20, raw: [1.9, 1.2, 1.25] },
  provoleta: { name: 'Provoleta', price: 20, cook: gm(8),  burn: 20, raw: [1.15, 1.15, 1.2] },
  filet:     { name: 'Filet',     price: 35, cook: gm(14), burn: 20, raw: [2, 1.15, 1.2], tex: 'vacio' },
  bife:      { name: 'Bife de Chorizo', price: 30, cook: gm(16), burn: 20, raw: [1.9, 1.2, 1.2], tex: 'vacio' },
};
const MAINS = ['filet', 'vacio', 'bife'], STARTERS = ['provoleta', 'chorizo'];
// Sauces are served in a small cup next to the dish they were ordered with (data-driven: add more here)
const SAUCES = {
  chimi:   { name: 'Chimichurri',   short: 'Chimi',   price: 3, color: 0x4b6f2a, dishes: ['filet', 'vacio', 'bife', 'chorizo'] },
  criolla: { name: 'Salsa Criolla', short: 'Criolla', price: 3, color: 0xc0472e, dishes: ['chorizo', 'vacio', 'bife'] },
};
// Wholesale items kept in cold storage; whole cuts are cut into portions at the prep station
const ITEMS = {
  filet_whole: { name: 'Whole Filet',     dish: 'filet',     whole: true, pack: 1, cost: 90 },
  vacio_whole: { name: 'Whole Vacío',     dish: 'vacio',     whole: true, pack: 1, cost: 60 },
  bife:        { name: 'Bife de Chorizo', dish: 'bife',      pack: 4, cost: 56 },
  chorizo:     { name: 'Chorizo',         dish: 'chorizo',   pack: 6, cost: 36 },
  provoleta:   { name: 'Provoleta',       dish: 'provoleta', pack: 4, cost: 32, plain: true }, // no meat quality
  chimi_bottle:   { name: 'Chimichurri',   sauce: 'chimi',   pack: 2, cups: 10, cost: 16, plain: true }, // bottles go to the sauce station
  criolla_bottle: { name: 'Salsa Criolla', sauce: 'criolla', pack: 2, cups: 10, cost: 14, plain: true },
};
const ITEM_KEYS = Object.keys(ITEMS);
const QUALITY = [
  { name: 'Standard', cost: 1, price: 1 },
  { name: 'Premium', cost: 1.5, price: 1.3 },
  { name: 'Angus', cost: 2.2, price: 1.7 },
  { name: 'Dry-Aged', cost: 3.2, price: 2.3 },
];
const STARTER = [['chorizo', 6], ['provoleta', 4], ['vacio_whole', 1], ['filet_whole', 1]]; // free crates on day 1
const DAY_START = 11 * 60, OPEN_AT = 12 * 60, CLOSE_AT = 22 * 60;
const FLOAT = 150;                                              // cash float in the register drawer (not revenue)
const PATIENCE = { queue: 60, foodFull: 60, foodZero: 120, foodLeave: 150, perDish: 15, pay: 60 }; // real seconds; food times +perDish per extra dish
const BURN_WARN = 6;                                            // the grill lamp flashes red in a piece's last seconds
const MAX_CARRY = 4;                                            // raw portions of one kind carried at once
const EAT_MIN = 30;                                             // game minutes a party spends eating
const EYE = 1.6, PLAYER_R = 0.3, SPEED = 4, NPC_SPEED = 1.6;
const DOOR_IN = new THREE.Vector3(-6, 0, 5.2), OUTSIDE = new THREE.Vector3(-6, 0, 8.5);
const COUNTER_SPOT = new THREE.Vector3(-4, 0, -2.6), REGISTER_SPOT = new THREE.Vector3(-5.6, 0, -2.6);
const LANE_OFF = 2, AISLE_Z = -1.5;            // walking lanes beside the tables and the aisle in front of them
const EXIT_WAY = new THREE.Vector3(-3, 0, AISLE_Z); // seated parties leave along the aisle, clear of the tables

// Demand, one row per day (the last row repeats and keeps ramping slowly). Tune difficulty here.
//   rate: parties per game hour · rush: demand multiplier during lunch/dinner · party: possible party sizes
//   extra: chance of a shared starter per two guests · sauce: chance a dish is ordered with a sauce
//   cash: share of parties paying cash · patience: multiplier on guest patience (never below 1)
const DAYS = [
  { rate: 1.0, rush: 1.4, party: [1, 1, 2], extra: 0, sauce: 0, sauces: [], cash: 0.2, patience: 1 },
  { rate: 1.3, rush: 1.6, party: [1, 2, 2], extra: 0.25, sauce: 0.3, sauces: ['chimi'], cash: 0.35, patience: 1 },
  { rate: 1.6, rush: 1.8, party: [1, 2, 2, 3], extra: 0.35, sauce: 0.4, sauces: ['chimi'], cash: 0.45, patience: 1 },
  { rate: 1.9, rush: 2, party: [1, 2, 3, 4], extra: 0.45, sauce: 0.5, sauces: ['chimi', 'criolla'], cash: 0.5, patience: 1 },
  { rate: 2.2, rush: 2.2, party: [2, 2, 3, 4], extra: 0.5, sauce: 0.55, sauces: ['chimi', 'criolla'], cash: 0.5, patience: 1 },
];
const RUSHES = [{ from: 12.5, to: 14.5, name: 'LUNCH RUSH' }, { from: 20, to: 21.5, name: 'DINNER RUSH' }]; // game hours
function dayCfg() {
  const d = DAYS[Math.min(day, DAYS.length) - 1], over = Math.max(0, day - DAYS.length);
  return over ? { ...d, rate: Math.min(3.2, d.rate + 0.2 * over) } : d;
}

const UPGRADES = [
  { id: 'grill', cat: 'KITCHEN', name: 'Bigger Grill', desc: '+2 grill spots per level (4 → 6 → 8 → 10)', cost: [150, 300, 450] },
  { id: 'grillq', cat: 'KITCHEN', name: 'Better Grill', desc: 'Food cooks 35% faster', cost: [120] },
  { id: 'prep', cat: 'KITCHEN', name: 'Better Prep Station', desc: '8 portions per whole cut, cutting twice as fast', cost: [100] },
  { id: 'cold', cat: 'STORAGE', name: 'Bigger Cold Storage', desc: '+20 storage space (extra freezer)', cost: [80] },
  { id: 'storage', cat: 'STORAGE', name: 'More Storage Capacity', desc: '+30 storage space (extra shelving)', cost: [150] },
  { id: 'tables', cat: 'RESTAURANT', name: 'More Tables', desc: 'Adds table 4', cost: [200] },
  { id: 'interior', cat: 'RESTAURANT', name: 'Better Interior', desc: 'Guests are 30% more patient and tip more', cost: [180] },
  { id: 'quality', cat: 'FOOD', name: 'Better Meat Quality', desc: 'Unlocks Premium, then Angus, then Dry-Aged meat', cost: [100, 250, 500] },
  { id: 'menu', cat: 'FOOD', name: 'More Food Options', desc: 'Adds Bife de Chorizo to the menu and wholesale', cost: [120] },
];
UPGRADES.forEach(u => { u.level = 0; });
const lvl = id => UPGRADES.find(u => u.id === id).level;
const has = id => lvl(id) > 0;
// Staff roles, hired through the office terminal. The player always runs the register.
const ROLES = {
  prep: { name: 'Prep Cook', hire: 60, wage: 30, shirt: 0xffffff, hat: true, beret: 'asador_prep.jpg', desc: 'Fetches whole cuts from cold storage and cuts them into portions' },
  server: { name: 'Server', hire: 60, wage: 25, shirt: 0x26302b, beret: 'asador_server.jpg', desc: 'Carries READY trays from the service counter to the tables' },
  grill: { name: 'Grill Cook', hire: 120, wage: 45, shirt: 0xffffff, hat: true, desc: 'Grills what open orders need and puts it on the table trays' },
};
// Characters: Higgsfield 3D models (public/models). Customers pick a type; every employee is the asador with a
// beret per role (grill cook red, server black, prep cook white). crotch = share of the height where the legs start
// (tucked away on a chair); shift/squash = seated forward offset (m) and front-to-back squeeze so the body fits
// between the chair back and the table edge.
const CHAR_H = 1.6, SEAT_TOP = 0.495;
const CHARS = {
  asador:  { file: 'asador.glb',  crotch: 0.2 },
  grandpa: { file: 'grandpa.glb', crotch: 0.25, shift: 0.14, squash: 0.82 },
  fan:     { file: 'fan.glb',     crotch: 0.2,  shift: 0.11, squash: 0.8 },
  senora:  { file: 'senora.glb',  crotch: 0.17, shift: 0.11, squash: 0.89 },
};
const CUSTOMER_TYPES = ['grandpa', 'fan', 'senora'];
// Higgsfield props (public/models): turn (the models face +x), uniform scale, bottom centre at the origin.
// The parrilla's grate section (model z between its end walls) is stretched so the grate covers every grill spot.
const PROPS = {
  parrilla: { file: 'parrilla.glb', rot: -Math.PI / 2, scale: 2.03, stretch: [-0.252, 0.394, 1.983] },
  table:    { file: 'table.glb', rot: 0, scale: 1.2 },          // top at 0.79
  chair:    { file: 'chair.glb', rot: -Math.PI / 2, scale: 1.078 }, // seat at SEAT_TOP
  pos:      { file: 'pos.glb', rot: -Math.PI / 2, scale: 0.84 },
  plant:    { file: 'plant.glb', rot: 0, scale: 1 },
  winerack: { file: 'winerack.glb', rot: 0, scale: 1.1 },
  plates:   { file: 'plates_shelf.glb', rot: -Math.PI / 2, scale: 0.75 },
  // raw food (longest side in metres, the bottom 3 cm under the origin like the procedural pieces), knife, cutting board
  meat_filet:     { file: 'meat_filet.glb', rot: 0, scale: 0.17 },
  meat_vacio:     { file: 'meat_vacio.glb', rot: 0, scale: 0.36 },
  meat_bife:      { file: 'meat_bife.glb', rot: Math.PI / 2, scale: 0.32 },
  meat_chorizo:   { file: 'meat_chorizo.glb', rot: 0, scale: 0.3 },
  meat_provoleta: { file: 'meat_provoleta.glb', rot: 0, scale: 0.27 },
  knife:          { file: 'knife.glb', rot: -2.117, scale: 0.26 },          // blade toward -z, lying flat
  board:          { file: 'cutting_board.glb', rot: 0, scale: 0.56 },
  prep_table:     { file: 'prep_table.glb', rot: Math.PI / 2, scale: 1 },   // stretched to the 2 x 0.7 m station
};
const portionsPer = () => (has('prep') ? 8 : 6);
const capacity = () => 30 + (has('cold') ? 20 : 0) + (has('storage') ? 30 : 0);
const menu = () => Object.keys(FOODS).filter(d => d !== 'bife' || has('menu'));
const patienceMult = () => (has('interior') ? 1.3 : 1) * dayCfg().patience;

// ---------- State ----------
let money = 0;
let held = null;          // { kind: 'crate' | 'whole' | 'bottle' | 'sauce' | 'tray', type, q, mesh, ... }; stacks: { kind: 'portion' | 'cooked', items: [{ type, q, mesh }] }
const grillFood = [];     // { type, q, t, mesh, slot, owner }
const customers = [];     // party leaders (party members follow them)
const queue = [], payQueue = []; // ordering line at the counter, payment line at the register
let msgTimer = 0;
let day = 1, isOpen = false, dayDone = false, everOpened = false, warnedClosing = false, clockMin = DAY_START;
let sinceArrival = 0, busySpell = 0, rushShown = '';             // demand model
const stock = Object.fromEntries(ITEM_KEYS.map(k => [k, []])); // cold storage: one quality level per unit
const trays = { filet: [], vacio: [] };                          // cut portions waiting at the prep station
const crates = [];                                               // crates standing in the delivery area
let delivery = null;                                             // wholesale order on its way: { t, list }
let busy = null;                                                 // a timed hands action in progress: { kind: 'cut' | 'pour', ... }
let uiMode = null, summaryTimer = 0;                             // uiMode: 'os' | 'summary' | 'pos'
let drawer = FLOAT;                                              // cash in the register drawer
const transactions = [];                                         // completed payments
const newDay = () => ({ sales: 0, tips: 0, card: 0, cash: 0, food: 0, staff: 0, upgrades: 0, guests: 0, lost: 0, deposit: 0, sold: {} });
let today = newDay();
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

scene.add(new THREE.HemisphereLight(0xffe6c4, 0x5a3820, 1.35)); // warm light all over
const sun = new THREE.DirectionalLight(0xffe2b8, 1.1);
sun.position.set(4, 10, 6);
sun.castShadow = true;
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);
const grillLight = new THREE.PointLight(0xff7a2a, 3, 6);
grillLight.position.set(4.5, 1.6, -4.8);
scene.add(grillLight);
const kitchenLight = new THREE.PointLight(0xfff0dc, 8, 14);
kitchenLight.position.set(0.8, 3.3, -10.3); // over the middle of the back of house, not glaring on the prep table
scene.add(kitchenLight);
const officeLight = new THREE.PointLight(0xffe2b0, 6, 7);
officeLight.position.set(-6.2, 3, -10.4);
scene.add(officeLight);

// ---------- Helpers ----------
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
const colliders = [], solids = []; // solids also block the interaction ray

// Textures generated with Higgsfield (public/textures)
const loader = new THREE.TextureLoader();
const texImg = {}; // one image per file, shared by every repeat of it
function tex(name, rx = 1, ry = 1) {
  const src = texImg[name] ||= { img: loader.load(`textures/${name}.jpg`, () => src.uses.forEach(t => { t.needsUpdate = true; })), uses: [] };
  const t = new THREE.Texture();
  t.source = src.img.source;
  if (t.image) t.needsUpdate = true; else src.uses.push(t);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
const texMat = (name, rx, ry) => new THREE.MeshStandardMaterial({ map: tex(name, rx, ry), roughness: 0.9 });
// per-face tiling so a texture (bricks by default) keeps its size on every face (BoxGeometry order: ±x, ±y, ±z)
function brickMats(w, h, d, s = 1.2, name = 'brick') {
  const x = texMat(name, d / s, h / s), y = texMat(name, w / s, d / s), z = texMat(name, w / s, h / s);
  return [x, x, y, y, z, z];
}
// Higgsfield props load once (see PROPS); onProp(name, place) runs place(lib) when the model is ready, and each
// placement is a mesh sharing the model's geometry and material. Until then the procedural stand-ins stay.
const propLib = {}, propWait = {};
function onProp(name, place) { if (propLib[name]) place(propLib[name]); else (propWait[name] ||= []).push(place); }
function makeProp(L) {
  const m = new THREE.Mesh(L.geo, L.mat);
  m.castShadow = m.receiveShadow = true;
  return m;
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

function labelTex(text, bg = '#0009', fg = '#fff', aspect = 2) { // canvas texture: centered lines of text, shrunk to fit
  const c = document.createElement('canvas'), W = Math.round(256 * aspect);
  c.width = W; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, W, 256);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  let size = lines.length > 2 ? 68 : lines.length > 1 ? 90 : 150;
  g.font = `bold ${size}px system-ui`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width));
  if (widest > W - 42) { size = Math.floor(size * (W - 42) / widest); g.font = `bold ${size}px system-ui`; }
  lines.forEach((l, i) => g.fillText(l, W / 2, 128 + (i - (lines.length - 1) / 2) * size * 1.1));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function bubbleTex(text) { // a guest's speech bubble: rounded box with a tail pointing down at them
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.roundRect(6, 6, 500, 186, 56); g.fill();
  g.beginPath(); g.moveTo(222, 186); g.lineTo(256, 250); g.lineTo(290, 186); g.fill();
  g.fillStyle = '#222'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 120;
  g.font = `bold ${size}px system-ui`;
  const w = g.measureText(text).width;
  if (w > 430) { size = Math.floor(size * 430 / w); g.font = `bold ${size}px system-ui`; }
  g.fillText(text, 256, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  pour: () => [0, 0.2, 0.4, 0.6].forEach((d, i) => beep(430 - i * 45, 0.09, 'sine', 0.08, d)),
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
flat(16, 12, texMat('calcareas', 16 / 1.2, 12 / 1.2), 0, 0); // dining room: calcáreas tiles
const kitchenTiles = texMat('floor', 6.7, 2.5);
kitchenTiles.color.set(0xbfc8c8);
flat(16, 6, kitchenTiles, 0, -9);                // back of house
flat(3.6, 3.2, 0x8a6040, -6.2, -10.4, 0.003);    // office floor
flat(6, 8, 0x9a9a95, 11, -9, 0.002);             // delivery yard

const WALL = 0xf0e0c0, WH = 3.5;
box(9, WH, 0.2, brickMats(9, WH, 0.2), -3.5, WH / 2, -6);    // brick wall behind the grill,
box(5.4, WH, 0.2, brickMats(5.4, WH, 0.2), 5.3, WH / 2, -6); // kitchen doorway at x 1..2.6
box(1.6, 1.1, 0.2, brickMats(1.6, 1.1, 0.2), 1.8, WH - 0.55, -6, false);
const plaster = (w, h, d) => brickMats(w, h, d, 2.4, 'plaster');
box(0.2, WH, 12, plaster(0.2, WH, 12), -8, WH / 2, 0);   // dining left
box(0.2, WH, 12, plaster(0.2, WH, 12), 8, WH / 2, 0);    // dining right
box(1, WH, 0.2, plaster(1, WH, 0.2), -7.5, WH / 2, 6);   // front, left of door
box(13, WH, 0.2, plaster(13, WH, 0.2), 1.5, WH / 2, 6);  // front, right of door
box(2, 1, 0.2, plaster(2, 1, 0.2), -6, WH - 0.5, 6, false); // above door
colliders.push({ minX: -7, maxX: -5, minZ: 5.9, maxZ: 6.1, on: true }); // the player stays inside; guests use the door
box(0.2, WH, 6, brickMats(0.2, WH, 6), -8, WH / 2, -9);          // back of house: brick kitchen walls
box(16.2, WH, 0.2, brickMats(16.2, WH, 0.2), 0, WH / 2, -12);
box(0.2, WH, 1.6, brickMats(0.2, WH, 1.6), 8, WH / 2, -11.2);      // east wall, back door at z -10.4..-9
box(0.2, WH, 3, brickMats(0.2, WH, 3), 8, WH / 2, -7.5);
box(0.2, 1.1, 1.4, brickMats(0.2, 1.1, 1.4), 8, WH - 0.55, -9.7, false);
box(2, WH, 0.2, WALL, -7, WH / 2, -8.8);        // office, door at x -6..-4.8
box(0.4, WH, 0.2, WALL, -4.6, WH / 2, -8.8);
box(1.2, 1.1, 0.2, WALL, -5.4, WH - 0.55, -8.8, false);
box(0.2, WH, 3.2, WALL, -4.4, WH / 2, -10.4);
// delivery yard: low walls, painted loading zone, sign
for (const [w, d, x, z] of [[6, 0.15, 11, -13], [6, 0.15, 11, -5], [0.15, 8, 14, -9], [0.15, 1, 8, -12.5]]) box(w, 1.1, d, 0x9d9d98, x, 0.55, z);
const stripe = mat(0xf2c230);
for (const [w, d, x, z] of [[4.6, 0.1, 11, -12.25], [4.6, 0.1, 11, -6.75], [0.1, 5.6, 8.7, -9.5], [0.1, 5.6, 13.3, -9.5]]) flat(w, d, stripe, x, z, 0.004);
for (let i = 0; i < 5; i++) flat(0.12, 0.9, stripe, 9.4 + i * 0.85, -7.15, 0.004).rotation.z = 0.7;
box(0.1, 2.3, 0.1, 0x555555, 13.6, 1.15, -9.5, false); // post for the DELIVERY sign

// Counter
const counter = box(3, 1, 0.8, brickMats(3, 1, 0.8, 1, 'counter_wood'), -4.5, 0.5, -3.5);
box(3.1, 0.06, 0.9, 0x3a2a1a, -4.5, 1.03, -3.5, false);
counter.userData.kind = 'counter';
// order screens (counter POS + kitchen display) share one canvas, drawn by drawScreens()
const orderCanvas = document.createElement('canvas');
orderCanvas.width = 512;
orderCanvas.height = 360;
const orderTex = new THREE.CanvasTexture(orderCanvas);
orderTex.colorSpace = THREE.SRGBColorSpace;
function orderScreen(w, x, y, z, stand, ry = Math.PI) { // faces -z (the staff side) unless turned
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  part(new THREE.BoxGeometry(w + 0.05, w * 0.7 + 0.05, 0.04), mat(0x1a1a1a), 0, 0, -0.025, g);
  part(new THREE.PlaneGeometry(w, w * 0.7), new THREE.MeshBasicMaterial({ map: orderTex }), 0, 0, 0, g).castShadow = false;
  if (stand) part(new THREE.BoxGeometry(0.05, 0.26, 0.05), mat(0x1a1a1a), 0, -w * 0.35 - 0.13, -0.03, g);
  scene.add(g);
}
orderScreen(0.56, -3.5, 1.46, -3.72, true); // on the front counter
orderScreen(0.9, 4.2, 1.95, -6.13, false);  // kitchen display above the prep station
orderScreen(1, 7.88, 2.05, -4.4, false, -Math.PI / 2); // on the side wall of the grill area

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
const grillDeco = new THREE.Group(); // procedural grate, crank and brasero until the parrilla model is in
scene.add(grillDeco);
const grateBar = rod(0.012, 0.84).rotateX(Math.PI / 2);
for (let i = 0; i < 15; i++) part(grateBar, iron, 3.1 + i * 0.2, 0.935, -5.3, grillDeco);
for (const z of [-4.88, -5.72]) part(new THREE.BoxGeometry(2.9, 0.05, 0.04), iron, 4.5, 0.94, z, grillDeco); // frame
for (const x of [3.05, 5.95]) part(new THREE.BoxGeometry(0.04, 0.05, 0.86), iron, x, 0.94, -5.3, grillDeco);
// height crank on the front
const crank = new THREE.Group();
crank.position.set(3.14, 0.62, -4.82);
part(new THREE.TorusGeometry(0.11, 0.014, 6, 14), iron, 0, 0, 0, crank);
part(new THREE.BoxGeometry(0.22, 0.02, 0.02), iron, 0, 0, 0, crank);
part(new THREE.BoxGeometry(0.02, 0.22, 0.02), iron, 0, 0, 0, crank);
part(rod(0.015, 0.1).rotateX(Math.PI / 2), iron, 0.08, 0.08, 0.05, crank);
grillDeco.add(crank);
// side brasero: brick pedestal + iron basket with burning logs
const brasero = box(0.7, 0.9, 0.9, brickMats(0.7, 0.9, 0.9), 6.4, 0.45, -5.3);
part(new THREE.PlaneGeometry(0.6, 0.6), emberMat, 6.4, 0.905, -5.3, grillDeco).rotation.x = -Math.PI / 2;
const cageBar = rod(0.01, 0.45);
for (let i = 0; i < 5; i++) {
  const o = -0.25 + i * 0.125;
  for (const [dx, dz] of [[o, -0.25], [o, 0.25], [-0.25, o], [0.25, o]]) part(cageBar, iron, 6.4 + dx, 1.13, -5.3 + dz, grillDeco);
}
for (const y of [0.92, 1.35]) {
  for (const dz of [-0.25, 0.25]) part(new THREE.BoxGeometry(0.52, 0.02, 0.02), iron, 6.4, y, -5.3 + dz, grillDeco);
  for (const dx of [-0.25, 0.25]) part(new THREE.BoxGeometry(0.02, 0.02, 0.52), iron, 6.4 + dx, y, -5.3, grillDeco);
}
const logGeo = rod(0.045, 0.42).rotateZ(Math.PI / 2);
for (const [y, dz, ry] of [[0.96, 0.1, 0.4], [0.96, -0.1, -0.3], [1.04, 0, 1.4]]) part(logGeo, mat(0x5a3b22), 6.4, y, -5.3 + dz, grillDeco).rotation.y = ry;
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
// grill spots [x, z], filled from the middle out: 4 to start, "Bigger Grill" adds 2 per level (front row, back row)
const SLOTS = [3.95, 5.05, 4.5, 3.4, 5.6].flatMap(x => [[x, -5.12], [x, -5.48]]);
const slotCount = () => 4 + 2 * lvl('grill');
const grillSpeed = () => (has('grillq') ? 1.35 : 1);
// one lamp per spot on the brick front (the upper lamp is the back row): yellow cooking, green ready, flashing red before it burns
const slotLights = SLOTS.map(([x, z]) => part(new THREE.BoxGeometry(0.15, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: 0x333333 }), x, z < -5.3 ? 0.82 : 0.73, -4.84));
slotLights.forEach((l, i) => { l.visible = i < slotCount(); });
let grillModel = null; // the parrilla model once loaded (the look-at highlight shows on it)
onProp('parrilla', L => { // the Higgsfield parrilla: its grate spans x 3.2..5.8 (every spot) with the bars at 0.94, the basket at the old brasero
  grillDeco.visible = false;
  grill.material = brasero.material = coals.material = hitMat; // still the collider and the interaction target
  const m = grillModel = makeProp(L);
  m.position.set(4.644, 0, -5.29);
  scene.add(m);
  slotLights.forEach((l, i) => { l.position.set(SLOTS[i][0], SLOTS[i][1] < -5.3 ? 0.855 : 0.805, -4.672); l.scale.y = 0.7; }); // on its front lip
  flames.forEach(f => { f.position.x -= 0.27; f.position.y = 0.86; f.position.z -= 0.23; }); // in its fire basket
});

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
const tableCloth = texMat('tablecloth', 2, 2);
const plateGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.012, 16), plateMat = mat(0xf4f4f0);
// 4 seats per table; guests face the table. Each seat knows its spot, facing, approach lane and plate spot.
const SEATS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const tableWood = mat(0x5a3a1a), chairMat = mat(0x6b4423);
const tables = [
  { x: 0, z: 0.5 }, { x: 4, z: 0.5 }, { x: 0, z: 3.8 }, { x: 4, z: 3.8 },
].map((t, i) => {
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  const top = part(new THREE.BoxGeometry(1.2, 0.08, 1.2), clothMat, 0, 0.75, 0, g);
  const leg = part(new THREE.BoxGeometry(0.15, 0.75, 0.15), tableWood, 0, 0.37, 0, g);
  const seats = SEATS.map(([dx, dz]) => {
    const rot = Math.atan2(-dx, -dz), ch = new THREE.Group();
    ch.position.set(dx, 0, dz);
    ch.rotation.y = rot;
    part(new THREE.BoxGeometry(0.5, 0.08, 0.5), chairMat, 0, 0.45, 0, ch);
    part(new THREE.BoxGeometry(0.5, 0.6, 0.08), chairMat, 0, 0.75, -0.25, ch);
    part(new THREE.BoxGeometry(0.1, 0.45, 0.1), tableWood, 0, 0.22, 0, ch);
    g.add(ch);
    part(plateGeo, plateMat, dx * 0.3, 0.797, dz * 0.3, g);
    const lane = dx ? t.x + dx * LANE_OFF : t.x - LANE_OFF; // guests walk in beside the table, never through it
    return { pos: new THREE.Vector3(t.x + dx, 0, t.z + dz), rot, lane: new THREE.Vector3(lane, 0, t.z + dz),
      plate: new THREE.Vector3(t.x + dx * 0.3, 0.82, t.z + dz * 0.3), side: new THREE.Vector3(-dz, 0, dx), chair: ch };
  });
  g.traverse(o => { o.castShadow = o.receiveShadow = true; });
  const num = new THREE.MeshStandardMaterial({ map: labelTex(String(i + 1), '#f4efe6', '#7a1f1f', 1), roughness: 0.9 });
  part(new THREE.BoxGeometry(0.1, 0.1, 0.1), [num, num, tableWood, tableWood, num, num], 0, 0.84, 0, g); // table number block
  g.userData.kind = 'table';
  scene.add(g);
  const col = { minX: t.x - 0.6, maxX: t.x + 0.6, minZ: t.z - 0.6, maxZ: t.z + 0.6, on: i < 3 };
  colliders.push(col);
  const table = { n: i + 1, x: t.x, z: t.z, group: g, col, customer: null, active: i < 3, seats, top, leg };
  g.userData.ref = table;
  g.visible = table.active;
  return table;
});
onProp('table', L => tables.forEach(t => { // Higgsfield table (top at 0.79) under a thin checked tablecloth
  t.top.visible = t.leg.visible = false;
  t.group.add(makeProp(L));
  part(new THREE.BoxGeometry(1.22, 0.006, 1.17), tableCloth, 0, 0.7946, 0, t.group).receiveShadow = true;
}));
onProp('chair', L => tables.forEach(t => t.seats.forEach(s => { // bentwood chair, seat at SEAT_TOP, set back so its backrest clears a seated guest
  s.chair.children.forEach(m => { m.visible = false; });
  const m = makeProp(L);
  m.position.z = -0.06;
  s.chair.add(m);
})));

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
// Higgsfield raw food: the models show raw meat; cookLook() browns a piece and fades in grill marks, then burns it
const CHARRED = new THREE.Color(0.13, 0.09, 0.07);
const grillMarks = loader.load('textures/grill_marks.webp'), burntTex = tex('burnt');
grillMarks.colorSpace = THREE.SRGBColorSpace;
grillMarks.wrapS = grillMarks.wrapT = THREE.RepeatWrapping;
function foodMatGLB(base, type) { // per piece: grill marks (top faces, projected from above) and the burnt crust mix in by uniforms
  const m = base.clone(), u = m.userData;
  u.cook = { value: 0 };
  u.burn = { value: 0 };
  const marks = { value: type === 'provoleta' ? 0 : 1 }; // the cheese only browns
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uCook: u.cook, uBurn: u.burn, uMarkOn: marks, uMarks: { value: grillMarks }, uBurnt: { value: burntTex } });
    sh.vertexShader = 'varying vec3 vFoodPos;\nvarying vec3 vFoodN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFoodPos = position;\n  vFoodN = normal;');
    sh.fragmentShader = 'uniform float uCook;\nuniform float uBurn;\nuniform float uMarkOn;\nuniform sampler2D uMarks;\nuniform sampler2D uBurnt;\nvarying vec3 vFoodPos;\nvarying vec3 vFoodN;\n'
      + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); // cooking browns the raw colour but keeps its detail
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.29, 0.14) * (0.55 + 0.9 * lum), uCook * (0.45 + 0.4 * uMarkOn));
  vec4 mk = texture2D(uMarks, vFoodPos.xz * 6.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb, mk.a * uCook * uMarkOn * smoothstep(0.35, 0.8, normalize(vFoodN).y));
  diffuseColor.rgb = mix(diffuseColor.rgb, texture2D(uBurnt, vFoodPos.xz * 4.0).rgb, uBurn);`);
  };
  m.customProgramCacheKey = () => 'food';
  return m;
}
function cookLook(mesh, cook, burn) { // cook 0 raw → 1 done; burn 0 → 1 burnt crust (false for a procedural piece)
  const u = mesh.material.userData;
  if (!u.cook) return false;
  u.cook.value = cook;
  u.burn.value = burn;
  mesh.material.color.setRGB(1, 1, 1).lerp(CHARRED, burn);
  return true;
}
function makeFoodMesh(type) {
  const L = propLib['meat_' + type];
  const m = L ? new THREE.Mesh(L.geo, foodMatGLB(L.mat, type)) : new THREE.Mesh(foodGeo[type] ||= FOOD_GEO[type](), foodMat(type));
  m.castShadow = true;
  m.foodType = type; // pieces made before the model loaded are swapped for it (see below)
  return m;
}
for (const type of Object.keys(FOOD_GEO)) onProp('meat_' + type, L => {
  L.geo.translate(0, -0.03, 0);
  scene.traverse(o => {
    if (o.foodType !== type || o.geometry === L.geo) return;
    o.geometry = L.geo;
    o.material = foodMatGLB(L.mat, type);
    if (o.foodWhole) o.scale.multiply(o.foodWhole);
  });
});
// cheap smoke and sizzle over the grill: two point clouds with fixed pools, each particle fading out
const puffTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, '#fff'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function puffs(n, size, rgb, alpha) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-10), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: puffTex, vertexColors: true, transparent: true, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  return { geo, n, i: 0, life: new Float32Array(n), max: new Float32Array(n), vel: new Float32Array(n * 3), rgb, alpha };
}
const smoke = puffs(70, 0.3, [0.62, 0.6, 0.58], 0.32), sizzle = puffs(50, 0.035, [1, 0.72, 0.3], 0.95);
function emit(s, x, y, z, vy, life, shade = 1) {
  const i = s.i = (s.i + 1) % s.n, c = s.geo.attributes.color;
  s.geo.attributes.position.setXYZ(i, x, y, z);
  s.vel.set([(Math.random() - 0.5) * 0.12, vy, (Math.random() - 0.5) * 0.12], i * 3);
  s.life[i] = s.max[i] = life;
  c.setXYZW(i, s.rgb[0] * shade, s.rgb[1] * shade, s.rgb[2] * shade, 0);
}
function stepPuffs(s, dt) {
  const p = s.geo.attributes.position, c = s.geo.attributes.color;
  for (let i = 0; i < s.n; i++) {
    if (s.life[i] <= 0) { if (c.getW(i)) { c.setW(i, 0); p.setY(i, -10); } continue; }
    s.life[i] -= dt;
    const k = Math.max(0, s.life[i] / s.max[i]);
    p.setXYZ(i, p.getX(i) + s.vel[3 * i] * dt, p.getY(i) + s.vel[3 * i + 1] * dt, p.getZ(i) + s.vel[3 * i + 2] * dt);
    c.setW(i, s.alpha * Math.min(1, (1 - k) * 6) * k);
  }
  p.needsUpdate = c.needsUpdate = true;
}
function grillFx(f, st, dt) { // light smoke and sizzle while it cooks, much more (and darker) smoke once it burns
  const p = f.mesh.position, burnt = st === 'burnt', j = () => (Math.random() - 0.5) * 0.16;
  if (Math.random() < dt * (burnt ? 9 : st === 'ready' ? 3 : 1.5)) emit(smoke, p.x + j(), 1.0, p.z + j(), 0.22 + Math.random() * 0.2, 1.4 + Math.random(), burnt ? 0.35 : 1);
  if (!burnt && Math.random() < dt * 7) emit(sizzle, p.x + j(), 0.99, p.z + j(), 0.5 + Math.random() * 0.5, 0.3);
}
// cold-storage items: whole cuts get their own shape, everything else looks like its dish
function makeItemMesh(it) {
  if (ITEMS[it].sauce) return makeBottle(ITEMS[it].sauce);
  if (it === 'filet_whole') {
    foodGeo.filet_whole ||= paint(new THREE.LatheGeometry([V2(0.001, -0.22), V2(0.04, -0.2), V2(0.062, -0.1), V2(0.07, 0.04), V2(0.06, 0.15), V2(0.032, 0.21), V2(0.001, 0.225)], 10).rotateZ(Math.PI / 2), 0xffffff);
    if (propLib.meat_filet) { const w = makeFoodMesh('filet'); w.scale.set(2.6, 1.2, 0.9); return w; } // the whole tenderloin: a stretched medallion
    const m = new THREE.Mesh(foodGeo.filet_whole, foodMat('filet'));
    m.castShadow = true;
    m.foodType = 'filet';
    m.foodWhole = new THREE.Vector3(2.6, 1.2, 0.9);
    return m;
  }
  const m = makeFoodMesh(ITEMS[it].dish);
  if (it === 'vacio_whole') m.scale.set(1.8, 1.4, 1.7);
  return m;
}
const cupMat = mat(0xf4f4f0), capMat = mat(0x7a1f1f), sauceMats = {};
const sauceMat = s => (sauceMats[s] ||= new THREE.MeshStandardMaterial({ color: SAUCES[s].color, roughness: 0.35 }));
const cupGeo = new THREE.CylinderGeometry(0.034, 0.026, 0.03, 12);
function makeBottle(s) { // sauce bottle with a paper label (origin at its middle, bottom at y -0.075)
  const g = new THREE.Group();
  part(new THREE.CylinderGeometry(0.042, 0.042, 0.13, 10), sauceMat(s), 0, -0.01, 0, g);
  part(new THREE.CylinderGeometry(0.0435, 0.0435, 0.05, 10), cupMat, 0, -0.01, 0, g);
  part(new THREE.CylinderGeometry(0.016, 0.04, 0.04, 10), sauceMat(s), 0, 0.075, 0, g);
  part(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), capMat, 0, 0.105, 0, g);
  return g;
}
function makeCup(s) { // small ramekin of sauce that goes next to a dish
  const g = new THREE.Group();
  part(cupGeo, cupMat, 0, 0, 0, g);
  g.userData.fill = part(new THREE.CylinderGeometry(0.029, 0.029, 0.004, 12), sauceMat(s), 0, 0.012, 0, g);
  return g;
}
const foodState = f => {
  const d = FOODS[f.type];
  return f.t < d.cook ? 'cooking' : f.t < d.cook + d.burn ? 'ready' : 'burnt';
};

const freeSlot = () => SLOTS.findIndex((_, i) => i < slotCount() && !grillFood.some(f => f.slot === i));
const freeSlots = () => SLOTS.filter((_, i) => i < slotCount() && !grillFood.some(f => f.slot === i)).length;
function startCooking(type, q = 0, owner = null) { // owner: the grill cook for its own pieces
  const slot = freeSlot();
  const mesh = makeFoodMesh(type);
  mesh.position.set(SLOTS[slot][0], 0.97, SLOTS[slot][1]);
  mesh.userData.kind = 'food';
  scene.add(mesh);
  const f = { type, q, t: 0, mesh, slot, owner };
  mesh.userData.ref = f;
  grillFood.push(f);
  sfx.cook();
}

function removeGrillFood(f) {
  const i = grillFood.indexOf(f);
  if (i >= 0) grillFood.splice(i, 1);
  scene.remove(f.mesh);
}

const readyFood = () => grillFood.filter(f => foodState(f) === 'ready');
function offGrill(f) { // off the grill it is just food (on a tray it must not answer as grill food)
  removeGrillFood(f);
  f.mesh.userData = {};
  return { type: f.type, q: f.q, mesh: f.mesh };
}
function pickUpReady() { // one E takes every ready piece on the grill (mixed dishes are fine)
  const items = readyFood().map(offGrill);
  if (held?.kind === 'cooked') { held.items.push(...items); restack(held); reach(); sfx.pick(); } else hold(stack('cooked', items));
}
function tossBurnt(f) {
  removeGrillFood(f);
  reach();
  toast(`Burnt ${FOODS[f.type].name} tossed!`, '#f66');
  sfx.bad();
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

// Higgsfield characters: each model loads once; every person shares its geometry and textures
const charLib = {}; // type → { upper, seated, legs, mat, cy } (people made before their model has loaded stay procedural)
const gltfLoader = new GLTFLoader();
gltfLoader.register(parser => { // embedded textures decode through <img>: a page's CSP may refuse fetch() of blob: URLs
  parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
  return { name: 'imgTextures' };
});
const glbBytes = b => new TextDecoder().decode(new Uint8Array(b, 0, 4)) === 'glTF' ? b // a raw GLB, or base64 text where
  : Uint8Array.from(atob(new TextDecoder().decode(b)), c => c.charCodeAt(0)).buffer; // the host doesn't serve .glb
for (const [type, k] of Object.entries(CHARS)) {
  fetch(`models/${k.file}`).then(r => r.arrayBuffer()).then(b => gltfLoader.parse(glbBytes(b), '', gl => {
    let mesh;
    gl.scene.traverse(o => { if (o.isMesh) mesh = o; });
    charLib[type] = prepChar(mesh, k);
  }));
}
for (const [name, k] of Object.entries(PROPS)) {
  fetch(`models/${k.file}`).then(r => r.arrayBuffer()).then(b => gltfLoader.parse(glbBytes(b), '', gl => {
    let mesh;
    gl.scene.traverse(o => { if (o.isMesh) mesh = o; });
    propLib[name] = prepProp(mesh, k);
    (propWait[name] || []).forEach(place => place(propLib[name]));
  }));
}
function prepProp(mesh, k) { // optional stretch of a middle section along model z, turn, scale, bottom centre at the origin
  const g = mesh.geometry.clone(), p = g.attributes.position, n = g.attributes.normal;
  if (k.stretch) {
    const [a, b, f] = k.stretch;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      p.setZ(i, z <= a ? z : z <= b ? a + (z - a) * f : z + (b - a) * (f - 1));
      if (z > a && z <= b) { // stretching along z flattens the normals' z part
        const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i) / f, l = Math.hypot(nx, ny, nz) || 1;
        n.setXYZ(i, nx / l, ny / l, nz / l);
      }
    }
  }
  g.rotateY(k.rot);
  g.scale(k.scale, k.scale, k.scale);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingSphere();
  return { geo: g, mat: mesh.material };
}
function prepChar(mesh, k) { // arms a little closer to the body, CHAR_H tall with the feet at 0, facing +z, legs split off
  const g = mesh.geometry.clone(), p = g.attributes.position;
  g.computeBoundingBox();
  const b = g.boundingBox, h = b.max.y - b.min.y, side = 0.22 * h; // the models face +x: z is their side
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (Math.abs(z) > side) p.setZ(i, Math.sign(z) * (side + (Math.abs(z) - side) * 0.6)); }
  const sc = CHAR_H / h;
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeScale(sc, sc, sc))
    .multiply(new THREE.Matrix4().makeTranslation(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)));
  const cy = k.crotch * CHAR_H, idx = g.index.array, up = [], lo = [];
  for (let i = 0; i < idx.length; i += 3) (Math.max(p.getY(idx[i]), p.getY(idx[i + 1]), p.getY(idx[i + 2])) < cy ? lo : up).push(idx[i], idx[i + 1], idx[i + 2]);
  const split = (list, pos = p) => { // shares the vertex data, only the triangle list differs
    const q = new THREE.BufferGeometry();
    for (const [n, a] of Object.entries(g.attributes)) q.setAttribute(n, n === 'position' ? pos : a);
    q.setIndex(list);
    q.computeBoundingSphere();
    return q;
  };
  const seatPos = p.clone(); // seated: nothing of the upper body hangs below the crotch line, into the seat
  for (let i = 0; i < seatPos.count; i++) seatPos.setY(i, Math.max(seatPos.getY(i), cy));
  return { upper: split(up), seated: split(up, seatPos), legs: split(lo), mat: mesh.material, cy };
}
function makeToy(type, tint = null, map = null, size = 1) {
  const L = charLib[type], root = new THREE.Group(), body = new THREE.Group(), model = new THREE.Group(), legs = new THREE.Group();
  let m = L.mat;
  if (tint || map) { m = m.clone(); if (tint) m.color.copy(tint); if (map) m.map = map; }
  const up = new THREE.Mesh(L.upper, m), lo = new THREE.Mesh(L.legs, m);
  up.castShadow = lo.castShadow = true;
  legs.position.y = L.cy; // the legs fold up toward the crotch line when sitting
  lo.position.y = -L.cy;
  legs.add(lo);
  model.add(up, legs);
  model.scale.setScalar(size);
  body.add(model);
  root.add(body);
  return { root, body, model, upper: up, lib: L, legGroup: legs, legs: [], arms: [], toy: CHARS[type], type, cy: L.cy, t: Math.random() * 10, lx: 0, lz: 0, sitT: 0, walk: 0, seed: Math.random() * 6 };
}
function makeCustomerRig(taken) { // a type the room has least of; a repeat gets a slight tint and size change
  if (!CUSTOMER_TYPES.every(t => charLib[t])) return makePerson();
  const live = [...customers.flatMap(c => [c.rig, ...c.members.map(m => m.rig)]).map(r => r.type), ...taken];
  const count = t => live.filter(x => x === t).length, fewest = Math.min(...CUSTOMER_TYPES.map(count));
  const type = pick(CUSTOMER_TYPES.filter(t => count(t) === fewest)), repeat = count(type) > 0;
  taken.push(type);
  return makeToy(type, repeat ? new THREE.Color().setHSL(Math.random(), 0.35, 0.86) : null, null, repeat ? 0.95 + Math.random() * 0.1 : 1);
}
const staffMaps = {};
function staffMap(file) { // the asador's texture with a role-colored beret
  if (!staffMaps[file]) {
    const t = staffMaps[file] = loader.load(`models/${file}`);
    t.flipY = false; // like the glTF's own textures
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return staffMaps[file];
}
// toy animation for the rigid models: a waddle when walking, breathing and a little sway when standing,
// legs tucked away on the chair with a slight lean back; always facing where they walk (the path sets the root's turn)
function poseToy(c, r, dt, moving, sitting) {
  r.sitT += ((sitting ? 1 : 0) - r.sitT) * Math.min(1, dt * 5);
  r.walk += ((moving && !sitting ? 1 : 0) - r.walk) * Math.min(1, dt * 8);
  const e = r.sitT * r.sitT * (3 - 2 * r.sitT), w = r.walk, still = 1 - w, t = r.t, toy = r.toy, size = r.model.scale.x;
  const rootY = c.group.position.y, step = Math.abs(Math.sin(t * 8)), sq = (1 - step) * 0.04 * w;
  const breathe = Math.sin(t * 2.2 + r.seed) * 0.012 * still;
  const sway = Math.sin(t * 0.9 + r.seed) * (0.012 + 0.03 * Math.max(0, Math.sin(t * 0.23 + r.seed)) ** 2) * still;
  const nod = c.state === 'eat' ? 0.05 + Math.sin(t * 6) * 0.04 : c.state === 'prep' ? 0.12 + Math.sin(t * 12) * 0.06 : 0;
  r.body.position.set(0, -rootY + SEAT_TOP * e + step * 0.05 * w, (toy.shift || 0) * e); // seated: the body rests on the seat
  r.model.position.y = -r.cy * size * e; // pivot at the feet when standing, at the seat when sitting
  r.body.rotation.set(-0.06 * e + nod, 0, Math.sin(t * 8) * 0.09 * w + sway);
  const wide = 1 + sq * 0.5 - breathe * 0.5;
  r.body.scale.set(wide, 1 - sq + breathe, wide * (1 + ((toy.squash || 1) - 1) * e));
  r.legGroup.scale.y = Math.max(0.001, 1 - e);
  r.legGroup.visible = e < 0.98;
  r.upper.geometry = r.legGroup.visible ? r.lib.upper : r.lib.seated;
  const top = CHAR_H * size * (1 - e) + (SEAT_TOP + (CHAR_H - r.cy) * size) * e; // head height
  if (c.mood) c.mood.position.y = top + 0.25 - rootY;
  if (c.bubble) c.bubble.position.y = top + 0.5 - rootY;
}

// Simple procedural pose (fallback people): walk swing, sitting, eating (visual only)
function poseCustomer(c, dt) {
  const r = c.rig, p = c.group.position;
  const moving = Math.hypot(p.x - r.lx, p.z - r.lz) > 1e-4;
  r.lx = p.x; r.lz = p.z; r.t += dt;
  const sitting = c.state === 'wait' || c.state === 'eat';
  if (r.toy) return poseToy(c, r, dt, moving, sitting);
  const s = moving && !sitting ? Math.sin(r.t * 9) * 0.5 : 0;
  r.body.position.y = sitting ? -0.09 : 0;
  r.legs.forEach((l, i) => {
    l.hip.rotation.x = sitting ? -Math.PI / 2 : (i ? -s : s);
    l.knee.rotation.x = sitting ? Math.PI / 2 : Math.max(0, i ? -s : s) * 0.8;
  });
  r.arms.forEach((a, i) => { a.rotation.x = sitting ? -0.7 : (i ? s : -s) * 0.8; });
  if (c.state === 'eat' || c.state === 'prep') r.arms[1].rotation.x = -1.3 + Math.sin(r.t * 6) * 0.35;
}
// mood badge over the party leader once patience runs low: yellow, then a pulsing red
function moodTex(sym, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 80px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(sym, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const MOOD = { warn: new THREE.SpriteMaterial({ map: moodTex('!', '#d99a1e') }), angry: new THREE.SpriteMaterial({ map: moodTex('!!', '#d03030') }) };
const MEMBER_OFFSETS = [[0, 0], [0.75, 0], [-0.75, 0], [0, 0.75]]; // where party members stand next to their leader
function spawnParty() { // a party walks in together; the leader orders and pays for the table
  const free = tables.filter(t => t.active && !t.customer);
  if (!free.length) return false;
  const table = pick(free), size = pick(dayCfg().party), made = [];
  const person = i => {
    const rig = makeCustomerRig(made);
    rig.root.position.set(OUTSIDE.x + MEMBER_OFFSETS[i][0], 0, OUTSIDE.z + i * 0.7);
    scene.add(rig.root);
    return rig;
  };
  const rig = person(0), g = rig.root, mood = new THREE.Sprite(MOOD.warn), pat = PATIENCE.queue * patienceMult();
  mood.position.y = 1.98;
  mood.visible = false;
  g.add(mood);
  const c = {
    group: g, mood, table, rig, state: 'enter', path: [DOOR_IN.clone()], members: [], items: null, foods: [],
    patience: pat, maxPatience: pat, orderedAt: 0, bubble: null, eatT: 0, tipP: 1, pay: null, missedSauce: false,
  };
  for (let i = 1; i < size; i++) {
    const r = person(i);
    r.root.userData = { kind: 'customer', ref: c };
    c.members.push({ rig: r, group: r.root, seatI: i, state: 'enter', path: [DOOR_IN.clone().add(new THREE.Vector3(MEMBER_OFFSETS[i][0], 0, 0.6 * i))] });
  }
  g.userData = { kind: 'customer', ref: c };
  table.customer = c;
  customers.push(c);
  today.guests += size;
  return true;
}

function setBubble(c, text) {
  if (c.bubble) { c.group.remove(c.bubble); c.bubble.material.map.dispose(); c.bubble.material.dispose(); }
  c.bubble = null;
  if (!text) return;
  c.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex(text) }));
  c.bubble.scale.set(0.7, 0.35, 1);
  c.bubble.position.y = 2.28;
  c.group.add(c.bubble);
}

function sit(group, seat) { group.position.set(seat.pos.x, -0.2, seat.pos.z); group.rotation.y = seat.rot; }
const seatPath = st => [new THREE.Vector3(st.lane.x, 0, AISLE_Z), st.lane.clone(), st.pos.clone()];
const exitPath = lane => [lane.clone(), new THREE.Vector3(lane.x, 0, AISLE_Z), EXIT_WAY.clone(), DOOR_IN.clone(), OUTSIDE.clone()];

function takeOrder(c) {
  queue.shift();
  const items = makeOrder(1 + c.members.length);
  if (!items.length) {
    leave(c, false);
    setBubble(c, 'No food?');
    today.lost += 1 + c.members.length;
    toast('Out of stock! Store your crates or buy food at the office terminal.', '#f66', 4);
    sfx.bad();
    return;
  }
  c.items = items;
  c.missedSauce = !!items.missedSauce;
  c.state = 'toTable';
  c.orderedAt = performance.now();
  c.path = seatPath(c.table.seats[0]);
  c.members.forEach(m => { m.state = 'toTable'; m.path = seatPath(c.table.seats[m.seatI]); });
  toast(`Order: ${orderText(items).replace(/\n/g, ', ')} → Table ${c.table.n}`);
  beep(880, 0.08);
}

// what can still be served: stock (whole cuts count their portions), cut portions, grill and hands, minus open orders
function availability() {
  const per = portionsPer(), a = Object.fromEntries(Object.keys(FOODS).map(d => [d, 0]));
  for (const k of ITEM_KEYS) if (ITEMS[k].dish) a[ITEMS[k].dish] += stock[k].length * (ITEMS[k].whole ? per : 1);
  for (const d in trays) a[d] += trays[d].length;
  grillFood.forEach(f => { if (foodState(f) !== 'burnt') a[f.type]++; });
  if (held?.kind === 'whole') a[ITEMS[held.type].dish] += per;
  if (busy?.whole) a[ITEMS[busy.whole.type].dish] += per;
  staff.forEach(e => { if (e.carry && ITEMS[e.carry.type]?.whole) a[ITEMS[e.carry.type].dish] += per; });
  for (const h of [held, ...staff.map(e => e.carry)]) if (h?.kind === 'portion' || h?.kind === 'cooked') h.items.forEach(x => a[x.type]++);
  passTrays.forEach(t => t.items.forEach(x => { if (x.kind === 'dish') a[x.type]++; }));
  customers.forEach(c => c.items && c.state !== 'exit' && c.items.forEach(i => { if (!i.served) a[i.dish]--; }));
  return a;
}
function sauceAvail(s) { // cups still available: station bottle, stored bottles, cups in hands or on trays, minus open orders
  let n = sauceLevel[s] + ITEM_KEYS.reduce((k, id) => k + (ITEMS[id].sauce === s ? stock[id].length * ITEMS[id].cups : 0), 0);
  if (held?.kind === 'bottle' && ITEMS[held.type].sauce === s) n += ITEMS[held.type].cups;
  if (held?.kind === 'sauce' && held.type === s) n++;
  passTrays.forEach(t => t.items.forEach(x => { if (x.kind === 'cup' && x.type === s) n++; }));
  customers.forEach(c => c.items && c.state !== 'exit' && c.items.forEach(i => { if (i.sauce === s && !i.sauced) n--; }));
  return n;
}
function pickSauce(d, cfg) {
  if (Math.random() >= cfg.sauce) return null;
  const opts = cfg.sauces.filter(x => SAUCES[x].dishes.includes(d));
  if (!opts.length) return null;
  const ok = opts.filter(x => sauceAvail(x) > 0);
  return ok.length ? pick(ok) : 'missing';
}
function makeOrder(size) { // one dish per guest (mostly mains), sometimes shared starters and sauces
  const cfg = dayCfg(), a = availability(), m = menu(), items = [];
  let missed = false;
  const take = pool => {
    const opts = pool.filter(d => m.includes(d) && a[d] > 0);
    if (!opts.length) return null;
    const d = pick(opts);
    a[d]--;
    return d;
  };
  const add = (d, seat) => {
    let sauce = pickSauce(d, cfg);
    if (sauce === 'missing') { missed = true; sauce = null; }
    items.push({ dish: d, sauce, served: false, sauced: false, q: 0, seat });
  };
  for (let g = 0; g < size; g++) {
    const d = (Math.random() < 0.7 && take(MAINS)) || take(m);
    if (d) add(d, g);
  }
  for (let k = 0; k < Math.ceil(size / 2); k++) {
    const d = Math.random() < cfg.extra && take(STARTERS);
    if (d) items.push({ dish: d, sauce: null, served: false, sauced: false, q: 0, seat: k });
  }
  items.missedSauce = missed;
  return items;
}
function orderText(items) { // what the table is still missing, one line per dish (+ sauce)
  const n = {};
  for (const i of items) {
    if (i.served && (!i.sauce || i.sauced)) continue;
    const k = i.dish + (i.sauce ? '+' + i.sauce : '');
    n[k] = (n[k] || 0) + 1;
  }
  return Object.entries(n).map(([k, cnt]) => {
    const [d, sc] = k.split('+');
    return (cnt > 1 ? `${cnt}× ` : '') + FOODS[d].name + (sc ? ` + ${SAUCES[sc].name}` : '');
  }).join('\n');
}

const complete = c => c.items.every(i => i.served && (!i.sauce || i.sauced));
function tipFactor(c) { // full tip if the food came within 60 s (+15 s per extra dish), falling to nothing at 120 s
  const k = PATIENCE.perDish * (c.items.length - 1), m = patienceMult();
  const full = (PATIENCE.foodFull + k) * m, zero = (PATIENCE.foodZero + k) * m;
  return THREE.MathUtils.clamp((zero - (c.waitT || 0)) / (zero - full), 0, 1);
}
function startEating(c) { if (complete(c)) { c.tipP = tipFactor(c); c.state = 'eat'; c.eatT = gm(EAT_MIN); } }
function openItem(c, type, sauce, server) { // which unserved dish a plate fills (the same sauce first); the server needs an exact match
  const ok = it => !it.served && it.dish === type && !(server && it.claimed);
  let i = c.items.findIndex(it => ok(it) && (it.sauce || null) === (sauce || null));
  if (i < 0 && !server) i = c.items.findIndex(ok);
  return i;
}
function serve(c, i, plate) { // plate: { type, q, mesh } from the player's hands or a table tray
  const it = c.items[i], seat = c.table.seats[it.seat % 4];
  const k = c.items.filter(x => x !== it && x.served && x.seat % 4 === it.seat % 4).length;
  it.served = true;
  it.q = plate.q;
  it.mesh = plate.mesh;
  const p = seat.plate.clone().addScaledVector(seat.side, [0, 0.27, -0.27][k % 3]);
  plate.mesh.position.copy(p);
  plate.mesh.rotation.set(0, 0, 0);
  plate.mesh.scale.setScalar(1);
  scene.add(plate.mesh);
  c.foods.push(plate.mesh);
  if (k) { // a second dish at the same seat gets its own plate
    const pl = new THREE.Mesh(plateGeo, plateMat);
    pl.position.set(p.x, 0.797, p.z);
    scene.add(pl);
    c.foods.push(pl);
  }
  sfx.serve();
  startEating(c);
}
function serveSauce(c, i, cup) { // a cup of sauce next to a dish that is on the table
  const it = c.items[i];
  it.sauced = true;
  cup.position.set(0, 0, -0.13);
  cup.rotation.set(0, 0, 0);
  cup.scale.setScalar(1);
  it.mesh.add(cup);
  sfx.serve();
  startEating(c);
}

function billLines(c) { // receipt lines: dishes (by meat quality) and sauce cups
  const lines = {};
  for (const it of c.items) {
    if (!it.served) continue;
    const key = it.dish + it.q;
    (lines[key] ||= { name: FOODS[it.dish].name + (it.q ? ` ${QUALITY[it.q].name}` : ''), qty: 0, each: Math.round(FOODS[it.dish].price * QUALITY[it.q].price), icon: it.dish }).qty++;
    if (it.sauce && it.sauced) (lines[it.sauce] ||= { name: SAUCES[it.sauce].name, qty: 0, each: SAUCES[it.sauce].price, icon: it.sauce }).qty++;
  }
  return Object.values(lines);
}
const billTotal = c => billLines(c).reduce((n, l) => n + l.qty * l.each, 0);
function tipPct(c) { // happier guests tip more: quick service, better meat, a nicer room, no missing sauce
  const q = c.items.reduce((n, i) => n + i.q, 0) / c.items.length;
  const sat = 0.15 + 0.6 * c.tipP + 0.12 * q + (has('interior') ? 0.15 : 0) - (c.missedSauce ? 0.2 : 0);
  return sat > 0.8 ? 15 : sat > 0.6 ? 10 : sat > 0.4 ? 5 : 0;
}
function goPay(c) { // the party gets up: the guests head out, the leader queues at the register
  const total = billTotal(c);
  c.pay = Math.random() < dayCfg().cash
    ? { method: 'cash', tender: Math.random() < 0.2 ? total : [20, 50, 100].find(b => b >= total) || Math.ceil(total / 50) * 50 }
    : { method: 'card' };
  c.state = 'toPay';
  c.group.position.y = 0;
  const lane = c.table.seats[0].lane;
  c.path = [lane.clone(), new THREE.Vector3(lane.x, 0, AISLE_Z), REGISTER_SPOT.clone().add(new THREE.Vector3(0, 0, payQueue.length * 0.9))];
  payQueue.push(c);
  c.patience = c.maxPatience = PATIENCE.pay * patienceMult();
  c.foods.forEach(m => scene.remove(m));
  c.foods = [];
  c.table.customer = null; // the table is free for the next party
  c.members.forEach(m => memberExit(m, c));
  pos.dirty = true;
}
function completePayment(c, method, tip) {
  const total = billTotal(c);
  for (const l of billLines(c)) today.sold[l.icon] = (today.sold[l.icon] || 0) + l.qty; // for the end-of-day sales list
  if (method === 'cash') { drawer += total + tip; today.cash += total; } else { money += total + tip; today.card += total; }
  today.sales += total;
  today.tips += tip;
  transactions.push({ day, table: c.table.n, method, total, tip, time: clockMin });
  toast(`Paid ${fmtMoney(total)} by ${method}${tip ? ` + ${fmtMoney(tip)} tip` : ''}`, '#ffd76a');
  sfx.pay();
  leave(c, false);
}
function memberExit(m, c) {
  const seated = m.state === 'wait' || m.state === 'eat';
  m.state = 'exit';
  m.group.position.y = 0;
  m.path = seated ? exitPath(c.table.seats[m.seatI].lane) : [DOOR_IN.clone(), OUTSIDE.clone()];
}
function leave(c, angry) {
  const seated = c.state === 'wait' || c.state === 'eat';
  c.state = 'exit';
  c.group.position.y = 0;
  if (c.table.customer === c) c.table.customer = null;
  for (const q of [queue, payQueue]) { const i = q.indexOf(c); if (i >= 0) q.splice(i, 1); }
  c.path = seated ? exitPath(c.table.seats[0].lane) : [DOOR_IN.clone(), OUTSIDE.clone()];
  c.foods.forEach(m => scene.remove(m));
  c.foods = [];
  c.members.forEach(m => { if (m.state !== 'exit') memberExit(m, c); });
  setBubble(c, angry ? '>:(' : null);
  c.mood.visible = false;
  if (angry) { today.lost += 1 + c.members.length; toast('A guest left angry!', '#f66'); sfx.bad(); }
  pos.dirty = true;
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
  const slot = (spot, q, step) => [spot.clone().add(new THREE.Vector3(0, 0, q.indexOf(c) * step))];
  if (c.state === 'queue' || c.state === 'order') c.path = slot(COUNTER_SPOT, queue, 1.1);
  if (c.state === 'payLine' || c.state === 'paying') c.path = slot(REGISTER_SPOT, payQueue, 0.9);
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
        sit(c.group, c.table.seats[0]);
        setBubble(c, null);
        c.waitT = 0; // seconds waited for the food: sets the tip
        c.patience = c.maxPatience = (PATIENCE.foodLeave + PATIENCE.perDish * (c.items.length - 1)) * patienceMult();
      }
      break;
    case 'eat':
      if ((c.eatT -= dt) <= 0) goPay(c);
      break;
    case 'toPay':
      if (arrived) c.state = 'payLine';
      break;
    case 'payLine':
      if (arrived && payQueue[0] === c) {
        c.state = 'paying';
        c.group.rotation.y = Math.PI;
        setBubble(c, c.pay.method === 'card' ? 'CARD' : `CASH ${fmtMoney(c.pay.tender)}`);
        pos.dirty = true;
      }
      break;
    case 'exit':
      if (arrived && c.members.every(m => !m.path.length)) {
        scene.remove(c.group);
        c.members.forEach(m => scene.remove(m.group));
        customers.splice(customers.indexOf(c), 1);
      }
      break;
  }
  c.members.forEach(m => { // party members follow their leader
    const o = MEMBER_OFFSETS[m.seatI];
    if (c.state === 'queue' || c.state === 'order') m.path = [COUNTER_SPOT.clone().add(new THREE.Vector3(o[0], 0, queue.indexOf(c) * 1.1 + o[1]))];
    if (stepPath(m, dt) && m.state === 'toTable') { m.state = 'wait'; sit(m.group, c.table.seats[m.seatI]); }
    if (m.state === 'wait' && c.state === 'eat') m.state = 'eat';
    poseCustomer(m, dt);
  });

  if (['queue', 'order', 'wait', 'payLine', 'paying'].includes(c.state)) {
    c.patience -= dt;
    if (c.state === 'wait') c.waitT += dt;
    const p = c.patience / c.maxPatience;
    c.mood.visible = p < 0.5;
    c.mood.material = p < 0.25 ? MOOD.angry : MOOD.warn;
    c.mood.scale.setScalar(p < 0.25 ? 0.25 + Math.sin(performance.now() / 110) * 0.04 : 0.22);
    if (c.patience <= 0) {
      const unpaid = c.state === 'payLine' || c.state === 'paying';
      leave(c, true);
      if (unpaid) toast('A guest walked out without paying!', '#f66', 3);
    }
  } else c.mood.visible = false;
  poseCustomer(c, dt);
}

// ---------- Back of house, entrance, delivery ----------
// Wooden signs: the HUD's sign panel drawn as a 9-slice on a canvas, Lilita One lettering (cream, dark outline) and an
// optional icon. Every sign is redrawn once the panel art, the font and its icon are in; setSign() re-letters one in place.
const CREAM = '#fff6e0';
const SIGN_ICON = { KITCHEN: 'chef', STORAGE: 'sack', OFFICE: 'calendar', 'PREP STATION': 'plate', PEDIDOS: 'bell', CAJA: 'coin', DELIVERY: 'sack', PARRILLA: 'flame', SERVICE: 'bell', SAUCES: 'chimi' };
const signArt = new Image(), signIcons = {}, woodSigns = [];
function signIcon(name) {
  if (!signIcons[name]) {
    const im = signIcons[name] = new Image();
    im.onload = () => woodSigns.filter(w => w.icon === name).forEach(drawWood);
    im.src = `ui/${name}.webp`;
  }
  return signIcons[name];
}
function drawWood(w) {
  const c = w.tex.image, g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  if (signArt.naturalWidth) { // 9-slice: the corners keep their shape, edges and centre stretch
    const sw = signArt.naturalWidth, sh = signArt.naturalHeight, sl = sw * 0.094, st = sh * 0.18, dt = H * 0.2, dl = dt * 1.15;
    const sx = [0, sl, sw - sl, sw], sy = [0, st, sh - st, sh], dx = [0, dl, W - dl, W], dy = [0, dt, H - dt, H];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.drawImage(signArt, sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
  } else { g.fillStyle = '#6b4528'; g.fillRect(0, 0, W, H); }
  const im = w.icon && signIcon(w.icon), isz = H * 0.62, gap = im ? isz + H * 0.08 : 0;
  let size = H * 0.5;
  g.font = `${size}px "Lilita One", "Arial Rounded MT Bold", sans-serif`;
  const tw = g.measureText(w.text).width, room = W - H * 0.5 - gap;
  if (tw > room) { size = Math.floor(size * room / tw); g.font = `${size}px "Lilita One", "Arial Rounded MT Bold", sans-serif`; }
  const total = gap + Math.min(tw, room), x0 = (W - total) / 2;
  if (im && im.complete && im.naturalWidth) g.drawImage(im, x0, (H - isz) / 2, isz, isz);
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = size * 0.16; g.strokeStyle = '#2a1408'; g.strokeText(w.text, x0 + gap, H * 0.53);
  g.fillStyle = w.color; g.fillText(w.text, x0 + gap, H * 0.53);
  w.tex.needsUpdate = true;
}
function woodTex(text, aspect, icon = null, color = CREAM) {
  const c = document.createElement('canvas');
  c.height = 128;
  c.width = Math.round(128 * aspect);
  const tex = new THREE.CanvasTexture(c), w = { tex, text, icon, color };
  tex.colorSpace = THREE.SRGBColorSpace;
  woodSigns.push(w);
  drawWood(w);
  return w;
}
function setSign(face, text, icon = face.userData.sign.icon, color = CREAM) { // re-letter a wooden sign
  const w = face.userData.sign;
  if (w.text === text && w.icon === icon && w.color === color) return;
  Object.assign(w, { text, icon, color });
  drawWood(w);
}
Promise.all([new Promise(r => { signArt.onload = signArt.onerror = r; }), document.fonts.load('64px "Lilita One"').catch(() => {})]).then(() => woodSigns.forEach(drawWood));
signArt.src = 'ui/sign.webp';
function panel(text, w, h) { // flat wooden sign facing +z
  const sign = woodTex(text, w / h);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true }));
  m.userData.sign = sign;
  scene.add(m);
  return m;
}
const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.6, roughness: 0.35 });
const wood = mat(0x6b3f22), dark = mat(0x222222);
const hitMat = new THREE.MeshBasicMaterial({ visible: false }); // invisible, but still hit by the interaction ray
// physical signs instead of floating labels: a painted face in a wooden frame (two-sided when it hangs free)
function plaque(text, w, h, x, y, z, ry = 0, bg = '#2a1a10', fg = '#f4e4c8', twoSided = false, parent = scene) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  part(new THREE.BoxGeometry(w * 0.94, h * 0.84, 0.03), wood, 0, 0, 0, g); // hidden behind the sign's rounded panel
  const sign = woodTex(text, w / h, SIGN_ICON[text] || null);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: sign.tex, transparent: true }));
  face.userData.sign = sign;
  face.position.z = 0.021;
  g.add(face);
  if (twoSided) {
    const back = new THREE.Mesh(face.geometry, face.material);
    back.position.z = -0.021;
    back.rotation.y = Math.PI;
    g.add(back);
  }
  g.userData.face = face;
  parent.add(g);
  return g;
}
plaque('KITCHEN', 1.1, 0.3, 1.8, 2.7, -5.885);
plaque('STORAGE', 1.2, 0.3, -2.2, 2.35, -11.885);
plaque('OFFICE', 1, 0.28, -5.4, 2.75, -8.685);
plaque('PREP STATION', 1.3, 0.28, 4.2, 2.55, -6.115, Math.PI);
plaque('PEDIDOS', 1, 0.26, -3.9, 0.62, -3.085, 0, '#7a1f1f');
plaque('CAJA', 0.6, 0.26, -5.4, 0.62, -3.085, 0, '#7a1f1f');
plaque('DELIVERY', 1.2, 0.4, 13.6, 2.5, -9.5, -Math.PI / 2, '#f2c230', '#1a1a1a', true);
plaque('PARRILLA', 1.4, 0.3, 4.8, 2.95, -4.918).rotation.x = -0.566; // on the slanted front of the hood

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
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.4), new THREE.MeshBasicMaterial({ map: labelTex(t, bg, '#fff', 0.86 / 0.4) }));
  f.position.set(0, -0.1, z);
  f.rotation.y = ry;
  signPivot.add(f);
}
signPivot.userData.kind = 'sign';
scene.add(signPivot);

// cold storage: stainless refrigerated shelving, one compartment per wholesale item, in front of white cold-room
// wall panels under a slightly cool light
colliders.push({ minX: 0.45, maxX: 5.55, minZ: -11.95, maxZ: -11.15, on: true });
const stainless = new THREE.MeshStandardMaterial({ map: tex('steel', 2, 1), metalness: 0.45, roughness: 0.45 });
const coldPanels = texMat('coldroom', 4, 2.5);
coldPanels.emissive.setHex(0x1c2a36); // a faint cool glow
part(new THREE.BoxGeometry(5.1, 2.1, 0.06), coldPanels, 3, 1.05, -11.92);
part(new THREE.PlaneGeometry(5.6, WH), coldPanels, 3, WH / 2, -11.887).castShadow = false; // the whole wall behind it
part(new THREE.BoxGeometry(5.1, 0.3, 0.8), stainless, 3, 1.95, -11.55);
part(new THREE.BoxGeometry(5.1, 0.25, 0.8), stainless, 3, 0.125, -11.55);
const BIN_W = 5.1 / ITEM_KEYS.length;
for (let i = 0; i <= ITEM_KEYS.length; i++) part(new THREE.BoxGeometry(0.05, 2.1, 0.8), stainless, 0.45 + i * BIN_W, 1.05, -11.55);
for (const y of [0.5, 1.15]) part(new THREE.BoxGeometry(5.1, 0.03, 0.7), stainless, 3, y, -11.6);
const coldLight = new THREE.PointLight(0xdcecff, 3, 5);
coldLight.position.set(3, 2.7, -10.6);
scene.add(coldLight);
// PVC strip curtain in the back doorway: the kitchen is closed off from the yard, and anyone still walks through
const stripMat = new THREE.MeshStandardMaterial({ color: 0xcfe4ec, transparent: true, opacity: 0.5, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false });
for (let i = 0; i < 7; i++) part(new THREE.PlaneGeometry(0.22, 2.36), stripMat, 7.9, 1.21, -10.32 + i * 0.207).rotation.y = Math.PI / 2;
const capPlaque = plaque('', 2.2, 0.36, 3, 2.45, -11.885, 0, '#0b3d5c', '#e6f6ff');
const bins = ITEM_KEYS.map((id, i) => {
  const x = 0.45 + BIN_W * (i + 0.5);
  const hit = part(new THREE.BoxGeometry(BIN_W - 0.07, 1.7, 0.75), hitMat, x, 0.95, -11.5);
  hit.userData = { kind: 'bin', ref: id };
  const label = panel('', BIN_W - 0.06, 0.3); // readable from the doorway
  label.position.set(x, 1.95, -11.14);
  const shows = [0, 1, 2, 3].map(k => {
    const m = makeItemMesh(id);
    m.position.set(x + (k % 2 ? 0.15 : -0.15), k < 2 ? 0.59 : 1.24, -11.48); // up front where they are easy to see
    m.scale.multiplyScalar(ITEMS[id].whole ? 0.7 : ITEMS[id].sauce ? 1 : 0.9);
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
onProp('prep_table', L => { // the stainless prep table: work surface at 0.9 under the board and trays, back edge against the wall
  prepTable.material = hitMat; // still the collider and the prep hit area
  const m = makeProp(L);
  m.scale.set(2, 1.557, 1.205);
  m.position.set(4.2, 0, -6.55);
  scene.add(m);
});
part(new THREE.PlaneGeometry(3, 1.35), texMat('kitchen_tiles', 3 / 1.35, 1), 4.2, 1.575, -6.102).rotation.y = Math.PI; // tiled wall behind the prep station
prepTable.userData.kind = 'prep';
const board = part(new THREE.BoxGeometry(0.55, 0.03, 0.38), mat(0xc49a6c), 4.2, 0.915, -6.6);
board.userData.kind = 'prep';
const boardKnife = part(new THREE.BoxGeometry(0.03, 0.01, 0.26), steel, 4.42, 0.935, -6.62);
onProp('board', L => { // the Higgsfield cutting board, flattened to the old board's height; the box stays the prep hit area
  board.material = hitMat;
  const m = makeProp(L);
  m.position.set(4.2, 0.9, -6.6);
  m.scale.y = 0.5;
  scene.add(m);
});
onProp('knife', L => { // the cuchillo criollo lies on the board (and is hidden with it while the hands cut)
  boardKnife.geometry = new THREE.BufferGeometry();
  boardKnife.add(makeProp(L));
});
const trayObjs = ['filet', 'vacio'].map((d, i) => {
  const x = i ? 4.95 : 3.45;
  const t = part(new THREE.BoxGeometry(0.44, 0.03, 0.34), steel, x, 0.915, -6.55);
  t.userData = { kind: 'tray', ref: d };
  const label = plaque('', 0.5, 0.17, x, 0.72, -6.915, Math.PI, '#1a1a1a', '#e8f1f2'); // on the front of the prep table
  const shows = Array.from({ length: 8 }, (_, k) => {
    const m = makeFoodMesh(d);
    m.scale.setScalar(d === 'vacio' ? 0.4 : 0.55);
    m.position.set(x - 0.15 + (k % 4) * 0.1, 0.95, -6.62 + Math.floor(k / 4) * 0.13);
    scene.add(m);
    return m;
  });
  return { d, t, label, shows };
});

// dry storage: wooden shelving with meat crates and cardboard boxes (a second unit arrives with "More Storage Capacity")
const crateMat = texMat('crate'), cardboardMat = texMat('cardboard');
function shelf(x, z, w) {
  const g = new THREE.Group();
  for (const dx of [-w / 2, w / 2]) part(new THREE.BoxGeometry(0.05, 2, 0.5), brickMats(0.05, 2, 0.5, 1, 'counter_wood'), x + dx, 1, z, g);
  for (const y of [0.3, 0.95, 1.6]) {
    part(new THREE.BoxGeometry(w, 0.04, 0.5), brickMats(w, 0.04, 0.5, 1, 'counter_wood'), x, y, z, g);
    for (let i = 0; i < 3; i++) {
      const sz = 0.26 + ((i + y * 10) % 3) * 0.05, k = Math.round(i + y * 10);
      part(new THREE.BoxGeometry(sz, sz * 0.8, 0.36), k % 2 ? crateMat : cardboardMat, x - w / 2 + 0.35 + i * (w - 0.7) / 2, y + 0.02 + sz * 0.4, z, g).rotation.y = (k % 5 - 2) * 0.07;
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
const osScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.36), new THREE.MeshBasicMaterial({ map: labelTex('ASADO OS\nUPGRADES · WHOLESALE\nFINANCES', '#10231a', '#9fe0b0', 0.56 / 0.36) }));
osScreen.position.z = 0.026;
monitor.add(osScreen);
monitor.userData.kind = 'terminal';
scene.add(monitor);

// "Better Interior": plants, pendant lamps, framed pictures
const decor = new THREE.Group();
decor.visible = false;
scene.add(decor);
onProp('plant', L => { // two more plants (the dining corners always have theirs, see the interior)
  for (const [x, z] of [[7.35, -1.9], [-2.4, -5.5]]) {
    const m = makeProp(L);
    m.position.set(x, 0, z);
    m.scale.setScalar(0.75);
    m.rotation.y = Math.PI / 2;
    decor.add(m);
  }
});
for (const [x, ry] of [[-7.88, Math.PI / 2], [7.88, -Math.PI / 2]]) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85), new THREE.MeshBasicMaterial({ map: labelTex('ASADO\ndesde 1987', '#5a2a1a', '#f4e4c8', 1.3 / 0.85) }));
  p.position.set(x, 1.9, 1.5);
  p.rotation.y = ry;
  decor.add(p);
}

// ---------- Service counter, sauce station, interior ----------
// The pass: one numbered tray per table on the service counter between the grill and the dining room
const PASS_Z = -3.4, PASS_Y = 1.05;
const capWood = mat(0x3a2a1a);
const pass = box(5.3, 1, 0.5, brickMats(5.3, 1, 0.5, 1, 'counter_wood'), 5.25, 0.5, PASS_Z);
pass.userData.kind = 'pass';
box(5.36, 0.05, 0.62, steel, 5.25, 1.025, PASS_Z, false);
for (const x of [2.7, 7.8]) box(0.05, 0.85, 0.05, iron, x, 1.475, PASS_Z, false); // heat-lamp gantry
box(5.15, 0.05, 0.07, iron, 5.25, 1.92, PASS_Z, false);
for (const x of [3.5, 5.25, 7]) {
  part(new THREE.ConeGeometry(0.11, 0.12, 10, 1, true), iron, x, 1.84, PASS_Z);
  part(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb060 }), x, 1.8, PASS_Z).castShadow = false;
}
plaque('SERVICE', 1, 0.24, 4.1, 2.09, PASS_Z, 0, '#2a1a10', '#ffd76a', true);
// low dividers close the staff side off from the dining room (staff gap at x 0.55..1.85)
for (const [w, x] of [[3.55, -1.225], [0.75, 2.225]]) {
  box(w, 1.05, 0.12, brickMats(w, 1.05, 0.12, 1, 'counter_wood'), x, 0.525, PASS_Z);
  box(w + 0.06, 0.05, 0.2, capWood, x, 1.075, PASS_Z, false);
}
// table trays: dishes (each gets a plate) and sauce cups collect per table; a complete tray is READY and goes out in one trip
const DISH_SPOTS = [[-0.36, -0.11], [0, -0.11], [0.36, -0.11], [-0.36, 0.11], [0, 0.11], [0.36, 0.11]];
const CUP_SPOTS = [[-0.18, -0.11], [0.18, -0.11], [-0.18, 0.11], [0.18, 0.11]];
const trayMat = mat(0x3b3f45);
const passTrays = tables.map((tb, i) => {
  const x = 3.3 + i * 1.3, g = new THREE.Group();
  g.position.set(x, PASS_Y, PASS_Z);
  part(new THREE.BoxGeometry(1.1, 0.02, 0.5), trayMat, 0, 0.01, 0, g);
  for (const [w, d, px, pz] of [[1.1, 0.02, 0, -0.24], [1.1, 0.02, 0, 0.24], [0.02, 0.5, -0.54, 0], [0.02, 0.5, 0.54, 0]]) part(new THREE.BoxGeometry(w, 0.035, d), trayMat, px, 0.028, pz, g);
  scene.add(g);
  const labels = [plaque('', 0.6, 0.16, x, 0.84, PASS_Z - 0.265, Math.PI), plaque('', 0.6, 0.16, x, 0.84, PASS_Z + 0.265)]; // kitchen and dining side
  const t = { n: tb.n, x, home: g.position.clone(), group: g, labels, items: [], owner: null, ready: false, claimed: false, away: false, key: '' };
  g.userData = { kind: 'passTray', ref: t };
  g.visible = tb.active; // tray 4 comes with "More Tables"
  labels.forEach(l => { l.visible = tb.active; });
  return t;
});
function trayGuest(t) { // the party this tray is for: sitting down or seated, food not complete
  const c = tables[t.n - 1].customer;
  return c && c.items && (c.state === 'toTable' || c.state === 'wait') ? c : null;
}
const onTray = (t, kind, type) => t.items.filter(x => x.kind === kind && x.type === type).length;
const dishNeed = (t, c, d) => c.items.filter(i => !i.served && i.dish === d).length - onTray(t, 'dish', d);
const cupNeed = (t, c, k) => c.items.filter(i => i.sauce === k && !i.sauced).length - onTray(t, 'cup', k);
function trayMissing(t, c) { // what the table still needs on its tray
  const out = [], add = (k, name) => { if (k > 0) out.push((k > 1 ? `${k}× ` : '') + name); };
  for (const d in FOODS) add(dishNeed(t, c, d), FOODS[d].name);
  for (const k in SAUCES) add(cupNeed(t, c, k), SAUCES[k].name);
  return out;
}
function trayFit(t, c, h) { // how many of the carried items this table's tray takes
  if (!c || t.away) return 0;
  if (h.kind === 'sauce') return cupNeed(t, c, h.type) > 0 ? 1 : 0;
  const per = {};
  h.items.forEach(x => { per[x.type] = (per[x.type] || 0) + 1; });
  return Object.entries(per).reduce((n, [d, k]) => n + Math.max(0, Math.min(k, dishNeed(t, c, d))), 0);
}
function layoutTray(t) { // plates in two rows of three, sauce cups in the gaps between them
  let d = 0, k = 0;
  for (const x of t.items) {
    const [px, pz] = x.kind === 'dish' ? DISH_SPOTS[d++ % DISH_SPOTS.length] : CUP_SPOTS[k++ % CUP_SPOTS.length];
    if (x.plate) { t.group.add(x.plate); x.plate.position.set(px, 0.026, pz); x.plate.scale.setScalar(0.7); }
    t.group.add(x.mesh);
    x.mesh.position.set(px, x.plate ? 0.045 : 0.036, pz);
    x.mesh.rotation.set(0, 0, 0);
    x.mesh.scale.setScalar(x.plate ? 0.7 : 1);
  }
}
function trayPut(t, h) { // every dish of the stack this table still needs goes on its tray; the rest stays in the stack
  const c = trayGuest(t);
  if (!c || t.away) return;
  h.items = h.items.filter(x => {
    if (dishNeed(t, c, x.type) <= 0) return true;
    t.owner = c;
    t.items.push({ kind: 'dish', type: x.type, q: x.q, mesh: x.mesh, plate: new THREE.Mesh(plateGeo, plateMat) });
    return false;
  });
  layoutTray(t);
  restack(h);
}
function placeOnTray(t) { // the player puts carried dishes, or a sauce cup, on a table's tray
  const h = held;
  if (h.kind === 'sauce') {
    dropHeld();
    t.owner = trayGuest(t);
    t.items.push({ kind: 'cup', type: h.type, mesh: h.mesh });
    layoutTray(t);
  } else {
    trayPut(t, h);
    if (h.items.length) reach(); else dropHeld();
  }
  syncTray(t);
  sfx.serve();
}
function clearTray(t) { // anything left on it is thrown out
  for (const x of t.items) { t.group.remove(x.mesh); if (x.plate) t.group.remove(x.plate); }
  t.items = [];
  t.owner = null;
}
function syncTray(t) { // clear leftovers of a party that is gone, work out READY, re-letter the tray signs when that changes
  const c = trayGuest(t);
  if (!t.away && t.items.length && t.owner !== c) clearTray(t);
  if (!t.away) t.ready = !!c && t.items.length > 0 && !trayMissing(t, c).length;
  const key = t.away ? 'out' : t.ready ? 'ready' : 'wait';
  if (key === t.key) return;
  t.key = key;
  for (const l of t.labels) setSign(l.userData.face, `TABLE ${t.n}${t.away ? ' · OUT' : t.ready ? ' · READY' : ''}`, 'tray', t.away ? '#b9ab95' : t.ready ? '#7dff8a' : CREAM);
}
passTrays.forEach(syncTray);
function serveTray(t, c) { // everything on the tray goes on the table: dishes first, then their sauce cups
  for (const x of t.items) if (x.kind === 'dish') {
    t.group.remove(x.plate);
    const i = openItem(c, x.type, null, false);
    if (i >= 0) serve(c, i, x); else t.group.remove(x.mesh);
  }
  for (const x of t.items) if (x.kind === 'cup') {
    const i = c.items.findIndex(it => it.served && it.sauce === x.type && !it.sauced);
    if (i >= 0) serveSauce(c, i, x.mesh); else t.group.remove(x.mesh);
  }
  t.items = [];
  t.owner = null;
}
function takeTray(t) { t.away = true; syncTray(t); hold({ kind: 'tray', tray: t, mesh: t.group }); }
function returnTray(t) { // back to its spot on the pass
  t.away = t.claimed = false;
  t.group.scale.setScalar(1);
  t.group.rotation.set(0, 0, 0);
  t.group.position.copy(t.home);
  scene.add(t.group);
  syncTray(t);
}
function putTrayBack() { const t = held.tray; dropHeld(); returnTray(t); }
function serveHeldTray(c) { const t = held.tray; dropHeld(); serveTray(t, c); returnTray(t); }

// sauce station: bottles stand in holders; fill a cup, then put it on its table's tray (or take it to the table)
const sauceLevel = Object.fromEntries(Object.keys(SAUCES).map(k => [k, 0])); // cups left in each station bottle
const station = box(1.8, 0.95, 0.5, steel, -0.4, 0.475, -5.64);
station.userData.kind = 'sauceStation';
plaque('SAUCES', 0.9, 0.24, -0.4, 1.75, -5.885);
const holders = Object.keys(SAUCES).map((k, i) => {
  const x = -1 + i * 0.6;
  part(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 14), dark, x, 0.96, -5.64);
  const bottle = makeBottle(k);
  bottle.position.set(x, 1.045, -5.64);
  scene.add(bottle);
  const hit = part(new THREE.BoxGeometry(0.42, 0.5, 0.45), hitMat, x, 1.2, -5.64);
  hit.userData = { kind: 'sauce', ref: k };
  const label = plaque('', 0.48, 0.16, x, 0.75, -5.385, 0, '#1a1a1a', '#e8f1f2');
  return { s: k, x, bottle, hit, label };
});
for (let i = 0; i < 4; i++) part(cupGeo, cupMat, 0.3, 0.966 + i * 0.022, -5.62); // a stack of empty cups
function refreshSauces() {
  for (const h of holders) {
    const n = sauceLevel[h.s];
    h.bottle.visible = n > 0;
    setSign(h.label.userData.face, `${n}/${ITEMS[h.s + '_bottle'].cups}`, h.s, n ? CREAM : '#ff8a80');
  }
}
refreshSauces();
function placeBottle() {
  const s = ITEMS[held.type].sauce;
  sauceLevel[s] = ITEMS[held.type].cups;
  dropHeld();
  refreshSauces();
  sfx.store();
  toast(`${SAUCES[s].name} bottle placed at the sauce station`);
}
function pourBack() {
  sauceLevel[held.type] = Math.min(ITEMS[held.type + '_bottle'].cups, sauceLevel[held.type] + 1);
  dropHeld();
  refreshSauces();
}
function startPour(s) { // fill a cup from the station bottle; the view locks onto the bottle while the hands pour
  const h = holders.find(k => k.s === s), p = camera.position;
  sauceLevel[s]--;
  refreshSauces();
  handSauce.color.setHex(SAUCES[s].color);
  busy = { kind: 'pour', t: 0, dur: 1.2, sauce: s,
    yaw: Math.atan2(p.x - h.x, p.z + 5.64), pitch: -Math.atan2(EYE - 1.05, Math.hypot(h.x - p.x, -5.64 - p.z)) };
  sfx.pour();
}

// filete menu board behind the front counter: the painted board with today's prices chalked in;
// a dish that isn't on today's menu is wiped off the board
const menuCanvas = document.createElement('canvas');
menuCanvas.width = 765;
menuCanvas.height = 1024;
const menuTex = new THREE.CanvasTexture(menuCanvas);
menuTex.colorSpace = THREE.SRGBColorSpace;
box(1.21, 1.6, 0.05, wood, -4.6, 1.95, -5.875, false);
part(new THREE.PlaneGeometry(1.15, 1.54), new THREE.MeshBasicMaterial({ map: menuTex }), -4.6, 1.95, -5.849).castShadow = false;
const menuArt = new Image();
menuArt.crossOrigin = 'anonymous';
menuArt.onload = () => drawMenu();
menuArt.src = 'textures/menu_board.jpg';
// [line centre y, end of the painted name x] in the 896×1200 painting
const MENU_ROWS = { filet: [395, 526], vacio: [494, 542], bife: [590, 710], chorizo: [688, 580], provoleta: [784, 615], chimi: [954, 590], criolla: [1022, 600] };
function drawMenu() { // dishes and sauces at today's prices
  if (!menuArt.naturalWidth) return;
  const g = menuCanvas.getContext('2d'), on = menu();
  g.setTransform(765 / 896, 0, 0, 1024 / 1200, 0, 0);
  g.drawImage(menuArt, 0, 0, 896, 1200);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  for (const [k, [y, x]] of Object.entries(MENU_ROWS)) {
    if (FOODS[k] && !on.includes(k)) { g.fillStyle = '#1d1e1e'; g.fillRect(140, y - 38, 620, 76); continue; }
    g.fillStyle = '#f2dc8c'; g.font = `bold ${SAUCES[k] ? 30 : 34}px Georgia, serif`;
    g.fillText(`$${(FOODS[k] || SAUCES[k]).price}`, x + 14, y + 2);
  }
  if (lvl('quality')) {
    g.fillStyle = '#f2dc8c'; g.font = 'italic 24px Georgia, serif'; g.textAlign = 'center';
    g.fillText(`${QUALITY.slice(1, lvl('quality') + 1).map(q => q.name).join(', ')} cuts are priced higher`, 448, 841);
  }
  menuTex.needsUpdate = true;
}
drawMenu();

// wine shelf behind the counter, charcoal sacks next to the brasero
const wines = [0x3b1520, 0x203a22, 0x5a1a1a].map(mat), wineGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8);
for (const y of [1.25, 1.75]) box(1, 0.04, 0.28, wood, -7.3, y, -5.76, false);
for (let i = 0; i < 12; i++) part(wineGeo, wines[i % 3], -7.7 + (i % 6) * 0.16, i < 6 ? 1.4 : 1.9, -5.76);
for (const [x, z, r] of [[7.4, -5.5, 0.3], [7.45, -4.95, -0.2]]) part(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 8), mat(0x5b5040), x, 0.275, z).rotation.y = r;

// closed wooden plank ceiling with beams over the whole building: the restaurant reads as an enclosed room
const ceilWood = texMat('wood', 16.4 / 1.4, 18.4 / 1.4);
ceilWood.emissiveMap = ceilWood.map;
ceilWood.emissive.setHex(0x4a4038); // the planks never go black in the corners
box(16.4, 0.1, 18.4, ceilWood, 0, WH + 0.05, -3, false).castShadow = false;
const beamWood = brickMats(16, 0.2, 0.16, 1.4, 'wood'), lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6 });
beamWood.forEach(m => m.color.setHex(0x9a7860));
for (const z of [-4.4, -1.4, 1.6, 4.6]) box(16, 0.2, 0.16, beamWood, 0, WH - 0.1, z, false).castShadow = false;
part(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 14), lampMat, -4.6, WH - 0.03, -4.6).castShadow = false; // over the staff side of the counter
// pendant lamps over the tables: dark green enamel domes on black cords, one warm light each (4 at most, no shadows);
// table 4's lamp comes with the table
const enamel = new THREE.MeshStandardMaterial({ color: 0x1d4a30, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide });
const cordMat = mat(0x111111), bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
const domeGeo = new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), cordGeo = rod(0.008, WH - 2.6);
for (const t of tables) {
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  part(cordGeo, cordMat, 0, (WH + 2.6) / 2, 0, g);
  part(domeGeo, enamel, 0, 2.34, 0, g);
  part(new THREE.SphereGeometry(0.06, 10, 8), bulbMat, 0, 2.4, 0, g);
  g.traverse(o => { o.castShadow = false; });
  const light = new THREE.PointLight(0xffc98a, 3.5, 7);
  light.position.y = 2.36;
  g.add(light);
  g.visible = t.active;
  t.lamp = g;
  scene.add(g);
}
// windows (bright glass in wooden frames) and wainscoting around the dining room
const glass = new THREE.MeshBasicMaterial({ color: 0xcfe6f2 });
function windowAt(x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 1.75, z);
  g.rotation.y = ry;
  part(new THREE.PlaneGeometry(1.3, 1.1), glass, 0, 0, 0, g).castShadow = false;
  for (const [w, h, px, py] of [[1.42, 0.07, 0, 0.585], [1.42, 0.07, 0, -0.585], [0.07, 1.24, 0.685, 0], [0.07, 1.24, -0.685, 0], [0.04, 1.1, 0, 0], [1.3, 0.04, 0, 0]]) {
    part(new THREE.BoxGeometry(w, h, 0.05), wood, px, py, 0.02, g);
  }
  part(new THREE.BoxGeometry(1.5, 0.05, 0.14), wood, 0, -0.63, 0.06, g);
  scene.add(g);
}
for (const x of [-4.1, 0.2, 4.4]) windowAt(x, 5.89, Math.PI);
for (const z of [-1.4, 4.3]) windowAt(7.89, z, -Math.PI / 2);
windowAt(-7.89, 3.4, Math.PI / 2);
const wainscot = mat(0x5a3a22);
for (const [w, d, x, z] of [[0.03, 11.8, -7.885, 0], [0.03, 11.8, 7.885, 0], [12.9, 0.03, 1.45, 5.885], [0.9, 0.03, -7.45, 5.885]]) {
  box(w, 1, d, wainscot, x, 0.5, z, false).castShadow = false;
  box(w + 0.04, 0.04, d + 0.04, capWood, x, 1.02, z, false);
}
// pictures on flat planes: the filete logo above the entrance and on a sign hung over the front counter, two posters
function picture(name, w, h, x, y, z, ry) {
  const g = new THREE.Group(), m = texMat(name);
  m.emissiveMap = m.map;
  m.emissive.setHex(0x3a3a3a); // readable in the dim corners
  g.position.set(x, y, z);
  g.rotation.y = ry;
  part(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.03), wood, 0, 0, -0.016, g);
  part(new THREE.PlaneGeometry(w, h), m, 0, 0, 0, g);
  g.traverse(o => { o.castShadow = false; });
  scene.add(g);
  return g;
}
picture('logo', 1.4, 0.782, -6, 2.97, 5.885, Math.PI);
picture('logo', 1.2, 0.67, -4.6, 2.935, -4.25, 0);
for (const dx of [-0.5, 0.5]) part(rod(0.006, 0.23), cordMat, -4.6 + dx, WH - 0.115, -4.25).castShadow = false;
picture('poster_tango', 0.66, 0.88, -7.885, 1.95, -0.4, Math.PI / 2);
picture('poster_futbol', 0.66, 0.88, 2.3, 1.95, 5.885, Math.PI);
// light blue and white pennant garland strung above the front counter
const garland = new THREE.CatmullRomCurve3(Array.from({ length: 21 }, (_, i) => new THREE.Vector3(-6.6 + i * 0.2, 3.4 - 0.32 * Math.sin(Math.PI * i / 20), -3.25)));
part(new THREE.TubeGeometry(garland, 40, 0.006, 4), cordMat, 0, 0, 0).castShadow = false;
const flagPos = [], flagCol = [], celeste = new THREE.Color(0x75aadb), white = new THREE.Color(0xf4f4f0);
for (let i = 0; i < 22; i++) {
  const q = garland.getPointAt((i + 0.5) / 22), c = i % 2 ? white : celeste;
  flagPos.push(q.x - 0.07, q.y, -3.25, q.x + 0.07, q.y, -3.25, q.x, q.y - 0.17, -3.25);
  for (let k = 0; k < 3; k++) flagCol.push(c.r, c.g, c.b);
}
const flagGeo = new THREE.BufferGeometry();
flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(flagPos, 3));
flagGeo.setAttribute('color', new THREE.Float32BufferAttribute(flagCol, 3));
flagGeo.computeVertexNormals();
part(flagGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 0, 0, 0).castShadow = false;
// props off every walking path, station and interaction ray: plants in the dining corners and on the left wall,
// the wine rack between the right wall's picture and window, the plate shelf high on the wall behind the counter
onProp('plant', L => {
  for (const [x, z, k, r] of [[7.35, 5.35, 1, 0], [-7.6, 5.45, 0.85, Math.PI], [-7.45, 1.8, 1, 0]]) {
    const m = makeProp(L);
    m.position.set(x, 0, z);
    m.scale.setScalar(k);
    m.rotation.y = r;
    scene.add(m);
  }
});
onProp('winerack', L => { const m = makeProp(L); m.position.set(7.785, 1.15, 2.9); scene.add(m); });
onProp('plates', L => { const m = makeProp(L); m.position.set(-3, 1.7, -5.729); scene.add(m); });

// delivery crates (free starter crates wait in the yard on day 1)
function makeCrate(item, qs, starter) {
  const g = new THREE.Group();
  part(new THREE.BoxGeometry(0.55, 0.38, 0.42), mat(starter ? 0x9c6b3c : 0xb08850), 0, 0.19, 0, g);
  part(new THREE.BoxGeometry(0.57, 0.04, 0.44), mat(0x6b4a2a), 0, 0.37, 0, g);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshBasicMaterial({ map: labelTex(`${ITEMS[item].name.toUpperCase()}\n×${qs.length}${starter ? '\nFREE STARTER' : ''}`, '#f4e4c8', '#3a2a1a', 1.4) }));
  label.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); // printed on the lid, readable from the back door
  label.position.y = 0.393;
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
    setSign(b.label, `×${n}`, ITEMS[b.id].dish || ITEMS[b.id].sauce, n ? CREAM : '#b9ab95');
    b.shows.forEach((m, k) => { m.visible = k < n; });
  }
  setSign(capPlaque.userData.face, `COLD STORAGE  ${usedSpace()}/${capacity()}`);
}
function refreshTrays() {
  for (const t of trayObjs) {
    const n = trays[t.d].length;
    setSign(t.label.userData.face, `×${n}`, t.d);
    t.shows.forEach((m, k) => { m.visible = k < n; });
  }
}
refreshStorage();
refreshTrays();
function pickUpCrate(c) {
  crates.splice(crates.indexOf(c), 1);
  scene.remove(c.mesh);
  c.mesh.rotation.set(0, Math.PI / 2, 0); // lid text faces the player
  c.mesh.scale.setScalar(0.72);
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
function stack(kind, items) { // raw portions (one kind, up to MAX_CARRY) or grilled pieces (any mix), carried as a small pile
  const h = { kind, type: kind === 'portion' ? items[0].type : null, items, mesh: new THREE.Group() };
  restack(h);
  return h;
}
function restack(h) {
  h.mesh.clear();
  h.items.forEach((x, i) => {
    h.mesh.add(x.mesh);
    x.mesh.position.set(0, i * 0.045, 0);
    x.mesh.rotation.set(0, i * 0.6, 0);
    x.mesh.scale.setScalar(0.55);
  });
}
function takePortion(type, src, refresh, mk) { // E adds one raw portion to the stack in hand
  const h = held;
  if (!src.length || (h && !(h.kind === 'portion' && h.type === type && h.items.length < MAX_CARRY))) return;
  const x = { type, q: src.shift(), mesh: mk() };
  refresh();
  if (h) { h.items.push(x); restack(h); reach(); sfx.pick(); } else hold(stack('portion', [x]));
}
function takeFromBin(id) {
  const it = ITEMS[id];
  if (!it.whole && !it.sauce) return takePortion(it.dish, stock[id], refreshStorage, () => makeItemMesh(id));
  const q = stock[id].shift();
  refreshStorage();
  hold({ kind: it.whole ? 'whole' : 'bottle', type: id, q, mesh: makeItemMesh(id) });
}
function takeFromTray(d) { takePortion(d, trays[d], refreshTrays, () => makeFoodMesh(d)); }
function grillHeld() { // one E puts every carried raw portion on a free spot; the rest stays in hand
  const h = held;
  while (h.items.length && freeSlot() >= 0) startCooking(h.type, h.items.shift().q);
  if (h.items.length) { restack(h); reach(); } else dropHeld();
}
function serveHeld(c) { // straight from the hands: every carried dish the table still needs
  const h = held;
  h.items = h.items.filter(x => {
    const i = openItem(c, x.type, null, false);
    if (i < 0) return true;
    serve(c, i, x);
    return false;
  });
  if (h.items.length) { restack(h); reach(); } else dropHeld();
}
const binOf = h => (h.kind === 'whole' || h.kind === 'bottle' ? h.type : ITEMS[h.type] && !ITEMS[h.type].whole ? h.type : null); // null: goes on a tray
function putBack() { // a stack goes back whole
  const h = held, b = binOf(h), qs = h.items ? h.items.map(x => x.q) : [h.q];
  (b ? stock[b] : trays[h.type]).unshift(...qs);
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
  busy = { kind: 'cut', t: 0, dur: has('prep') ? 1.5 : 3, whole: h, s0: h.mesh.scale.x, chop: 0,
    yaw: Math.atan2(p.x - 4.2, p.z + 6.6), pitch: -Math.atan2(EYE - 0.95, Math.hypot(4.2 - p.x, -6.6 - p.z)) };
}
function updateBusy(dt) {
  const b = busy, k = Math.min(1, dt * 6);
  b.t += dt;
  yaw += Math.atan2(Math.sin(b.yaw - yaw), Math.cos(b.yaw - yaw)) * k;
  pitch += (b.pitch - pitch) * k;
  camera.rotation.set(pitch, yaw, 0);
  if (b.kind === 'pour') { // the hands tip the bottle over the cup (updateHands), then hold the filled cup
    if (b.t < b.dur) return;
    busy = null;
    hold({ kind: 'sauce', type: b.sauce, q: 0, mesh: makeCup(b.sauce) });
    return;
  }
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

// ---------- Staff: role-based employees (hire cost, daily wage, a small state machine per role) ----------
const staff = [];
const STAFF_HOME = { prep: new THREE.Vector3(2.2, 0, -8.8), server: new THREE.Vector3(2, 0, -2.7), grill: new THREE.Vector3(4.5, 0, -4.3) };
const hired = role => staff.some(e => e.role === role);
const wages = () => staff.reduce((n, e) => n + ROLES[e.role].wage, 0);
function hire(role) {
  const R = ROLES[role], rig = charLib.asador ? makeToy('asador', null, R.beret ? staffMap(R.beret) : null) : makePerson(R.shirt);
  if (R.hat && !rig.toy) part(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 10), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 0, 1.86, 0, rig.body); // chef hat
  const e = { role, rig, group: rig.root, state: 'idle', path: [], t: 1, task: null, carry: null };
  e.group.position.copy(STAFF_HOME[role]);
  scene.add(e.group);
  staff.push(e);
  return e;
}
const PREP_FRONT = new THREE.Vector3(4.2, 0, -7.35);
const STAFF_AI = {
  prep(e, dt) { // wait → check for a prep task → fetch the whole cut → cut it → return
    const arrived = stepPath(e, dt);
    if (e.state === 'idle' && (e.t -= dt) <= 0) {
      e.task = ['filet', 'vacio'].find(d => trays[d].length < 4 && stock[d + '_whole'].length);
      if (e.task) { e.state = 'fetch'; e.path = [new THREE.Vector3(bins[ITEM_KEYS.indexOf(e.task + '_whole')].x, 0, -10.6)]; } else e.t = 1;
    } else if (e.state === 'fetch' && arrived) {
      const it = e.task + '_whole';
      if (stock[it].length) {
        e.carry = { type: it, q: stock[it].shift(), mesh: makeItemMesh(it) };
        e.carry.mesh.position.set(0, 1.05, 0.3);
        e.rig.body.add(e.carry.mesh);
        refreshStorage();
        e.state = 'toPrep';
        e.path = [PREP_FRONT.clone()];
      } else { e.state = 'back'; e.path = [STAFF_HOME.prep.clone()]; }
    } else if (e.state === 'toPrep' && arrived) {
      e.state = 'prep';
      e.t = has('prep') ? 2 : 4;
      e.group.rotation.y = 0;
    } else if (e.state === 'prep' && (e.t -= dt) <= 0) {
      for (let i = portionsPer(); i > 0; i--) trays[e.task].push(e.carry.q);
      e.rig.body.remove(e.carry.mesh);
      e.carry = null;
      refreshTrays();
      e.state = 'back';
      e.path = [STAFF_HOME.prep.clone()];
    } else if (e.state === 'back' && arrived) { e.state = 'idle'; e.t = 2; }
  },
  server(e, dt) { // wait → carry a READY table tray to its table in one trip → bring the empty tray back
    const arrived = stepPath(e, dt), home = () => { e.state = 'back'; e.task = null; e.path = [new THREE.Vector3(e.group.position.x, 0, AISLE_Z), STAFF_HOME.server.clone()]; };
    if (e.state === 'idle' && (e.t -= dt) <= 0) {
      e.t = 0.5;
      const t = passTrays.find(t => t.ready && !t.claimed && !t.away);
      if (t) { t.claimed = true; e.task = { t, c: t.owner }; e.state = 'toPass'; e.path = [new THREE.Vector3(t.x, 0, -2.7)]; }
    } else if (e.state === 'toPass' && arrived) {
      const { t, c } = e.task;
      if (!t.ready || t.away || t.owner !== c) { t.claimed = false; return home(); }
      t.away = true;
      syncTray(t);
      e.carry = t;
      t.group.scale.setScalar(0.75);
      t.group.position.set(0, 1.07, 0.42);
      e.rig.body.add(t.group);
      const lane = c.table.seats[0].lane;
      e.state = 'deliver';
      e.path = [new THREE.Vector3(lane.x, 0, AISLE_Z), lane.clone()];
    } else if (e.state === 'deliver' && arrived) {
      const { t, c } = e.task;
      if (c.state === 'wait' && c.table.customer === c) serveTray(t, c); else clearTray(t); // the party left: the food is thrown out
      e.state = 'return';
      e.path = [new THREE.Vector3(e.group.position.x, 0, AISLE_Z), new THREE.Vector3(t.x, 0, -2.7)];
    } else if (e.state === 'return' && arrived) {
      returnTray(e.task.t);
      e.carry = null;
      home();
    } else if (e.state === 'back' && arrived) { e.state = 'idle'; e.t = 0.5; }
  },
  grill(e, dt) { // raw portions open orders need → free grill spots → off the grill when ready → the right table trays
    const arrived = stepPath(e, dt), spot = STAFF_HOME.grill, mine = grillFood.filter(f => f.owner === e);
    const carry = h => { e.carry = h; h.mesh.position.set(0, 1.05, 0.32); e.rig.body.add(h.mesh); };
    const drop = () => { e.rig.body.remove(e.carry.mesh); e.carry = null; };
    if ((e.state === 'idle' || e.state === 'back') && arrived) {
      e.state = 'idle';
      e.group.rotation.y = Math.PI; // facing the grill
      if ((e.t -= dt) > 0) return;
      e.t = 0.4;
      const ready = mine.filter(f => foodState(f) === 'ready');
      if (ready.length) { // never lets them burn: they come off as soon as they're ready
        carry(stack('cooked', ready.map(offGrill)));
        e.task = trayFor(e.carry);
        if (e.task) { e.state = 'toTray'; e.path = [new THREE.Vector3(e.task.x, 0, -4.1)]; } else drop(); // nobody needs them anymore
        return;
      }
      const need = grillNeed(), free = freeSlots();
      const d = Object.keys(FOODS).filter(k => need[k] > 0 && portionSrc(k).length).sort((a, b) => need[b] - need[a])[0];
      if (!d || !free || mine.some(f => burnIn(f) < (d in trays ? 10 : 13) + 3)) return; // leaves only if nothing of its own could burn meanwhile
      e.task = { type: d, n: Math.min(MAX_CARRY, free, need[d]) };
      e.state = 'fetch';
      e.path = [...KITCHEN_WAY.map(v => v.clone()), fetchSpot(d)];
    } else if (e.state === 'fetch' && arrived) {
      const { type, n } = e.task, src = portionSrc(type), items = [];
      while (items.length < n && src.length) items.push({ type, q: src.shift(), mesh: makeFoodMesh(type) });
      refreshStorage();
      refreshTrays();
      if (items.length) carry(stack('portion', items));
      e.state = 'toGrill';
      e.path = [...KITCHEN_WAY.map(v => v.clone()).reverse(), spot.clone()];
    } else if (e.state === 'toGrill' && arrived) {
      const h = e.carry;
      if (h) {
        while (h.items.length && freeSlot() >= 0) startCooking(h.type, h.items.shift().q, e);
        if (h.items.length) { portionSrc(h.type).unshift(...h.items.map(x => x.q)); refreshStorage(); refreshTrays(); } // spots taken meanwhile: back on the shelf
        drop();
      }
      e.state = 'idle';
      e.t = 0;
    } else if (e.state === 'toTray' && arrived) {
      e.group.rotation.y = 0; // facing the pass
      trayPut(e.task, e.carry);
      syncTray(e.task);
      e.task = e.carry.items.length ? trayFor(e.carry) : null;
      if (e.task) { e.path = [new THREE.Vector3(e.task.x, 0, -4.1)]; return; }
      drop(); // anything nobody needs anymore is thrown out
      e.state = 'back';
      e.path = [spot.clone()];
    }
  },
};
const KITCHEN_WAY = [new THREE.Vector3(2.3, 0, -4.3), new THREE.Vector3(1.8, 0, -5.4), new THREE.Vector3(1.8, 0, -6.7)]; // grill area → kitchen doorway
const portionSrc = d => (d in trays ? trays[d] : ITEMS[d] && !ITEMS[d].whole ? stock[d] : []); // cut portions, or pre-portioned dishes in cold storage
const fetchSpot = d => new THREE.Vector3(d in trays ? trayObjs.find(o => o.d === d).t.position.x : bins.find(b => b.id === d).x, 0, d in trays ? -7.35 : -10.6);
const burnIn = f => { const d = FOODS[f.type]; return f.t < d.cook ? (d.cook - f.t) / grillSpeed() + d.burn : d.cook + d.burn - f.t; }; // seconds until it burns
function grillNeed() { // dishes open orders still need that nobody is cooking, carrying or has put on a tray
  const n = Object.fromEntries(Object.keys(FOODS).map(d => [d, 0]));
  customers.forEach(c => c.items && (c.state === 'toTable' || c.state === 'wait') && c.items.forEach(i => { if (!i.served) n[i.dish]++; }));
  passTrays.forEach(t => t.items.forEach(x => { if (x.kind === 'dish') n[x.type]--; }));
  grillFood.forEach(f => { if (foodState(f) !== 'burnt') n[f.type]--; });
  for (const h of [held, ...staff.map(e => e.carry)]) if (h?.kind === 'portion' || h?.kind === 'cooked') h.items.forEach(x => n[x.type]--);
  return n;
}
function trayFor(h) { // the tray of the least patient table that takes something from this stack
  return passTrays.filter(t => trayFit(t, trayGuest(t), h) > 0)
    .sort((a, b) => { const x = trayGuest(a), y = trayGuest(b); return x.patience / x.maxPatience - y.patience / y.maxPatience; })[0] || null;
}
function updateStaff(dt) {
  for (const e of staff) {
    STAFF_AI[e.role](e, dt);
    poseCustomer(e, dt);
    if (e.carry) e.rig.arms.forEach(a => { a.rotation.x = -1.15; }); // both hands hold what they carry
  }
}

// ---------- Day cycle ----------
function openRestaurant() {
  isOpen = true; everOpened = true; warnedClosing = false;
  clockMin = OPEN_AT;
  sinceArrival = 60; // the first party shows up within a few minutes
  busySpell = 0;
  sfx.sign();
  sfx.door();
  toast('Restaurant OPEN! Guests are on their way.', '#9f6', 3);
}
const rushNow = () => isOpen && RUSHES.find(r => clockMin / 60 >= r.from && clockMin / 60 < r.to);
function demandRate() { // parties per game hour right now
  const cfg = dayCfg(), h = clockMin / 60, rush = rushNow();
  return cfg.rate * (rush ? cfg.rush : h >= 15 && h < 18 ? 0.6 : 1) * (busySpell > 0 ? 1.5 : 1);
}
function updateDemand(dt) { // random arrivals: rushes, a quiet afternoon, occasional busy spells; never too close or too far apart
  const mins = dt * TIME_SCALE, rush = rushNow();
  if (rush && rushShown !== rush.name + day) { rushShown = rush.name + day; toast(`${rush.name}!`, '#ffb347', 3); }
  if (busySpell > 0) busySpell -= mins;
  else if (day > 1 && Math.random() < 0.12 * mins / 60) { busySpell = 40; toast('Busy spell: more guests are coming in!', '#ffb347', 3); }
  sinceArrival += mins;
  if (sinceArrival > 8 && (Math.random() < demandRate() * mins / 60 || sinceArrival > 70) && spawnParty()) sinceArrival = 0;
}
function closeRestaurant() { // parties eating or waiting to pay settle up, everyone else goes home; wages and banking
  isOpen = false;
  dayDone = true;
  for (const c of [...customers]) {
    if (['eat', 'toPay', 'payLine', 'paying'].includes(c.state)) completePayment(c, 'card', 0);
    else if (c.state !== 'exit') leave(c, false);
  }
  queue.length = payQueue.length = 0;
  [...grillFood].forEach(removeGrillFood);
  for (const e of staff) if (e.role !== 'prep') { // the server and the grill cook put down what they carry
    if (e.role === 'server' && e.carry) returnTray(e.carry); else if (e.carry) e.rig.body.remove(e.carry.mesh);
    e.carry = e.task = null;
    e.state = 'back';
    e.path = [STAFF_HOME[e.role].clone()];
  }
  if (held?.kind === 'tray') putTrayBack();
  passTrays.forEach(clearTray); // leftover dishes are thrown out
  const w = wages();
  money -= w;
  today.staff += w;
  today.deposit = drawer - FLOAT; // the day's cash goes to the bank, the float stays in the drawer
  money += today.deposit;
  drawer = FLOAT;
  if (uiMode === 'pos') posExit();
  sfx.sign();
  toast('Restaurant CLOSED', '#ffb347', 3);
  summaryTimer = 1.4; // let the sign turn back before the summary
}
const revenue = t => t.sales + t.tips;
const profitOf = t => revenue(t) - t.food - t.staff - t.upgrades;
function showSummary() {
  const profit = profitOf(today);
  history.push({ day, ...today, revenue: revenue(today), profit });
  const row = (a, v) => `<tr><td>${a}</td><td class="num">${fmtMoney(v)}</td></tr>`;
  sumEl.innerHTML = `<div class="win"><div class="bar"><span>DAY ${day} COMPLETE</span><span>ASADO OS</span></div><div class="pane"><table>
    ${row(`${icon('coin')}Sales`, today.sales)}${row(`${icon('star')}Tips`, today.tips)}${row(`${icon('plate')}Food cost`, -today.food)}${row(`${icon('chef')}Staff cost`, -today.staff)}${row(`${icon('sack')}Upgrade cost`, -today.upgrades)}
    <tr><td class="big">PROFIT</td><td class="num big ${profit < 0 ? 'neg' : 'pos'}">${fmtMoney(profit)}</td></tr></table>
    ${Object.keys(today.sold).length ? `<p>${Object.entries(today.sold).map(([k, n]) => `<span style="white-space:nowrap;margin-right:14px">${icon(k)}${n}× ${(FOODS[k] || SAUCES[k]).name}</span>`).join('')}</p>` : ''}
    <p class="muted">${icon('happy')}${today.guests} guests · ${icon('angry')}${today.lost} lost · card ${fmtMoney(today.card)} · cash ${fmtMoney(today.cash)} · ${fmtMoney(today.deposit)} cash banked, the ${fmtMoney(FLOAT)} float stays in the drawer</p>
    <div class="foot"><span class="muted">Money: ${fmtMoney(money)} · Restock at the office terminal before you open tomorrow</span>
    <button data-a="next">CONTINUE TO NEXT DAY</button></div></div></div>`;
  uiMode = 'summary';
  sumEl.hidden = false;
  document.exitPointerLock();
}
function nextDay() {
  const before = dayCfg().sauces;
  day++;
  dayDone = false;
  clockMin = DAY_START;
  today = newDay();
  closeUI();
  const fresh = dayCfg().sauces.filter(k => !before.includes(k)).map(k => SAUCES[k].name);
  toast(fresh.length ? `DAY ${day}: guests now ask for ${fresh.join(' and ')}. Buy bottles at the office terminal` : `DAY ${day}: restock at the office terminal, then open the restaurant`, '#ffd76a', 5);
}

// ---------- ASADO OS: office terminal (upgrades + staff, wholesale, finances) ----------
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
    }).join('') + '<tr><td class="cat" colspan="3">STAFF</td></tr>' + Object.entries(ROLES).map(([id, r]) => {
      const got = hired(id);
      return `<tr><td>${r.name} <span class="muted">${fmtMoney(r.wage)}/day wage</span><br><span class="muted">${r.desc}</span></td>
        <td class="num">${r.soon ? 'COMING SOON' : got ? 'HIRED' : fmtMoney(r.hire)}</td>
        <td class="num">${r.soon || got ? '' : `<button data-a="hire" data-v="${id}"${money < r.hire ? ' disabled' : ''}>HIRE</button>`}</td></tr>`;
    }).join('') + '</table>';
  } else if (osTab === 'wholesale') {
    const units = wsItems().reduce((n, k) => n + wsQty[k] * ITEMS[k].pack, 0);
    const total = wsItems().reduce((n, k) => n + wsQty[k] * packCost(k, wsQ), 0);
    const free = Math.max(0, capacity() - usedSpace() - incoming());
    const qBtns = QUALITY.map((q, i) => `<button data-a="q" data-v="${i}" class="${wsQ === i ? 'on' : ''}"${i > lvl('quality') ? ' disabled' : ''}>${q.name}</button>`).join(' ');
    body = `<p class="muted">MEAT QUALITY ${qBtns}</p>
      <table><tr><th>ITEM</th><th>PACK</th><th class="num">PRICE</th><th class="num">QUANTITY</th><th class="num">TOTAL</th></tr>
      ${wsItems().map(k => `<tr><td>${icon(ITEMS[k].dish || ITEMS[k].sauce)}${ITEMS[k].name}</td><td class="muted">${ITEMS[k].whole ? `whole · ${portionsPer()} portions` : ITEMS[k].cups ? `${ITEMS[k].pack} bottles · ${ITEMS[k].cups} cups each` : `${ITEMS[k].pack} pieces`}</td>
        <td class="num">${fmtMoney(packCost(k, wsQ))}</td>
        <td class="num"><button data-a="qty" data-v="${k}" data-d="-1">−</button> ${wsQty[k]} <button data-a="qty" data-v="${k}" data-d="1">+</button></td>
        <td class="num">${fmtMoney(wsQty[k] * packCost(k, wsQ))}</td></tr>`).join('')}</table>
      <div class="foot"><span class="muted">Uses ${units} of ${free} free storage spaces · Money ${fmtMoney(money)}</span>
        <span>TOTAL <b class="big">${fmtMoney(total)}</b> <button data-a="order"${!units || total > money || units > free ? ' disabled' : ''}>ORDER</button></span></div>`;
  } else {
    const profit = profitOf(today);
    const rows = [['Money in the bank', money], ['Cash in the register', drawer], ["Today's sales", today.sales], ['· by card', today.card], ['· in cash', today.cash],
      ['Tips', today.tips], ['Food cost', -today.food], ['Staff cost', -today.staff], ['Upgrade cost', -today.upgrades]];
    body = `<table>${rows.map(([a, v]) => `<tr><td>${a}</td><td class="num">${fmtMoney(v)}</td></tr>`).join('')}
      <tr><td class="big">Today's profit</td><td class="num big ${profit < 0 ? 'neg' : 'pos'}">${fmtMoney(profit)}</td></tr></table>
      <p class="muted">Card payments reach the bank right away. Cash stays in the register until closing, when everything above the ${fmtMoney(FLOAT)} float is banked.</p>
      ${history.length ? `<p class="cat">PREVIOUS DAYS</p><table><tr><th>DAY</th><th class="num">GUESTS</th><th class="num">REVENUE</th><th class="num">COSTS</th><th class="num">PROFIT</th></tr>
      ${history.map(d => `<tr><td>${d.day}</td><td class="num">${d.guests}</td><td class="num">${fmtMoney(d.revenue)}</td><td class="num">${fmtMoney(d.food + d.staff + d.upgrades)}</td><td class="num ${d.profit < 0 ? 'neg' : 'pos'}">${fmtMoney(d.profit)}</td></tr>`).join('')}</table>` : ''}`;
  }
  osEl.innerHTML = `<div class="win"><div class="bar"><span>ASADO OS 1.0 · DAY ${day} · ${fmtTime(clockMin)}</span><button data-a="exit">EXIT ✕</button></div>
    <div class="tabs">${tab('upgrades', 'UPGRADES')}${tab('wholesale', 'FOOD WHOLESALE')}${tab('finances', 'FINANCES')}</div>
    <div class="pane">${osMsg ? `<p class="pos">${osMsg}</p>` : ''}${body}</div></div>`;
}
function buyUpgrade(u) {
  const cost = u.cost[u.level];
  if (money < cost) return;
  money -= cost;
  today.upgrades += cost;
  u.level++;
  if (u.id === 'tables') {
    tables[3].active = tables[3].col.on = tables[3].group.visible = tables[3].lamp.visible = true;
    passTrays[3].group.visible = true; // its tray on the pass
    passTrays[3].labels.forEach(l => { l.visible = true; });
  }
  if (u.id === 'interior') decor.visible = true;
  if (u.id === 'cold') freezer.visible = freezerCol.on = true;
  if (u.id === 'storage') extraShelf.g.visible = extraShelf.col.on = true;
  if (u.id === 'quality') wsQ = u.level;
  drawMenu();
  refreshStorage();
  refreshTrays();
  osMsg = `${u.name} purchased!`;
  sfx.pay();
}
function hireStaff(role) {
  const r = ROLES[role];
  if (r.soon || hired(role) || money < r.hire) return;
  money -= r.hire;
  today.staff += r.hire;
  hire(role);
  osMsg = `${r.name} hired! Wage: ${fmtMoney(r.wage)} per day.`;
  sfx.pay();
}
function placeOrder() { // pay now; one crate per item arrives in the delivery area
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
  delivery = { t: isOpen ? gm(20) : 6, list: delivery ? delivery.list.concat(list) : list };
  osMsg = `Order placed for ${fmtMoney(total)}. The truck will drop the crates in the DELIVERY area${isOpen ? ' in about 20 minutes' : ''}.`;
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
  if (a === 'hire') hireStaff(v);
  if (a === 'q') wsQ = +v;
  if (a === 'qty') wsQty[v] = Math.max(0, Math.min(20, wsQty[v] + +b.dataset.d));
  if (a === 'order') placeOrder();
  renderOS();
}
osEl.addEventListener('click', onUIClick);
sumEl.addEventListener('click', onUIClick);

// ---------- Register (POS): checkout on a small in-game computer, with a cash drawer and a card reader ----------
const POS_W = 0.5, POS_H = 0.352;
const posCanvas = document.createElement('canvas');
posCanvas.width = 1024;
posCanvas.height = 720;
const posTex = new THREE.CanvasTexture(posCanvas);
posTex.colorSpace = THREE.SRGBColorSpace;
const posMon = new THREE.Group();
posMon.position.set(-5.6, 1.4, -3.62);
posMon.rotation.y = Math.PI; // the screen faces the staff side of the counter
const posBezel = part(new THREE.BoxGeometry(POS_W + 0.04, POS_H + 0.04, 0.04), dark, 0, 0, -0.022, posMon);
const posScreen = part(new THREE.PlaneGeometry(POS_W, POS_H), new THREE.MeshBasicMaterial({ map: posTex }), 0, 0, 0, posMon);
posScreen.castShadow = false;
const posStand = part(new THREE.BoxGeometry(0.05, 0.2, 0.05), dark, 0, -0.27, -0.03, posMon);
const posCursor = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([V2(0, 0), V2(0, -0.024), V2(0.0065, -0.018), V2(0.012, -0.028), V2(0.016, -0.026), V2(0.0105, -0.016), V2(0.018, -0.016)])), new THREE.MeshBasicMaterial({ color: 0xffffff }));
posCursor.visible = false;
posMon.add(posCursor);
posMon.userData.kind = 'register';
scene.add(posMon);
const posKeys = [part(new THREE.BoxGeometry(0.36, 0.02, 0.12), dark, -5.6, 1.07, -3.8),   // keyboard
  part(new THREE.BoxGeometry(0.045, 0.02, 0.07), dark, -5.3, 1.07, -3.8)];                  // mouse
onProp('pos', L => { // the Higgsfield register on the counter: the interactive screen sits on its monitor's glass
  [posBezel, posStand, ...posKeys].forEach(m => { m.visible = false; });
  const m = makeProp(L);
  m.position.set(0.017, -0.56, -0.1105);
  posMon.add(m);
  posMon.position.y = 1.62; // the model stands on the counter top (1.06)
});
const cashDrawer = part(new THREE.BoxGeometry(0.44, 0.09, 0.3), mat(0x3a3f45), -5.6, 0.94, -3.755);
const readerCanvas = document.createElement('canvas');
readerCanvas.width = 256;
readerCanvas.height = 160;
const readerTex = new THREE.CanvasTexture(readerCanvas);
readerTex.colorSpace = THREE.SRGBColorSpace;
const reader = new THREE.Group();
reader.position.set(-5, 1.08, -3.3);
reader.rotation.x = 0.45; // the card reader tilts towards the guest
part(new THREE.BoxGeometry(0.09, 0.025, 0.16), dark, 0, 0, 0, reader);
part(new THREE.PlaneGeometry(0.076, 0.048), new THREE.MeshBasicMaterial({ map: readerTex }), 0, 0.0135, 0.025, reader).rotation.x = -Math.PI / 2;
scene.add(reader);
function setReader(a, b = '') {
  const g = readerCanvas.getContext('2d');
  g.fillStyle = '#0d1f14';
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#9fe0b0'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 34px monospace'; g.fillText(a, 128, 58);
  g.font = '22px monospace'; g.fillText(b, 128, 112);
  readerTex.needsUpdate = true;
}
setReader('WELCOME');
const pos = { for: undefined, method: null, step: 'method', entry: '', msg: '', change: 0, tip: 0, readerT: 0, drawerT: 0, cx: 0.5, cy: 0.5, hover: null, buttons: [], dirty: true, minute: -1 };
const POS_VIEW = new THREE.Vector3(-5.6, EYE, -4.3);
const posCur = () => (payQueue[0]?.state === 'paying' ? payQueue[0] : null);
function openPOS() {
  uiMode = 'pos';
  pos.dirty = true;
  posCursor.visible = true;
  renderer.domElement.style.cursor = 'none';
  document.exitPointerLock();
  sfx.ui();
}
function posExit() {
  uiMode = null;
  pos.dirty = true;
  posCursor.visible = false;
  renderer.domElement.style.cursor = '';
  startEl.style.display = document.pointerLockElement ? 'none' : 'flex';
  lockPointer();
}
function posAction(id) { // checkout steps: method → amount → (cash: change | card: tip on the reader → approved)
  const c = posCur();
  pos.dirty = true;
  sfx.ui();
  if (id === 'logoff') return posExit();
  if (!c) return;
  const total = billTotal(c);
  pos.msg = '';
  if (id === 'cash' || id === 'card') {
    if (c.pay.method !== id) { pos.msg = `This guest pays by ${c.pay.method.toUpperCase()}`; sfx.bad(); return; }
    pos.method = id;
    pos.step = id + 'Amount';
    pos.entry = '';
    if (id === 'card') setReader(`$${total}`, 'ENTER AMOUNT');
  } else if (/^d\d$/.test(id)) { if (pos.entry.length < 4) pos.entry += id[1]; }
  else if (id === 'clr') pos.entry = '';
  else if (id.startsWith('bill')) pos.entry = id.slice(4);
  else if (id === 'enter' && pos.step === 'cashAmount') {
    if (+pos.entry !== c.pay.tender) { pos.msg = `The guest handed you ${fmtMoney(c.pay.tender)}`; sfx.bad(); return; }
    pos.change = c.pay.tender - total;
    pos.step = 'cashChange';
  } else if (id === 'enter' && pos.step === 'cardAmount') {
    if (+pos.entry !== total) { setReader('DECLINED', 'WRONG AMOUNT'); pos.msg = `The card amount must match the total, ${fmtMoney(total)}`; sfx.bad(); return; }
    pos.step = 'cardTip';
    pos.readerT = 1.5;
    setReader(`$${total}`, 'TIP? 0 5 10 15%');
  } else if (id === 'change' && pos.step === 'cashChange') {
    pos.step = 'cashDone';
    pos.drawerT = 1.3;
    pos.tip = Math.round(total * tipPct(c) / 100); // cash tips go in the jar
    sfx.store();
  } else if (id === 'complete' && pos.step === 'cardApproved') completePayment(c, 'card', pos.tip);
}
function updatePOS(dt, playing) {
  const c = posCur();
  if (c !== pos.for) { // the next guest stepped up to the register
    pos.for = c; pos.method = null; pos.step = 'method'; pos.entry = ''; pos.msg = ''; pos.readerT = pos.drawerT = 0; pos.dirty = true;
    setReader(c ? `$${billTotal(c)}` : 'WELCOME', c ? 'PLEASE WAIT' : '');
  }
  if (playing && pos.readerT > 0 && (pos.readerT -= dt) <= 0 && c) { // the guest picks a tip on the reader
    const pct = tipPct(c);
    pos.tip = Math.round(billTotal(c) * pct / 100);
    pos.step = 'cardApproved';
    setReader('APPROVED', `TIP ${pct}% · $${pos.tip}`);
    sfx.serve();
    pos.dirty = true;
  }
  if (playing && pos.drawerT > 0 && (pos.drawerT -= dt) <= 0 && c) completePayment(c, 'cash', pos.tip);
  cashDrawer.position.z += ((pos.drawerT > 0 ? -4 : -3.755) - cashDrawer.position.z) * Math.min(1, dt * 10);
  if (Math.floor(clockMin) !== pos.minute) { pos.minute = Math.floor(clockMin); pos.dirty = true; }
  if (pos.dirty) { pos.dirty = false; drawPOS(); }
  const fov = uiMode === 'pos' ? 36 : 75;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 6); camera.updateProjectionMatrix(); }
  if (uiMode !== 'pos') return;
  const k = Math.min(1, dt * 6), p = camera.position; // step up to the screen
  p.lerp(POS_VIEW, k);
  const ty = Math.atan2(p.x + 5.6, p.z + 3.62), tp = Math.atan2(posMon.position.y - p.y, Math.hypot(p.x + 5.6, p.z + 3.62));
  yaw += Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw)) * k;
  pitch += (tp - pitch) * k;
  camera.rotation.set(pitch, yaw, 0);
}
function drawPOS() { // a tiny fictional desktop: menu bar, register line, ticket window, keypad
  const g = posCanvas.getContext('2d'), c = posCur(), B = (pos.buttons = []);
  const text = (t, x, y, size = 26, color = '#e8f1f2', align = 'left', bold = true) => {
    g.font = `${bold ? 'bold ' : ''}${size}px sans-serif`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y);
  };
  const rr = (x, y, w, h, color, r = 12) => { g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  const btn = (id, x, y, w, h, label, color = '#2d6f86') => { B.push({ id, x, y, w, h }); rr(x, y, w, h, pos.hover === id ? '#4ba3c3' : color, 10); text(label, x + w / 2, y + h / 2, 26, '#fff', 'center'); };
  g.fillStyle = '#10232b'; g.fillRect(0, 0, 1024, 720);
  g.fillStyle = '#e3a33a'; g.fillRect(0, 0, 1024, 56);
  text('ASADO POS', 22, 28, 28, '#24160a');
  text(`CAJA 1 · ${fmtTime(clockMin)} · DRAWER ${fmtMoney(drawer)}`, 1002, 28, 22, '#24160a', 'right');
  rr(16, 72, 240, 570, '#16323d');
  text('REGISTER LINE', 32, 102, 20, '#9cc3cf');
  if (!payQueue.length) text('nobody waiting', 32, 142, 21, '#5f8794', 'left', false);
  payQueue.slice(0, 10).forEach((q, i) => text(`TABLE ${q.table.n} · ${q.state === 'paying' ? q.pay.method.toUpperCase() : 'coming'}`, 32, 142 + i * 40, 21, q.state === 'paying' ? '#ffd76a' : '#9cc3cf', 'left', q.state === 'paying'));
  rr(272, 72, 736, 570, '#f4efe6');
  if (!c) text(payQueue.length ? 'A guest is walking to the register…' : 'No guest at the register', 640, 340, 28, '#7a6a5a', 'center');
  else {
    const total = billTotal(c);
    text(`TABLE ${c.table.n} · ${1 + c.members.length} guest${c.members.length ? 's' : ''}`, 292, 104, 26, '#24160a');
    billLines(c).slice(0, 8).forEach((l, i) => {
      const im = iconImg(l.icon);
      if (im.complete && im.naturalWidth) g.drawImage(im, 290, 132 + i * 30, 28, 28);
      text(`${l.qty}× ${l.name}`, 324, 146 + i * 30, 21, '#3b2f25', 'left', false);
      text(fmtMoney(l.qty * l.each), 700, 146 + i * 30, 21, '#3b2f25', 'right', false);
    });
    g.fillStyle = '#d8cdbd'; g.fillRect(292, 398, 408, 2);
    text('TOTAL', 292, 426, 28, '#24160a');
    text(fmtMoney(total), 700, 426, 30, '#24160a', 'right');
    text(c.pay.method === 'card' ? 'Guest pays by CARD' : `Guest pays CASH · hands you ${fmtMoney(c.pay.tender)}`, 292, 466, 21, '#9a5212');
    if (pos.step === 'method') { btn('cash', 292, 500, 196, 70, 'CASH', '#3d7a4a'); btn('card', 504, 500, 196, 70, 'CARD', '#3a5d9a'); }
    if (pos.step === 'cashAmount' || pos.step === 'cardAmount') {
      rr(292, 494, 408, 54, '#ffffff', 8);
      text(`${pos.step === 'cashAmount' ? 'RECEIVED' : 'CARD AMOUNT'}  $${pos.entry || '0'}`, 306, 521, 26, '#24160a');
      btn('enter', 292, 560, 408, 64, pos.step === 'cashAmount' ? 'ENTER' : 'SEND TO READER', '#3d7a4a');
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0'].forEach((k, i) => btn(k === 'C' ? 'clr' : 'd' + k, 728 + (i % 3) * 90, 100 + Math.floor(i / 3) * 76, 80, 64, k, '#3a4b55'));
      if (pos.step === 'cashAmount') [20, 50, 100].forEach((b, i) => btn('bill' + b, 728 + i * 90, 410, 80, 56, `$${b}`, '#6b5b2a'));
    }
    if (pos.step === 'cashChange') {
      text(`CHANGE DUE ${fmtMoney(pos.change)}`, 292, 522, 34, '#24160a');
      btn('change', 292, 560, 408, 64, pos.change ? `GIVE ${fmtMoney(pos.change)} CHANGE` : 'CLOSE SALE', '#3d7a4a');
    }
    if (pos.step === 'cashDone') text('Drawer open… counting the change', 292, 540, 26, '#3b2f25');
    if (pos.step === 'cardTip') text('The guest is choosing a tip on the card reader…', 292, 540, 22, '#3b2f25');
    if (pos.step === 'cardApproved') { text(`APPROVED · tip ${fmtMoney(pos.tip)}`, 292, 522, 30, '#2f7d3a'); btn('complete', 292, 560, 408, 64, 'COMPLETE SALE', '#3d7a4a'); }
  }
  if (pos.msg) text(pos.msg, 272, 676, 22, '#ff9a80');
  if (uiMode === 'pos') btn('logoff', 868, 652, 140, 50, 'LOG OFF', '#7a3b2e');
  else text('[E] USE REGISTER', 1002, 676, 22, '#5f8794', 'right');
  posTex.needsUpdate = true;
}
const ndc = new THREE.Vector2();
function posPointer(e) { // the real mouse moves a cursor drawn on the register screen
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(posScreen)[0];
  if (!hit) return;
  pos.cx = hit.uv.x;
  pos.cy = 1 - hit.uv.y;
  posCursor.position.set((pos.cx - 0.5) * POS_W, (0.5 - pos.cy) * POS_H, 0.003);
  const x = pos.cx * 1024, y = pos.cy * 720, b = pos.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  const id = b ? b.id : null;
  if (id !== pos.hover) { pos.hover = id; pos.dirty = true; }
}
function posClick() { if (pos.hover) posAction(pos.hover); }
function posKey(e) {
  if (e.code === 'Escape') return posExit();
  if (/^(Digit|Numpad)\d$/.test(e.code)) posAction('d' + e.code.slice(-1));
  if (e.code === 'Backspace') { pos.entry = pos.entry.slice(0, -1); pos.dirty = true; }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') posAction(pos.step === 'cashChange' ? 'change' : pos.step === 'cardApproved' ? 'complete' : 'enter');
}

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
    if (ref.state === 'toPay' || ref.state === 'payLine' || ref.state === 'paying') return getAction(posMon);
    return null;
  }
  if (kind === 'counter') {
    const c = queue[0];
    if (c && c.state === 'order') return { label: '[E] Take order', fn: () => takeOrder(c) };
    return { label: !isOpen ? 'Counter: the restaurant is closed' : queue.length ? 'Guest coming…' : 'No guests waiting' };
  }
  if (kind === 'food') {
    if (h && h.kind !== 'cooked') return getAction(grill);
    const ready = readyFood().length, st = foodState(ref), name = FOODS[ref.type].name;
    if (ready) return { label: `[E] Pick up ${ready} ready piece${ready > 1 ? 's' : ''}`, fn: pickUpReady };
    if (st === 'cooking') return { label: `${name} cooking… ${Math.floor(ref.t / FOODS[ref.type].cook * 100)}%` };
    return { label: `[E] Toss burnt ${name}`, fn: () => tossBurnt(ref) };
  }
  if (kind === 'grill') {
    const ready = readyFood().length, pick = ready && { label: `[E] Pick up ${ready} ready piece${ready > 1 ? 's' : ''}`, fn: pickUpReady };
    if (!h) return pick || { label: 'Parrilla: bring raw portions to grill them' };
    if (h.kind === 'portion') {
      const free = freeSlots(), n = Math.min(free, h.items.length);
      if (!free) return { label: 'Grill full' };
      return { label: `[E] Grill ${n}× ${FOODS[h.type].name}${n < h.items.length ? ` (${h.items.length - n} stay in hand: grill full)` : ''}`, fn: grillHeld };
    }
    if (h.kind === 'cooked') return pick || { label: `[E] Discard ${heldName()}`, fn: dropHeld };
    if (h.kind === 'whole') return { label: `Cut the ${ITEMS[h.type].name} at the prep station first` };
    return { label: 'Hands full' };
  }
  if (kind === 'table') {
    const c = ref.customer;
    if (h?.kind === 'tray') {
      if (h.tray.n !== ref.n) return { label: `This is Table ${h.tray.n}'s tray` };
      if (!c || c.state !== 'wait') return { label: `Table ${ref.n} isn't waiting for food: put the tray back on the service counter` };
      return { label: `[E] Serve Table ${ref.n}`, fn: () => serveHeldTray(c) };
    }
    if (!c || !['wait', 'eat', 'toTable'].includes(c.state)) return { label: `Table ${ref.n}` };
    if (c.state === 'eat') return { label: `Table ${ref.n} is eating` };
    const wants = orderText(c.items).replace(/\n/g, ', ');
    if (c.state === 'toTable') return { label: `Table ${ref.n} wants: ${wants}` };
    if (h?.kind === 'sauce') {
      const i = c.items.findIndex(it => it.served && it.sauce === h.type && !it.sauced);
      if (i < 0) return { label: `Table ${ref.n} doesn't need ${SAUCES[h.type].name}` };
      return { label: `[E] Serve ${SAUCES[h.type].name} with the ${FOODS[c.items[i].dish].name}`, fn: () => { const cup = held.mesh; dropHeld(); serveSauce(c, i, cup); } };
    }
    if (h?.kind !== 'cooked') return { label: `Table ${ref.n} wants: ${wants} · patience ${Math.max(0, Math.round(100 * c.patience / c.maxPatience))}%` };
    const n = h.items.filter((x, k) => h.items.slice(0, k).filter(y => y.type === x.type).length < c.items.filter(i => !i.served && i.dish === x.type).length).length;
    if (!n) return { label: `Table ${ref.n} doesn't need ${carriedNames(h)}` };
    return { label: `[E] Serve ${n} dish${n > 1 ? 'es' : ''} to Table ${ref.n}`, fn: () => serveHeld(c) };
  }
  if (kind === 'sign' || kind === 'door') {
    if (isOpen) return { label: '[E] CLOSE RESTAURANT', fn: closeRestaurant };
    if (dayDone) return { label: 'Closed for today' };
    return { label: '[E] OPEN RESTAURANT', fn: openRestaurant };
  }
  if (kind === 'crate') return h ? { label: 'Hands full' } : { label: `[E] Pick up crate: ${crateText(ref)}`, fn: () => pickUpCrate(ref) };
  if (kind === 'bin') {
    const n = stock[ref].length, it = ITEMS[ref], name = it.name, portion = !it.whole && !it.sauce;
    if (h?.kind === 'crate') return { label: `[E] Store ${crateText(h.crate)}`, fn: storeCrate };
    if (h?.kind === 'portion' && portion && h.type === it.dish) return morePortions(h, n, name, () => takeFromBin(ref));
    if (h && (h.kind === 'whole' || h.kind === 'bottle') && binOf(h) === ref) return { label: `[E] Put back ${name}`, fn: putBack };
    if (h) return { label: 'Hands full' };
    if (!n) return { label: `${name}: empty. Order more at the office terminal` };
    return { label: `[E] Take ${name}${qTag(stock[ref][0])} (${n} left)${portion ? ' · hold E for more' : ''}`, fn: () => takeFromBin(ref), repeat: portion };
  }
  if (kind === 'prep') {
    if (h?.kind === 'whole') return { label: `[E] PREPARE ${ITEMS[h.type].name.toUpperCase()}`, fn: startPrep };
    return { label: 'Prep station: bring a whole cut from cold storage' };
  }
  if (kind === 'tray') {
    const n = trays[ref].length, name = FOODS[ref].name;
    if (h?.kind === 'portion' && h.type === ref) return morePortions(h, n, `${name} portion`, () => takeFromTray(ref));
    if (h) return { label: 'Hands full' };
    if (!n) return { label: `No ${name} portions yet: cut a whole ${name} first` };
    return { label: `[E] Take ${name} portion${qTag(trays[ref][0])} (${n} left) · hold E for more`, fn: () => takeFromTray(ref), repeat: true };
  }
  if (kind === 'register') {
    if (camera.position.z > -3.85) return { label: 'Register: step behind the counter to use it' };
    return { label: posCur() ? '[E] USE REGISTER · a guest is waiting to pay' : '[E] USE REGISTER', fn: openPOS };
  }
  if (kind === 'pass') {
    if (h?.kind === 'tray') return { label: `[E] Put Table ${h.tray.n}'s tray back`, fn: putTrayBack };
    return { label: 'Service counter: put dishes and sauce cups on the tray of their table' };
  }
  if (kind === 'passTray') {
    const t = ref, c = trayGuest(t), n = t.n;
    if (h?.kind === 'tray') return h.tray === t ? { label: `[E] Put Table ${n}'s tray back`, fn: putTrayBack } : { label: 'Hands full' };
    if (h?.kind === 'cooked' || h?.kind === 'sauce') {
      const k = trayFit(t, c, h);
      if (!k) return { label: `Table ${n} doesn't need ${carriedNames(h)}` };
      return { label: `[E] Put ${h.kind === 'sauce' ? SAUCES[h.type].name : `${k} dish${k > 1 ? 'es' : ''}`} on Table ${n}'s tray`, fn: () => placeOnTray(t) };
    }
    if (h) return { label: 'Hands full' };
    if (t.claimed) return { label: `Table ${n}'s tray is READY: the server is coming for it` };
    if (t.ready) return { label: `[E] Take Table ${n}'s tray (READY)`, fn: () => takeTray(t) };
    if (!c) return { label: `Table ${n}'s tray: no open order` };
    return { label: `Table ${n}'s tray needs: ${trayMissing(t, c).join(', ')}` };
  }
  if (kind === 'sauce' || kind === 'sauceStation') {
    const k = kind === 'sauce' ? ref : h?.kind === 'bottle' ? ITEMS[h.type].sauce : h?.kind === 'sauce' ? h.type : null;
    if (!k) return { label: 'Sauce station: look at a bottle to fill a cup' };
    const name = SAUCES[k].name, n = sauceLevel[k];
    if (h?.kind === 'bottle') {
      if (ITEMS[h.type].sauce !== k) return { label: `This holder is for ${name}` };
      if (n) return { label: `The ${name} bottle still has ${n} cups` };
      return { label: `[E] Place the ${name} bottle`, fn: placeBottle };
    }
    if (h?.kind === 'sauce' && h.type === k) return { label: `[E] Pour the cup back into the ${name}`, fn: pourBack };
    if (h) return { label: 'Hands full' };
    if (!n) return { label: `${name}: empty. Bring a bottle from cold storage` };
    return { label: `[E] Fill a cup of ${name} (${n} left)`, fn: () => startPour(k) };
  }
  if (kind === 'terminal') return { label: '[E] USE TERMINAL', fn: openTerminal };
  return null;
}
function heldName() {
  const h = held;
  if (h.kind === 'crate') return crateText(h.crate);
  if (h.kind === 'whole') return ITEMS[h.type].name + qTag(h.q);
  if (h.kind === 'bottle') return `a bottle of ${ITEMS[h.type].name}`;
  if (h.kind === 'sauce') return `a cup of ${SAUCES[h.type].name}`;
  if (h.kind === 'tray') return `Table ${h.tray.n}'s tray`;
  const per = {};
  h.items.forEach(x => { per[x.type] = (per[x.type] || 0) + 1; });
  return Object.entries(per).map(([d, k]) => `${k}× ${h.kind === 'cooked' ? 'grilled' : 'raw'} ${FOODS[d].name}`).join(', ');
}
const carriedNames = h => (h.kind === 'sauce' ? SAUCES[h.type].name : [...new Set(h.items.map(x => FOODS[x.type].name))].join(' or '));
const morePortions = (h, n, name, fn) => (h.items.length < MAX_CARRY && n
  ? { label: `[E] Take another ${name} (${h.items.length + 1}/${MAX_CARRY}) · hold E for more`, fn, repeat: true }
  : { label: `[E] Put back ${h.items.length}× ${name}`, fn: putBack });

const raycaster = new THREE.Raycaster();
raycaster.far = 3.2;
const center = new THREE.Vector2();
const fixedTargets = [...solids, coals, doorPivot, signPivot, board, monitor, posMon, ...bins.map(b => b.hit), ...trayObjs.map(t => t.t), ...holders.map(k => k.hit)];
let currentAction = null;
function updateInteraction() {
  if (uiMode) {
    currentAction = null;
    setPrompt(uiMode === 'pos' ? 'Use the mouse on the register screen · Esc to step away' : '');
    showCard(null);
    highlight(null);
    return;
  }
  raycaster.setFromCamera(center, camera);
  const people = customers.filter(c => c.state !== 'exit').flatMap(c => [c.group, ...c.members.map(m => m.group)]);
  const targets = [...fixedTargets, ...grillFood.map(f => f.mesh), ...tables.filter(t => t.active).map(t => t.group), ...people, ...crates.map(c => c.mesh), ...passTrays.filter(t => !t.away && t.group.visible).map(t => t.group)];
  const hit = raycaster.intersectObjects(targets, true)[0];
  const o = hit && customerTarget(hit.object);
  currentAction = o && !busy ? getAction(o) : null;
  setPrompt(currentAction ? currentAction.label : held ? `Carrying: ${heldName()}` : '');
  showCard(o);
  highlight(o);
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
  if (isOpen) {
    if (clockMin >= CLOSE_AT) return 'Closing time: finish the last tables, then CLOSE at the sign by the front door';
    if (posCur() && uiMode !== 'pos') return 'A guest is waiting at the REGISTER to pay';
    return !hired('server') && passTrays.some(t => t.ready && !t.away) ? 'A tray is READY on the SERVICE counter: take it to its table' : '';
  }
  if (held?.kind === 'crate') return 'Carry the crate to COLD STORAGE in the back of house and press E';
  if (crates.length) return 'Crates are waiting in the DELIVERY area: go through the KITCHEN and out the back door';
  if (!everOpened) return 'All stocked! Open the restaurant at the OPEN/CLOSED sign by the front door';
  return 'Buy food and upgrades at the OFFICE terminal, then open at the sign by the front door';
}
// HUD icons (public/ui, cut from the Higgsfield icon sheets) and the wooden signs
const icon = name => `<img class="ico" src="ui/${name}.webp" alt="">`;
const iconImgs = {};
function iconImg(name) { // for canvases (the register); redraws the register once it has loaded
  if (!iconImgs[name]) { const im = iconImgs[name] = new Image(); im.onload = () => { pos.dirty = true; screenKey = ''; }; im.src = `ui/${name}.webp`; }
  return iconImgs[name];
}
const eventEl = document.getElementById('event'), cardEl = document.getElementById('card');
let hudKey = '';
function updateHUD() {
  const hint = hintText(), rush = rushNow(), key = `${day}|${Math.floor(clockMin)}|${money}|${isOpen}|${hint}|${rush && rush.name}`;
  if (key === hudKey) return;
  hudKey = key;
  hudEl.className = 'hud wood';
  hudEl.innerHTML = `<span>${icon('calendar')} DAY ${day}</span><span>${icon('clock')} ${fmtTime(clockMin)}</span><span class="money">${icon('coin')} ${fmtMoney(money)}</span><span class="st ${isOpen ? 'open' : 'closed'}">${isOpen ? 'OPEN' : 'CLOSED'}</span>`;
  eventEl.hidden = !rush; // the hanging sign shows only while an event is on
  if (rush) eventEl.innerHTML = `${icon('flame')} ${rush.name}`;
  hintEl.textContent = hint;
}
let promptKey = null;
function setPrompt(label) { // [E] actions get the E key and an orange pill, anything else a plain wooden pill
  if (label === promptKey) return;
  promptKey = label;
  const act = label.startsWith('[E] ');
  promptEl.innerHTML = !label ? '' : act ? `${icon('key_e')}<span class="pill">${label.slice(4)}</span>` : `<span class="pill info">${label}</span>`;
}
let cardKey = null;
function showCard(o) { // looking at a table or its tray: the party's order with icons, a check once it is on the tray
  const k = o && o.userData.kind, t = k === 'table' ? o.userData.ref : k === 'passTray' ? tables[o.userData.ref.n - 1] : null, c = t && t.customer;
  if (!c || !c.items) { if (cardKey !== '') { cardKey = ''; cardEl.hidden = true; } return; }
  const tray = passTrays[t.n - 1], lines = {};
  for (const i of c.items) (lines[i.dish + '|' + (i.sauce || '')] ||= { dish: i.dish, sauce: i.sauce, n: 0, done: 0 }).n++;
  for (const l of Object.values(lines)) {
    const onTray = tray.items.filter(x => x.kind === 'dish' && x.type === l.dish).length;
    l.done = Math.min(l.n, c.items.filter(i => i.dish === l.dish && i.sauce === l.sauce && i.served).length + onTray);
  }
  const total = c.items.reduce((n, i) => n + Math.round(FOODS[i.dish].price * QUALITY[i.q || 0].price) + (i.sauce ? SAUCES[i.sauce].price : 0), 0);
  const p = c.state === 'wait' ? c.patience / c.maxPatience : 1;
  const key = JSON.stringify([t.n, lines, total, p >= 0.5]);
  if (key === cardKey) return;
  cardKey = key;
  cardEl.innerHTML = `<div class="head"><span>TABLE ${t.n}</span>${icon(p >= 0.5 ? 'happy' : 'angry')}</div>`
    + Object.values(lines).map(l => `<div class="row">${icon(l.dish)}${l.sauce ? icon(l.sauce) : ''}<span>${l.n}×</span>${l.done ? `<span class="ok">${l.done === l.n ? '✔' : `${l.done}/${l.n} ✔`}</span>` : ''}</div>`).join('')
    + `<div class="tot">${icon('coin')} ${fmtMoney(total)}</div>`;
  cardEl.hidden = false;
}
// look-at highlight: a warm emissive tint on the visible meshes of the target (materials cloned once, no post-processing)
const hlMats = new WeakMap();
let hlObj = null, hlList = [];
function hlTint(m) {
  if (!m.emissive) return m;
  let h = hlMats.get(m);
  if (!h) {
    h = m.clone();
    h.emissive = m.emissive.clone().add(new THREE.Color(0x4a2a08));
    h.userData = m.userData; // a grilled piece keeps its cooking look
    h.onBeforeCompile = m.onBeforeCompile;
    h.customProgramCacheKey = m.customProgramCacheKey;
    hlMats.set(m, h);
  }
  return h;
}
function highlight(o) {
  const k = o && o.userData.kind, show = k === 'grill' ? grillModel : k === 'bin' ? bins.find(b => b.id === o.userData.ref)?.shows : o;
  if (o === hlObj) return;
  for (const [mesh, mat] of hlList) mesh.material = mat;
  hlList = [];
  hlObj = o;
  for (const s of [].concat(show || [])) s.traverse(mesh => {
    if (!mesh.isMesh || !mesh.visible || mesh.material === hitMat) return;
    hlList.push([mesh, mesh.material]);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(hlTint) : hlTint(mesh.material);
  });
}
let screenKey = '', screenT = 0;
// order boards (counter, kitchen, grill wall): the Higgsfield chalkboard with chalk lettering, food icons per item and a
// status dot: waiting, on the grill, ready (on its tray, or only the sauce missing), served
const chalkImg = new Image();
chalkImg.crossOrigin = 'anonymous';
chalkImg.onload = () => { screenKey = ''; };
chalkImg.src = 'ui/chalkboard.jpg';
document.fonts.load('22px "Lilita One"').then(() => { screenKey = ''; }, () => {});
const DOT = { waiting: '#ff6b5b', grill: '#ffb020', ready: '#5fe07a', served: '#7ec8ff' };
function drawScreens(dt) { // counter POS + kitchen display: active orders per table
  if ((screenT -= dt) > 0) return;
  screenT = 0.3;
  const rows = [];
  for (const c of customers.filter(c => c.items && ['toTable', 'wait', 'eat'].includes(c.state)).sort((a, b) => a.table.n - b.table.n)) {
    rows.push({ head: `TABLE ${c.table.n} (${1 + c.members.length})`, note: c.state === 'eat' ? 'EATING' : c.state === 'toTable' ? 'SEATING' : passTrays[c.table.n - 1].ready ? 'TRAY READY' : 'WAITING' });
    const n = {}, tray = passTrays[c.table.n - 1];
    for (const i of c.items) {
      const e = (n[i.dish + (i.sauce ? '+' + i.sauce : '')] ||= [0, 0, 0]);
      e[0]++;
      if (i.served) e[1]++;
      if (i.served && (!i.sauce || i.sauced)) e[2]++;
    }
    for (const [key, [k, sv, done]] of Object.entries(n)) {
      const [d, sc] = key.split('+'), onTray = tray.items.filter(x => x.kind === 'dish' && x.type === d).length;
      const st = done === k ? 'served' : sv === k || sv + onTray >= k ? 'ready' : grillFood.some(f => f.type === d && foodState(f) !== 'burnt') ? 'grill' : 'waiting';
      rows.push({ d, sc, k, st });
    }
  }
  const waiting = queue.filter(c => c.state === 'order').length, paying = payQueue.length;
  const key = JSON.stringify(rows) + waiting + paying + isOpen + Math.floor(clockMin) + chalkImg.complete;
  if (key === screenKey) return;
  screenKey = key;
  const g = orderCanvas.getContext('2d'), W = 512, H = 360, L = 44, R = 468;
  if (chalkImg.complete && chalkImg.naturalWidth) g.drawImage(chalkImg, 0, 0, W, H);
  else { g.fillStyle = '#1f2321'; g.fillRect(0, 0, W, H); }
  const chalk = (t, x, y, size, color = '#f4f1ea', align = 'left') => {
    g.font = `${size}px "Lilita One", "Arial Rounded MT Bold", sans-serif`; g.textAlign = align; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(255,255,255,0.35)'; g.shadowBlur = 2; g.fillStyle = color; g.fillText(t, x, y); g.shadowBlur = 0;
  };
  chalk('ACTIVE ORDERS', L, 54, 26);
  chalk(isOpen ? fmtTime(clockMin) : 'CLOSED', R, 54, 22, '#ffd76a', 'right');
  g.fillStyle = 'rgba(244,241,234,0.5)'; g.fillRect(L, 70, R - L, 2);
  let y = 92;
  if (!rows.length) chalk(isOpen ? 'No open orders' : 'Restaurant closed', L, y + 4, 22, 'rgba(244,241,234,0.75)');
  for (const r of rows.slice(0, 8)) {
    if (r.head) {
      chalk(r.head, L, y, 21, '#ffd76a');
      chalk(r.note, R, y, 17, '#cfe8d5', 'right');
    } else {
      const ic = iconImg(r.d), sc = r.sc && iconImg(r.sc);
      if (ic.complete && ic.naturalWidth) g.drawImage(ic, L + 8, y - 13, 26, 26);
      if (sc && sc.complete && sc.naturalWidth) g.drawImage(sc, L + 34, y - 11, 22, 22);
      chalk(`×${r.k}  ${FOODS[r.d].name}${r.sc ? ' + ' + SAUCES[r.sc].short : ''}`, L + (r.sc ? 62 : 40), y, 19);
      g.fillStyle = DOT[r.st]; g.beginPath(); g.arc(R - 8, y, 7, 0, Math.PI * 2); g.fill();
    }
    y += 27;
  }
  const foot = [waiting && `COUNTER: ${waiting} to order`, paying && `REGISTER: ${paying} to pay`].filter(Boolean).join(' · ');
  if (foot) chalk(foot, L, H - 50, 18, '#ffb347');
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
// Chrome reports the cursor snapping back as one big movement when the lock engages (before or after
// pointerlockchange): skip the first movement under a new lock and anything right after the change
let lockedAt = 0, lockSeen = false;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) lockedAt = performance.now();
  startEl.style.display = document.pointerLockElement || uiMode ? 'none' : 'flex';
});
document.addEventListener('mousemove', e => {
  if (uiMode === 'pos') return posPointer(e);
  const locked = !!document.pointerLockElement, fresh = locked && !lockSeen;
  lockSeen = locked;
  if (!locked || fresh || uiMode || busy || performance.now() - lockedAt < 150) return;
  yaw -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.5, 1.5);
  camera.rotation.set(pitch, yaw, 0);
});
renderer.domElement.addEventListener('mousedown', () => { if (uiMode === 'pos') posClick(); });
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (uiMode === 'pos') return posKey(e);
  if (e.code === 'Escape' && uiMode === 'os') closeUI();
  if (e.code === 'KeyE' && document.pointerLockElement && !uiMode && !busy && currentAction?.fn && (!e.repeat || currentAction.repeat)) {
    currentAction.fn();
    updateInteraction(); // holding E keeps grabbing while the action allows it
  }
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
onProp('knife', L => {
  knife.children.forEach(m => { m.visible = false; });
  const m = makeProp(L);
  m.rotation.z = Math.PI / 2; // blade upright for cutting
  m.position.set(0.02, 0, -0.11); // handle in the grip, blade forward
  m.castShadow = false;
  knife.add(m);
});
const handPlate = new THREE.Mesh(plateGeo, plateMat);
handPlate.visible = false;
hands.add(handPlate);
const handSauce = new THREE.MeshStandardMaterial({ roughness: 0.35 }); // recolored for each pour
const handBottle = makeBottle('chimi'), handCup = makeCup('chimi');
for (const o of [handBottle, handCup]) o.traverse(m => { if (m.material === sauceMat('chimi')) m.material = handSauce; });
handBottle.position.set(0, 0.06, -0.06);
handCup.position.set(0, 0.035, -0.07);
handBottle.visible = handCup.visible = false;
handR.add(handBottle);
handL.add(handCup);
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 5), handSauce);
stream.visible = false;
hands.add(stream);
const holdSlot = new THREE.Group(); // carried things sit small in the lower right, clear of the crosshair and the prompt
hands.add(holdSlot);
const HELD_SCALE = { crate: 0.55, whole: 0.5, bottle: 0.8, tray: 0.32 };
const HAND_POSE = { // camera space: hands [x, y, z, rotX, rotZ], held item [x, y, z]
  none: { L: [-0.3, -0.75, -0.42, 0, 0], R: [0.3, -0.75, -0.42, 0, 0], item: [0, -0.6, -0.5] },
  hold: { L: [-0.3, -0.75, -0.42, 0, 0], R: [0.37, -0.37, -0.52, 0.1, -0.5], item: [0.4, -0.25, -0.58] },
  cut: { L: [-0.16, -0.36, -0.52, 0.3, 0.2], R: [0.13, -0.31, -0.5, 0, -0.15], item: [0, -0.6, -0.5] },
  pour: { L: [-0.05, -0.31, -0.46, 0.2, 0.25], R: [0.12, -0.2, -0.46, 0, -0.35], item: [0, -0.6, -0.5] },
};
let reachT = 1, bobT = 0;
function reach() { reachT = 0; } // quick pick-up / place motion
function hold(h) { held = h; h.mesh.position.set(0, 0, 0); holdSlot.add(h.mesh); reach(); sfx.pick(); }
function dropHeld() { if (held) holdSlot.remove(held.mesh); held = null; reach(); }
const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function updateHands(dt, moving) {
  reachT = Math.min(1, reachT + dt / 0.3);
  const r = Math.sin(Math.PI * reachT), k = Math.min(1, dt * 14);
  const P = HAND_POSE[busy ? busy.kind : held ? 'hold' : 'none'];
  if (moving) bobT += dt * 9;
  const bob = Math.sin(bobT) * 0.012, chop = busy?.kind === 'cut' ? Math.abs(Math.sin(busy.t * 11)) : 0;
  for (const [h, p, c] of [[handL, P.L, 0], [handR, P.R, chop]]) {
    h.position.lerp(tmpV.set(p[0], p[1] + bob + r * 0.04 + c * 0.08, p[2] - r * 0.1), k);
    h.rotation.x += (p[3] - c * 0.7 - h.rotation.x) * k;
    h.rotation.z += (p[4] - h.rotation.z) * k;
  }
  knife.visible = busy?.kind === 'cut';
  boardKnife.visible = busy?.kind !== 'cut';
  handL.visible = !knife.visible; // cutting shows no arms: only the knife, chopping over the board
  for (const m of handR.children) if (m !== knife) m.visible = !knife.visible;
  const pouring = busy?.kind === 'pour', tilt = pouring ? Math.max(0, Math.min(1, busy.t / 0.35, (busy.dur - busy.t) / 0.25)) : 0;
  handBottle.visible = handCup.visible = pouring;
  handBottle.rotation.z = 1.9 * tilt;
  if (pouring) handCup.userData.fill.scale.set(1, 1, 1).multiplyScalar(0.15 + 0.85 * Math.min(1, busy.t / busy.dur));
  stream.visible = tilt > 0.7;
  if (stream.visible) { // a thin pour from the bottle neck into the cup
    hands.worldToLocal(handBottle.localToWorld(tmpA.set(0, 0.11, 0)));
    hands.worldToLocal(handCup.localToWorld(tmpB.set(0, 0.012, 0)));
    stream.position.addVectors(tmpA, tmpB).multiplyScalar(0.5);
    stream.scale.set(1, tmpA.distanceTo(tmpB), 1);
    stream.quaternion.setFromUnitVectors(UP, tmpB.sub(tmpA).normalize());
  }
  const [x, y, z] = P.item;
  holdSlot.position.set(x, y + bob + r * 0.04, z - r * 0.1);
  holdSlot.scale.setScalar(held ? HELD_SCALE[held.kind] || 1 : 1);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
const lastPos = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const playing = (!!document.pointerLockElement || uiMode === 'pos') && (!uiMode || uiMode === 'pos'); // the shift keeps running at the register
  if (playing) {
    if (busy) updateBusy(dt); else if (uiMode !== 'pos') updatePlayer(dt);
    if (isOpen) {
      clockMin = Math.min(clockMin + dt * TIME_SCALE, CLOSE_AT + 60);
      if (clockMin >= CLOSE_AT && !warnedClosing) {
        warnedClosing = true;
        toast('Closing time! No new guests. Finish up, then CLOSE at the front door sign.', '#ffb347', 5);
      }
      if (clockMin < CLOSE_AT) updateDemand(dt);
    }

    const speed = grillSpeed();
    for (const f of [...grillFood]) {
      f.t += dt * (f.t < FOODS[f.type].cook ? speed : 1); // Better Grill speeds up cooking, never the burn window
      const d = FOODS[f.type], st = foodState(f);
      grillFx(f, st, dt);
      if (cookLook(f.mesh, Math.min(1, f.t / d.cook), st === 'burnt' ? 1 : st === 'ready' ? (f.t - d.cook) / d.burn * 0.55 : 0)) continue;
      const col = new THREE.Color().setRGB(...d.raw);
      if (st === 'cooking') col.lerp(new THREE.Color(1, 1, 1), f.t / d.cook);
      else if (st === 'ready') col.setRGB(1, 1, 1).lerp(new THREE.Color(0.3, 0.2, 0.15), (f.t - d.cook) / d.burn * 0.7);
      else col.setRGB(0.02, 0.018, 0.018);
      f.mesh.material.color.copy(col);
    }
    stepPuffs(smoke, dt);
    stepPuffs(sizzle, dt);
    slotLights.forEach((l, i) => {
      const f = grillFood.find(g => g.slot === i), st = f && foodState(f), d = f && FOODS[f.type];
      l.visible = i < slotCount();
      l.material.color.setHex(!f ? 0x333333 : st === 'cooking' ? 0xffb020 : st === 'burnt' ? 0x140404
        : f.t - d.cook > d.burn - BURN_WARN && Math.floor(f.t * 4) % 2 ? 0xff2a2a : 0x2ee060);
    });
    if (sizzleGain) sizzleGain.gain.value = grillFood.length ? 0.015 * grillFood.length : 0;

    for (const c of [...customers]) updateCustomer(c, dt);
    updateStaff(dt);
    passTrays.forEach(syncTray);
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

  updatePOS(dt, playing);
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
  camera, customers, queue, payQueue, grillFood, tables, stock, trays, crates, bins, trayObjs, UPGRADES, ROLES, history, staff, transactions, pos,
  scene, charLib, CHARS, CHAR_H, SEAT_TOP, propLib, PROPS, passTrays, holders, sauceLevel, slotLights, SLOTS, SAUCES, DAYS, ITEMS, PATIENCE, sauceAvail, slotCount, tipFactor, foodState, grillNeed,
  sign: signPivot, door: doorPivot, board, monitor, posMon, hands: { L: handL, R: handR, knife, plate: handPlate, bottle: handBottle, cup: handCup, stream, slot: holdSlot }, MOOD,
  get money() { return money; }, set money(v) { money = v; }, get drawer() { return drawer; }, get held() { return held; }, get action() { return currentAction; },
  get day() { return day; }, set day(v) { day = v; }, get isOpen() { return isOpen; }, get clockMin() { return clockMin; }, set clockMin(v) { clockMin = v; },
  get today() { return today; }, get busy() { return busy; }, get uiMode() { return uiMode; }, get delivery() { return delivery; },
  get screenKey() { return screenKey; }, set sinceArrival(v) { sinceArrival = v; }, dayCfg, demandRate, billTotal, tipPct, availability, FOODS,
  setLook(y, p) { yaw = y; pitch = p; camera.rotation.set(p, y, 0); },
  lookAt(x, y, z) { const p = camera.position; this.setLook(Math.atan2(p.x - x, p.z - z), Math.atan2(y - p.y, Math.hypot(x - p.x, z - p.z))); },
  posButton(id) { // screen position of a register button, so tests can drive the real mouse
    const b = pos.buttons.find(k => k.id === id);
    if (!b) return null;
    const v = posScreen.localToWorld(new THREE.Vector3(((b.x + b.w / 2) / 1024 - 0.5) * POS_W, (0.5 - (b.y + b.h / 2) / 720) * POS_H, 0)).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
  },
};
