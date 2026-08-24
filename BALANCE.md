# BALANCE.md — economy tuning notes (v3 rules)

All numbers live in `src/engine/data/` (see the table in README.md).
`bun run balance` validates structural rules; `bun run simulate` produces the
statistics quoted below.

## Staged price gaps (the core v3 request)

The v3 ladders open a deliberate gap between production stages so that
**buying inputs to produce is attractive**:

- **Raw** (opening stock 10, equilibrium 6): opening buys of 1–3¢, ~4–5¢ at
  equilibrium. The opening glut is cheap fuel for the first production cycles
  and burns off within ~2 rounds under elastic drift.
- **Intermediate** (equilibrium 6): priced at roughly *raw chain cost + ~3¢
  operating overhead + 5–7¢ margin*. Examples at opening prices: sand 1¢ →
  glass sells 10¢ (**+~7¢ on a 16¢ Mixer+Furnace pair ≈ 45%** of the card
  investment, hitting the "~50% of production card costs" target — verified
  by a unit test); wood 1¢ → lumber 11¢ on a single 7¢ Grinder.
- **Finished** (equilibrium 3): priced off the full *purchase* cost of their
  intermediate inputs plus margin — buildings 42–78¢, electronics 40–65¢,
  machinery 70–117¢, vehicles 75–122¢. Self-produced inputs turn these from
  break-even into the engine-builder's jackpot, on top of prestige.

## Elastic equilibrium drift

`step = min(ceil(|equilibrium − stock| / 2), driftMax)` per round (raw cap 3,
staples 3, intermediates 2, finished 2). Consequences, matching the request:

- One producer selling ~2 units/round into an intermediate lane holds it
  ~1–2 above equilibrium → sustained **medium** margin.
- Two producers push it 4+ above → the ladder slides 2+ slots and drift can't
  keep up → **low** margin until someone leaves the lane.
- A dumped lane (stock 12) snaps back at the cap and recovers value in ~3
  rounds, so no market stays dead.

## Market roads (trading as a side strategy)

1 asphalt buys a permanent road to one resource market; each unit sold there
earns a 1¢ rebate when another player buys that resource (FIFO across
sellers). A road pays for itself after ~5–8 rebated units, making dedicated
trade lanes (or camping the staples other players constantly buy) a genuine
side income without touching production.

## Component-card costs

Sequence components are cheap individually (Grinder/Mixer/Fermenter 7¢ …
Assembler/Cracker 10¢, Petrochemical Complex 11¢) because facilities now cost
2–3 cards. Effective facility costs: Blast/Glass Furnace 16¢, Refinery 19¢,
Factory 18¢, Plastics Refinery 28¢ — in line with the old single-card costs,
but the **combo system** (3 uses per card per turn across different
sequences) makes overlapping facilities much stronger than the sum of their
parts: Grinder+Mixer+Furnace+Forming Machine (~31¢) is simultaneously a
Sawmill, Grain Mill, EAF, Blast/Glass Furnace, Concrete Plant, and Pulp Mill.

## Simulation results

`bun run simulate -- 200 4 normal` (200 seeded games, 4 normal AIs):

```
Average final score:   25.9    Games not finishing: 0
Average prestige:      15.0    AI loop-guard hits:  0
Average game-end cash: 52.9
Win rate by seat: 41.5% / 25.0% / 17.0% / 16.5%
Cards owned per game: components dominate (assembler 4.4, forming 4.3,
  grinder 4.0, furnace 3.9, mixer 3.1) and ALL production cards see play
  (1.4–2.7 each) — the dead-production problem of v2 is gone.
Finished per game: pharmaceuticals 3.9, buildings 2.0, clothing 1.5,
  machinery/vehicles/electronics ≈ 0 (AI depth limitation, see findings).
```

`bun run simulate -- 200 2 normal`: avg score 30.5, prestige 18.4, seats
72.5% / 27.5%. `bun run simulate -- 100 3 easy`: avg score 36.2, prestige
27.3 — easy AIs ride the high-margin production loops effectively.

### Findings

1. **The staged economy works**: production cards and component sequences are
   all purchased and used; average end-game cash roughly doubles starting
   cash while prestige engines run — buy-to-produce is profitable as
   requested, with the opening cycles the most lucrative.
