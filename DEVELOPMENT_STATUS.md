# Asado Tycoon — development status

Pre-Higgsfield version: procedural low-poly visuals, canvas-texture signs and screens, no paid assets.
Last updated with the "difficulty, POS, staff & restaurant systems" phase.

## Playable loop

1. Day starts at 11:00, closed. Crates wait in the DELIVERY yard (four free starter crates on day 1).
2. Carry crates through the kitchen to COLD STORAGE (7 bins, capacity on the sign above the fridge).
3. Open at the OPEN/CLOSED sign by the front door. Parties of 1–4 guests arrive and queue at PEDIDOS.
4. Take the order at the counter; the party sits at its own table, one chair per guest.
5. Cut whole cuts at the PREP STATION, grill portions on the PARRILLA (slot lamps show doneness),
   plate them, add sauce cups, put plates on the SERVICE counter or serve the table directly.
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
| Staff | Role table with hire cost, daily wage and a state machine: Prep Cook (fetch → cut → return), Server (pass → table → return); Grill Cook listed as coming soon |
| Sauces | Bottles bought wholesale → delivered → stored → placed at the SAUCE station → pour a cup (hands animation) → add to a plate on the pass or bring to the table; dish + sauce both required |
| Service counter | Six plate spots between the grill and the dining room, heat-lamp gantry; the server only takes plates that match an open order exactly (sauce included) |
| Signs | Physical plaques: KITCHEN, STORAGE, OFFICE, PREP STATION, COLD STORAGE (capacity), PEDIDOS, CAJA, PARRILLA (on the hood), SERVICE, SAUCES, DELIVERY, table number blocks, crate lid labels, bin and tray labels |
| Status | Grill slot lamps (yellow cooking, green ready, flashing red, dark burnt); guest mood badge below 50% / 25% patience; patience % in the table prompt |
| Interior | Ceiling with beams and lamps (enclosed room), windows, wainscoting, menu chalkboard behind the counter, wine shelf, charcoal sacks, low dividers separating the staff side, order screens at the counter, kitchen and grill |
| Hands | Carry (two hands), crate, one-handed bottle/cup, cutting with a knife, pouring bottle → cup, plate under carried dishes |
| Economy | Wholesale food cost, upgrades, wages, tips; end-of-day summary and history in ASADO OS finances |

## Tests (headless Playwright, see CLAUDE.md)

- `tests/playtest-pos.cjs` — store crates, open, a party orders and sits, full food pipeline, card
  checkout (wrong method/amount refused, tip, bank), cash checkout (wrong tender caught, change, drawer),
  rush and demand shape, hire a prep cook, delivery, books after closing, day 2 and day 3 (simultaneous
  orders), impatient guests leave.
- `tests/playtest-service.cjs` — no floating labels, sauce bottles in wholesale and cold storage, bottle to
  station, pour animation, pour back, grill lamps, plates on the pass, server delivers a matching plate and
  waits for sauce, sauce cup on a pass plate and at the table, bill with sauces, mood badges, closing clears
  the pass, server wage on the books.

Latest run (headless Chromium, software WebGL): `playtest-pos` 60/60 checks, `playtest-service`
61/61 checks, no page or console errors; `npm run build` succeeds.

## Known limitations

- Only one employee per role. The Grill Cook role is defined but not hireable yet.
- Guests and staff don't collide with each other or the player (they follow fixed lanes).
- Speech bubbles over guests (`?`, `CARD`, `CASH $50`) are the only floating sprites, by design.
- Software rendering (CI/headless) runs at 5–8 fps; real GPUs are not a concern at this scene size.

## Next steps (suggestions)

- Grill Cook AI (take raw portions from trays/bins, grill, plate to the pass).
- More sauces/sides through the data tables; seasonal menu prices.
- Save/load (localStorage) for multi-session play.
- Higgsfield pass for textures/props once credits are available.
