# Industrial Engine

A strategic economic engine-building digital board game, fully playable in the
browser. Buy production capacity, assemble component cards into transformation
**sequences**, trade a market steered by a turn-clocked market maker, capture
the spread with market roads, borrow rivals' cards, and race to be first to
each finished good. 2–4 players, hot-seat,
with easy/normal/hard AI opponents in any human/AI mix. No backend, no accounts —
everything runs locally and saves to `localStorage`.

## Install & run

The build uses **Bun** (bundler, dev server, and test runner). Node 18+ is
useful for the Playwright UI checks but not required to play.

```bash
bun install          # optional; the repo already vendors react/react-dom
bun run dev          # dev server (bun ./index.html) — open the printed URL
bun run build        # production build into dist/
bunx serve dist      # serve the production build (or any static server)
```

### Tests & tools

```bash
bun run test         # unit + integration tests (102 tests)
bun run typecheck    # tsc --noEmit (strict)
bun run format       # prettier
bun run balance      # balance/config validation (fails on any error)
bun run simulate     # AI-only simulation, e.g.:
bun run simulate -- 200 4 normal   # games, players, difficulty
node scripts/ui-check.mjs          # Playwright smoke test + screenshots
node scripts/seq-check.mjs         # sequence-assembly & rebate-pip UI test
node scripts/v4-check.mjs          # undo / viewer / borrow / turbine UI test
```

> **Why Bun instead of Vite/Vitest?** This project was authored in a sandbox
> whose network policy blocks the npm registry, so Vite and Vitest could not be
> installed. Bun's bundler fills Vite's role and `bun test` runs the suite.
> Tests are written **against the Vitest API** via a path-alias shim
> (`tests/vitest-shim.ts`); installing real Vitest later requires no test-file
> changes — just remove the `paths` alias in `tsconfig.json`.

## Learning the game

New players get a **brief five-step tutorial** (🎓 Tutorial) that auto-opens on
first visit — the core loop in about a minute. The complete rules below are also
available in-app under 📖 Rules, with a searchable recipe reference.

## Complete rules

### Setup

2–4 players (any mix of humans and AIs). Turn order is randomized from the
game seed. Starting cash compensates seating: 30/33/36/39 credits. Every
player starts with **one Construction card**, **5 electricity, 5 fuel, 5
food, and 1 asphalt**, no other cards or resources, and zero prestige. The
marketplace shows 6 face-up cards (at least 3 production cards at the start)
from a seeded, shuffled deck. All resources live in your **warehouse**:
activations draw inputs from it and deliver outputs to it automatically.

### A turn

In **any order and any number of times**: buy/sell resources, buy marketplace
cards, build market roads, and activate cards or sequences. You start each
turn at 0 activations and owe **1 food per 3 activations** (paid on the 1st,
4th, 7th…). Ending your turn pays **$4 income — doubled to $8 if you
performed no activations**. An Undo button reverts non-random actions.

### Sequences & the combo system

