// Stage 1 playtest: demand + parties + POS (card, cash, tips, drawer) + staff + multi-day, on top of the existing pipeline
// Run with the dev server up (npm run dev):  NODE_PATH=$(npm root -g) node tests/playtest-pos.cjs
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
  let maxParties = 0;
  const waitFor = async (fn, ms, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(fn, arg)) return true; maxParties = Math.max(maxParties, await g(() => __game.customers.filter(c => c.items && ['toTable', 'wait', 'eat'].includes(c.state)).length)); await p.waitForTimeout(200); } return false; };
  const label = async (want, ms = 5000) => { const t = Date.now(); let l; while (Date.now() - t < ms) { l = await g(() => __game.action && __game.action.label); if (l && l.startsWith(want)) return l; await p.waitForTimeout(100); } return l; };
  const act = async (x, z, tx, ty, tz, want, quiet) => { await at(x, z); await look(tx, ty, tz); const l = await label(want); if (!quiet || !(l && l.startsWith(want))) check(!!l && l.startsWith(want), `prompt: ${l} (wanted ${want})`); await p.keyboard.press('KeyE'); await p.waitForTimeout(200); return l; };
  const shot = n => process.env.SHOTS && p.screenshot({ path: `${process.env.SHOTS}/${n}.png` });
  const unlock = () => g(() => Document.prototype.exitPointerLock.call(document));
  const binX = id => g(i => __game.bins.find(b => b.id === i).x, id);
  const party = (tag, fn) => g(([t, f]) => { const c = __game.customers.find(c => c.testId === t); return c ? new Function('c', 'return ' + f)(c) : null; }, [tag, fn]);

  async function produce(dish) { // get a raw portion of `dish` into the hands
    if (dish === 'filet' || dish === 'vacio') {
      if (!(await g(d => __game.trays[d].length, dish))) {
        const bx = await binX(dish + '_whole');
        await act(bx, -10.3, bx, 0.95, -11.4, '[E] Take Whole', true);
        await act(4.2, -7.5, 4.2, 0.92, -6.6, '[E] PREPARE', true);
        await waitFor(() => !__game.busy, 30000);
      }
      await act(4.2, -7.5, dish === 'filet' ? 3.45 : 4.95, 0.93, -6.55, '[E] Take', true);
    } else {
      const bx = await binX(dish);
      await act(bx, -10.3, bx, 0.95, -11.4, '[E] Take', true);
    }
    return g(() => __game.held && __game.held.kind === 'portion' ? __game.held.type : null);
  }
  async function serveParty(tag) { // cook and serve everything this party ordered, one dish at a time
    let served = 0;
    for (let guard = 0; guard < 10; guard++) {
      const dish = await party(tag, "(c.items.find(i => !i.served) || {}).dish || null");
      if (!dish) break;
      const got = await produce(dish);
      if (got !== dish) { check(false, `got a raw ${dish} portion (holding ${got})`); return served; }
      await act(3.6, -4.2, 3.6, 0.93, -5.3, '[E] Grill', true);
      await waitFor(d => __game.grillFood.some(f => f.type === d && f.t >= __game.FOODS[d].cook), 150000, dish);
      const fp = await g(d => __game.grillFood.find(f => f.type === d).mesh.position.toArray(), dish);
      await act(fp[0], -4.2, fp[0], fp[1], fp[2], '[E] Pick up', true);
      await waitFor(t => { const c = __game.customers.find(c => c.testId === t); return c && c.state === 'wait'; }, 120000, tag);
      const tb = await party(tag, '[c.table.x, c.table.z]');
      await act(tb[0], tb[1] - 1.5, tb[0], 0.79, tb[1], '[E] Serve', true);
      served++;
    }
    return served;
  }
  async function posBtn(id) { // move the real mouse onto a register button and click it
    const xy = await g(i => __game.posButton(i), id);
    if (!xy) { check(false, `register button "${id}" on screen`); return; }
    await p.mouse.move(xy[0], xy[1], { steps: 3 });
    await p.waitForTimeout(200);
    await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(400);
  }
  const posState = () => g(() => ({ step: __game.pos.step, msg: __game.pos.msg, ui: __game.uiMode }));

  // ---------------- day 1 setup
  check(await g(() => __game.money === 0 && __game.drawer === 150 && __game.crates.length === 4), 'start: $0 bank, $150 cash float, 4 starter crates');
  for (const c of await g(() => __game.crates.map(c => ({ item: c.item, x: c.mesh.position.x, z: c.mesh.position.z })))) {
    await act(c.x - 1.2, c.z, c.x, 0.25, c.z, '[E] Pick up crate', true);
    const bx = await binX(c.item);
    await act(bx, -10.3, bx, 0.95, -11.4, '[E] Store', true);
  }
  check(await g(() => __game.crates.length === 0 && __game.stock.chorizo.length === 6), 'starter crates stored');
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT');
  check(await g(() => __game.isOpen), 'restaurant open');

  // ---------------- demand: a party arrives, orders, sits at its own chairs
  check(await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000), 'a party reached the counter');
  await g(() => { __game.queue[0].testId = 'A'; });
  const sizeA = await party('A', '1 + c.members.length');
  await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order');
  const oA = await party('A', 'c.items.map(i => i.dish + (i.sauce ? "+" + i.sauce : ""))');
  check(oA && oA.length >= 1, `party of ${sizeA} ordered: ${oA}`);
  check(await waitFor(t => { const c = __game.customers.find(c => c.testId === t); return c.state === 'wait' && c.members.every(m => m.state === 'wait'); }, 120000, 'A'), 'whole party seated');
  const seatsA = await party('A', '[c.group.position, ...c.members.map(m => m.group.position)].map(p => p.x.toFixed(1) + "," + p.z.toFixed(1))');
  check(new Set(seatsA).size === seatsA.length, `each guest on their own chair: ${seatsA.join(' | ')}`);
  await g(() => { const c = __game.customers.find(c => c.testId === 'A'); c.patience = c.maxPatience = 999; }); // the test cooks slowly in software rendering
  await at(-1, -1.2); await look(0, 0.9, 0.6); await p.waitForTimeout(300); await shot('y_party');
  const nServed = await serveParty('A');
  check(nServed === oA.length && await party('A', 'c.state') === 'eat', `served all ${nServed} dishes, party eating`);

  // ---------------- checkout by CARD at the register, driven with the real mouse
  check(await waitFor(() => __game.payQueue[0] && __game.payQueue[0].testId === 'A' && __game.payQueue[0].state === 'paying', 200000), 'party leader waiting at the register');
  await g(() => { const c = __game.payQueue[0]; c.pay = { method: 'card' }; c.patience = c.maxPatience = 999; });
  await act(-5.6, -4.4, -5.6, 1.4, -3.62, '[E] USE REGISTER');
  check(await g(() => __game.uiMode === 'pos'), 'register UI open (pointer released, cursor on the screen)');
  await p.waitForTimeout(2500);
  await shot('y_pos');
  const totalA = await g(() => __game.billTotal(__game.payQueue[0]));
  await posBtn('cash');
  check(/pays by CARD/.test((await posState()).msg), 'wrong payment method is refused');
  await posBtn('card');
  check((await posState()).step === 'cardAmount', 'card selected: reader asks for the amount');
  await posBtn('d9'); await posBtn('d9'); await posBtn('d9');
  await posBtn('enter');
  check(/must match/.test((await posState()).msg), 'wrong card amount is declined');
  await posBtn('clr');
  for (const d of String(totalA)) await posBtn('d' + d);
  const m0 = await g(() => __game.money);
  await posBtn('enter');
  check(await waitFor(() => __game.pos.step === 'cardApproved', 15000), 'guest chose a tip, PAYMENT APPROVED');
  const tipA = await g(() => __game.pos.tip);
  await shot('y_card');
  await posBtn('complete');
  const tA = await g(() => __game.transactions[__game.transactions.length - 1]);
  check(tA && tA.method === 'card' && tA.total === totalA && tA.tip === tipA, `card sale recorded: $${totalA} + $${tipA} tip`);
  check(await g(([m, t]) => __game.money === m + t, [m0, totalA + tipA]), 'card money reached the bank');
  check([0, 5, 10, 15].map(x => Math.round(totalA * x / 100)).includes(tipA), `tip is one of 0/5/10/15% (${tipA})`);
  await posBtn('logoff'); await unlock();
  check(await g(() => __game.uiMode === null), 'logged off the register');

  // ---------------- checkout in CASH (next party: the test skips its cooking to save time)
  check(await waitFor(() => __game.customers.some(c => c.state === 'wait' || (c.state === 'order' && !c.testId)), 200000), 'another party is in the restaurant');
  if (await g(() => !__game.customers.some(c => c.state === 'wait'))) await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order');
  await waitFor(() => __game.customers.some(c => c.state === 'wait'), 120000);
  await g(() => { const c = __game.customers.find(c => c.state === 'wait'); c.testId = 'B'; c.items.forEach(i => { i.served = true; i.q = 0; }); c.tipP = 0.9; c.state = 'eat'; c.eatT = 0.3; });
  check(await waitFor(() => __game.payQueue[0] && __game.payQueue[0].testId === 'B' && __game.payQueue[0].state === 'paying', 120000), 'second party at the register');
  const totalB = await g(() => __game.billTotal(__game.payQueue[0]));
  const tender = totalB <= 50 ? 50 : 100;
  await g(t => { const c = __game.payQueue[0]; c.pay = { method: 'cash', tender: t }; c.patience = c.maxPatience = 999; }, tender);
  await act(-5.6, -4.4, -5.6, 1.4, -3.62, '[E] USE REGISTER');
  await p.waitForTimeout(2500);
  const d0 = await g(() => __game.drawer), mB = await g(() => __game.money);
  await posBtn('cash');
  check((await posState()).step === 'cashAmount', 'cash selected');
  await posBtn('bill20');
  await posBtn('enter');
  check(tender === 20 || /handed you/.test((await posState()).msg), 'wrong received amount is caught');
  await posBtn('bill' + tender);
  await posBtn('enter');
  const ps = await g(() => ({ step: __game.pos.step, change: __game.pos.change }));
  check(ps.step === 'cashChange' && ps.change === tender - totalB, `change due $${ps.change} (gave $${tender} for $${totalB})`);
  await shot('y_cash');
  const txN = await g(() => __game.transactions.length);
  await posBtn('change');
  check(await waitFor(n => __game.transactions.length === n + 1, 15000, txN), 'cash sale recorded after the drawer closes');
  const tB = await g(() => __game.transactions[__game.transactions.length - 1]);
  check(tB.method === 'cash' && tB.total === totalB, `cash transaction: $${tB.total} + $${tB.tip} tip in the jar`);
  check(await g(([d, t]) => __game.drawer === d + t, [d0, totalB + tB.tip]), `drawer ${d0} → ${await g(() => __game.drawer)} (net of change)`);
  check(await g(m => __game.money === m, mB), 'cash does not reach the bank until closing');
  await posBtn('logoff'); await unlock();
  check(await g(() => __game.uiMode === null), 'logged off the register');

  // ---------------- rushes + demand shape
  await g(() => { __game.clockMin = 12 * 60 + 40; });
  check(await waitFor(() => /LUNCH RUSH/.test(document.getElementById('hud').textContent), 8000), 'LUNCH RUSH shown in the HUD');
  const rates = await g(() => { const base = __game.dayCfg().rate; const r = __game.demandRate(); __game.clockMin = 16 * 60; const q = __game.demandRate(); __game.clockMin = 12 * 60 + 40; return [base, r, q]; });
  check(rates[1] > rates[0] && rates[2] < rates[0], `demand: base ${rates[0]}/h, lunch ${rates[1].toFixed(2)}/h, afternoon ${rates[2].toFixed(2)}/h`);
  console.log(`info: day 1 peak of ${maxParties} parties with open orders (relaxed by design)`);

  // ---------------- staff: hire a prep cook through the terminal
  await g(() => { __game.money += 500; });
  await act(-6.3, -10.2, -6.3, 1.12, -11.6, '[E] USE TERMINAL');
  await p.click('#os [data-a=tab][data-v=upgrades]');
  check(await g(() => /COMING SOON/.test(document.getElementById('os').innerText) && !!document.querySelector('#os [data-a=hire][data-v=prep]')), 'STAFF section lists roles (server/grill cook coming soon)');
  await p.click('#os [data-a=hire][data-v=prep]');
  check(await g(() => __game.staff.length === 1 && __game.staff[0].role === 'prep' && __game.today.staff === 60), 'prep cook hired ($60)');
  await p.click('#os [data-a=tab][data-v=wholesale]');
  await p.click('#os [data-a=qty][data-v=vacio_whole][data-d="1"]');
  await p.click('#os [data-a=order]');
  await p.click('#os [data-a=exit]'); await unlock();
  check(await waitFor(() => __game.crates.length >= 1, 150000), 'delivery arrived');
  const dc = await g(() => { const c = __game.crates.find(c => c.item === 'vacio_whole'); return [c.mesh.position.x, c.mesh.position.z]; });
  await act(dc[0] - 1.2, dc[1], dc[0], 0.25, dc[1], '[E] Pick up crate');
  const vx = await binX('vacio_whole');
  await act(vx, -10.3, vx, 0.95, -11.4, '[E] Store');
  await at(1, -9); await look(4.2, 1, -6.6);
  check(await waitFor(() => __game.trays.vacio.length >= 6, 120000), `prep cook cut a whole vacío: tray ${await g(() => __game.trays.vacio.length)}`);

  // ---------------- close day 1, check the books
  await g(() => { __game.clockMin = 22 * 60 + 1; });
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] CLOSE RESTAURANT');
  check(await waitFor(() => __game.uiMode === 'summary', 20000), 'end-of-day summary');
  const h1 = await g(() => ({ ...__game.history[0], drawer: __game.drawer, tx: __game.transactions.filter(t => t.day === 1) }));
  const txSales = h1.tx.reduce((n, t) => n + t.total, 0), txTips = h1.tx.reduce((n, t) => n + t.tip, 0);
  check(h1.sales === txSales && h1.tips === txTips, `day 1: sales $${h1.sales}, tips $${h1.tips} match ${h1.tx.length} transactions`);
  check(h1.drawer === 150 && h1.deposit === h1.tx.filter(t => t.method === 'cash').reduce((n, t) => n + t.total + t.tip, 0), `cash banked $${h1.deposit}, float back to $150`);
  check(h1.staff === 60 + 30, `staff cost $${h1.staff} (hire + one day's wage)`);
  await shot('y_summary');
  await p.click('#summary [data-a=next]'); await unlock();

  // ---------------- day 2: harder config, parties, sauces wanted (none stocked yet)
  check(await g(() => __game.day === 2 && __game.dayCfg().rate > 1 && __game.dayCfg().party.includes(2)), 'day 2 uses a busier demand row');
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT');
  check(await waitFor(() => __game.queue[0] && __game.queue[0].state === 'order', 150000), 'day 2: a party arrived');
  await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order');
  await g(() => { __game.clockMin = 22 * 60 + 1; });
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] CLOSE RESTAURANT');
  check(await waitFor(() => __game.uiMode === 'summary', 20000), 'day 2 summary');
  await p.click('#summary [data-a=next]'); await unlock();
  check(await g(() => __game.day === 3 && __game.history.length === 2), 'day 3 reached, two days in the books');

  // ---------------- day 3: several parties with open orders at the same time
  await act(-4.2, 4.3, -4.2, 1.85, 5.4, '[E] OPEN RESTAURANT');
  for (let k = 0; k < 3; k++) {
    await g(() => { __game.sinceArrival = 100; }); // let the next party arrive right away
    if (!(await waitFor(() => __game.queue.some(c => c.state === 'order'), 150000))) break;
    await act(-4.5, -4.8, -4.5, 0.8, -3.5, '[E] Take order', true);
  }
  const open3 = await g(() => __game.customers.filter(c => c.items && ['toTable', 'wait'].includes(c.state)).map(c => `T${c.table.n}:${c.items.length}`));
  check(open3.length >= 2, `simultaneous open orders on day 3: ${open3.join(' ')}`);
  check(await g(() => __game.dayCfg().party.length >= 4 && __game.dayCfg().sauce > 0), 'day 3 config: bigger parties, sauces requested');

  // ---------------- patience: a seated party that waits too long gives up and frees its table
  const angry = await g(() => { const c = __game.customers.find(c => c.state === 'wait'); if (!c) return null; c.testId = 'X'; c.patience = 0.01; return c.table.n; });
  check(angry !== null && await waitFor(() => /left angry/.test(document.getElementById('msg').textContent), 10000), 'impatient guests still leave');
  check(await g(n => !__game.tables.find(t => t.n === n).customer && __game.today.lost > 0, angry), `table ${angry} freed, guests counted as lost`);

  console.log('errors:', errs.length ? errs : 'none');
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await b.close();
})().catch(e => { console.log('FAIL exception', e.message); console.log('errors:', global.__errs); process.exit(1); });
