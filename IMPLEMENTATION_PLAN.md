# Industrial Engine — Implementation Plan

## Environment constraint (recorded up front)

The build sandbox blocks the npm registry (403 host_not_allowed), so Vite and
Vitest cannot be installed. The environment ships React 19.2.6, TypeScript 6.0.3,
Bun 1.3.13, Playwright, Prettier, and http-server. The plan therefore uses:

- **Bundler / dev server:** `bun build ./index.html` and `bun ./index.html`
  (Bun's built-in bundler is the Vite-equivalent here; zero network needed).
- **Unit tests:** `bun test` with tests written against the **Vitest API**
  through a local `vitest` path-alias shim (`tests/vitest-shim.ts` re-exports
  `bun:test`). If the registry becomes available, `npm i -D vitest` works with
  no test-file changes.
- **React:** vendored from the machine's global install into `node_modules`.
- **Types:** minimal hand-written `types/react.d.ts` (no @types/react access).

## Architecture

- `src/engine/` — pure TypeScript rules engine, zero React imports, fully
  serializable state, deterministic seeded RNG.
  - `types.ts` — all shared types.
  - `rng.ts` — xmur3 + mulberry32 seeded RNG with serializable state.
  - `data/resources.ts` — 28 resource definitions with 12-slot price ladders.
  - `data/cards.ts` — 27 card definitions, costs, deck counts.
  - `data/recipes.ts` — all canonical recipes as data.
  - `data/config.ts` — round count, starting cash, restock, scoring knobs.
  - `market.ts` — sequential pricing quotes (pure functions).
  - `game.ts` — createGame, startTurn, endTurn, buyResource, sellResource,
    buyCard, getAvailableActivations, activateCard, activateMultiCardRecipe,
    calculateScore, serializeGame, deserializeGame.
  - `ai.ts` — easy + normal AI with loop guards; runAiTurn / stepAi.
  - `validate.ts` — balance/config validation (used by script + tests).
  - `simulate.ts` — headless AI-only game runner.
- `src/ui/` — React components; every action goes through the engine.
  Screens: Setup, Game (Header, Tableau, Inventory, ResourceMarket,
  CardMarketplace, ActionLog, RulesModal, DevPanel), GameOver breakdown.
- `scripts/balance-check.ts` — validates ladders, recipes, margins, no
  money-printing loops.
- `scripts/simulate.ts` — 200+ seeded AI games, reports stats.
- `tests/` — the 27 required unit cases + integration chain tests.

## Order of work

1. Scaffold (this step): package.json, tsconfig, shims, index.html.
2. Engine data + market math + game core.
3. Full test suite against the engine.
4. AI + simulation + balance script; tune ladders/costs from results.
5. React UI + styles + localStorage persistence + accessibility.
6. Docs (README.md, BALANCE.md), production build, Playwright visual pass.
7. Final verification: format, typecheck, tests, build, headless UI smoke.

## Key design decisions

- Engine functions take a `GameState` and return a new state (clone-then-mutate
  internally); React never mutates state directly.
- Production and transformation are both "recipes" in data; production cards
  simply have zero-input recipes. Farm/Ranch/EAF alternate modes are extra
  recipes on the same card.
- Multi-card recipes list two required card types; activation consumes one
  ready instance of each.
- Prestige is stored on finished-product recipes and awarded at activation.
- Scoring per spec; inventory value = sequential sell simulation against
  current market stock (units that cannot fit in a full market add 0).

## v2 change-request addendum (implemented)

A second iteration reworked the rules per user request: Construction starter
card (buildings moved off the Factory), non-consuming livestock requirements
with a per-turn commitment ledger, slaughterhouse/compost/harvest/fertilize
changes, end-of-turn income (4¢/8¢), marketplace top-left insertion +
no-purchase cycling, equilibrium-drift markets, packaging cost on selling
pharma/electronics/clothing, vehicles rename + slimmer recipe,
machinery/vehicles tags with electricity/fuel activation costs (doubled
energy outputs, refinery fuel 4), finished-goods→deck-card exchange,
Power-Grid-style on-card storage with asphalt roads, food-per-3-activations
upkeep, and 5×4 starting staples. Engine, AI, UI, tests (92), balance
validation, simulations, and docs were all updated; state version bumped to 2.

## v3 change-request addendum (implemented)

Third iteration: card roads/storage deprecated (warehouse-direct resources),
market roads with FIFO spread rebates and colored pips, 1 starting asphalt,
farm harvest capped at 3, transformation SEQUENCES with drag/click assembly
and a 3-uses-per-card combo system, 9 new component cards replacing 13
facility cards, flat 1-electricity sequence cost, staged price ladders with
elastic equilibrium drift, and free-card grants for producing machinery or
vehicles (replacing the exchange action). Engine, AI, UI, tests (83), docs,
and simulations updated; state version bumped to 3.

## v4 change-request addendum (implemented)

$ currency, Biochemical Plant / Cheesemaker / Ammonia Plant sequences,
turbine fuel recipe at 5 output with grid/black-start toggle, $2 road rebates
with player-colored pips, 1-asphalt player roads with $2 card borrowing and
full-board viewing, card sell-back at ceil(cost/2), simultaneous refinery
outputs (3 fuel + 1 asphalt; reformed variant 4+1), pasteurizer removed,
turn-clocked market maker with frozen per-round budgets, Bresenham per-turn
shares and the no-full/no-empty boundary rule, duplicate-free marketplace,
undo for non-random actions, packaged-goods price bumps + net-of-packaging
scoring, and first-producer-only prestige. State version bumped to 4.
102 tests green.

## v5 change-request addendum (implemented)

Six refinements, no serialized-state changes (existing saves still load):

1. **Player colors.** Added the four seat colors (`--pc1..--pc4`) as CSS
   variables plus the previously-missing `.pip-p*` / `.player-dot` /
   `seat-p*` rules — the seat color now paints the player-overview dot and a
   bold left edge on each player box, and a pending spread rebate colors the
   matching market supply pips to the selling player's color. (The prior
   iteration referenced these classes but never defined them, so nothing was
   colored.)
