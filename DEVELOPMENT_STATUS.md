# Asado Tycoon — development status

Higgsfield version, blocks 1–2:
- Guests, staff and the main interior props are Higgsfield 3D models.
- Floors, walls, counters, ceiling and tablecloths use Higgsfield textures.
- The menu board, logo signs and posters are Higgsfield pictures.

The rest is still procedural low-poly, with canvas-texture signs and screens. The frozen pre-Higgsfield version
is commit 172ceab. Last updated with the "Higgsfield block 2: interior" phase.

## Playable loop

1. Day starts at 11:00, closed. Crates wait in the DELIVERY yard (four free starter crates on day 1).
2. Carry crates through the kitchen to COLD STORAGE (7 bins, capacity on the sign above the fridge).
3. Open at the OPEN/CLOSED sign by the front door. Parties of 1–4 guests arrive and queue at PEDIDOS.
4. Take the order at the counter; the party sits at its own table, one chair per guest.
5. Cut whole cuts at the PREP STATION, carry up to 4 raw portions, grill them on the PARRILLA (lamps show
   doneness), put the dishes and sauce cups on the table's tray at the SERVICE counter; a READY tray goes
   out in one trip (server or player).
6. The leader pays at the register (CAJA): card with tip, or cash with change from the drawer.
7. At 22:00 no new guests; close at the sign. Cash above the $150 float is banked; wages are paid.
8. End-of-day summary, then restock and buy upgrades and staff at the OFFICE terminal (ASADO OS).

## Systems

| Area | Status |
|---|---|
| Demand | Random party arrivals per game hour, lunch and dinner rushes, quiet afternoon, busy spells, min/max gaps |
| Difficulty | `DAYS` table per day (rate, rush, party sizes, shared starters, sauce requests, cash share, patience); later days keep ramping, capped |
| Menu | Filet, Vacío, Bife de Chorizo (upgrade), Chorizo, Provoleta; Chimichurri and Salsa Criolla; data-driven |
| Meat quality | Standard → Premium → Angus → Dry-Aged (upgrade levels), priced per portion |
| Register (POS) | Monitor with an in-world desktop and a cursor moved by the real mouse; keyboard digits/Enter/Esc; cash drawer and card reader models |
| Cash | $150 float (not revenue), received amount, change due, drawer balance, cash banked at closing |
| Card | Amount must match the total, guest picks a 0/5/10/15% tip from satisfaction, APPROVED, recorded |
| Transactions | Every payment recorded (day, table, method, total, tip, time); summary and finances match them |
| Staff | Role table with hire cost, daily wage and a state machine: Prep Cook $60/$30 (fetch → cut → return), Server $60/$25 (READY tray → table → back), Grill Cook $120/$45 (portions open orders need → free grill spots → off when ready → table trays) |
| Sauces | Bottles bought wholesale → delivered → stored → placed at the SAUCE station → pour a cup (hands animation) → put it on the table's tray (or bring it to the table); dish + sauce both required |
| Service counter | One numbered tray per table (tray 4 with More Tables); a tray only takes what its table still needs, gets a plate per dish, turns READY (green) when every dish and sauce is there |
| Grill | Higgsfield parrilla model; its grate section is stretched to cover all 10 spots, and the spot lamps sit on its front lip. 4 spots, Bigger Grill +2 per level up to 10 ($150/$300/$450); 20 s from ready to burnt for every dish, red flash in the last 6 s; Better Grill speeds up cooking only |
| Patience | Real seconds: order queue 60 s, food wait full tip ≤60 s → none at 120 s → leaves at 150 s (+15 s per extra dish), pay line 60 s; day factor 1.0, Better Interior +30% |
| Signs | Physical plaques: KITCHEN, STORAGE, OFFICE, PREP STATION, COLD STORAGE (capacity), PEDIDOS, CAJA, PARRILLA (on the hood), SERVICE, SAUCES, DELIVERY, table number blocks, crate lid labels, bin and tray labels |
| Status | Grill slot lamps (yellow cooking, green ready, flashing red, dark burnt); guest mood badge below 50% / 25% patience; patience % in the table prompt |
| Interior | Higgsfield textures: calcáreas floor, plaster dining walls, brick grill and kitchen walls, tiled wall behind the prep station, counter wood, wooden plank ceiling and beams (closed over the whole building), gingham tablecloths. Higgsfield models: tables, bentwood chairs (seat at SEAT_TOP), the register (the interactive screen sits on its monitor), plants in the dining corners, a wine rack, a plate shelf with siphons. Pictures: the filete menu board, which shows today's prices (dishes not on today's menu are wiped off), the filete logo above the entrance and on a sign over the counter, tango and fútbol posters. Pendant lamps with a warm light over each table, a light blue and white pennant garland over the counter, warm lighting. Also windows, wainscoting, wine shelf, charcoal sacks, low dividers, order screens |
| Better Interior | Framed pictures and two more plants (its pendant lamps are now always there) |
| Hands | Carried things sit small in the lower right; stacks of up to 4 raw portions of one kind (E adds one, hold E for more), all ready grill pieces in one E; cutting with a knife, pouring bottle → cup |
| Characters | Three Higgsfield guest models (gaucho grandpa, football fan, señora); the room picks the type it has least of, and a repeat gets a light tint and 0.95–1.05 size. The asador model is used for every employee, with the beret showing the role (grill cook red, server black, prep cook white). Each GLB loads once and is shared. Code-only toy animation: waddle walk, breathing and sway when standing, sitting with the legs tucked and a slight lean back |
| Economy | Wholesale food cost, upgrades, wages, tips; end-of-day summary and history in ASADO OS finances |