Most transformations are performed by **ordered sequences of component
cards** — Grinder/Shredder/Cutter, Mixer, Distillation Column, Forming
Machine, Assembler, Cracker, Polymerizer, Furnace, Fermenter, plus the
Petrochemical Complex. Drag cards from your tableau into the **Sequence
Assembly** area (or use each card's "Add to sequence" button); when the order
matches a facility, its name appears with the recipes it can run.

**Order matters**: Mixer→Furnace is the *Blast/Glass Furnace* while
Furnace→Mixer is the *Concrete Batch Plant*.

Activating a sequence uses every card in it — but the **combo system** lets
each card work up to **3 times per turn, each in a different sequence**. A
Grinder can saw lumber alone, then join Grinder→Furnace (Electric Arc
Furnace), then Grinder→Forming Machine (Pulp Mill), all in one turn. The same
sequence can't repeat on the same cards, even for a different recipe.

| Sequence (in order) | Facility |
| --- | --- |
| Grinder | Grain Mill / Sawmill |
| Forming Machine | Plastics Extruder/Molder |
| Distillation Column → Cracker | Refinery (1 oil → 3 fuel + 1 asphalt) |
| Distillation Column → Cracker → Steam Reformer | Refinery (1 oil → 4 fuel + 1 asphalt) |
| Fermenter | Cheesemaker (⊙3 livestock → 1 food) |
| Fermenter → Distillation Column | Biochemical Plant (2 agriculture → 1 chemicals) |
| Steam Reformer → Mixer | Ammonia Plant (1 natural gas → 1 fertilizer) |
| Distillation Column → Cracker → Polymerizer | Plastics Refinery (oil → plastic) |
| Grinder → Fermenter → Distillation Column | Ethanol Plant |
| Cracker → Polymerizer | Steam Cracker (gas → plastic) |
| Cracker → Petrochemical Complex | Steam Cracker (gas → chemicals) |
| Grinder → Forming Machine | Pulp Mill |
| Forming Machine → Assembler | Factory / Textile Mill (textiles, clothing ★4, pharma ★6, electronics ★5, machinery ★10, vehicles ★14) |
| Distillation Column → Cracker → Petrochemical Complex | Petrochemical Refinery (oil → chemicals) |
| Grinder → Furnace | Electric Arc Furnace (steel, alloy) |
| Mixer → Furnace | Blast / Glass Furnace (steel, glass) |
| Furnace → Mixer | Concrete Batch Plant |

Cards **not** replaced by sequences activate on their own, once per turn: the
8 production cards, Ranch, Solar Panels, Turbine/Generator, Slaughterhouse,
Fermenter (as the Cheesemaker), and Construction.

### Activation costs

Each **sequence activation costs 1 electricity** (flat, not per card).
Standalone cards cost by tag: production cards are Vehicles (⛽ 1 fuel), other
standalone cards are Machinery (⚡ 1 electricity), and the Ranch and Solar
Panels are untagged (free). Activations are atomic and disabled buttons always
explain why.

### Market roads & spread rebates

For **1 asphalt** you may build a road to any individual resource market —
conceptually, selling directly to the other players and capturing the bid/ask
spread. Mechanically: you are still paid the (lower) sell price up front, and
you are **rebated $2 each time another player buys a unit of that resource**,
up to the number of units you sold. Multiple road-sellers are credited in the
order they sold (FIFO). Pending rebates appear as **pips in each seller's
color** on the supply track (with text tooltips). Your own purchases never
trigger your own rebates.

### Market prices (sequential pricing + elastic drift)

Every resource has a 12-slot nondecreasing ladder: buy at
`ladder[capacity − stock]`, sell one slot lower minus the $1 spread; every
unit is priced sequentially and totals are always shown first. The
**turn-clocked market maker** snaps every market elastically toward its
equilibrium — `step = min(ceil(|equilibrium − stock| / 2), driftMax)` per
round, frozen at round start and dealt out in equal shares before each
player's turn (see the v4 section below). Price ladders are staged so that
**buying inputs to produce is genuinely profitable**: first-cycle
intermediate production clears ~50% of the component cards' cost, one steady
producer sustains a medium margin, and two producers saturate a lane to a low
margin. Selling **pharmaceuticals, electronics, or clothing costs 1 packaging
per unit** (producing them doesn't).

### Farms, livestock, and other special rules

- **Harvest Crops** yields the Farm's current output (starts 2, **max 3**),
  then output drops by 1 (min 0). **Fertilization** consumes 1 fertilizer and
  raises output by 2, capped at 3 — it is blocked at the cap (no effect
  beyond it). **Composting**: 2 agriculture → 1 fertilizer.
- **Non-consuming requirements (⊙)**: the Cheesemaker (3 livestock → 1 food),
  Weave Wool (3 livestock → 1 textiles), and Ranch manure processing
  (3 livestock → 1 fertilizer) need livestock present but don't consume it; a
  given quantity backs only one such activation per turn.
- **Free cards for top-tier production**: producing **machinery** grants a
  free machinery-tagged card of your choice from the deck; producing
  **vehicles** grants a free vehicles-tagged (production) card — and you keep
  the resource.

### Card marketplace

Buying a card shifts the remaining cards right and a fresh card enters
**top-left**. On any turn where you buy no card, the **bottom-right** card
returns to the bottom of the deck and a fresh card enters top-left.

### Scoring

Producing a finished product awards permanent prestige: clothing 4,
electronics 5, pharmaceuticals 6, buildings 8, machinery 10, vehicles 14.
At game end:

```
netWorth      = cash + current sell value of the warehouse
                + floor(total printed card cost / 2)
economicScore = floor(netWorth / 10)
finalScore    = prestige + economicScore
```

Ranking: final score → prestige → net worth → finished resources held →
shared victory. The end screen shows the full breakdown.

## AI

All difficulties obey exactly the same rules through the same public engine
functions and see no hidden information. The AI (v11) plans with a **shaped
value function** `Ṽ(s) = R(s) + λ(t)·Φ(s)`: `R` is honest liquidation value
(prestige + net worth/10 — the final score if the game ended now) and `Φ` is
a potential with three legible terms — the board's future earning power, the
feasibility×race value of still-unclaimed prestige goods, and roads/grants.
`λ` decays to zero on the final round, so late turns collapse to pure score
maximization. Because feasibility gives smooth partial credit for owned cards
and held input baskets, **multi-step staging emerges from the gradient**: the
AI buys facility partners, produces or stages upstream inputs across turns
(protected from its own surplus-selling), and cashes the claim.

Difficulty is **search strength** over the same value function. **Easy** acts
greedily on activation margins with a seeded ~20% slip. **Normal** ranks
candidates by a cheap prescore, evaluates the top 4 with the full value
function, and gates acting against ending the turn (banking the no-activation
income bonus). **Hard** widens the beam to 8 and simulates real rollouts of
the turn's remainder for the top 4 before choosing — a strict superset of
normal's consideration. The ladder is monotone in mixed-table duels (normal
beats easy ≈90%, hard beats normal ≈60%+), and every tier is deterministic
for a fixed seed.

**Class affinity (v12).** When an AI plays a class, the value function accounts
for that class's mechanics (Regenerist/Land Baron output bonuses, Hipster
first-use doubling, Line Boss cheaper food/energy, Trader's halved prestige and
richer rebates) and the planner leans into them — the Parasite actually borrows
cards, the Trader lays more road, the Liquidator flips cards. Measured across
all eight classes this raises average class scores (mean +2.3; parasite +7.8,
hipster +6.9), so it is **on by default**; create a game with
`aiClassAffinity: false` for vanilla class-blind AIs. See BALANCE.md v12.

