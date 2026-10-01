// Focused playtest: table trays, multi-carry, grill cook, grill levels, burn window, patience, day 4 smoke run.
// Each section runs on a fresh page; pass section names to run only those (e.g. `... playtest-service.cjs trays cook`).
// Run with the dev server up (npm run dev):  NODE_PATH=$(npm root -g) node tests/playtest-service.cjs
// Needs Playwright with Chromium. Env: GAME_URL (default http://localhost:5173/), SHOTS=<dir> to save screenshots.
const { chromium } = require('playwright');
const shot = (p, n) => process.env.SHOTS && p.screenshot({ path: `${process.env.SHOTS}/${n}.png` });
const URL = process.env.GAME_URL || 'http://localhost:5173/';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

function helpers(p) {
  const g = (fn, a) => p.evaluate(fn, a);
  const at = (x, z) => g(([x, z]) => __game.camera.position.set(x, 1.6, z), [x, z]);
  const look = (x, y, z) => g(([x, y, z]) => __game.lookAt(x, y, z), [x, y, z]);
  const waitFor = async (fn, ms, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(fn, arg)) return true; await p.waitForTimeout(200); } return false; };
  const label = async (want, ms = 5000) => { const t = Date.now(); let l; while (Date.now() - t < ms) { l = await g(() => __game.action && __game.action.label); if (l && l.startsWith(want)) return l; await p.waitForTimeout(100); } return l; };
  const act = async (x, z, tx, ty, tz, want, quiet) => { await at(x, z); await look(tx, ty, tz); const l = await label(want); if (!quiet || !(l && l.startsWith(want))) check(!!l && l.startsWith(want), `prompt: ${l} (wanted ${want})`); await p.keyboard.press('KeyE'); await p.waitForTimeout(250); return l; };
  const binX = id => g(i => __game.bins.find(b => b.id === i).x, id);
  const bin = async (id, want, quiet = true) => { const x = await binX(id); return act(x, -10.3, x, 0.95, -11.4, want, quiet); };
  const held = () => g(() => { const h = __game.held; return h && { kind: h.kind, type: h.type, n: h.items ? h.items.length : 1, types: h.items ? h.items.map(x => x.type) : null }; });
  const trayX = n => 3.3 + (n - 1) * 1.3;
  const tray = (n, want, quiet) => act(trayX(n), -4.3, trayX(n), 1.07, -3.4, want, quiet);
  const grill = (want, quiet = true) => act(4.5, -4.3, 4.5, 0.93, -5.3, want, quiet);
  const ready = () => g(() => __game.grillFood.forEach(f => { if (f.t < __game.FOODS[f.type].cook) f.t = __game.FOODS[f.type].cook; }));
  const unlock = () => g(() => Document.prototype.exitPointerLock.call(document));
  async function storeStarter() {
    for (const c of await g(() => __game.crates.map(c => ({ item: c.item, x: c.mesh.position.x, z: c.mesh.position.z })))) {
      await act(c.x - 1.2, c.z, c.x, 0.25, c.z, '[E] Pick up crate', true);
      await bin(c.item, '[E] Store');
    }
  }
  const open = () => act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT', true);
  async function party(spec, tag) { // the next party orders exactly `spec` ([dish, sauce] per item) and waits seated
    await g(() => { __game.sinceArrival = 100; });
    if (!(await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000))) { check(false, `party ${tag} arrived`); return null; }
    await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order', true);
    await g(([spec, tag]) => {
      const c = __game.customers.find(c => c.items && !c.testId && c.state === 'toTable');
      c.testId = tag;
      c.items = spec.map(([dish, sauce], k) => ({ dish, sauce, served: false, sauced: false, q: 0, seat: k % (1 + c.members.length) }));
      c.missedSauce = false;
    }, [spec, tag]);
    await waitFor(t => __game.customers.find(c => c.testId === t).state === 'wait', 120000, tag);
    return g(t => { const c = __game.customers.find(c => c.testId === t); c.patience = c.maxPatience = 9999; return { x: c.table.x, z: c.table.z, n: c.table.n }; }, tag);
  }
  const P = (tag, fn) => g(([t, f]) => new Function('c', 'return ' + f)(__game.customers.find(c => c.testId === t)), [tag, fn]);
  const T = n => g(n => { const t = __game.passTrays[n - 1]; return { items: t.items.map(x => x.kind + ':' + x.type), ready: t.ready, away: t.away, key: t.key, claimed: t.claimed }; }, n);
  async function pour(s) { // fill a cup at the sauce station (Chimichurri holder at x -1, Criolla at -0.4)
    const x = s === 'chimi' ? -1 : -0.4;
    await act(x, -4.7, x, 1.1, -5.64, '[E] Fill a cup', true);
    await waitFor(() => !__game.busy, 20000);
  }
  async function terminal(tab) {
    await act(-6.3, -10.2, -6.3, 1.12, -11.6, '[E] USE TERMINAL', true);
    await p.click(`#os [data-a=tab][data-v=${tab}]`);
  }
  const exitTerminal = async () => { await p.click('#os [data-a=exit]'); await unlock(); };
  return { g, at, look, waitFor, label, act, binX, bin, held, trayX, tray, grill, ready, storeStarter, open, party, P, T, pour, terminal, exitTerminal, unlock, p };
}

