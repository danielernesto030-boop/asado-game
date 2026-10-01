// Stage 2 playtest: sauce bottles → sauce station → pour a cup → plate at the service counter → server or player serves;
// grill slot lamps, mood badges, physical signs (no floating labels), closing clears the pass
// Run with the dev server up (npm run dev):  NODE_PATH=$(npm root -g) node tests/playtest-service.cjs
// Needs Playwright with Chromium. Env: GAME_URL (default http://localhost:5173/), SHOTS=<dir> to save screenshots.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  const errs = []; global.__errs = errs;
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(process.env.GAME_URL || 'http://localhost:5173/');
  await p.waitForTimeout(1500);
  await p.evaluate(() => { Object.defineProperty(document, 'pointerLockElement', { get: () => document.body, configurable: true }); document.getElementById('start').style.display = 'none'; });
  const g = (fn, a) => p.evaluate(fn, a);
  let fails = 0;
  const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
  const at = (x, z) => g(([x, z]) => __game.camera.position.set(x, 1.6, z), [x, z]);
  const look = (x, y, z) => g(([x, y, z]) => __game.lookAt(x, y, z), [x, y, z]);
  const waitFor = async (fn, ms, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(fn, arg)) return true; await p.waitForTimeout(200); } return false; };
  const label = async (want, ms = 5000) => { const t = Date.now(); let l; while (Date.now() - t < ms) { l = await g(() => __game.action && __game.action.label); if (l && l.startsWith(want)) return l; await p.waitForTimeout(100); } return l; };
  const act = async (x, z, tx, ty, tz, want, quiet) => { await at(x, z); await look(tx, ty, tz); const l = await label(want); if (!quiet || !(l && l.startsWith(want))) check(!!l && l.startsWith(want), `prompt: ${l} (wanted ${want})`); await p.keyboard.press('KeyE'); await p.waitForTimeout(200); return l; };
  const shot = n => process.env.SHOTS && p.screenshot({ path: `${process.env.SHOTS}/${n}.png` });
  const unlock = () => g(() => Document.prototype.exitPointerLock.call(document));
  const binX = id => g(i => __game.bins.find(b => b.id === i).x, id);
  const A = fn => g(f => new Function('c', 'return ' + f)(__game.customers.find(c => c.testId === 'A')), fn);
  const held = () => g(() => __game.held && { kind: __game.held.kind, type: __game.held.type, sauce: __game.held.sauce || null });
  const STATION = [-1, -4.7, -1, 1.1, -5.64]; // stand + look at the Chimichurri holder

  // ---------------- physical signs only: no floating label sprites left in the world
  check(await g(() => { let n = 0; __game.scene.traverse(o => { if (o.isSprite) n++; }); return n === 0; }), 'no floating label sprites in the restaurant (signs are physical plaques)');
  check(await g(() => __game.ITEMS.chimi_bottle && __game.bins.length === 7), 'sauce bottles are wholesale items with their own cold-storage bins (7 bins)');

  // ---------------- buy sauce bottles + hire a server at the office terminal
  for (const c of await g(() => __game.crates.map(c => ({ item: c.item, x: c.mesh.position.x, z: c.mesh.position.z })))) {
    await act(c.x - 1.2, c.z, c.x, 0.25, c.z, '[E] Pick up crate', true);
    const bx = await binX(c.item);
    await act(bx, -10.3, bx, 0.95, -11.4, '[E] Store', true);
  }
  await g(() => { __game.money += 1000; });
  await act(-6.3, -10.2, -6.3, 1.12, -11.6, '[E] USE TERMINAL');
  await p.click('#os [data-a=tab][data-v=upgrades]');
  await p.click('#os [data-a=hire][data-v=server]');
  check(await g(() => __game.staff.some(e => e.role === 'server') && /HIRED/.test(document.getElementById('os').innerText)), 'server hired at the terminal');
  await p.click('#os [data-a=tab][data-v=wholesale]');
  check(await g(() => /2 bottles · 10 cups each/.test(document.getElementById('os').innerText)), 'wholesale lists sauce bottles (2 bottles · 10 cups each)');
  await p.click('#os [data-a=qty][data-v=chimi_bottle][data-d="1"]');
  await p.click('#os [data-a=qty][data-v=criolla_bottle][data-d="1"]');
  await p.click('#os [data-a=order]');
  await p.click('#os [data-a=exit]'); await unlock();
  check(await waitFor(() => __game.crates.length === 2, 60000), 'bottle crates delivered');
  for (const c of await g(() => __game.crates.map(c => ({ item: c.item, x: c.mesh.position.x, z: c.mesh.position.z })))) {
    await act(c.x - 1.2, c.z, c.x, 0.25, c.z, '[E] Pick up crate', true);
    const bx = await binX(c.item);
    await act(bx, -10.3, bx, 0.95, -11.4, '[E] Store');
  }
  check(await g(() => __game.stock.chimi_bottle.length === 2 && __game.stock.criolla_bottle.length === 2), 'bottles stored in cold storage (2 + 2)');

  // ---------------- bottle → sauce station → pour a cup
  const cx = await binX('criolla_bottle');
  await act(cx, -10.3, cx, 0.95, -11.4, '[E] Take Salsa Criolla');
  check((await held())?.kind === 'bottle', 'holding a bottle of Salsa Criolla');
  await act(cx, -10.3, cx, 0.95, -11.4, '[E] Put back Salsa Criolla');
  check(await g(() => !__game.held && __game.stock.criolla_bottle.length === 2), 'bottle put back in its bin');
  const chx = await binX('chimi_bottle');
  await act(chx, -10.3, chx, 0.95, -11.4, '[E] Take Chimichurri');
  await act(...STATION, '[E] Place the Chimichurri bottle');
  check(await g(() => __game.sauceLevel.chimi === 10 && !__game.held && __game.holders[0].bottle.visible), 'bottle placed at the sauce station: 10 cups');
  check(await g(() => __game.sauceAvail('chimi') === 20), 'sauce stock = station bottle + stored bottle (20 cups)');
  await act(...STATION, '[E] Fill a cup of Chimichurri');
  check(await g(() => __game.busy && __game.busy.kind === 'pour'), 'pouring: hands are busy');
  await waitFor(() => __game.hands.stream.visible, 8000);
  check(await g(() => __game.hands.bottle.visible && __game.hands.cup.visible), 'pour animation: bottle in one hand, cup in the other');
  await shot('z2_pour');
  check(await waitFor(() => !__game.busy, 20000) && (await held())?.kind === 'sauce' && await g(() => __game.sauceLevel.chimi === 9), 'holding a cup of Chimichurri, bottle at 9/10');
  await act(...STATION, '[E] Pour the cup back');
  check(await g(() => __game.sauceLevel.chimi === 10 && !__game.held), 'cup poured back');

  // ---------------- a party orders 3 chorizos, two of them with chimichurri
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT');
  check(await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000), 'a party reached the counter');
  await g(() => { __game.queue[0].testId = 'A'; });
  await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order');
  await g(() => {
    const c = __game.customers.find(c => c.testId === 'A'), it = (sauce, seat) => ({ dish: 'chorizo', sauce, served: false, sauced: false, q: 0, seat });
    c.items = [it('chimi', 0), it(null, c.members.length ? 1 : 0), it('chimi', 0)];
    c.missedSauce = false;
  });
  check(await waitFor(() => { const c = __game.customers.find(c => c.testId === 'A'); return c.state === 'wait'; }, 120000), 'party seated');
  await g(() => { const c = __game.customers.find(c => c.testId === 'A'); c.patience = c.maxPatience = 9999; });
  const tb = await A('[c.table.x, c.table.z]');
  await at(tb[0], tb[1] - 1.5); await look(tb[0], 0.79, tb[1]);
  const tl = await label('Mesa');
  check(/patience \d+%/.test(tl || ''), `table prompt shows the order and patience: "${tl}"`);

  // ---------------- grill two chorizos: slot lamps go yellow, then green
  const chz = await binX('chorizo');
  for (let k = 0; k < 2; k++) {
    await act(chz, -10.3, chz, 0.95, -11.4, '[E] Take Chorizo', true);
    await act(3.6, -4.2, 3.6, 0.93, -5.3, '[E] Grill', true);
  }
  const lamp = i => g(i => __game.slotLights[i].material.color.getHex(), i);
  check(await lamp(0) === 0xffb020 && await lamp(1) === 0xffb020 && await g(() => !__game.slotLights[2].visible), 'grill slot lamps: yellow while cooking (third slot hidden until upgraded)');
  await at(4.5, -3.0); await look(4.5, 0.8, -4.84); await p.waitForTimeout(400); await shot('z2_lamps');
  check(await waitFor(() => __game.grillFood.length === 2 && __game.grillFood.every(f => f.t >= __game.FOODS.chorizo.cook), 150000), 'both chorizos cooked');
  check(await lamp(0) === 0x2ee060, 'slot lamp turns green when the food is ready');

  // ---------------- both plates (no sauce yet) → service counter; the server delivers the one that matches
  let fp = await g(() => __game.grillFood.find(f => f.slot === 0).mesh.position.toArray());
  await act(fp[0], -4.2, fp[0], fp[1], fp[2], '[E] Pick up');
  await act(4.8, -4.3, 4.8, 1.0, -3.4, '[E] Place grilled Chorizo on the service counter');
  check(await g(() => __game.passItems.length === 1 && !__game.held), 'plate placed on the service counter');
  fp = await g(() => __game.grillFood[0].mesh.position.toArray());
  await act(fp[0], -4.2, fp[0], fp[1], fp[2], '[E] Pick up');
  await act(4.8, -4.3, 4.8, 1.0, -3.4, '[E] Place grilled Chorizo');
  check(await waitFor(() => __game.staff.some(e => e.role === 'server' && e.carry), 40000), 'server picked the plate up from the pass');
  await waitFor(() => __game.staff.find(e => e.role === 'server').state === 'deliver', 20000);
  const sv = await g(() => __game.staff.find(e => e.role === 'server').group.position.toArray());
  await at(sv[0] + 1.5, sv[2] - 1.2); await look(sv[0], 1.2, sv[2]); await p.waitForTimeout(400); await shot('z2_server');
  check(await waitFor(() => { const c = __game.customers.find(c => c.testId === 'A'); return c.items[1].served && __game.passItems.length === 1; }, 80000), 'server served the plain chorizo to the right table (the other plate waits)');
  check(await waitFor(() => __game.staff.find(e => e.role === 'server').state === 'idle', 60000), 'server walked back to the pass');

  // ---------------- plate 2 waits on the pass until it gets its sauce (the server only takes complete plates)
  const slotX = await g(() => __game.PASS_SLOTS[__game.passItems[0].slot]);
  await act(slotX, -4.3, slotX, 1.08, -3.4, '[E] Take Chorizo');
  check((await held())?.kind === 'cooked', 'picked a plate up from the service counter');
  await act(4.8, -4.3, 4.8, 1.0, -3.4, '[E] Place grilled Chorizo');
  await p.waitForTimeout(4000);
  check(await g(() => __game.passItems.length === 1 && !__game.passItems[0].claimed), 'server leaves a plate that still needs its sauce');
  await act(...STATION, '[E] Fill a cup of Chimichurri', true);
  await waitFor(() => !__game.busy, 20000);
  const slot2 = await g(() => __game.PASS_SLOTS[__game.passItems[0].slot]);
  await act(slot2, -4.3, slot2, 1.08, -3.4, '[E] Add Chimichurri to the Chorizo');
  check(await g(() => __game.passItems[0]?.sauce === 'chimi' && !__game.held), 'sauce cup added to the plate on the service counter');
  await at(slot2 - 0.7, -4.0); await look(slot2, 1.06, -3.4); await p.waitForTimeout(400); await shot('z2_pass');
  check(await waitFor(() => { const c = __game.customers.find(c => c.testId === 'A'); return c.items.filter(i => i.sauce && i.served && i.sauced).length === 1; }, 80000), 'server served the chorizo + chimichurri (dish and cup together)');

  // ---------------- dish 3: served by hand, then its sauce cup brought separately
  await act(chz, -10.3, chz, 0.95, -11.4, '[E] Take Chorizo', true);
  await act(3.6, -4.2, 3.6, 0.93, -5.3, '[E] Grill', true);
  await waitFor(() => __game.grillFood.some(f => f.t >= __game.FOODS.chorizo.cook), 150000);
  fp = await g(() => __game.grillFood[0].mesh.position.toArray());
  await act(fp[0], -4.2, fp[0], fp[1], fp[2], '[E] Pick up');
  await act(tb[0], tb[1] - 1.5, tb[0], 0.79, tb[1], '[E] Serve Chorizo');
  check(await A('c.items[2].served && !c.items[2].sauced && c.state === "wait"'), 'dish served without its sauce: the table still waits');
  check(await waitFor(() => __game.screenKey.includes('ADD SAUCE'), 8000), 'order screens show ADD SAUCE');
  await act(...STATION, '[E] Fill a cup of Chimichurri', true);
  await waitFor(() => !__game.busy, 20000);
  await act(tb[0], tb[1] - 1.5, tb[0], 0.79, tb[1], '[E] Serve Chimichurri with the Chorizo');
  check(await A('c.items.every(i => i.served && (!i.sauce || i.sauced)) && c.state === "eat"'), 'sauce cup served at the table: party complete and eating');
  await at(tb[0] + 0.9, tb[1] - 0.9); await look(tb[0], 0.8, tb[1]); await p.waitForTimeout(400); await shot('z2_table');
  const bill = await A('[__game.billTotal(c), c.items.map(i => i.mesh.children.length)]');
  check(bill[0] === 3 * 15 + 2 * 3, `bill: 3 chorizos + 2 chimichurri = $${bill[0]}`);
  check(bill[1].filter(n => n > 0).length === 2, 'both sauce cups sit next to their dishes');
  check(await g(() => __game.sauceLevel.chimi === 8), 'station bottle used for 2 cups (8/10 left)');

  // ---------------- mood badge instead of a patience bar
  await g(() => { __game.sinceArrival = 100; });
  if (await waitFor(() => __game.customers.some(c => c.state === 'queue' || c.state === 'order'), 150000)) {
    await g(() => { const c = __game.customers.find(c => c.state === 'queue' || c.state === 'order'); c.testId = 'M'; c.patience = c.maxPatience * 0.4; });
    await p.waitForTimeout(500);
    const m1 = await g(() => { const c = __game.customers.find(c => c.testId === 'M'); return [c.mood.visible, c.mood.material === __game.MOOD.warn]; });
    await g(() => { const c = __game.customers.find(c => c.testId === 'M'); c.patience = c.maxPatience * 0.2; });
    await p.waitForTimeout(500);
    const m2 = await g(() => { const c = __game.customers.find(c => c.testId === 'M'); return [c.mood.visible, c.mood.material === __game.MOOD.angry]; });
    check(m1[0] && m1[1] && m2[0] && m2[1], 'mood badge: yellow below 50% patience, red below 25%');
    const cp = await g(() => __game.customers.find(c => c.testId === 'M').group.position.toArray());
    await at(cp[0] + 1.2, cp[2] + 1.6); await look(cp[0], 1.7, cp[2]); await p.waitForTimeout(400); await shot('z2_mood');
    await g(() => { const c = __game.customers.find(c => c.testId === 'M'); c.patience = c.maxPatience; });
  } else check(false, 'a second party arrived for the mood check');

  // ---------------- closing clears the pass and sends the server home
  await act(chz, -10.3, chz, 0.95, -11.4, '[E] Take Chorizo', true);
  await act(3.6, -4.2, 3.6, 0.93, -5.3, '[E] Grill', true);
  await waitFor(() => __game.grillFood.some(f => f.t >= __game.FOODS.chorizo.cook), 150000);
  fp = await g(() => __game.grillFood[0].mesh.position.toArray());
  await act(fp[0], -4.2, fp[0], fp[1], fp[2], '[E] Pick up', true);
  await act(4.8, -4.3, 4.8, 1.0, -3.4, '[E] Place', true);
  await g(() => { __game.clockMin = 22 * 60 + 1; });
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] CLOSE RESTAURANT');
  check(await g(() => __game.passItems.length === 0 && __game.staff.find(e => e.role === 'server').carry === null), 'closing clears leftover plates from the pass');
  check(await waitFor(() => __game.uiMode === 'summary', 20000), 'end-of-day summary');
  check(await g(() => __game.history[0].staff === 90 + 35), `server wage on the books ($${await g(() => __game.history[0].staff)})`);

  console.log('errors:', errs.length ? errs : 'none');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch(e => { console.log('FAIL exception', e.message); console.log('errors:', global.__errs); process.exit(1); });