2. **Pharma & clothing +$5.** Both finished-goods ladders raised $5 so the
   equilibrium sell clears input + packaging with a real margin (the packaging
   cost had been eating the whole spread).
3. **Marketplace self-replacement.** `drawNonDuplicate` now takes the
   just-cycled card as an excluded type, so a cycled card (or a duplicate copy
   of it sitting on top of the deck) can't immediately return unless it is the
   only non-duplicate replacement.
4. **Equal-size tableau cards.** The active tableau wraps each card in a
   draggable box; that box is now a flex grid item that stretches its card to
   fill the cell, matching the viewer layout (no empty gaps in a row).
5. **Sand cost → 2.** Sand's cheap end is floored at 2 so concrete's high
   price is backed by a real input cost (mid/equilibrium ladder unchanged;
   glass/concrete opening margins still healthy).
6. **Standalone cards in sequence assembly.** Non-production cards with a
   standalone recipe (Solar, Turbine, Slaughterhouse, Cheesemaker,
   Construction, …) can now be dragged/added into the Sequence Assembly area
   and activated there, not just inline. 109 tests green.

## v6 change-request addendum (implemented)

Three follow-ups, no serialized-state changes:

1. **Concrete/sand correction.** Reverted the v5 sand price-floor change and
   instead raised concrete's recipe input from 1 sand to 2, leaving the sand
   and concrete ladders untouched — concrete is a bit less profitable to
   produce without being repriced.
2. **Facility quick-load.** New engine helper `availableFacilities` lists the
   sequences the active player can build right now (distinct ready instances,
   in order); the empty Sequence Assembly area renders them as icon chips that
   load the sequence on click.
3. **Field Guide.** Added a `flavor` field to every resource, card, and
   sequence (Smil-style, tied to the production chain) plus an `icon` for each
   facility, and a Field Guide panel that shows the note for the last resource,
   card, or facility the player clicked. 117 tests green.

## v7 change-request addendum (implemented)

State version bumped to 5 (new per-player stats/everPurchased, per-game
modifiers/marketConfig, allProducedRound, statSeq, records).

1. **Drag-to-sell.** The on-card Sell button is gone; a card is now sold by
   dragging it from the tableau onto the Card Marketplace, which shows the
   refund (or a "can't sell" note for starters/borrowed) while hovering.
2. **9-card tableau limit.** Buying or claiming a grant is blocked past 9
   non-borrowed cards (Construction counts; borrowed cards are exempt). The AI
   respects the cap (declines grants / stops buying when full).
3. **All-produced end.** Once every resource has been produced by anyone, the
   game ends after the following round — `min(maxRounds, allProducedRound+1)`.
4. **Fuel.** Players start with 3 fuel (was 5) and fuel's market equilibrium is
   7 (one below the other staples).
5. **Recipe yields.** Grain Mill is 2 agriculture → 2 food; Ethanol Plant is
   2 agriculture → 4 fuel.
6. **Farm harvest.** Max yield is 4. Fertilization is now an *alternate harvest*:
   spend 1 fertilizer to harvest at the current yield AND raise yield by 1
   afterward (capped), versus the normal harvest's −1.
7. **Setup modifiers** (any combination): Knife fight (−1 deck copy of
   grinder/cracker/mixer/forming machine), Random resources (equilibria shifted
   ±≤2), Viscous markets (drift capped at 1/round), Cyclical economy (drift lags
   one round).
