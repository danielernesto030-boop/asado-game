# Asado Tycoon — notes for Claude

A first-person 3D Argentine parrilla management game. Three.js + Vite, no other runtime dependencies.
**Higgsfield version, blocks 1–2** (assets fetched from existing Higgsfield jobs, compressed to 1024px JPEG):
- Guests, staff and the main interior props are 3D models (`public/models/*.glb`): parrilla, tables, chairs,
  register, plants, wine rack and plate shelf.
- Floors, walls, counters, ceiling and tablecloths use the textures in `public/textures`.
- The menu board, the logo signs and the two posters are pictures.

Everything else is still procedural low-poly geometry, and the remaining signs and screens are canvas textures.
The frozen pre-Higgsfield version is commit 172ceab, published at its own artifact link, which must never be
republished. Do not generate anything with Higgsfield or any paid asset service unless the user asks for it.

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
   `UPGRADES`, `ROLES` (staff), `CHARS` (character models), `PROPS` (interior models). Times are written in game
   minutes and converted with `gm()`; `TIME_SCALE` sets how fast the 12:00–22:00 shift runs (about 8 real minutes).
2. **State** — money (bank), `drawer` (register cash, starts at the `FLOAT`), held item, queues, stock, etc.
3. **World** — helpers (`box`, `part`, `flat`, `labelTex`, `panel`, `plaque`), then the restaurant:
   dining room, front counter + register, grill, tables, back of house (cold storage, prep station,
   storage, office), service counter (`pass`), sauce station, menu board, interior dressing.
4. **Systems** — characters (`charLib`, `makeToy`, `poseToy`), customers (parties, orders, serving, billing),
   storage/prep, staff AI (`STAFF_AI[role]`), day cycle and demand, ASADO OS terminal (HTML overlay),
   register POS (in-world canvas + virtual cursor).
5. **Interaction** — a center-screen raycast hits objects tagged with `userData.kind`; `getAction(obj)`
   returns `{ label, fn }` for the bottom prompt and the E key.
6. **HUD, player, hands, loop**, and the `window.__game` test hook at the end.

Conventions:
- Things the player carries are `held = { kind, type, q, mesh, ... }` with kinds `crate`, `whole`, `bottle`,
  `sauce` (a filled cup) and `tray` (a table tray); raw `portion`s (up to `MAX_CARRY` of one kind) and grilled
  `cooked` pieces (any mix) are stacks `{ kind, items: [{ type, q, mesh }] }`. Held meshes sit in `holdSlot`.
- The service counter holds one tray per table (`passTrays`); a tray only takes what its table still needs
  and is READY when every dish and sauce cup is there. Grill pieces carry an `owner` (the grill cook's own).
- Characters are rigid GLB meshes animated in code, with no skeleton. Each model loads once into `charLib`
  (scaled to `CHAR_H`, facing +z, split at its `crotch` line into upper body and legs). `makeToy()` builds a
  person from the shared geometry, cloning the material only for a tint or a role beret texture. `poseToy()`
  animates it: a waddle when walking, breathing and sway when standing, and sitting on the chair with the legs
  tucked away (per-type `shift`/`squash` keep the body between the chair back and the table). People created
  before the models finish loading fall back to the procedural `makePerson()`.
- Timed hand actions use `busy = { kind: 'cut' | 'pour', ... }`; `updateBusy` and `updateHands` animate them.
- No floating labels in the world: use `plaque()` for signs, lamps/mood badges for status. The only sprites
  are guests' speech bubbles and mood badges.
- Textures load through `tex(name, rx, ry)`, which shares one image per file across every repeat.
  `brickMats(w, h, d, s, name)` tiles any texture per box face (brick, plaster, counter_wood, wood).
- Props: `PROPS` gives each model's turn (the models face +x) and scale. The model loads once with the
  characters, prepared by `prepProp` (bottom centre at the origin; the parrilla's grate section is stretched).
  `onProp(name, place)` swaps it in for the procedural stand-in, which stays until then. Colliders, hit boxes
  and stations never change. Decor is never added to `solids` or the ray targets, so it can't block interaction.
- Keep the shader light count low (software rendering in tests is slow; each point light costs ~7%). The dining
  room has one warm point light per pendant lamp, 4 at most.
- Prefer extending the data tables over new code paths; keep new code in the matching section.

## Testing

`window.__game` exposes state and helpers (`lookAt`, `posButton`, `dayCfg`, `billTotal`, …).
Playtests drive the real game in headless Chromium with Playwright (not a project dependency: they use
a global install, found through `NODE_PATH`):

```
npm run dev &                                          # tests use http://localhost:5173 (or GAME_URL)
NODE_PATH=$(npm root -g) node tests/playtest-pos.cjs     # demand, parties, register, staff, 3 days
NODE_PATH=$(npm root -g) node tests/playtest-service.cjs # trays, carry, cook, grill, burn, patience, day4
NODE_PATH=$(npm root -g) node tests/playtest-characters.cjs # 3D characters: day1, day4 (floating, chairs, facing)
                                                         # (add section names to run only those)
```

Set `SHOTS=/some/dir` to save screenshots. Headless quirks: software WebGL runs at ~5–8 fps and frame
time is clamped to 50 ms, so game time runs slower than real time (a full test takes 10–20 minutes, run it
in the background). Pointer lock is faked with `Object.defineProperty(document, 'pointerLockElement', …)`;
after a trusted click on an overlay button Chromium grants a real pointer lock that halves the frame rate,
so the tests call `Document.prototype.exitPointerLock` afterwards.