2. **First-seat advantage is significant in AI mirrors** — 41.5% in 4-player
   and 72.5% in 2-player. The first seat eats the cheapest opening-glut
   trades and reaches scarce finished markets first, and identical greedy
   strategies collide turn after turn. Human variety softens this; knobs are
   `startingCash` (config.ts) and the finished-goods equilibria/driftMax
   (resources.ts). A structural fix (alternating turn order) was out of scope.
3. **Easy sometimes outperforms normal in mirrors**: easy's naive
   produce-and-sell rides the strong margins while normal spends more on
   cards. Normal's card buying was tightened after testing (see below); the
   residual gap is documented rather than hidden — "easy" still loses to
   "normal" head-to-head less often than these solo averages suggest because
   they compete for the same lanes.
4. **Machinery/vehicles/electronics stay rare in AI play** (the greedy AI
   won't stage electronics as an input for a later machinery run), so the
   free-card grants mostly reward human play. The grant flow itself is fully
   tested.
5. **Fermenter is the weakest card** — ethanol competes with dirt-cheap fuel.
   Intentional while energy stays a cheap staple; raising fuel's ladder is
   the lever if ethanol should matter.
6. **No shortages or stalls**: 0 unfinished games, 0 loop-guard hits across
   500+ logged games.

### Balance changes made after v3 testing

- Buildings ladder nudged +2 (to 42–78¢) so its mid-market value strictly
  clears the sum of its four intermediate inputs (stage-gap test).
- Normal AI: only values sequences that are complete or one card short
  (was ≤2 short), values incomplete ones at 35% (was 50%), and keeps a 15¢
  reserve so it can afford prestige input baskets — this stopped it stranding
  cash in half-built sequences and roughly doubled its prestige output.
- AI values the machinery/vehicles card grant at +8¢ when comparing recipes.

## v4 addendum

**Prestige race.** Only 47 total prestige exists per game now (one claim per
finished good). Simulations: 4-player normal averages 14.7 final score /
3.4 prestige per player with seat win rates **32.5 / 18.5 / 24.0 / 25.0%** —
the race sharply flattened the old first-seat prestige snowball (was
41.5/25/17/16.5). 2-player: 50.7/49.3%, effectively even. Easy AIs still
finish healthy games (avg 12.9 score, $81 cash). 0 unfinished games, 0 loop
guards across 500 v4 games.

**Turn-clocked market maker.** Freezing each round's elastic adjustment and
dealing it out per turn removed the "player 1 sees a fresh market" artifact
of end-of-round drift; the boundary rule (no full/empty market at turn start)
consumes the same budget when aligned, so totals per round match the old
elastic step within ±1. The ▲/▼ row arrows make the pending adjustment
predictable at a glance.

**Packaged goods.** Pharma/electronics/clothing ladders +$6 to cover the
packaging sale cost; scoring docks held packaged units by the current
packaging buy price.

**Rebates at $2/unit** make market roads pay back after ~4 rebated units —
a used road on a staple lane (food/fuel/electricity, which AIs buy every
turn) is now among the best small investments in the game.

**AI notes.** The AI claims grants, picks the cheaper turbine start mode, and
prices combined input+energy demand with a single sequential quote (fixing a
planner/engine mismatch found in simulation). It does not borrow cards or
sell cards back — documented human-only edges for now.

## v5 addendum

**Pharma & clothing +$5.** The v4 +$6 packaging bump still left almost no
spread once both the intermediate input *and* packaging were paid at market:
at equilibrium clothing sold 19 against textiles 13 + packaging 10, and pharma
26… er, 21 against chemicals 13 + packaging 10 — i.e. negative. Raising both
ladders $5 (equilibrium sells now pharma 26, clothing 24) restores a positive
spread over input + packaging and a healthy margin for an engine-builder who
self-produces the intermediate (~13–15). Simulation (200×4 normal): avg score
14.9, prestige 3.3, cash 54.4, seats 32.0/19.5/20.5/28.0, 0 unfinished, 0 loop
guards — unchanged health, with pharma/clothing output up slightly (~4 each).

**Marketplace self-replacement.** A cycled card — including a duplicate copy of
it already on top of the deck — no longer snaps straight back into the market
unless it is the only non-duplicate replacement available.

**Player colors & standalone sequences** are UI/quality changes with no economic
effect: seat colors now actually paint (the classes existed but the CSS didn't),
and any non-production card that activates on its own can run through the
Sequence Assembly area.

## v7 addendum

**Fuel is scarcer.** Players start with 3 fuel (was 5) and fuel equilibrates at
7 instead of 8, so the black-start turbine and vehicle production lean a little
harder on the market. **Agriculture chains are richer**: Grain Mill now yields
2 food from 2 agriculture and the Ethanol Plant 4 fuel from 2 agriculture, and
farms cap at yield 4 with fertilizer folded into an alternate harvest (harvest
now *and* raise future yield). Net effect in 4-player normal sims: 0 unfinished /
0 loop guards, average score ~16–17 and end cash ~$79 (up from ~$54) — the
economy is looser but stable, and prestige rises because the six record awards
add up to 2 each.

**9-card tableau limit** caps engine sprawl and makes the drag-to-sell (half
printed cost, rounded up) a real decision late game.

**All-produced ending** can shorten games when players collectively cover every
resource; in AI mirrors this rarely triggers (machinery/vehicles stay rare), so
most games still run the full round limit.

**Setup modifiers** are orthogonal knobs: Knife fight thins the four workhorse
components, Random resources jitters equilibria ±≤2, Viscous markets flattens
drift to 1/round (slower snap-back, longer-lived margins), and Cyclical economy
lags drift a round (markets chase where stock *was*). All four together still
finish clean games in simulation.

**Record trackers** reward play styles the economy alone doesn't score: the
trading side game (Landlord, Road Baron), engine tempo (The Combo, its opposite
Stillness), the livestock/non-consuming loop (The Rancher), and self-sufficiency
(Vertical Integration — a finished good whose direct inputs were never bought).

## v8 addendum

**Thinner deck + board-profit AI.** Every card lost a copy to match the 9-card
tableau limit, and the normal AI was rebuilt to value cards by the rise in its
**total board profit** — the summed margin of every activation it could run,
capped by the combo rules — with a facility-completion lookahead. Before, the AI
only built single-card facilities and hoarded cash (seat-1 win rate spiked to
~51%); after, it builds refineries, plastics, and chemicals chains and the
seat split flattens again (4-player normal ≈ 26/19/23/32, avg score ~18, prestige
~6.7, end cash ~$82, 0 unfinished / 0 loop guards). Machinery and vehicles stay
rare — the greedy planner still won't stage five intermediates for one finished
good — a documented human-only edge.

**Extra asphalt, cheaper asphalt.** A Mixer on the refinery tail (coker) adds
+1 asphalt; to keep asphalt from becoming a free-money lane the ladder dropped
~1 across the board. **Exodia** is a deliberately expensive six-card flex that
turns 2 oil + 1 natgas into fuel, asphalt, chemicals, and plastic in one shot —
a payoff for players who assemble the whole refining line.

**Staging area.** Cards parked in the Sequence Assembly area don't count toward
the tableau cap, letting you assemble a big facility (Exodia needs six cards)
without being blocked — but you can only stage cards that keep building toward a
real facility, and you can't pull them back into a full tableau. It clears each
turn, so the cap stays a genuine buy-gate.

**Two verifications, no bugs found.** Random Resources keeps equilibria within
default ± 2 (a `⌂N` marker now shows the target on each market row), and the
activation records count every activation — the trackers panel now shows each
player's value so "fewest"-style records read correctly.

## v9 addendum

**Player classes** add asymmetric setups; balance is deliberately swingy and
class play is a variant rather than the tuned baseline. Simulation of AI-vs-AI
games with each class assigned finishes cleanly with no loop-guard hits, and the
seat split stays flat in class-free 4-player mirrors (~20/26/21/34). Notes: the
Regenerist is intentionally hard — no purchasing means it must produce its own
energy, so it leans on Turbine/Solar; the Trader trades prestige for a strong
trading economy; the Line Boss and Land Baron are pure efficiency boosts; the
Parasite and Liquidator pay for their edges with a 6-card tableau.

**AI card discipline.** A sold-this-turn flag stops the AI from buying and
selling cards in the same turn, the swap never rebuys the type it just sold, and
duplicates must clear a higher board-profit bar — so redundant copies (like a
second Assembler with only one Forming Machine) no longer get bought.

**Marketplace churn.** Cycling a minimum of two cards per turn keeps the shop
fresher, so a full tableau or a slow round doesn't leave stale cards sitting.

**Record tuning.** The Rancher (min 8) and Vertical Integration (min 3) cutoffs
were nudged so both are reachable but still an achievement.

## v11 addendum — the shaped-value AI and the measurement suite

This batch replaced the greedy one-step AI with a **shaped-value planner**
(`Ṽ = R + λ·Φ`: liquidation value plus decaying potential — engine earning
power, unclaimed-prestige feasibility × race, roads/grants) searched by
prescore-ranked candidate evaluation with rollouts on hard; and replaced the
global-counter simulation stats with **per-player metrics in engine state**
(`PlayerMetrics`: produced/sold/bought per resource with dollars, activations
per recipe, roads, cards, grants, borrows, income). Every decision now carries
a rationale (`[ΔV +4.7: R +6.1, prestige −1.4]`), `runAiTurn` returns the
step-by-step plan, and `explainAiDecision` exposes the full scored candidate
set read-only. Strategy signatures are computed analysis-side
(`src/engine/analysis.ts`) from the metrics with thresholds derived from the
seeded baseline's own distribution (p75 of nonzero) — never fed back into play.

**Baselines** (200×4 normal, 10 rounds; `balance/baseline-pre-refactor.json`
vs `balance/baseline-post-refactor.json`):

| metric | pre | post |
|---|---|---|
| avg final score | 17.8 | 19.0 |
| avg prestige | 6.3 | 7.3 |
| machinery+vehicles claimed | ~0.00/player-game | 0.11/player-game |
| lateTech signature lit | 0.5% | 7.0% (wins 92% of its games) |
| signatures per player-game | 1.53 | 1.93 (none lit: 30% → 8%) |
| seat win spread | 22/23/26/30 | 29/29/20/23 |
| unfinished / guard hits | 0 / 0 | 0 / 0 |

**Difficulty is search strength** and the ladder is monotone in mixed-table
duels: normal beats easy 90%+, hard beats normal ~60–67%, hard beats easy
90–100%. All tiers are deterministic per seed (easy's mistake roll uses the
game RNG) and never hit the loop guard.

**Multi-step staging works.** The planner stages input baskets across turns
(`stage 1 glass for Assemble Vehicles`), holds them against the surplus-sell
pass, and claims the heavy tech goods — verified by scenario tests. Three
value-function subtleties mattered and are documented in ai.ts: potential must
be damped (`PRESTIGE_POTENTIAL_DAMP` 0.6) or realizing prestige is cannibalized
by its own forecast; the race factor discounts only opponents *strictly*
closer (a tie sprints, it doesn't defer); and engine potential is computed on
an empty hypothetical warehouse plus an explicit vertical-integration spread
credit, or held stock gets double-counted against activation margins.

### Findings (game vs agent)

1. **Heavy tech is a capital cliff (game).** Machinery/vehicles claims demand
   the forming+assembler pair, an electronics prerequisite, and a $60–100
   basket while mid-game cash sits at $10–30 — a whole game's profit. The
   payoff is decisive (lateTech winners take 92% of their games) but only a
   committed specialist gets there, so claims appear in a minority of games.
   Levers if they should be more common: input baskets (recipes.ts), prestige
   (config.ts `prestigeByProduct`), or mid-game income.
2. **Petroleum specialization doesn't pay (game).** The refining ladder's
   margins are thin against its card outlay; petroleum signatures barely occur
   and don't reliably win. Exodia is never assembled by the AI (agent: the
   card-value lookahead only completes facilities ≤2 cards short — a
   documented blindness — but the margin case is also weak).
3. **Roads alone don't win (game).** roadStaple lights often (33%) but wins
   only 16% — rebates are good side income, not a strategy. Consumer goods
   (64% wins when lit), engine accumulation (48%), and farming (59%) are
   healthy strategies.
4. **The stronger agent revealed thin margins.** It abandons sub-dollar
   activation loops the old AI ran reflexively (electricity/fuel raw loops,
   alternate turbine modes, ethanol, cheesemaker), leaning on market restock
   instead. Coverage at the resource level stays complete, but those recipe
   lanes are only marginally viable — a pricing lever, not a planner bug.
5. **Seat fairness improved** (post spread 29/29/20/23 vs historical seat-1
   or seat-4 spikes) but ±6% asymmetries remain across runs; the residual is
   structural (opening glut + first-claim prestige), not agent asymmetry —
   all seats run identical policies.
6. **Classes (1 classed vs 3 unclassed, normal AI):** trader ~79% and hipster
   ~67% win rates are clearly strong; lineBoss ~42% and equilibrist ~33%
   healthy; regenerist/parasite/landBaron hover near fair (21–29% across
   runs); **liquidator underperforms (~13%)** — its card-churn edge fights
   the AI's anti-thrash discipline (agent) and its 6-card tableau is a real
   cost (game).
7. **No stalls anywhere**: 0 unfinished games and 0 guard hits across every
   configuration tested (≈1,500 games this batch).

## v12 addendum — AI class affinity (personality)

The v11 planner valued every class as if it were unclassed: mechanics only
helped incidentally, and a few (parasite borrowing) were never used at all.
v12 makes the AI **play its class**. Two layers, both gated behind
`GameState.aiClassAffinity` so the change is a clean, measurable toggle:

1. **Class-aware valuation** — `planOption` now prices the class's own
   mechanics into activation margins: Regenerist's +1-every-output,
   Land Baron's +1-raw, Hipster's first-use intermediate doubling, Line Boss's
   food-every-4 and electricity-every-2-machinery, and the Trader's halved
   prestige. These feed the whole search (engine potential included).
2. **Affinity nudges** — the planner is pushed toward the signature action:
   the **Parasite actually borrows** (a new compound "borrow-and-run" move; it
   starts roaded to everyone and the AI otherwise never borrows), the
   **Trader** lays road on smaller batches at its $4 rebate, the **Liquidator**
   discounts card buys by its 80% resale, and Hipster/Land Baron/Regenerist get
   their signature activations surfaced into the evaluated set.

### Per-class scoring impact (`npm run class-affinity`)

Each class played 120 games, 1-classed-vs-3-unclassed normal AIs, seats
rotated, affinity OFF vs ON (paired seeds):

| class | OFF score | ON score | Δscore | Δwin% |
|---|---|---|---|---|
| equilibrist | 20.9 | 20.9 | +0.0 | +0 |
| regenerist | 26.4 | 27.1 | +0.7 | +0 |
| trader | 25.5 | 25.9 | +0.4 | +3 |
| **hipster** | 30.0 | 37.0 | **+6.9** | +18 |
| **parasite** | 19.7 | 27.5 | **+7.8** | +13 |
| **land baron** | 22.0 | 25.2 | **+3.2** | +9 |
| liquidator | 19.1 | 19.0 | −0.1 | +1 |
| lineBoss | 23.0 | 22.7 | −0.3 | −1 |

Mean Δscore **+2.3**; 5/8 classes improve (three substantially), equilibrist
and liquidator are neutral, lineBoss slips a hair. **Scores increase overall,
so per the design rule the nudge is ON by default** (`GAME_CONFIG.ai
.classAffinityDefault = true`); a game can still be created with
`aiClassAffinity: false` for vanilla AIs.

### Findings (game vs agent)

- **Parasite and Hipster were leaving their whole identity on the table.**
  Parasite's +7.8 is almost entirely the newly-enabled borrowing; Hipster's
  +6.9 is the AI finally chasing novel sequences for the doubling. These are
  agent gains — the mechanics were always there, unused.
- **Equilibrist has no actionable nudge** and is unchanged by design: its
  extra market-maker tick is a passive foresight edge already baked into the
  prices the AI reads, with nothing to actively "do." Documented, not a miss.
- **Line Boss is the one class the nudge slightly hurts (−0.3), and it's a
  game effect, not a bug.** Correctly valuing its cheaper activations makes it
  activate *more*; against three opponents that floods thin markets and
  depresses its own sell prices — something the static, opponent-free value
  function can't foresee. The honest fix is opponent/market modeling in
  rollouts (out of scope), not teaching the agent to under-value its own
  mechanic. The loss is immaterial (~1.5% of score).
- **Liquidator's flip nudge is a wash (−0.1).** Its 6-card tableau is a real
  handicap; the cheap-resale discount was tuned conservatively (half the
  refund) so it doesn't over-buy into that small tableau — enough to neutralize
  the earlier churn regression without a positive to show for it.
- **Determinism and health hold**: class-affinity games finish with 0 guard
  hits, are deterministic per seed, and unclassed games are byte-identical
  with the flag on or off (verified in tests).

## v13 addendum — market-impact modeling + tutorial

The v12 note flagged one class the affinity nudge slightly hurt — **Line
Boss** — and pinned it on the value function being *market-blind*: correctly
pricing its cheaper activations made it activate more, which floods thin
markets against three opponents and depresses its own sell prices, something
the static estimate couldn't foresee. v13 teaches the estimate to see it.

**The fix.** `estimateBoardProfit` (the per-turn earning-power estimate behind
engine potential, `staticTerminal`, and the hard-tier rollouts) priced every
activation's output at the *current top* of the sell ladder, independently — so
a schedule that produces six lumber valued all six at the top price. It now
walks each good's total production **once** down the descending ladder from the
current stock (which also caps at what the market can physically absorb) and
subtracts the gap. The AI foresees flooding at *decision* time instead of
discovering it only when the sells execute. Held inventory was already
ladder-aware in `inventorySellValue`, so R needed no change; this closes the
gap in the forward-looking term. Exposed as a balance knob
(`setMarketImpactModel`, default on) purely so the harness can measure it.

**Measurement (paired seeds, model off → on):**

| condition | off | on | Δ |
|---|---|---|---|
| unclassed normal, 120×4 | 18.99 | 19.23 | **+0.23** |
| unclassed hard, 80×4 | 21.38 | 21.35 | −0.03 (noise) |
| **Line Boss affinity delta** | −0.3 | **+0.4** | fixed |

The Line Boss regression is gone: with market impact modeled, its
affinity-on score goes from *below* affinity-off (−0.3) to *above* it (+0.4) —
the class-aware valuation now helps rather than hurts. Unclassed normal
improves (+0.23), hard is neutral, no guard hits, coverage unchanged, and the
big affinity winners are undisturbed (parasite +9.2, land baron +2.3 in the
same run). Scores improve overall, so the model ships on by default.

Remaining known gap: rollouts still hold *opponents* static and don't model
inter-turn drift recovery — the own-impact term is the dominant, correct lever;
full opponent modeling is future work.

**Brief tutorial.** A five-step onboarding overlay (`Tutorial.tsx`) now greets
first-time players — how you win, produce via cards/sequences, buy-low-sell-high
(including that dumping crashes a price), the prestige race, and taking a turn.
It auto-opens once (tracked in localStorage), is reopenable from the in-game
**🎓 Tutorial** button, and sits alongside the exhaustive **📖 Rules**
reference.

## v6 addendum

**Concrete now takes 2 sand (price unchanged).** The v5 attempt raised sand's
price floor; v6 instead raises concrete's *recipe* input from 1 sand to 2 and
leaves both the sand ladder and the concrete ladder (10–21) exactly as they
were. The effect is the intended one — concrete is a little less profitable to
make (more raw consumed per unit) without being repriced. Glass and concrete
still clear the first-cycle margin check, and a 150×4 normal simulation is
unchanged (avg score 14.9, prestige 3.4, 0 unfinished, 0 loop guards).

**Facility quick-load.** The engine exposes `availableFacilities`, listing every
sequence the active player can assemble from ready tableau cards with the
distinct instance ids in order. The empty Sequence Assembly area now shows these
as one-tap chips (each with a facility icon) that load the sequence directly.

**Field Guide (flavor text).** Every resource, card, and facility carries a
short flavor note in the register of Vaclav Smil's *How the World Really Works* —
materials-and-energy first, tied to the production chain (sand → glass in the
furnace, natural gas → ammonia in the reformer, and so on). A Field Guide panel
shows the note for whatever the player last clicked.