## Tests (headless Playwright, see CLAUDE.md)

- `tests/playtest-pos.cjs` — store crates, open, a party orders and sits, full food pipeline, card
  checkout (wrong method/amount refused, tip, bank), cash checkout (wrong tender caught, change, drawer),
  rush and demand shape, hire a prep cook, delivery, books after closing, day 2 and day 3 (simultaneous
  orders), impatient guests leave.
- `tests/playtest-characters.cjs` — `day1` and `day4` (lunch rush with all three staff). A sampler checks
  every character: feet on the floor, no walking through chairs, facing the walking direction, and seated
  guests on the seat, clear of the chair back and the table edge.
- `tests/playtest-service.cjs` — one section per system, each on a fresh page (pass section names to run
  only those): `trays` (right/wrong dish and cup, READY, player and server delivery), `carry`, `cook`
  (grill cook), `grill` (levels), `burn` (window, flash, Better Grill), `patience`, `day4` (lunch rush).

Latest runs (headless Chromium, software WebGL): `playtest-service` every section passing with no page
errors (trays, carry, cook, grill, burn, patience, day4); `playtest-pos` passed before the tray/multi-carry
patch and was not re-run for it; `npm run build` succeeds.
Higgsfield block 1: one `playtest-characters` run (day1, day4). Every character was a Higgsfield model,
nobody floated or walked through a chair, staff cut and grilled, and there were no page errors. That run
found seated guests dipping into the seat; this is fixed with a seated copy of the upper body clamped at the
crotch line. It also found timing problems in the test itself, now fixed. The test was not re-run after these
fixes, and the server carrying a tray was not seen within the day 4 window. `playtest-pos` and
`playtest-service` were not re-run for the characters.
Higgsfield block 2: `npm run build` plus one load check. All models and textures loaded and there were no
console errors. No gameplay runs, as asked.

## Known limitations

- Only one employee per role.
- A partly filled raw stack goes back to its bin once it is full (or the bin is empty): E on the bin adds one.
- Guests and staff don't collide with each other or the player (they follow fixed lanes); party members can
  overlap a little in the counter queue.
- Props are visual only: colliders and hit boxes are still the original boxes. The parrilla's middle section is
  stretched to the 10-spot grate, so its bricks look longer. A model shows once its GLB has loaded; until then
  the procedural stand-in shows.
- Characters are rigid models: arms don't swing, carried things are held in front of the body, and seated
  guests' legs are tucked out of sight.
- Speech bubbles over guests (`?`, `CARD`, `CASH $50`) are the only floating sprites, by design.
- Software rendering (CI/headless) runs at 5–8 fps; real GPUs are not a concern at this scene size.

## Next steps (suggestions)

- More sauces/sides through the data tables; seasonal menu prices.
- Save/load (localStorage) for multi-session play.
- Higgsfield pass for textures/props once credits are available.