8. **Record trackers** with 2 prestige each at game end (ties to whoever reached
   the record first; each has a min/max cutoff): The Landlord (borrow fees ≥6),
   The Road Baron (rebate $ ≥10), The Combo (activations in one turn ≥8),
   Stillness (fewest activations, ≤30), The Rancher (non-consuming activations
   ≥10), Vertical Integration (finished goods from only self-produced inputs
   ≥1). Shown live in-game and on the game-over screen. 131 tests green.

## v8 change-request addendum (implemented)

1. **Records box** moved to the left column, beneath the Resource Market, and
   now shows every player's value per record (not just the leader) so counts are
   transparent.
2. **Recipes:** Plastics Extruder outputs 2 packaging; a Mixer can join the
   refinery (after the cracker, or after the steam reformer) for +1 asphalt, and
   the asphalt ladder was shifted down 1 to compensate; added the six-card
   **Exodia** line (2 oil + 1 natgas → 3 fuel + 1 asphalt + 1 chemicals +
   1 plastic).
3. **Thinner deck:** every card has one fewer copy (production 3, components
   2–4), matching the tableau limit.
4. **Smarter AI:** the normal AI now values cards by the rise in its **total
   board profit** (the summed margin of every activation it could run, capped by
   the combo rules), with a facility-completion lookahead so it builds
   multi-card engines (refineries/plastics/chemicals) rather than only
   single-card facilities. It buys duplicates only when it can actually run them,
   and at the card limit it sells its least-productive card to buy a clearly
   better one.
5. **Sequence Assembly as a staging area:** staged cards no longer count toward
   the tableau limit; the facilities list is always shown but load is disabled
   while cards are staged; a staged card can only be added if it extends a valid
   facility; returning a card to the tableau is blocked if that would exceed the
   cap. The staging list lives in engine turn state and clears each turn.

### Investigations
- **Random Resources** verified correct — across 300 seeds a finished good's
  equilibrium stays within default ± 2 (buildings 1–5, never 6). Added a `⌂N`
  equilibrium marker to each market row so the target is visible; what looked
  like "6" was almost certainly the current stock (pushed up by drift or another
  player's sales), not the equilibrium.
- **Stillness / activation records** verified counting correctly in the engine
  (every activation increments `totalActivations`). The panel had shown only the
  single leader — for a "fewest" record that read as undercounting. The tracker
  panel now lists each player's value, making it transparent. 141 tests green.

## v9 change-request addendum (implemented)

State version bumped to 6 (new turn fields, per-player class/net-worth/tracking).

1. **Sequencer fix.** A card may be staged only if the staged sequence can still
   become a facility the player owns the cards to complete — a lone Furnace with
   no Mixer/Grinder is now rejected.
2. **AI card fixes.** A `soldCard` turn flag prevents buying and selling cards in
   the same turn; the swap never sells a card to rebuy its own type; and
   duplicates must clear a higher value bar so the AI won't stockpile redundant
   copies.
3. **Net-worth delta.** Each player's net-worth change over their last turn shows
   as a red/green arrow + number left of their button on the Players panel.
4. **Tweaks.** The Rancher min dropped to 8, Vertical Integration min rose to 3,
   and the marketplace now cycles at least 2 cards per turn (2 oldest if none
   bought, the oldest if one was bought).
5. **Player classes** (chosen per player at setup; "No class" default):
   Equilibrist (an extra market-maker preview tick the next player still gets),
   Regenerist (can't buy; only produces agriculture/livestock among raws but
   intermediates/finished freely; starts Farm/Ranch/Fermenter +2 asphalt; all
   outputs +1), Trader (road rebates $4, 8 starting asphalt, prestige halved),
   Hipster (doubles intermediate output on a sequence's first use, can't be first
   seat), Parasite (tableau 6, borrows 2 per player at $1, starts road-connected
   to all), Land Baron (raw output +1, price ladder moves once per 2 units sold),
   Liquidator (tableau 6, 80% card sell-back), Line Boss (1 food per 4
   activations, 1 electricity per 2 machinery activations). 153 tests green.

## v10 change-request addendum (implemented)

1. **No AI duplicate cards.** The normal AI never buys (or swaps into, or claims
   a grant of) a card type it already holds — duplicates almost never pay off, so
   they're banned outright. Verified across full AI games (no normal AI ends with
   a duplicate).
2. **Plastic vs chemicals.** Chemicals now share plastic's price ladder (equal
   value), and the Petrochemical Complex costs 9 to match the Polymerizer, so
   plastic is no longer the strictly cheaper-to-make, higher-value option. 157
   tests green.
