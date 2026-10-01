// Smoke test for the Higgsfield characters: Day 1 and a Day 4 lunch rush. Customers walk, sit and leave, staff work;
// an in-page sampler checks that nobody floats or sinks, clips through chairs or the table, or faces the wrong way.
// Run with the dev server up (npm run dev):  NODE_PATH=$(npm root -g) node tests/playtest-characters.cjs [day1] [day4]
// Needs Playwright with Chromium. Env: GAME_URL (default http://localhost:5173/), SHOTS=<dir> to save screenshots.
const { chromium } = require('playwright');
const URL = process.env.GAME_URL || 'http://localhost:5173/';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const SAMPLER = `(() => {
  const g = __game, V = g.camera.position.constructor, v = new V(), u = new V();
  const S = window.__S = { n: { toy: 0, proc: 0, walk: 0, sit: 0, exit: 0, floatBad: 0, faceN: 0, faceBad: 0, chairBad: 0, seatedChecked: 0, seatBad: 0 }, worst: [], last: new Map(), checked: new WeakSet() };
  const chairs = () => g.tables.filter(t => t.active).flatMap(t => t.seats.map(s => ({ t, s })));
  function sat(cx, cz, ry, hx, hz, b) { // person footprint (oriented box) against a chair (axis-aligned box)
    const ux = [Math.cos(ry), -Math.sin(ry)], uz = [Math.sin(ry), Math.cos(ry)], bc = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2], bh = [(b[1] - b[0]) / 2, (b[3] - b[2]) / 2];
    for (const a of [[1, 0], [0, 1], ux, uz]) {
      const d = Math.abs((cx - bc[0]) * a[0] + (cz - bc[1]) * a[1]);
      const rp = hx * Math.abs(a[0] * ux[0] + a[1] * ux[1]) + hz * Math.abs(a[0] * uz[0] + a[1] * uz[1]), rb = bh[0] * Math.abs(a[0]) + bh[1] * Math.abs(a[1]);
      if (d > rp + rb) return false;
    }
    return true;
  }
  const bad = (k, msg) => { S.n[k]++; if (S.worst.length < 12) S.worst.push(msg); };
  window.__sample = () => {
    const people = [...g.customers.flatMap(c => [{ o: c, rig: c.rig, own: c.table.seats[0] }, ...c.members.map(m => ({ o: m, rig: m.rig, own: c.table.seats[m.seatI] }))]), ...g.staff.map(e => ({ o: e, rig: e.rig }))];
    for (const P of people) {
      const r = P.rig, root = r.root, st = P.o.state;
      if (!r.toy) { S.n.proc++; continue; }
      S.n.toy++;
      if (st === 'exit') S.n.exit++;
      root.updateWorldMatrix(true, true);
      const upper = r.model.children[0], legs = r.legGroup.children[0];
      const each = (mesh, f) => { const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index.array; for (let i = 0; i < idx.length; i++) f(v.fromBufferAttribute(pos, idx[i]).applyMatrix4(mesh.matrixWorld)); };
      const p = root.position, ry = root.rotation.y;
      if (r.sitT < 0.03 && p.z < 6) { // standing or walking inside: feet on the floor, never through a chair, facing the way they walk
        S.n.walk++;
        let minY = 1e9; each(legs, q => { if (q.y < minY) minY = q.y; });
        if (minY < -0.03 || minY > 0.09) bad('floatBad', st + ' feet at ' + minY.toFixed(3));
        for (const { s } of chairs()) {
          if (P.own === s && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < 1.45) continue; // stepping into / out of its own chair
          const b = [s.pos.x - 0.27, s.pos.x + 0.27, s.pos.z - 0.27, s.pos.z + 0.27];
          if (sat(p.x, p.z, ry, 0.5, 0.33, b)) bad('chairBad', st + ' at ' + p.x.toFixed(2) + ',' + p.z.toFixed(2) + ' through chair ' + s.pos.x + ',' + s.pos.z);
        }
        const l = S.last.get(r);
        let dir = null;
        if (l && r.walk > 0.6) { const dx = p.x - l[0], dz = p.z - l[1], d = Math.hypot(dx, dz);
          if (d > 0.12) { dir = [dx / d, dz / d];
            if (l[2] && dir[0] * l[2][0] + dir[1] * l[2][1] > 0.97) { // a straight stretch: no corner between the samples
              S.n.faceN++;
              if (dir[0] * Math.sin(ry) + dir[1] * Math.cos(ry) < 0.9) bad('faceBad', st + ' moving ' + dir[0].toFixed(2) + ',' + dir[1].toFixed(2) + ' facing ' + Math.sin(ry).toFixed(2) + ',' + Math.cos(ry).toFixed(2)); } } }
        S.last.set(r, [p.x, p.z, dir]);
      } else S.last.delete(r);
      if (r.sitT > 0.98 && !S.checked.has(r)) { // seated: on the seat, clear of the chair back and the table edge
        S.checked.add(r); S.n.sit++; S.n.seatedChecked++;
        const inv = root.matrixWorld.clone().invert();
        let back = 0, table = 0, seat = 0, low = 1e9;
        each(upper, q => {
          const y = q.y; u.copy(q).applyMatrix4(inv); // chair frame: +z towards the table
          if (Math.abs(u.x) < 0.25 && y > 0.45 && y < 1.05 && u.z < -0.215) back++;
          if (Math.abs(u.x) < 0.6 && y > 0.71 && y < 0.79 && u.z > 0.41) table++;
          if (Math.abs(u.x) < 0.25 && Math.abs(u.z) < 0.25 && y < 0.455) seat++;
          if (Math.abs(u.x) < 0.25 && Math.abs(u.z) < 0.25) low = Math.min(low, y);
        });
        if (back || table || seat || low > 0.53) bad('seatBad', r.type + ' seated: ' + back + ' in chair back, ' + table + ' in table, ' + seat + ' in seat, lowest ' + low.toFixed(3));
      }
    }
    return S.n;
  };
})()`;

