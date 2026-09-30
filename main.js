import * as THREE from 'three';

// ---------- Config ----------
const FOODS = {
  chorizo:   { name: 'Chorizo',   price: 15, cook: 9,  burn: 8, raw: 0xc0504d, done: 0x7a2e1a },
  vacio:     { name: 'Vacío',     price: 25, cook: 13, burn: 8, raw: 0xd9807a, done: 0x8b4a2b },
  provoleta: { name: 'Provoleta', price: 20, cook: 7,  burn: 6, raw: 0xf5e6a8, done: 0xd9a441 },
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
const grillLight = new THREE.PointLight(0xff7a2a, 8, 6);
grillLight.position.set(4.5, 1.6, -4.8);
scene.add(grillLight);

// ---------- Helpers ----------
const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
const colliders = [];

function box(w, h, d, color, x, y, z, collide = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), mat(0xb5623c));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const street = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), mat(0x777777));
street.rotation.x = -Math.PI / 2;
street.position.set(0, -0.01, 9);
scene.add(street);

const WALL = 0xf0e0c0, WH = 3.5;
box(16, WH, 0.2, WALL, 0, WH / 2, -6);          // back
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

// Grill
const grill = box(3, 0.9, 0.9, 0x333333, 4.5, 0.45, -5.3);
grill.userData.kind = 'grill';
const coals = box(2.8, 0.05, 0.7, 0xff5a1a, 4.5, 0.86, -5.3, false);
coals.material.emissive = new THREE.Color(0xff3a00);
coals.material.emissiveIntensity = 0.8;
coals.userData.kind = 'grill';
for (let i = 0; i < 12; i++) box(0.03, 0.03, 0.8, 0x111111, 3.15 + i * 0.245, 0.92, -5.3, false); // grate bars
box(3.2, 0.4, 1.1, 0x555555, 4.5, 3.1, -5.35, false); // hood
const grillLabel = makeLabel('PARRILLA', 0.4);
grillLabel.position.set(4.5, 2.5, -5.2);
scene.add(grillLabel);
const SLOTS = [3.6, 4.5, 5.4];
const slotCount = () => (has('grill') ? 3 : 2);

// Tables
const tables = [
  { x: 0, z: 0.5 }, { x: 4, z: 0.5 }, { x: 0, z: 3.8 }, { x: 4, z: 3.8 },
].map((t, i) => {
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), mat(0x9c6b3c));
  top.position.y = 0.75;
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.75, 0.15), mat(0x5a3a1a));
  leg.position.y = 0.37;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), mat(0x6b4423));
  seat.position.set(-1, 0.45, 0);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.5), mat(0x6b4423));
  back.position.set(-1.25, 0.75, 0);
  const cleg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.45, 0.1), mat(0x5a3a1a));
  cleg.position.set(-1, 0.22, 0);
  g.add(top, leg, seat, back, cleg);
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
function makeFoodMesh(type) {
  let geo;
  if (type === 'chorizo') { geo = new THREE.CapsuleGeometry(0.06, 0.25, 4, 8); geo.rotateZ(Math.PI / 2); }
  else if (type === 'vacio') geo = new THREE.BoxGeometry(0.35, 0.06, 0.22);
  else geo = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 16);
  const m = new THREE.Mesh(geo, mat(FOODS[type].raw));
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
const SHIRTS = [0x3a6ea5, 0xc94c4c, 0x4c9c5a, 0xd9a13b, 0x8a5ca8, 0x2f8f8f];
function spawnCustomer() {
  const free = tables.filter(t => t.active && !t.customer);
  if (!free.length) return;
  const table = free[Math.floor(Math.random() * free.length)];
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.7, 4, 8), mat(SHIRTS[Math.floor(Math.random() * SHIRTS.length)]));
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(0xe0b08a));
  head.position.y = 1.4;
  g.add(body, head);
  g.traverse(o => { o.castShadow = true; });
  g.position.copy(OUTSIDE);
  const bar = makeBar();
  bar.position.y = 1.9;
  g.add(bar);
  const c = {
    group: g, bar, table, state: 'enter', path: [DOOR_IN.clone()],
    order: FOOD_KEYS[Math.floor(Math.random() * 3)], patience: QUEUE_PATIENCE, maxPatience: QUEUE_PATIENCE,
    orderedAt: 0, bubble: null, food: null, eatT: 0,
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
      const col = new THREE.Color(d.raw);
      if (st === 'cooking') col.lerp(new THREE.Color(d.done), f.t / d.cook);
      else if (st === 'ready') col.set(d.done).lerp(new THREE.Color(0x2a1a10), (f.t - d.cook) / d.burn * 0.6);
      else col.set(0x151515);
      f.mesh.material.color.copy(col);
      if (st === 'cooking') setBar(f.bar, f.t / d.cook, 0xffcc33);
      else if (st === 'ready') setBar(f.bar, 1 - (f.t - d.cook) / d.burn, Math.floor(f.t * 4) % 2 && f.t - d.cook > d.burn * 0.6 ? 0xff4444 : 0x44dd44);
      else setBar(f.bar, 1, 0x000000);
    }
    if (sizzleGain) sizzleGain.gain.value = grillFood.length ? 0.015 * grillFood.length : 0;

    for (const c of [...customers]) updateCustomer(c, dt);
    coals.material.emissiveIntensity = 0.7 + Math.sin(performance.now() / 200) * 0.15;
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