const SECTIONS = {
  async trays(H) {
    const { g, act, held, tray, grill, ready, party, P, T, pour, bin, waitFor, terminal, exitTerminal, p } = H;
    await H.storeStarter();
    await g(() => { __game.sauceLevel.chimi = __game.sauceLevel.criolla = 10; });
    await H.open();
    const A = await party([['chorizo', 'chimi'], ['provoleta', null]], 'A');
    check((await T(A.n)).items.length === 0 && !(await T(A.n)).ready, `Table ${A.n} has its own empty tray on the pass`);
    await bin('chorizo', '[E] Take'); await bin('chorizo', '[E] Take another');
    await grill('[E] Grill 2×');
    await bin('provoleta', '[E] Take');
    await grill('[E] Grill 1×');
    await ready();
    await grill('[E] Pick up 3 ready pieces');
    const l1 = await tray(A.n, '[E] Put 2 dishes');
    check((await T(A.n)).items.sort().join() === 'dish:chorizo,dish:provoleta' && (await held())?.n === 1, `right items go on the tray, the extra chorizo stays in hand (${l1})`);
    await H.at(H.trayX(A.n), -4.3); await H.look(H.trayX(A.n), 1.07, -3.4);
    const wrong = await H.label('Table');
    check(wrong === `Table ${A.n} doesn't need Chorizo`, `wrong item refused: "${wrong}"`);
    await grill('[E] Discard');
    await H.at(H.trayX(A.n), -4.3); await H.look(H.trayX(A.n), 1.07, -3.4);
    const need = await H.label(`Table ${A.n}'s tray needs`);
    check(/needs: Chimichurri$/.test(need || ''), `tray not READY without its sauce: "${need}"`);
    await pour('criolla');
    await H.at(H.trayX(A.n), -4.3); await H.look(H.trayX(A.n), 1.07, -3.4);
    const wrongCup = await H.label('Table');
    check(wrongCup === `Table ${A.n} doesn't need Salsa Criolla`, `wrong sauce cup refused: "${wrongCup}"`);
    await act(-0.4, -4.7, -0.4, 1.1, -5.64, '[E] Pour the cup back', true);
    await pour('chimi');
    await tray(A.n, '[E] Put Chimichurri');
    const tA = await T(A.n);
    check(tA.ready && tA.key === 'ready' && tA.items.length === 3, `all dishes + sauce on the tray: READY (green sign) ${JSON.stringify(tA)}`);
    await H.at(H.trayX(A.n) - 0.6, -4.25); await H.look(H.trayX(A.n), 1.0, -3.4); await p.waitForTimeout(400); await shot(p, 'p_tray_ready');
    await tray(A.n, `[E] Take Table ${A.n}'s tray`);
    check((await held())?.kind === 'tray' && (await T(A.n)).away, 'player carries the READY tray');
    await act(A.x, A.z - 1.5, A.x, 0.79, A.z, `[E] Serve Table ${A.n}`);
    check(await P('A', 'c.state === "eat" && c.items.every(i => i.served && (!i.sauce || i.sauced)) && c.items[0].mesh.children.length === 1'), 'whole tray served: dishes on the table, cup next to the chorizo, party eating');
    const back = await T(A.n);
    check(!back.away && !back.items.length && !(await held()), 'tray back on the pass, empty');
    // the server takes a READY tray in one trip
    await g(() => { __game.money += 500; });
    await terminal('upgrades');
    const os = await g(() => document.getElementById('os').innerText);
    check(/Server \$25\/day wage[\s\S]*?\$60/.test(os), 'server listed at $60 hire, $25/day');
    await p.click('#os [data-a=hire][data-v=server]');
    await exitTerminal();
    check(await g(() => __game.staff.some(e => e.role === 'server') && __game.today.staff === 60), 'server hired on day 1 for $60');
    const B = await party([['chorizo', 'chimi'], ['provoleta', null]], 'B');
    await bin('chorizo', '[E] Take'); await grill('[E] Grill 1×');
    await bin('provoleta', '[E] Take'); await grill('[E] Grill 1×');
    await ready();
    await grill('[E] Pick up 2 ready pieces');
    await tray(B.n, '[E] Put 2 dishes');
    await pour('chimi');
    await tray(B.n, '[E] Put Chimichurri');
    check(await waitFor(n => __game.passTrays[n - 1].claimed || __game.passTrays[n - 1].away, 20000, B.n), 'server claims the READY tray');
    check(await waitFor(n => __game.passTrays[n - 1].away && __game.staff.find(e => e.role === 'server').state === 'deliver', 30000, B.n), 'server carries the whole tray');
    const sv = await g(() => __game.staff.find(e => e.role === 'server').group.position.toArray());
    await H.at(sv[0] + 1.4, sv[2] + 1.2); await H.look(sv[0], 1.2, sv[2]); await p.waitForTimeout(400); await shot(p, 'p_server_tray');
    check(await waitFor(t => { const c = __game.customers.find(c => c.testId === t); return c.state === 'eat' && c.items.every(i => i.served && (!i.sauce || i.sauced)); }, 90000, 'B'), 'server delivered every dish and the sauce in one trip');
    check(await waitFor(n => !__game.passTrays[n - 1].away && !__game.passTrays[n - 1].items.length && __game.staff.find(e => e.role === 'server').state !== 'return', 60000, B.n), 'server brought the empty tray back');
  },

  async carry(H) {
    const { g, p, bin, held, grill, ready, party, tray, T } = H;
    await H.storeStarter();
    await H.open();
    const A = await party([['chorizo', null], ['provoleta', null]], 'A');
    await bin('chorizo', '[E] Take Chorizo');
    await bin('chorizo', '[E] Take another Chorizo (2/4)');
    await H.label('[E] Take another Chorizo (3/4)');
    await p.keyboard.down('KeyE');
    for (let i = 0; i < 6; i++) { await p.keyboard.down('KeyE'); await p.waitForTimeout(120); }
    await p.keyboard.up('KeyE');
    await p.waitForTimeout(300);
    const h4 = await held();
    check(h4?.kind === 'portion' && h4.n === 4 && await g(() => __game.stock.chorizo.length === 2), `holding E grabs up to 4 of the same kind (holding ${h4?.n}, ${await g(() => __game.stock.chorizo.length)} left)`);
    await H.at(4.5, -7.5); await H.look(4.5, 3.4, -9); await p.waitForTimeout(300);
    const prompt = await g(() => document.getElementById('prompt').textContent);
    check(prompt === 'Carrying: 4× raw Chorizo', `prompt shows the stack: "${prompt}"`);
    const ndc = await g(() => { const v = new __game.camera.position.constructor(); __game.hands.slot.getWorldPosition(v).project(__game.camera); return [v.x, v.y]; });
    check(ndc[0] > 0.35 && ndc[1] < -0.3, `carried stack sits in the lower right, clear of the center (screen ${ndc.map(v => v.toFixed(2))})`);
    await H.at(4.5, -4.3); await H.look(4.5, 0.6, -5.3); await p.waitForTimeout(300); await shot(p, 'p_carry');
    await bin('chorizo', '[E] Put back 4× Chorizo');
    check(!(await held()) && await g(() => __game.stock.chorizo.length === 6), 'the whole stack goes back to its bin');
    await bin('chorizo', '[E] Take'); await bin('chorizo', '[E] Take another'); await bin('chorizo', '[E] Take another');
    await grill('[E] Grill 3× Chorizo');
    check(!(await held()) && await g(() => __game.grillFood.length === 3), 'one E grills every carried portion');
    await bin('provoleta', '[E] Take'); await bin('provoleta', '[E] Take another');
    const lp = await grill('[E] Grill 1× Provoleta (1 stay in hand');
    check((await held())?.n === 1 && await g(() => __game.grillFood.length === 4), `leftovers stay in hand when the grill is full (${lp})`);
    for (let i = 0; i < 2; i++) await bin('provoleta', '[E] Take another Provoleta'); // empties the bin (2 were left)
    await bin('provoleta', '[E] Put back 3× Provoleta'); // a stack goes back once it is full or its bin is empty
    await ready();
    await grill('[E] Pick up 4 ready pieces');
    const hc = await held();
    check(hc?.kind === 'cooked' && hc.n === 4 && hc.types.filter(t => t === 'provoleta').length === 1 && await g(() => !__game.grillFood.length), 'one E takes every ready piece, mixed dishes');
    await H.at(4.5, -4.3); await H.look(4.5, 3.4, -4); await p.waitForTimeout(300);
    const pc = await g(() => document.getElementById('prompt').textContent);
    check(pc === 'Carrying: 3× grilled Chorizo, 1× grilled Provoleta', `prompt: "${pc}"`);
    await tray(A.n, '[E] Put 2 dishes');
    check((await T(A.n)).items.length === 2 && (await held())?.n === 2, 'tray takes what the table needs, the rest stays in hand');
  },

  async cook(H) {
    const { g, p, bin, grill, party, T, waitFor, terminal, exitTerminal, held } = H;
    await H.storeStarter();
    await g(() => { __game.money += 500; });
    await terminal('upgrades');
    check(await g(() => !/COMING SOON/.test(document.getElementById('os').innerText) && !!document.querySelector('#os [data-a=hire][data-v=grill]')), 'grill cook is hireable (no "coming soon")');
    await p.click('#os [data-a=hire][data-v=grill]');
    await exitTerminal();
    check(await g(() => __game.staff.some(e => e.role === 'grill') && __game.today.staff === 120), 'grill cook hired ($120)');
    await H.open();
    await bin('provoleta', '[E] Take'); await grill('[E] Grill 1× Provoleta'); // the player grills too
    await bin('provoleta', '[E] Take'); // ...and keeps one in hand
    const mySlot = await g(() => __game.grillFood.find(f => f.type === 'provoleta').slot);
    const stock0 = await g(() => __game.stock.chorizo.length);
    const A = await party([['chorizo', null], ['chorizo', null]], 'A');
    check(await waitFor(() => __game.grillFood.filter(f => f.owner && f.type === 'chorizo').length === 2, 120000), 'grill cook fetched what the order needs and put 2 chorizos on the grill');
    check(await g(s => __game.stock.chorizo.length === s - 2, stock0), 'it took them from cold storage');
    const slots = await g(() => __game.grillFood.map(f => [f.type, f.slot, !!f.owner]));
    check(await g(s => __game.grillFood.some(f => f.type === 'provoleta' && !f.owner && f.slot === s) && __game.grillFood.filter(f => f.owner).every(f => f.slot !== s), mySlot), `player and grill cook share the grill, cook on free spots only (${JSON.stringify(slots)})`);
    await g(() => __game.grillFood.forEach(f => { if (f.owner) f.t = __game.FOODS[f.type].cook; }));
    let burnt = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (await g(() => __game.grillFood.some(f => f.owner && __game.foodState(f) === 'burnt'))) burnt = true;
      if (await g(n => __game.passTrays[n - 1].items.length === 2, A.n)) break;
      await p.waitForTimeout(200);
    }
    const tr = await T(A.n);
    check(!burnt && tr.items.join() === 'dish:chorizo,dish:chorizo' && tr.ready, `cook picked them up when ready and put both on Table ${A.n}'s tray: READY`);
    check(await g(() => __game.grillFood.some(f => f.type === 'provoleta' && !f.owner)), "cook left the player's provoleta on the grill");
    check((await held())?.type === 'provoleta' && (await held()).n === 1, 'cook never touched what the player carries');
    await H.at(5.6, -2.6); await H.look(4.5, 1.2, -4.3); await p.waitForTimeout(400); await shot(p, 'p_grill_cook');
  },

  async grill(H) {
    const { g, p, terminal, exitTerminal, waitFor } = H;
    check(await g(() => __game.slotCount() === 4) && await waitFor(() => __game.slotLights.filter(l => l.visible).length === 4, 5000), 'grill starts with 4 spots (4 lamps)');
    await g(() => { __game.money += 2000; });
    await terminal('upgrades');
    const prices = [];
    for (let k = 0; k < 3; k++) {
      prices.push(await g(() => { const row = [...document.querySelectorAll('#os tr')].find(r => /Bigger Grill/.test(r.innerText)); return row.innerText.match(/\$\d+/)[0]; }));
      await p.click('#os [data-a=buy][data-v=grill]');
      prices.push(await g(() => __game.slotCount()));
    }
    check(prices.join() === '$150,6,$300,8,$450,10', `Bigger Grill: 3 levels, +2 spots each (${prices.join(' ')})`);
    check(await g(() => /Bigger Grill[\s\S]*?OWNED/.test(document.getElementById('os').innerText) && __game.today.upgrades === 900), 'maxed after level 3 ($900 spent)');
    await exitTerminal();
    check(await waitFor(() => __game.slotLights.filter(l => l.visible).length === 10, 5000), '10 lamps on the grill front');
    const ok = await g(() => { const s = __game.SLOTS; return new Set(s.map(a => a.join())).size === 10 && s.every(([x, z]) => x > 3.2 && x < 5.8 && z > -5.6 && z < -5); });
    check(ok, '10 distinct spots, all on the existing grate');
    await H.storeStarter();
    for (let k = 0; k < 2; k++) { await H.bin('chorizo', '[E] Take'); for (let i = 0; i < 2; i++) await H.bin('chorizo', '[E] Take another'); await H.grill('[E] Grill'); }
    await H.bin('provoleta', '[E] Take'); for (let i = 0; i < 1; i++) await H.bin('provoleta', '[E] Take another');
    await H.grill('[E] Grill 2×');
    check(await g(() => __game.grillFood.length === 8 && new Set(__game.grillFood.map(f => f.slot)).size === 8), '8 pieces grilling at once on 8 different spots');
    await H.at(4.5, -3.0); await H.look(4.5, 0.85, -5.2); await p.waitForTimeout(400); await shot(p, 'p_grill10');
  },

  async burn(H) {
    const { g, p, bin, grill } = H;
    check(await g(() => Object.values(__game.FOODS).every(f => f.burn === 20)), 'every dish: 20 s from ready to burnt');
    await H.storeStarter();
    await bin('chorizo', '[E] Take'); await grill('[E] Grill');
    const lamp = async ms => { const seen = new Set(); const t = Date.now(); while (Date.now() - t < ms) { seen.add(await g(() => __game.slotLights[__game.grillFood[0].slot].material.color.getHex())); await p.waitForTimeout(60); } return [...seen]; };
    await g(() => { const f = __game.grillFood[0]; f.t = __game.FOODS[f.type].cook + 1; });
    const calm = await lamp(1500);
    await g(() => { const f = __game.grillFood[0]; f.t = __game.FOODS[f.type].cook + 14.5; });
    const warn = await lamp(2500);
    check(calm.join() === String(0x2ee060) && warn.includes(0xff2a2a) && warn.includes(0x2ee060), `lamp steady green, flashing red only in the last 6 s (${calm.map(c => c.toString(16))} / ${warn.map(c => c.toString(16))})`);
    const st = await g(() => { const f = __game.grillFood[0], d = __game.FOODS[f.type], s = []; for (const dt of [19.9, 20.05]) { const t = f.t; f.t = d.cook + dt; s.push(__game.foodState(f)); f.t = t; } return s; });
    check(st.join() === 'ready,burnt', `ready until 20 s, then burnt (${st})`);
    await g(() => { __game.UPGRADES.find(u => u.id === 'grillq').level = 1; __game.grillFood[0].t = __game.FOODS.chorizo.cook + 1; });
    await bin('chorizo', '[E] Take'); await grill('[E] Grill');
    const r = await g(async () => {
      const [a, b] = __game.grillFood, t0 = [a.t, b.t];
      await new Promise(res => setTimeout(res, 3000));
      return [b.t - t0[1], a.t - t0[0]]; // b cooking (Better Grill), a ready
    });
    const ratio = r[0] / r[1];
    check(Math.abs(ratio - 1.35) < 0.05, `Better Grill: cooking runs ×${ratio.toFixed(2)}, the burn window stays real time`);
  },

  async patience(H) {
    const { g, act, waitFor } = H;
    check(await g(() => [1, 2, 3, 4, 5, 6, 7].every(d => { const old = __game.day; __game.day = d; const v = __game.dayCfg().patience; __game.day = old; return v === 1; })), 'patience factor 1.0 on every day');
    await H.storeStarter();
    await H.open();
    await g(() => { __game.sinceArrival = 100; });
    await waitFor(() => __game.queue.length > 0, 150000);
    check(await g(() => __game.queue[0].maxPatience === 60), `order queue: 60 s (${await g(() => __game.queue[0].maxPatience)})`);
    await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 60000);
    await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order', true);
    await g(() => { const c = __game.customers.find(c => c.items && c.state === 'toTable'); c.testId = 'A'; });
    await waitFor(() => __game.customers.find(c => c.testId === 'A').state === 'wait', 120000);
    const w = await g(() => { const c = __game.customers.find(c => c.testId === 'A'), k = 15 * (c.items.length - 1), f = [];
      for (const s of [60, 90, 120, 130]) { c.waitT = s + k; f.push(+__game.tipFactor(c).toFixed(2)); }
      c.waitT = 0; return { n: c.items.length, max: c.maxPatience, f }; });
    check(w.max === 150 + 15 * (w.n - 1), `food wait: leaves at ${w.max} s for ${w.n} dish(es) (150 s + 15 s per extra dish)`);
    check(w.f.join() === '1,0.5,0,0', `tip factor: full ≤60 s, linear to 0 at 120 s (+15 s/extra dish): ${w.f.join(' ')}`);
    await g(() => { const c = __game.customers.find(c => c.testId === 'A'); c.items.forEach(i => { i.served = i.sauced = true; }); c.state = 'eat'; c.eatT = 0.05; });
    check(await waitFor(() => { const c = __game.customers.find(c => c.testId === 'A'); return c.state === 'toPay' || c.state === 'payLine' || c.state === 'paying'; }, 30000), 'party goes to pay');
    check(await g(() => __game.customers.find(c => c.testId === 'A').maxPatience === 60), 'pay line: 60 s');
    await g(() => { __game.UPGRADES.find(u => u.id === 'interior').level = 1; __game.sinceArrival = 100; });
    await waitFor(() => __game.customers.some(c => !c.testId && c.state !== 'exit'), 150000);
    check(await g(() => Math.abs(__game.customers.find(c => !c.testId && c.state !== 'exit').maxPatience - 78) < 1e-9), 'Better Interior still adds 30% (queue 78 s)');
  },

  async day4(H) {
    const { g, p, waitFor, act } = H;
    await H.storeStarter();
    await g(() => { __game.day = 4; });
    check(await g(() => __game.dayCfg().sauces.includes('criolla') && __game.dayCfg().party.includes(4)), 'day 4 config: bigger parties, both sauces');
    await H.open();
    await g(() => { __game.clockMin = 12 * 60 + 40; });
    check(await waitFor(() => /LUNCH RUSH/.test(document.getElementById('hud').textContent), 8000), 'LUNCH RUSH on day 4');
    let peak = 0, orders = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      peak = Math.max(peak, await g(() => __game.customers.filter(c => c.state !== 'exit').length));
      if (await g(() => __game.queue[0] && __game.queue[0].state === 'order')) { await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order', true); orders++; }
      await p.waitForTimeout(500);
    }
    check(peak >= 1 && orders >= 1, `lunch rush: up to ${peak} parties in, ${orders} orders taken`);
    check(await g(() => __game.passTrays.slice(0, 3).every(t => t.key)), 'trays kept in sync during the rush');
    await H.at(6.5, 5); await H.look(-2, 1.2, -3); await p.waitForTimeout(400); await shot(p, 'p_day4');
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
    await p.waitForTimeout(1500);
    await p.evaluate(() => { Object.defineProperty(document, 'pointerLockElement', { get: () => document.body, configurable: true }); document.getElementById('start').style.display = 'none'; });
    try { await fn(helpers(p)); } catch (e) { check(false, `${name}: exception ${e.message.split('\n')[0]}`); }
    check(!errs.length, `${name}: no page errors ${errs.length ? JSON.stringify(errs.slice(0, 3)) : ''}`);
    await p.close();
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})();