**Market-impact modeling (v13).** The AI's forward value estimate walks each
good's total scheduled production down the sell ladder rather than pricing every
unit at the current top, so it foresees flooding its own thin markets instead of
discovering it when the sells execute. This lifted unclassed scoring (+0.2) and
fixed the one class the affinity nudge previously hurt (Line Boss, −0.3 → +0.4).

Every decision is **legible**: actions log their value motive
(`activate Assemble Vehicles [ΔV +6.3: R +13.9, prestige −6.7]`),
`runAiTurn` returns the per-step plan, and `explainAiDecision(state)` exposes
the full scored candidate set without acting — the primary tool for answering
"is this the game or the agent?". Per-player metrics (`PlayerMetrics` on
engine state: production, trades, activations by recipe, roads, borrows) feed
the simulation suite and the strategy-signature classifier in
`src/engine/analysis.ts`. Every AI turn is bounded by an action-count guard
(140); logged simulations hit it zero times. A settings toggle shows AI turns
step by step.

## Saved games

The active game autosaves to `localStorage` after every action
(`industrial-engine:save:v3`) and can be resumed from the setup screen.
Saves embed a state version and are validated on load; corrupt or old-version
saves are rejected safely.

## Design assumptions (unspecified details decided during implementation)

1. **Sequence identity** — a sequence is the exact ordered list of card types
   (`mixer>furnace`), and "different sequences" for the combo rule means
   different ordered lists. The same pair in the same order cannot rerun even
   for a different recipe; the reversed order is a different sequence.
2. **Standalone cards** have exactly one sequence (their own type), so the
   combo rule naturally limits them to one activation per turn, preserving
   the original once-per-turn behavior.
3. **Sequence energy** — 1 electricity per sequence activation regardless of
   length, per the change request; standalone cards keep their tag cost.
4. **Rebate scope** — rebates trigger only on *player* purchases (market
   drift doesn't count) and only for buyers other than the seller; the
   buyer's own queued entries are skipped but stay queued. Rebate obligations
   survive market drift (they are counts, not specific units).
5. **Pip coloring** — the pips nearest the "next purchase" end of the supply
   track are colored with the queue owners' colors (four color-blind-checked
   player colors, backed by text tooltips and counts).
6. **Farm cap** — fertilization at output 3 is *blocked* (rather than
   silently wasting fertilizer).
7. **Card grants** — one grant per machinery/vehicles unit produced, claimed
   (or declined) via a chooser; the AI always claims the best available card.
   Grants don't count as marketplace purchases for the cycling rule.
8. **Card roads deprecated** — the v2 card-to-warehouse road/storage system
   was removed (not just disabled) for clarity; the git/zip history preserves
   it if it's ever wanted back. "Roads" now always means market roads.
9. **Vehicles rename** — display name only; the internal resource id remains
   `transportation`.
10. **Facility names** — each sequence displays the facility it replaces;
    shared sequences show combined names (e.g. "Factory / Textile Mill",
    "Grain Mill / Sawmill").

## Balance configuration locations

