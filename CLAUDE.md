# Asado Tycoon — notes for Claude

A first-person 3D Argentine parrilla management game. Three.js + Vite, no other runtime dependencies.
This is the **pre-Higgsfield version**: all models are procedural low-poly geometry, all signs and screens
are canvas textures. Do not use Higgsfield or any paid asset generation unless the user asks for it.

## Run

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (vite.config.js uses base './')
```

## Code layout

Everything lives in `main.js`, in this order (search for the `// ---------- Section ----------` banners):

1. **Config** — the data tables that drive the game. Tune difficulty and content here first:
   `FOODS` (dishes, prices, cook/burn times), `SAUCES`, `ITEMS` (wholesale/cold storage, incl. sauce bottles),
   `QUALITY`, `DAYS` (demand per day: rate, rush, party sizes, sauces, cash share, patience), `RUSHES`,
   `UPGRADES`, `ROLES` (staff). Times are written in game minutes and converted with `gm()`;
   `TIME_SCALE` sets how fast the 12:00–22:00 shift runs (about 8 real minutes).
2. **State** — money (bank), `drawer` (register cash, starts at the `FLOAT`), held item, queues, stock, etc.
3. **World** — helpers (`box`, `part`, `flat`, `labelTex`, `panel`, `plaque`), then the restaurant:
   dining room, front counter + register, grill, tables, back of house (cold storage, prep station,
   storage, office), service counter (`pass`), sauce station, menu board, interior dressing.
4. **Systems** — customers (parties, orders, serving, billing), storage/prep, staff AI (`STAFF_AI[role]`),
   day cycle and demand, ASADO OS terminal (HTML overlay), register POS (in-world canvas + virtual cursor).
5. **Interaction** — a center-screen raycast hits objects tagged with `userData.kind`; `getAction(obj)`
   returns `{ label, fn }` for the bottom prompt and the E key.
6. **HUD, player, hands, loop**, and the `window.__game` test hook at the end.

Conventions:
- Things the player carries are `held = { kind, type, q, mesh, ... }` with kinds `crate`, `whole`, `portion`,
  `cooked` (a plated dish, may carry a `sauce`), `bottle`, `sauce` (a filled cup).
- Timed hand actions use `busy = { kind: 'cut' | 'pour', ... }`; `updateBusy` and `updateHands` animate them.
- No floating labels in the world: use `plaque()` for signs, lamps/mood badges for status. The only sprites
  are guests' speech bubbles and mood badges.
- Keep the shader light count low (software rendering in tests is slow; each point light costs ~7%).
- Prefer extending the data tables over new code paths; keep new code in the matching section.

## Testing

`window.__game` exposes state and helpers (`lookAt`, `posButton`, `dayCfg`, `billTotal`, …).
Playtests drive the real game in headless Chromium with Playwright (not a project dependency: they use
a global install, found through `NODE_PATH`):

```
npm run dev &                                          # tests use http://localhost:5173 (or GAME_URL)
NODE_PATH=$(npm root -g) node tests/playtest-pos.cjs     # demand, parties, register, staff, 3 days
NODE_PATH=$(npm root -g) node tests/playtest-service.cjs # sauces, service counter, server, lamps, signs
```

Set `SHOTS=/some/dir` to save screenshots. Headless quirks: software WebGL runs at ~5–8 fps and frame
time is clamped to 50 ms, so game time runs slower than real time (a full test takes 10–20 minutes, run it
in the background). Pointer lock is faked with `Object.defineProperty(document, 'pointerLockElement', …)`;
after a trusted click on an overlay button Chromium grants a real pointer lock that halves the frame rate,
so the tests call `Document.prototype.exitPointerLock` afterwards.