function helpers(p) {
  const g = (fn, a) => p.evaluate(fn, a);
  const at = (x, z) => g(([x, z]) => __game.camera.position.set(x, 1.6, z), [x, z]);
  const look = (x, y, z) => g(([x, y, z]) => __game.lookAt(x, y, z), [x, y, z]);
  const sample = () => p.evaluate(() => window.__sample());
  const waitFor = async (fn, ms, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(fn, arg)) return true; await sample(); await p.waitForTimeout(250); } return false; };
  const run = async ms => { const t = Date.now(); while (Date.now() - t < ms) { await sample(); await p.waitForTimeout(250); } };
  const label = async (want, ms = 5000) => { const t = Date.now(); let l; while (Date.now() - t < ms) { l = await g(() => __game.action && __game.action.label); if (l && l.startsWith(want)) return l; await p.waitForTimeout(100); } return l; };
  const act = async (x, z, tx, ty, tz, want, quiet) => { await at(x, z); await look(tx, ty, tz); const l = await label(want); if (!quiet || !(l && l.startsWith(want))) check(!!l && l.startsWith(want), `prompt: ${l} (wanted ${want})`); await p.keyboard.press('KeyE'); await p.waitForTimeout(250); return l; };
  const bin = async (id, want) => { const x = await g(i => __game.bins.find(b => b.id === i).x, id); return act(x, -10.3, x, 0.95, -11.4, want, true); };
  async function storeStarter() {
    for (const c of await g(() => __game.crates.map(c => ({ item: c.item, x: c.mesh.position.x, z: c.mesh.position.z })))) {
      await act(c.x - 1.2, c.z, c.x, 0.25, c.z, '[E] Pick up crate', true);
      await bin(c.item, '[E] Store');
    }
  }
  const open = () => act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT', true);
  const close = () => act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] CLOSE RESTAURANT', true);
  const takeOrders = async () => { while (await g(() => __game.queue[0] && __game.queue[0].state === 'order')) await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order', true); };
  const shot = async (n, eye, tgt) => { await at(eye[0], eye[1]); await look(...tgt); await p.waitForTimeout(500); if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${n}.png` }); };
  return { g, at, look, sample, waitFor, run, label, act, bin, storeStarter, open, close, takeOrders, shot, p };
}
// past 22:00 no new guests come in; whoever is still inside gives up and walks out through the door
// (closing first would not show it: the end-of-day summary pauses the world 1.4 s after the sign turns)
const lastOrders = () => {
  __game.clockMin = Math.max(__game.clockMin, 22 * 60);
  for (const c of __game.customers) if (c.state !== 'exit') { c.patience = Math.min(c.patience, 0.01); if (c.state === 'eat') c.eatT = 0.01; }
  return __game.customers.length === 0;
};
async function report(H, name) {
  const n = await H.sample(), w = await H.g(() => __S.worst);
  console.log(`info ${name}: ${JSON.stringify(n)}`);
  if (w.length) console.log('  first problems: ' + w.join(' | '));
  check(n.toy > 0 && n.proc === 0, `${name}: every character is a Higgsfield model (${n.toy} samples)`);
  check(n.floatBad === 0, `${name}: nobody floats or sinks while standing/walking (${n.walk} samples)`);
  check(n.chairBad === 0, `${name}: nobody walks through a chair`);
  check(n.faceN > 20 && n.faceBad === 0, `${name}: everyone faces the way they walk (${n.faceN} moves)`);
  check(n.seatedChecked > 0 && n.seatBad === 0, `${name}: ${n.seatedChecked} seated guests sit on the seat, clear of chair back and table`);
}

const SECTIONS = {
  async day1(H) {
    const { g, waitFor, run, p } = H;
    await H.storeStarter();
    await H.open();
    await g(() => { __game.sinceArrival = 100; });
    check(await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000), 'a party walked in to the counter');
    await H.shot('h_counter', [-4.5, -0.6], [-4.3, 1.1, -2.6]);
    await H.takeOrders();
    check(await waitFor(() => __game.customers.some(c => c.state === 'wait' && c.members.every(m => m.state === 'wait')), 120000), 'the party walked to its table and sat down');
    await run(2500);
    const tb = await g(() => { const c = __game.customers.find(c => c.state === 'wait'); return [c.table.x, c.table.z]; });
    await H.shot('h_seated', [tb[0] + 2.2, tb[1] - 2.0], [tb[0], 0.9, tb[1]]);
    await g(() => { __game.sinceArrival = 100; });
    await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000);
    await H.shot('h_walk', [-4.2, 3.2], [-4.6, 1.0, -0.5]);
    await H.takeOrders();
    await waitFor(() => __game.customers.filter(c => c.state === 'wait').length >= 2, 120000);
    await run(2500);
    // first party: done eating, goes to pay; second party: gives up and leaves from its seat
    await g(() => { const [a, b] = __game.customers.filter(c => c.state === 'wait'); a.items.forEach(i => { i.served = i.sauced = true; }); a.state = 'eat'; a.eatT = 0.05; b.patience = 0.01; });
    check(await waitFor(() => __game.customers.some(c => c.state === 'payLine' || c.state === 'paying'), 120000), 'a guest walked to the register');
    check(await waitFor(() => __game.customers.some(c => c.state === 'exit'), 20000), 'an unhappy party got up and walked out');
    await run(8000);
    check(await waitFor(lastOrders, 180000), 'everyone left through the door');
    await H.close();
    await report(H, 'day 1');
  },

  async day4(H) {
    const { g, waitFor, run, p } = H;
    await H.storeStarter();
    await g(() => { __game.money += 1000; });
    await H.act(-6.3, -10.2, -6.3, 1.12, -11.6, '[E] USE TERMINAL', true);
    await p.click('#os [data-a=tab][data-v=upgrades]');
    for (const r of ['prep', 'server', 'grill']) await p.click(`#os [data-a=hire][data-v=${r}]`);
    await p.click('#os [data-a=exit]');
    await g(() => Document.prototype.exitPointerLock.call(document));
    check(await g(() => __game.staff.length === 3 && __game.staff.every(e => e.rig.toy && e.rig.type === 'asador')), 'prep cook, server and grill cook are all the asador model');
    await g(() => { __game.day = 4; });
    await H.open();
    await g(() => { __game.clockMin = 12 * 60 + 40; });
    check(await waitFor(() => /LUNCH RUSH/.test(document.getElementById('hud').textContent), 8000), 'day 4 lunch rush');
    const seen = { prep: false, grill: false, tray: false, sat: 0 };
    const t0 = Date.now();
    while (Date.now() - t0 < 300000) {
      await H.takeOrders();
      await g(() => __game.customers.forEach(c => c.items && c.items.forEach(i => { i.sauce = null; }))); // no sauce: trays can go out without the player
      await g(() => __game.grillFood.forEach(f => { if (f.owner) f.t = Math.max(f.t, __game.FOODS[f.type].cook); })); // headless game time runs ~0.3x
      const s = await g(() => ({ prep: __game.staff.find(e => e.role === 'prep').state === 'prep', grill: __game.grillFood.some(f => f.owner), tray: __game.passTrays.some(t => t.away), sat: __game.customers.filter(c => c.state === 'wait' || c.state === 'eat').length }));
      seen.prep ||= s.prep; seen.grill ||= s.grill; seen.tray ||= s.tray; seen.sat = Math.max(seen.sat, s.sat);
      if (seen.tray && seen.grill && seen.sat >= 2 && Date.now() - t0 > 90000) break;
      await H.sample();
      await p.waitForTimeout(400);
    }
    check(seen.prep && seen.grill && seen.tray, `staff at work: prep cook cutting ${seen.prep}, grill cook grilling ${seen.grill}, server carrying a tray ${seen.tray}`);
    if (!seen.tray) console.log('  trays: ' + JSON.stringify(await g(() => __game.passTrays.map(t => ({ ready: t.ready, claimed: t.claimed, away: t.away, owner: t.owner && t.owner.state, key: t.key }))))
      + ' staff: ' + JSON.stringify(await g(() => __game.staff.map(e => [e.role, e.state, e.group.position.toArray().map(v => +v.toFixed(2))]))));
    check(seen.sat >= 2, `up to ${seen.sat} parties seated during the rush`);
    await H.shot('h_staff', [5.8, -1.6], [4.4, 1.0, -4.6]);
    const sv = await g(() => __game.staff.find(e => e.role === 'server').group.position.toArray());
    await H.shot('h_server', [sv[0] + 1.6, sv[2] + 1.4], [sv[0], 1.0, sv[2]]);
    await H.shot('h_dining', [6.5, 5.2], [1.5, 0.8, 0.5]);
    check(await waitFor(lastOrders, 200000), 'at closing time every guest walked out');
    await H.close();
    await report(H, 'day 4');
  },
};

(async () => {
  const want = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, fn] of Object.entries(SECTIONS)) {
    if (want.length && !want.includes(name)) continue;
    console.log(`== ${name}`);
    const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(URL);
    await p.waitForFunction(() => window.__game && ['asador', 'grandpa', 'fan', 'senora'].every(t => __game.charLib[t]), null, { timeout: 30000 });
    await p.evaluate(() => { Object.defineProperty(document, 'pointerLockElement', { get: () => document.body, configurable: true }); document.getElementById('start').style.display = 'none'; });
    await p.evaluate(SAMPLER);
    try { await fn(helpers(p)); } catch (e) { check(false, `${name}: exception ${e.message.split('\n')[0]}`); }
    check(!errs.length, `${name}: no page errors ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
    await p.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})();