| What | File |
| --- | --- |
| Price ladders, initial stocks, equilibria, elastic drift caps | `src/engine/data/resources.ts` |
| Card costs, deck counts, tags | `src/engine/data/cards.ts` |
| Recipes, sequences per recipe, prestige | `src/engine/data/recipes.ts` |
| Sequence definitions & facility names | `src/engine/data/sequences.ts` |
| Starting cash/resources, income, food rate, energy costs, road cost, combo cap, farm cap, packaging, grants | `src/engine/data/config.ts` |

See `BALANCE.md` for tuning rationale and simulation results.

## Known limitations

- Local hot-seat and AI, **plus online multiplayer** for the desktop/Steam
  build (host-authoritative full-state relay over Steam lobbies; a
  BroadcastChannel fallback lets you test it across browser tabs). See
  `STEAM.md`.
- Documented AI blindnesses: it never borrows cards or builds player-to-player
  roads; rollouts hold the world static (no opponent or market-drift
  modeling — this is most of why the Equilibrist's preview power is wasted on
  it); its card-value lookahead completes facilities at most 2 cards short,
  so it never assembles the 6-card Exodia line; it does not chase the v7
  record awards.
- Machinery/vehicles claims remain a committed-specialist play (a $60–100
  basket against $10–30 mid-game cash); the AI executes it in a minority of
  games and nearly always wins when it does — see BALANCE.md v11 findings.
- Residual seat asymmetry of a few percent persists in AI mirrors (structural:
  opening glut + first-claim prestige); see BALANCE.md.
- The Fermenter (ethanol) is weak while fuel stays cheap, and thin-margin
  energy/refining loops are skipped by the stronger v11 agent — pricing
  levers, see BALANCE.md.
- Drag-and-drop uses the HTML5 API (desktop); on tablets use each card's
  "Add to sequence" button, which is fully equivalent and keyboard-accessible.

## v4 rule changes (latest revision)

- **Currency** is displayed as `$` throughout.
- **Prestige race**: prestige goes ONLY to the first player to produce each
  finished good (tracked per resource; later or repeat production earns none).
- **Turn-clocked market maker** replaces end-of-round drift: each round's
  elastic equilibrium adjustment is frozen as a budget and dealt out in equal
  (Bresenham) shares at the start of every player's turn, so every player sees
  a comparable market before acting. The ▲/▼ arrows on each market row show
  the adjustment still to come. No market may start a turn completely full or
  empty — the market maker nudges it by 1, counted against the same budget
  when aligned (never double counted).
- **Market roads** now rebate **$2 per sold unit** purchased by another player
  (FIFO across sellers; pips colored per player).
- **Player roads & borrowing**: click a player to view their full board; build
  a road to them for 1 asphalt; with a road, pay them $2 to borrow a card for
  one turn (🤝 badge, 1 activation, disappears at end of turn).
- **Card sell-back**: non-starter cards sell back to the deck bottom for half
  their printed price, rounded up.
- **Undo**: every non-random action can be undone (everything except buying a
  card, which reveals the next deck card; buying also clears prior history so
  undo can never cross a reveal). History resets each turn.
- **Turbine/Generator**: burns fuel (replacing the oil recipe), produces 5
  electricity, with a grid-start (electricity) / black-start (fuel) toggle for
  its activation cost. Black-start Fuel Power correctly needs 2 fuel total.
- **Refinery** produces 3 fuel + 1 asphalt simultaneously; adding a Steam
  Reformer (Distillation Column → Cracker → Steam Reformer, still called
  "Refinery") yields 4 fuel + 1 asphalt.
- **New sequences**: Biochemical Plant (Fermenter → Distillation Column,
  2 agriculture → 1 chemicals); Cheesemaker (Fermenter alone, ⊙3 livestock →
  1 food — the Pasteurizer card is removed); Ammonia Plant (Steam Reformer →
  Mixer, 1 natural gas → 1 fertilizer; the reformer no longer works alone).
- **Marketplace**: no duplicate face-up cards unless the deck makes it
  impossible.
- **Packaged goods** (pharma/electronics/clothing) ladders were raised ~$6 to
  absorb the packaging sale cost, and end-game inventory values them net of
  packaging.

### v4 design assumptions

Borrow fees are paid to the card's owner; borrowed copies keep the source
farm's current yield; the same card may be borrowed again in later turns (each
costs $2); starter Construction cards cannot be sold back (they are not deck
cards) but CAN be borrowed; grant claims are treated as non-random (the deck
is open information) yet grouped with undoable actions; the market-maker
budget freezes at round start from current stocks, so mid-round trades shift
prices but not the current round's adjustment plan.
