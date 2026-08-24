// AI opponents (v11): shaped-value planner with rollout search.
//
// Every difficulty plays by exactly the same rules as humans: every move goes
// through the public engine functions, and the AI reads only public state
// (there is no hidden information in this game).
//
// ── Architecture ────────────────────────────────────────────────────────────
// The AI maximizes a SHAPED VALUE function  Ṽ(s) = R(s) + λ(t)·Φ(s):
//
//   R(s)   — liquidation value: prestige + netWorth/10. This is exactly the
//            final score if the game ended now, so late-game play collapses
//            to honest score maximization.
//   Φ(s)   — optimistic potential, three legible terms:
//            · engine    — what the board could earn per future turn
//                          (greedy schedule of profitable activations on a
//                          fresh-turn copy of the tableau) × horizon.
//            · prestige  — for each UNCLAIMED finished good: its prestige ×
//                          feasibility (cards owned² × input-basket coverage)
//                          × race factor (discounted when an opponent is
//                          close). Smooth partial credit means buying a
//                          partner card or producing an upstream input
//                          RAISES Ṽ — multi-step staging emerges from the
//                          gradient rather than from scripted special cases.
//            · position  — market roads (future spread rebates) and pending
//                          free-card grants.
//   λ(t)   — decays to 0 on the final round, so the last turns liquidate.
//
// Held resources are valued at SELL price inside R, and planned activations
// charge held inputs at sell value (their opportunity cost) while pricing
// shortfalls at buy quotes. Holding therefore earns exactly the bid/ask
// spread plus any prestige-staging credit — balanced against the opportunity
// cost of the tied-up cash, which the search sees through competing uses.
//
// ── Search (difficulty = search strength) ───────────────────────────────────
//   easy    greedy on R only (activation margins), breadth 1, with a seeded
//           mistake chance. No Φ, no rollout.
//   normal  rank candidates by a cheap analytic prescore, evaluate the top 4
//           with the full Ṽ, roll the top 2 out to end of turn with the
//           base policy, pick the best terminal value.
//   hard    same, breadth 8 / rollout 4 / deeper rollouts — a strict
//           superset of normal's consideration set.
//
// ── Guarantees ──────────────────────────────────────────────────────────────
// Termination: every action requires a strictly positive value gain and Ṽ is
// bounded, plus the hard action guard in runAiTurn. Legality: only public
// engine functions are called. Determinism: the only randomness is the easy
// tier's mistake roll, drawn from the seeded game RNG.
//
// Known blindnesses (documented, deliberate): the AI never borrows cards and
// never builds player-to-player roads; it assumes a static world during
// rollouts (opponents and market drift are frozen); it does not model
// record-tracker awards (v7 records) in its value function.

import type {
  ActivationOption,
  AiDifficulty,
  GameState,
  PlayerState,
  ResourceId,
} from "./types";
import {
  activateMultiCardRecipe,
  borrowCard,
  buildMarketRoad,
  buyCard,
  buyResource,
  claimCardGrant,
  endTurn,
  getAvailableActivations,
  inventorySellValue,
  sellCard,
  sellResource,
  setTurbineMode,
  tableauLimit,
} from "./game";
import { calculateMarketQuote, unitBuyPrice, unitSellPrice } from "./market";
import { getCard, CARDS } from "./data/cards";
import { getRecipe, RECIPES } from "./data/recipes";
import { RESOURCES, getResource } from "./data/resources";
import { GAME_CONFIG } from "./data/config";
import { nextRandom } from "./rng";

/** Credits the AI considers one prestige point to be worth (dollars). */
const PRESTIGE_CREDIT_VALUE = 10;

/** Whether the board-profit estimate models the AI's own market impact (v13).
 * Always on in play; the balance harness toggles it to measure the effect. */
let MARKET_IMPACT_MODEL = true;
export function setMarketImpactModel(on: boolean): void {
  MARKET_IMPACT_MODEL = on;
}

/** Player-class parameters (shared with the engine). */
const CP = GAME_CONFIG.classParams;

/**
 * Class affinity (v12). When on, the AI (a) values its own class's mechanics
 * in the shaped value function — regenerist/land-baron output bonuses,
 * hipster first-use doubling, line-boss cheaper food/energy, trader's halved
 * prestige and richer rebates — and (b) is nudged toward the actions that
 * exercise them (the parasite actually borrows, the liquidator flips cards,
 * the trader lays more road). Off = classes play as vanilla AIs. Gated so the
 * behavior is a clean, measurable, toggleable feature.
 */
function affinityOn(state: GameState): boolean {
  return state.aiClassAffinity ?? GAME_CONFIG.ai.classAffinityDefault;
}

export interface AiTurnReport {
  state: GameState;
  actions: number;
  hitGuard: boolean;
  /** Legibility: one line per decision, with the value motive that drove it. */
  steps: string[];
}

/** The value motives behind one state evaluation (all in score points). */
export interface ValueBreakdown {
  /** Liquidation value: prestige + netWorth/10 (== final score if game ended). */
  R: number;
  /** Future earning power of the board over the remaining horizon. */
  engine: number;
  /** Discounted unclaimed-prestige potential (feasibility × race). */
  prestige: number;
  /** Roads (future rebates) + pending grants. */
  position: number;
  /** R + λ·(engine + prestige + position). */
  total: number;
}

function drawRandom(state: GameState): [GameState, number] {
  const [rngState, value] = nextRandom(state.rngState);
  return [{ ...state, rngState }, value];
}

function active(state: GameState): PlayerState {
  return state.players[state.activePlayerIndex];
}

function sellValue(state: GameState, rid: ResourceId, qty: number): number {
  return calculateMarketQuote(rid, "sell", qty, state.market[rid]).total;
}

function buyPriceOr(
  state: GameState,
  rid: ResourceId,
  fallback: number,
): number {
  return unitBuyPrice(rid, state.market[rid]) ?? fallback;
}

/** Energy for a recipe; for the Turbine/Generator, picks the cheaper of
 * grid start (electricity) and black start (fuel) and reports the mode. */
function recipeEnergy(
  state: GameState,
  p: PlayerState,
  recipeId: string,
): { needs: Record<ResourceId, number>; turbineMode?: "grid" | "black" } {
  const recipe = getRecipe(recipeId);
  if (
    recipe.requiredCardTypes.length === 1 &&
    recipe.requiredCardTypes[0] === "turbine_generator"
  ) {
    const elecCost =
      (p.resources.electricity ?? 0) > 0
        ? 0.5 * buyPriceOr(state, "electricity", 3)
        : buyPriceOr(state, "electricity", 99);
    const fuelCost =
      (p.resources.fuel ?? 0) > 0
        ? 0.5 * buyPriceOr(state, "fuel", 3)
        : buyPriceOr(state, "fuel", 99);
    return elecCost <= fuelCost
      ? { needs: { electricity: 1 }, turbineMode: "grid" }
      : { needs: { fuel: 1 }, turbineMode: "black" };
  }
  const tag =
    recipe.requiredCardTypes.length > 1
      ? "machinery"
      : getCard(recipe.requiredCardTypes[0]).tag;
  if (!tag) return { needs: {} };
  const cost = GAME_CONFIG.activationEnergy[tag];
  return { needs: { [cost.resource]: cost.amount } };
}

interface Plan {
  option: ActivationOption;
  margin: number;
  /** Warehouse purchases needed first: id -> units. */
  toBuy: Partial<Record<ResourceId, number>>;
  buyCost: number;
  /** Set when the turbine should be toggled before activating. */
  turbineMode?: "grid" | "black";
}

/**
 * Plan an activation: what must be bought, and the net margin (output sell
 * value + prestige credit − input cost − energy/food overhead). Held inputs
 * are charged at their SELL value (opportunity cost); shortfalls at buy
 * quotes — so holding earns exactly the spread, never more.
 */
export function planOption(
  state: GameState,
  p: PlayerState,
  option: ActivationOption,
): Plan | null {
  const recipe = getRecipe(option.recipeId);
  const aff = affinityOn(state);
  const seqKey = recipe.requiredCardTypes.join(">");
  // Regenerist can't produce raws other than agriculture/livestock.
  if (p.classId === "regenerist") {
    for (const rid of Object.keys(recipe.outputs)) {
      const def = RESOURCES.find((r) => r.id === rid);
      if (
        def?.category === "raw" &&
        !GAME_CONFIG.classParams.regeneristRawAllowed.includes(rid)
      ) {
        return null;
      }
    }
  }
  const toBuy: Partial<Record<ResourceId, number>> = {};
  let buyCost = 0;
  let inputCost = 0;
  /** Total units this activation will consume per resource (inputs+energy). */
  const demand: Record<string, number> = {};

  // Consumed inputs: buy the shortfall; cost = purchase + opportunity value.
  for (const [rid, nRaw] of Object.entries(recipe.inputs)) {
    const n = nRaw ?? 0;
    demand[rid] = (demand[rid] ?? 0) + n;
    const have = p.resources[rid] ?? 0;
    const short = Math.max(0, n - have);
    if (short > 0) {
      const quote = calculateMarketQuote(rid, "buy", short, state.market[rid]);
      if (quote.units < short) return null;
      toBuy[rid] = (toBuy[rid] ?? 0) + short;
      buyCost += quote.total;
      inputCost += quote.total;
    }
    inputCost += sellValue(state, rid, Math.min(have, n));
  }

  // Non-consumed requirements + commitment ledger (buying tops up).
  for (const [rid, nRaw] of Object.entries(recipe.requires ?? {})) {
    const n = nRaw ?? 0;
    const have =
      (p.resources[rid] ?? 0) + (toBuy[rid] ?? 0) - (demand[rid] ?? 0);
    const committed = state.turn.committed[rid] ?? 0;
    const usable = have - committed;
    if (usable < n) {
      const short = n - usable;
      const quote = calculateMarketQuote(rid, "buy", short, state.market[rid]);
      if (quote.units < short) return null;
      toBuy[rid] = (toBuy[rid] ?? 0) + short;
      buyCost += quote.total;
      // Requirements are kept, so only charge a fraction of their cost.
      inputCost += quote.total / 4;
    }
  }

  // Energy + food overhead.
  const { needs: energy, turbineMode } = recipeEnergy(
    state,
    p,
    option.recipeId,
  );
  let overhead = 0;
  for (const [rid, nRaw] of Object.entries(energy)) {
    const n = nRaw ?? 0;
    // Line Boss covers 2 machinery activations with one electricity: on odd
    // parity this activation's electricity is free (mirrors the engine).
    if (
      aff &&
      p.classId === "lineBoss" &&
      rid === "electricity" &&
      p.machineryActs % 2 === 1
    ) {
      continue;
    }
    demand[rid] = (demand[rid] ?? 0) + n;
    const short = Math.max(
      0,
      (demand[rid] ?? 0) - (p.resources[rid] ?? 0) - (toBuy[rid] ?? 0),
    );
    if (short > 0) {
      const quote = calculateMarketQuote(rid, "buy", short, state.market[rid]);
      if (quote.units < short) return null;
      toBuy[rid] = (toBuy[rid] ?? 0) + short;
      buyCost += quote.total;
    }
    overhead += n * buyPriceOr(state, rid, 3);
  }
  // Line Boss owes food only every 4 activations instead of every 3.
  const perFood =
    aff && p.classId === "lineBoss"
      ? CP.lineBossActivationsPerFood
      : GAME_CONFIG.activationsPerFood;
  const foodDue = state.turn.activations % perFood === 0;
  if (foodDue) {
    demand.food = (demand.food ?? 0) + 1;
    const shortFood = Math.max(
      0,
      (demand.food ?? 0) - (p.resources.food ?? 0) - (toBuy.food ?? 0),
    );
    if (shortFood > 0) {
      const quote = calculateMarketQuote(
        "food",
        "buy",
        shortFood,
        state.market.food,
      );
      if (quote.units < shortFood) return null;
      toBuy.food = (toBuy.food ?? 0) + shortFood;
      buyCost += quote.total;
    }
  }
  overhead += buyPriceOr(state, "food", 3) / perFood;

  // Output value.
  let revenue = 0;
  if (recipe.special === "harvest" || recipe.special === "fertilize") {
    // Both harvest at the farm's current yield (v7); fertilize also raises it.
    const primary = p.cards.find(
      (c) => c.instanceId === option.cardInstanceIds[0],
    )!;
    const yieldNow = Math.min(
      primary.harvestOutput ?? 2,
      GAME_CONFIG.farmMaxHarvest,
    );
    revenue = sellValue(state, "agriculture", yieldNow);
    // Regenerist's +1-to-every-output also lifts the harvest.
    if (aff && p.classId === "regenerist") {
      revenue += sellValue(state, "agriculture", 1);
    }
    // Fertilizing preserves/raises future yield — a small forward-looking bonus.
    if (recipe.special === "fertilize" && state.maxRounds - state.round >= 1) {
      revenue += sellValue(state, "agriculture", 1);
    }
  } else {
    const novelHipster =
      aff &&
      p.classId === "hipster" &&
      !p.usedSequenceKeysEver.includes(seqKey);
    for (const [rid, n] of Object.entries(recipe.outputs)) {
      const units = n ?? 0;
      revenue += sellValue(state, rid, units);
      // Producing machinery/vehicles also grants a free card (extra value).
      if (GAME_CONFIG.productionCardGrants[rid]) {
        revenue += 8 * units;
      }
      // Class output bonuses the engine will actually apply (v12): Hipster
      // doubles a novel sequence's intermediate output, Regenerist adds +1 to
      // every output, Land Baron adds +1 to raw outputs. Valuing the extra
      // units is what makes the AI lean into the class's strength.
      if (aff && units > 0) {
        const cat = getResource(rid).category;
        let extra = 0;
        if (novelHipster && cat === "intermediate") extra += units;
        if (p.classId === "regenerist") extra += 1;
        if (p.classId === "landBaron" && cat === "raw") extra += 1;
        if (extra > 0) revenue += sellValue(state, rid, extra);
      }
    }
  }
  // Recompute the exact purchase cost with ONE sequential quote per
  // resource (separate per-need quotes would underprice later units when a
  // resource is needed both as input and as energy).
  buyCost = 0;
  // Regenerist can't buy anything, so only fully-stocked activations are viable.
  if (
    p.classId === "regenerist" &&
    Object.values(toBuy).some((n) => (n ?? 0) > 0)
  ) {
    return null;
  }
  for (const [rid, nRaw] of Object.entries(toBuy)) {
    const n = nRaw ?? 0;
    if (n <= 0) continue;
    const quote = calculateMarketQuote(rid, "buy", n, state.market[rid]);
    if (quote.units < n) return null;
    buyCost += quote.total;
  }

  // Prestige goes only to the first producer of each finished good.
  let prestige = recipe.prestige ?? 0;
  if (prestige > 0) {
    const productId = Object.keys(recipe.outputs)[0];
    if (state.prestigeClaimed[productId] !== undefined) prestige = 0;
  }
  // The Trader only earns half of each prestige award.
  if (aff && p.classId === "trader") prestige = Math.floor(prestige / 2);
  const margin =
    revenue + prestige * PRESTIGE_CREDIT_VALUE - inputCost - overhead;
  return { option, margin, toBuy, buyCost, turbineMode };
}

function executePlan(
  state: GameState,
  playerId: string,
  plan: Plan,
): GameState {
  let s = state;
  if (plan.turbineMode) {
    s = setTurbineMode(
      s,
      playerId,
      plan.option.cardInstanceIds[0],
      plan.turbineMode,
    );
  }
  for (const [rid, n] of Object.entries(plan.toBuy)) {
    if ((n ?? 0) > 0) s = buyResource(s, playerId, rid, n ?? 0);
  }
  return activateMultiCardRecipe(
    s,
    playerId,
    plan.option.recipeId,
    plan.option.cardInstanceIds,
  );
}

/**
 * Parasite affinity: borrow one card from another player and immediately run
 * the best activation it unlocks (borrowed cards vanish at turn end and may
 * activate once). A self-contained compound move so the shaped value function
 * sees the produced goods, not a dangling borrowed card.
 */
function borrowAndRun(
  state: GameState,
  playerId: string,
  ownerId: string,
  ownerInstanceId: string,
  cardType: string,
): GameState {
  let s = borrowCard(state, playerId, ownerId, ownerInstanceId);
  const me = s.players.find((x) => x.id === playerId)!;
  const borrowed = [...me.cards]
    .reverse()
    .find((c) => c.borrowedFrom === ownerId && c.cardTypeId === cardType);
  if (!borrowed) return s;
  let bestPlan: Plan | null = null;
  for (const o of getAvailableActivations(s, playerId)) {
    if (!o.cardInstanceIds.includes(borrowed.instanceId)) continue;
    const plan = planOption(s, me, o);
    if (!plan || plan.buyCost > me.cash) continue;
    if (!bestPlan || plan.margin > bestPlan.margin) bestPlan = plan;
  }
  if (bestPlan && bestPlan.margin > 0) s = executePlan(s, playerId, bestPlan);
  return s;
}

/**
 * Best single-activation margin the player would gain by BORROWING one copy
 * of `cardType` — considering every recipe that lists the card ANYWHERE in
 * its sequence (not just recipes keyed to that card), and requiring the
 * borrower to already own the remaining cards. Used to rank Parasite borrows.
 */
function bestBorrowMargin(
  state: GameState,
  p: PlayerState,
  cardType: string,
): number {
  const have = countBy(
    p.cards.filter((c) => !c.borrowedFrom).map((c) => c.cardTypeId),
  );
  have.set(cardType, (have.get(cardType) ?? 0) + 1); // the borrowed copy
  let best = 0;
  const seenSeq = new Set<string>();
  for (const recipe of RECIPES) {
    if (!recipe.requiredCardTypes.includes(cardType)) continue;
    const key = recipe.requiredCardTypes.join(">");
    if (seenSeq.has(key)) continue;
    seenSeq.add(key);
    const need = countBy(recipe.requiredCardTypes);
    let ok = true;
    for (const [t, cnt] of need) {
      if ((have.get(t) ?? 0) < cnt) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let revenue = 0;
    for (const [rid, n] of Object.entries(recipe.outputs)) {
      revenue += sellValue(state, rid, n ?? 0);
      if (GAME_CONFIG.productionCardGrants[rid]) revenue += 8 * (n ?? 0);
    }
    let prestigeVal = recipe.prestige ?? 0;
    if (prestigeVal > 0) {
      const productId = Object.keys(recipe.outputs)[0];
      if (state.prestigeClaimed[productId] !== undefined) prestigeVal = 0;
    }
    revenue += prestigeVal * PRESTIGE_CREDIT_VALUE;
    let cost = 2; // energy + food share
    let feasible = true;
    for (const [rid, n] of Object.entries(recipe.inputs)) {
      // Held inputs cost their opportunity (sell) value; shortfalls the buy.
      const held = Math.min(p.resources[rid] ?? 0, n ?? 0);
      const short = (n ?? 0) - held;
      cost += sellValue(state, rid, held);
      if (short > 0) {
        const price = unitBuyPrice(rid, state.market[rid]);
        if (price === null) {
          feasible = false;
          break;
        }
        cost += price * short;
      }
    }
    if (!feasible) continue;
    best = Math.max(best, revenue - cost);
  }
  return best;
}

/** Estimated best per-turn margin a card type could add to `owner`'s deck. */
function cardPerTurnValue(
  state: GameState,
  cardTypeId: string,
  owner: PlayerState,
): number {
  const def = getCard(cardTypeId);
  let best = 0;
  for (const rid of def.recipeIds) {
    const recipe = getRecipe(rid);
    if (recipe.special === "fertilize") continue;
    // Sequence completion: count missing partner card types.
    const counts = new Map<string, number>();
    for (const t of recipe.requiredCardTypes) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    counts.set(cardTypeId, (counts.get(cardTypeId) ?? 0) - 1);
    let missing = 0;
    for (const [t, need] of counts) {
      const owned = owner.cards.filter((c) => c.cardTypeId === t).length;
      missing += Math.max(0, (need ?? 0) - owned);
    }
    // Only value complete sequences, or ones this card leaves 1 short —
    // buying deep into incomplete sequences strands cash in dead cards.
    if (missing > 1) continue;
    let revenue = 0;
    for (const [res, n] of Object.entries(recipe.outputs)) {
      revenue += sellValue(state, res, n ?? 0);
    }
    let prestigeVal = recipe.prestige ?? 0;
    if (prestigeVal > 0) {
      const productId = Object.keys(recipe.outputs)[0];
      if (state.prestigeClaimed[productId] !== undefined) prestigeVal = 0;
    }
    revenue += prestigeVal * PRESTIGE_CREDIT_VALUE;
    let cost = 2; // energy + food share
    let feasible = true;
    for (const [res, n] of Object.entries(recipe.inputs)) {
      const price = unitBuyPrice(res, state.market[res]);
      if (price === null) {
        feasible = false;
        break;
      }
      cost += price * (n ?? 0);
    }
    for (const [res, n] of Object.entries(recipe.requires ?? {})) {
      const price = unitBuyPrice(res, state.market[res]);
      if (price === null) {
        feasible = false;
        break;
      }
      cost += (price * (n ?? 0)) / 4;
    }
    if (!feasible) continue;
    // Discount for incomplete sequences (partners must still be acquired).
    const value = (revenue - cost) * (missing === 0 ? 1 : 0.35);
    best = Math.max(best, value);
  }
  return best;
}

/** Resources the AI keeps rather than sells (working stock). */
function keepTargets(
  state: GameState,
  p: PlayerState,
): Record<ResourceId, number> {
  const keep: Record<ResourceId, number> = {};
  let machineryActs = 0;
  let vehicleActs = 0;
  const needsLivestock = p.cards.some((c) =>
    getCard(c.cardTypeId).recipeIds.some(
      (r) => (getRecipe(r).requires?.livestock ?? 0) > 0,
    ),
  );
  for (const c of p.cards) {
    const tag = getCard(c.cardTypeId).tag;
    if (tag === "machinery") machineryActs++;
    else if (tag === "vehicles") vehicleActs++;
  }
  keep.electricity = Math.min(machineryActs, 6);
  keep.fuel = Math.min(vehicleActs, 6);
  keep.food = 2;
  if (needsLivestock) keep.livestock = 3;
  // Keep one asphalt per market road it still wants (cheap heuristic: 1).
  keep.asphalt = p.marketRoads.length < 2 ? 1 : 0;
  // Staging: never sell inputs that feed an unclaimed prestige recipe whose
  // cards this player (mostly) owns — those units ARE the multi-turn plan.
  for (const [rid, units] of Object.entries(stagingTargets(state, p))) {
    keep[rid] = Math.max(keep[rid] ?? 0, units);
  }
  return keep;
}

/**
 * Input units worth holding for unclaimed prestige recipes this player is
 * meaningfully invested in (owns at least half the required cards). This is
 * what makes multi-turn staging stable: produced/bought inputs for the big
 * finished goods are not liquidated by the surplus-selling pass.
 */
function stagingTargets(
  state: GameState,
  p: PlayerState,
): Record<ResourceId, number> {
  const targets: Record<ResourceId, number> = {};
  const roundsLeft = effectiveEndRound(state) - state.round;
  if (roundsLeft < 1) return targets;
  for (const recipe of RECIPES) {
    if (!recipe.prestige || recipe.prestige <= 0) continue;
    const productId = Object.keys(recipe.outputs)[0];
    if (state.prestigeClaimed[productId] !== undefined) continue;
    if (cardsPartFor(p, recipe.requiredCardTypes) < 0.5) continue;
    for (const [rid, n] of Object.entries(recipe.inputs)) {
      targets[rid] = Math.max(targets[rid] ?? 0, n ?? 0);
    }
  }
  return targets;
}

/** Fraction of a required card-type list this player owns (with multiplicity,
 * excluding borrowed copies — they vanish at end of turn). */
function cardsPartFor(p: PlayerState, requiredCardTypes: string[]): number {
  const need = new Map<string, number>();
  for (const t of requiredCardTypes) need.set(t, (need.get(t) ?? 0) + 1);
  let owned = 0;
  for (const [t, n] of need) {
    const have = p.cards.filter(
      (c) => c.cardTypeId === t && !c.borrowedFrom,
    ).length;
    owned += Math.min(n, have);
  }
  return owned / requiredCardTypes.length;
}

/**
 * Estimated per-turn profit of a player's board: greedily schedule the most
 * profitable activations, respecting the combo limits (each card up to
 * maxUsesPerTurn uses, each in a different sequence). This is the AI's measure
 * of what a set of cards is worth — a duplicate card only adds value if the
 * board can actually run it profitably.
 */
function estimateBoardProfit(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return 0;
  const scored = getAvailableActivations(state, playerId)
    .map((o) => ({ o, plan: planOption(state, p, o) }))
    .filter(
      (x): x is { o: ActivationOption; plan: Plan } =>
        !!x.plan && x.plan.margin > 0,
    )
    .sort((a, b) => b.plan.margin - a.plan.margin);
  const uses = new Map<string, number>();
  const seqByInst = new Map<string, Set<string>>();
  let total = 0;
  const producedTally: Record<string, number> = {};
  const boughtTally: Record<string, number> = {};
  // Per-resource sum of the output sell-value each activation's plan CREDITED,
  // computed independently against the current top of the ladder. Used below
  // to subtract the market impact the individual plans could not see.
  const plannedSell: Record<string, number> = {};
  for (const { o, plan } of scored) {
    const recipe = getRecipe(o.recipeId);
    const seqKey = recipe.requiredCardTypes.join(">");
    const ok = o.cardInstanceIds.every((id) => {
      const seqs = seqByInst.get(id);
      return (
        (uses.get(id) ?? 0) < GAME_CONFIG.maxUsesPerTurn && !seqs?.has(seqKey)
      );
    });
    if (!ok) continue;
    for (const id of o.cardInstanceIds) {
      uses.set(id, (uses.get(id) ?? 0) + 1);
      let seqs = seqByInst.get(id);
      if (!seqs) {
        seqs = new Set();
        seqByInst.set(id, seqs);
      }
      seqs.add(seqKey);
    }
    total += plan.margin;
    for (const [rid, n] of Object.entries(recipe.outputs)) {
      const units = n ?? 0;
      producedTally[rid] = (producedTally[rid] ?? 0) + units;
      plannedSell[rid] = (plannedSell[rid] ?? 0) + sellValue(state, rid, units);
    }
    for (const [rid, n] of Object.entries(plan.toBuy)) {
      boughtTally[rid] = (boughtTally[rid] ?? 0) + (n ?? 0);
    }
  }

  // ── Own-market impact (v13) ──────────────────────────────────────────────
  // Each plan priced its output at the CURRENT top of the sell ladder, blind
  // to the units the rest of this schedule dumps into the same market. The
  // true revenue for producing P units of a good is a SINGLE walk down the
  // ladder from the current stock — which also caps at what the market can
  // absorb (beyond capacity, extra units sell for nothing). Subtract the gap
  // so the AI foresees flooding its own markets instead of discovering it only
  // when the sells actually execute.
  if (MARKET_IMPACT_MODEL) {
    for (const [rid, produced] of Object.entries(producedTally)) {
      if (produced <= 0) continue;
      const walk = calculateMarketQuote(
        rid,
        "sell",
        produced,
        state.market[rid],
      ).total;
      const planned = plannedSell[rid] ?? 0;
      if (planned > walk) total -= planned - walk;
    }
  }
  // Vertical-integration synergy: when the schedule PRODUCES what it also
  // BUYS (a turbine feeding machinery, a farm feeding food upkeep, a
  // refinery fueling vehicles), the internal flow saves the bid/ask spread
  // that the per-recipe margins charged twice. Credit it once per matched
  // unit — this is what makes self-supply boards worth building.
  for (const [rid, made] of Object.entries(producedTally)) {
    const bought = boughtTally[rid] ?? 0;
    if (bought <= 0) continue;
    const stock = state.market[rid];
    const buy = unitBuyPrice(rid, stock);
    const sell = unitSellPrice(rid, stock);
    if (buy === null && sell === null) continue;
    const spread = Math.max(1, (buy ?? (sell ?? 0) + 2) - (sell ?? 0));
    total += Math.min(made, bought) * spread;
  }
  return total;
}

/** Board profit if the player held exactly `cardTypeIds` (fresh copies), on a
 * CLEAN shallow-cloned state — the input state is never mutated.
 *
 * The hypothetical player has an EMPTY warehouse: every input is priced at
 * market buy quotes. This makes the estimate a property of the BOARD and the
 * MARKET only — current inventory must not swing it, or consuming a held
 * input would be double-charged (once as opportunity cost in the activation
 * margin, and again as a drop in "future potential" multiplied by the
 * horizon). Inventory's forward value lives in R (liquidation) and in the
 * prestige-staging coverage instead. */
function boardProfitForCards(
  state: GameState,
  p: PlayerState,
  cardTypeIds: string[],
): number {
  const hypoCards = cardTypeIds.map((tid, i) => ({
    instanceId: `hypo-${i}`,
    cardTypeId: tid,
    usedSequences: [],
    ...(tid === "farm" ? { harvestOutput: 2 } : {}),
  }));
  const hypoState: GameState = {
    ...state,
    turn: { ...state.turn, committed: {}, activations: 0 },
    players: state.players.map((pl) =>
      pl.id === p.id
        ? {
            ...pl,
            cards: hypoCards,
            // The Regenerist cannot buy inputs, so their board's earning
            // power genuinely IS inventory-dependent — keep it for them.
            resources: pl.classId === "regenerist" ? pl.resources : {},
          }
        : pl,
    ),
  };
  return estimateBoardProfit(hypoState, p.id);
}

/** Per-turn earning power of the player's PERMANENT board on a fresh turn:
 * borrowed cards excluded, combo usage and commitments reset. Used by the
 * engine-potential term so that activating now never "uses up" future value. */
function potentialBoardProfit(state: GameState, p: PlayerState): number {
  return boardProfitForCards(
    state,
    p,
    p.cards.filter((c) => !c.borrowedFrom).map((c) => c.cardTypeId),
  );
}

function removeOne(arr: string[], val: string): string[] {
  const i = arr.indexOf(val);
  return i === -1 ? arr.slice() : [...arr.slice(0, i), ...arr.slice(i + 1)];
}

function countBy(arr: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/**
 * Net value (over `horizon` turns, minus cost) of acquiring `cType`, measured
 * as the rise in total board profit. Beyond the immediate gain, it credits a
 * card for progressing an as-yet-incomplete facility: if `cType` leaves a
 * facility only one or two partner cards short, it scores the board profit of
 * the completed facility, discounted by the partners still to be bought.
 */
function cardAcquisitionValue(
  state: GameState,
  p: PlayerState,
  heldTypes: string[],
  cType: string,
  p0: number,
  horizon: number,
  effCost?: number,
): number {
  // effCost lets the Liquidator discount a card by the 80% it can reclaim on
  // resale — the sunk portion is small, so more situational buys clear the bar.
  const cost = effCost ?? getCard(cType).cost;
  let best =
    (boardProfitForCards(state, p, [...heldTypes, cType]) - p0) * horizon -
    cost;

  const have = countBy([...heldTypes, cType]);
  const seenSeq = new Set<string>();
  for (const recipe of RECIPES) {
    if (!recipe.requiredCardTypes.includes(cType)) continue;
    const key = recipe.requiredCardTypes.join(">");
    if (seenSeq.has(key)) continue;
    seenSeq.add(key);
    const need = countBy(recipe.requiredCardTypes);
    const missing: string[] = [];
    for (const [t, cnt] of need) {
      const short = cnt - (have.get(t) ?? 0);
      for (let i = 0; i < short; i++) missing.push(t);
    }
    if (missing.length === 0 || missing.length > 2) continue;
    const plan = [...heldTypes, cType, ...missing];
    const gain = (boardProfitForCards(state, p, plan) - p0) * horizon;
    const partnerCost = missing.reduce((s, t) => s + getCard(t).cost, 0);
    best = Math.max(best, gain - cost - 0.6 * partnerCost);
  }
  return best;
}

// ---------------------------------------------------------------------------
// the shaped value function  Ṽ(s) = R(s) + λ(t)·Φ(s)

/** The round after which the game ends (accounts for the all-produced rule). */
function effectiveEndRound(state: GameState): number {
  return state.allProducedRound !== null
    ? Math.min(state.maxRounds, state.allProducedRound + 1)
    : state.maxRounds;
}

/** λ(t): 1 with 2+ rounds left, 0.5 with 1, 0 on the final round. */
function lambdaFor(state: GameState): number {
  const roundsLeft = effectiveEndRound(state) - state.round;
  return Math.min(1, Math.max(0, roundsLeft / 2));
}

/** Liquidation value in score points: prestige + netWorth/10. */
function liquidationValue(state: GameState, p: PlayerState): number {
  const cardTotal = p.cards.reduce(
    (s, c) => (c.borrowedFrom ? s : s + getCard(c.cardTypeId).cost),
    0,
  );
  const netWorth =
    p.cash +
    inventorySellValue(state, p) +
    Math.floor(cardTotal / GAME_CONFIG.scoring.cardValueDivisor);
  return p.prestige + netWorth / GAME_CONFIG.scoring.economicDivisor;
}

/** How much of a still-unclaimed prestige point the potential term credits.
 * MUST be well below 1: realizing prestige removes the good's potential, so
 * a claim nets π·(1 − λ·PRESTIGE_POTENTIAL_DAMP·feas). Too close to 1 and
 * the agent hoards feasibility instead of cashing it in. */
const PRESTIGE_POTENTIAL_DAMP = 0.6;

/** Prestige potential: Σ over unclaimed finished goods of prestige ×
 * feasibility × race (damped). Feasibility = (cards owned fraction)² ×
 * input-basket coverage — smooth, so staging steps each raise Ṽ. */
function prestigePotential(state: GameState, p: PlayerState): number {
  let total = 0;
  const bestByProduct = new Map<string, number>();
  for (const recipe of RECIPES) {
    if (!recipe.prestige || recipe.prestige <= 0) continue;
    const productId = Object.keys(recipe.outputs)[0];
    if (state.prestigeClaimed[productId] !== undefined) continue;
    const cardsPart = cardsPartFor(p, recipe.requiredCardTypes);
    if (cardsPart <= 0) continue;
    // Input-basket coverage, weighted by unit value.
    let basketCost = 0;
    let heldValue = 0;
    for (const [rid, nRaw] of Object.entries(recipe.inputs)) {
      const n = nRaw ?? 0;
      const price = buyPriceOr(state, rid, 6);
      basketCost += n * price;
      heldValue += Math.min(p.resources[rid] ?? 0, n) * price;
    }
    const coverage = basketCost > 0 ? heldValue / basketCost : 1;
    const inputsPart = 0.4 + 0.6 * Math.min(1, coverage);
    const feas = cardsPart * cardsPart * inputsPart;
    // Race: discount only when an opponent is STRICTLY closer on cards.
    // An opponent merely tied with us does not devalue the sprint — the
    // race goes to whoever moves first, and it is our turn right now.
    let oppBest = 0;
    for (const other of state.players) {
      if (other.id === p.id) continue;
      oppBest = Math.max(
        oppBest,
        cardsPartFor(other, recipe.requiredCardTypes),
      );
    }
    const excess = Math.max(0, oppBest - cardsPart);
    const race = 1 - 0.9 * excess;
    const value = PRESTIGE_POTENTIAL_DAMP * recipe.prestige * feas * race;
    const prev = bestByProduct.get(productId) ?? 0;
    if (value > prev) bestByProduct.set(productId, value);
  }
  for (const v of bestByProduct.values()) total += v;
  // The Trader earns half prestige, so the potential is worth half to them.
  return p.classId === "trader" ? total / 2 : total;
}

/** Position potential: market roads (future spread rebates) + pending free
 * grants. Farm/ranch earning power lives in the engine term, not here. */
function positionPotential(state: GameState, p: PlayerState): number {
  const roundsLeft = effectiveEndRound(state) - state.round;
  const rebate =
    p.classId === "trader"
      ? GAME_CONFIG.classParams.traderRoadRebate
      : GAME_CONFIG.roadRebate;
  const roadDollars = p.marketRoads.length * rebate * 1.2 * roundsLeft;
  const grants = state.pendingGrants.filter((g) => g.playerId === p.id).length;
  return roadDollars / 10 + grants * 0.8;
}

/** Full shaped-value evaluation for one player. */
export function evaluatePosition(
  state: GameState,
  playerId: string,
): ValueBreakdown {
  const p = state.players.find((x) => x.id === playerId)!;
  const R = liquidationValue(state, p);
  const lambda = lambdaFor(state);
  if (lambda === 0) {
    return { R, engine: 0, prestige: 0, position: 0, total: R };
  }
  const roundsLeft = effectiveEndRound(state) - state.round;
  const horizon = Math.min(roundsLeft, 4);
  const engine =
    (potentialBoardProfit(state, p) * horizon * 0.5) /
    GAME_CONFIG.scoring.economicDivisor;
  const prestige = prestigePotential(state, p);
  const position = positionPotential(state, p);
  return {
    R,
    engine: lambda * engine,
    prestige: lambda * prestige,
    position: lambda * position,
    total: R + lambda * (engine + prestige + position),
  };
}

// ---------------------------------------------------------------------------
// candidate actions

interface Candidate {
  kind:
    | "activate"
    | "buyCard"
    | "swapSell"
    | "road"
    | "sell"
    | "stageBuy"
    | "borrow"
    | "claimGrant";
  describe: string;
  /** Cheap analytic estimate of the value gain, in score points. */
  prescore: number;
  apply: (s: GameState) => GameState;
}

/**
 * Enumerate candidate actions with cheap analytic prescores. The prescores
 * only RANK candidates for full evaluation; the shaped value function makes
 * the actual decision (except on easy, which acts on prescores directly).
 *
 * `cheap` (used inside rollouts) replaces the expensive board-profit card
 * valuations with the light cardPerTurnValue estimate and skips swap
 * analysis — card decisions are made at the top level, but rollouts still
 * see enough of them to complete a sell-then-buy upgrade.
 */
function enumerateCandidates(
  state: GameState,
  p: PlayerState,
  difficulty: AiDifficulty,
  cheap = false,
): Candidate[] {
  const out: Candidate[] = [];
  const roundsLeft = effectiveEndRound(state) - state.round;
  const remainingRounds = roundsLeft + 1;
  const lastRound = roundsLeft <= 0;
  const atCardLimit =
    p.cards.filter((c) => !c.borrowedFrom).length >= tableauLimit(p);

  // Resources relevant to prestige staging (used to admit negative-margin
  // upstream production that the value function may rescue).
  const staging = difficulty === "easy" ? {} : stagingTargets(state, p);

  // -- activations --
  for (const o of getAvailableActivations(state, p.id)) {
    const plan = planOption(state, p, o);
    if (!plan) continue;
    if (plan.buyCost > p.cash) continue;
    const recipe = getRecipe(o.recipeId);
    // Staging bonus: producing an input that an unclaimed-prestige plan
    // still needs is worth ranking highly even at a negative margin — the
    // value function (not this prescore) makes the final call.
    let stagingBonus = 0;
    for (const [rid, nRaw] of Object.entries(recipe.outputs)) {
      const unmet = Math.max(0, (staging[rid] ?? 0) - (p.resources[rid] ?? 0));
      stagingBonus += Math.min(unmet, nRaw ?? 0) * 0.8;
    }
    const stagingRelevant = stagingBonus > 0 || (recipe.prestige ?? 0) > 0;
    // Positive-margin plans always qualify; negative-margin ones only when
    // they plausibly serve a prestige plan (bounded loss).
    if (plan.margin <= 0 && !(stagingRelevant && plan.margin > -15)) continue;
    // Affinity nudge: surface the class's signature activation into the
    // evaluated set (the value function, corrected above, then decides).
    let affBonus = 0;
    if (affinityOn(state)) {
      const outs = Object.keys(recipe.outputs);
      // (Line Boss needs no prescore nudge: its cheaper food/energy is already
      // priced into plan.margin above, and a bump only crowds the top-K.)
      if (
        p.classId === "hipster" &&
        !p.usedSequenceKeysEver.includes(recipe.requiredCardTypes.join(">"))
      ) {
        affBonus += 0.5; // chase novel sequences for the doubling
      } else if (
        p.classId === "landBaron" &&
        outs.some((rid) => getResource(rid).category === "raw")
      ) {
        affBonus += 0.1; // raws pay an extra unit
      } else if (
        p.classId === "regenerist" &&
        outs.some((rid) => rid === "electricity" || rid === "fuel")
      ) {
        affBonus += 0.2; // self-produced energy frees it from the market
      }
    }
    out.push({
      kind: "activate",
      describe: `activate ${recipe.name}`,
      prescore: plan.margin / 10 + stagingBonus + affBonus,
      apply: (s) => executePlan(s, p.id, plan),
    });
  }

  // -- parasite borrowing (affinity) --
  // The Parasite starts with roads to everyone and borrows for $1; the AI
  // otherwise never borrows, so this is the whole personality. Each candidate
  // borrows a card and runs the best activation it unlocks in one move.
  if (
    affinityOn(state) &&
    p.classId === "parasite" &&
    !cheap &&
    p.cash >= CP.parasiteBorrowCost
  ) {
    for (const ownerId of p.playerRoads) {
      if ((p.borrowedFromCount[ownerId] ?? 0) >= CP.parasiteBorrowsPerOwner) {
        continue;
      }
      const owner = state.players.find((x) => x.id === ownerId);
      if (!owner) continue;
      const seenTypes = new Set<string>();
      for (const src of owner.cards) {
        if (src.borrowedFrom) continue;
        if (seenTypes.has(src.cardTypeId)) continue;
        seenTypes.add(src.cardTypeId);
        if (
          p.cards.some(
            (c) => c.cardTypeId === src.cardTypeId && !c.borrowedFrom,
          )
        ) {
          continue; // already own the type — borrowing adds no new sequence
        }
        const val = bestBorrowMargin(state, p, src.cardTypeId);
        if (val <= CP.parasiteBorrowCost + 1) continue; // not worth the fee
        const ownerInst = src.instanceId;
        const type = src.cardTypeId;
        out.push({
          kind: "borrow",
          describe: `borrow ${getCard(type).name} from ${owner.name}`,
          prescore: (val - CP.parasiteBorrowCost) / 10,
          apply: (s) => borrowAndRun(s, p.id, ownerId, ownerInst, type),
        });
      }
    }
  }

  // -- card acquisition --
  if (remainingRounds >= 2 && difficulty === "easy") {
    for (let slot = 0; slot < state.cardMarket.length; slot++) {
      const cardTypeId = state.cardMarket[slot];
      if (cardTypeId === null) continue;
      const def = getCard(cardTypeId);
      if (def.cost + 2 > p.cash) continue;
      if (def.category !== "production") continue;
      if (atCardLimit) continue;
      out.push({
        kind: "buyCard",
        describe: `buy ${def.name}`,
        prescore: 0.3,
        apply: (s) => buyCard(s, p.id, slot),
      });
      break; // easy grabs the first affordable production card
    }
  } else if (remainingRounds >= 2) {
    const horizon = Math.min(remainingRounds - 1, 6);
    const reserve = 15; // keep cash for prestige input baskets
    const heldTypes = p.cards
      .filter((c) => !c.borrowedFrom)
      .map((c) => c.cardTypeId);
    const P0 = cheap ? 0 : boardProfitForCards(state, p, heldTypes);

    // Straight purchases (tableau room, no same-turn sell — avoids thrash).
    if (!atCardLimit && !state.turn.soldCard) {
      for (let slot = 0; slot < state.cardMarket.length; slot++) {
        const cardTypeId = state.cardMarket[slot];
        if (cardTypeId === null) continue;
        // The AI never buys a card type it already holds — duplicates almost
        // never pay off, so they are banned outright (v10).
        if (heldTypes.includes(cardTypeId)) continue;
        const def = getCard(cardTypeId);
        if (def.cost + reserve > p.cash) continue;
        // Liquidator: the 80% resale value makes a card partly recoverable, so
        // the VALUE calc charges a reduced sunk cost (half of the non-refunded
        // portion — a conservative discount so it doesn't over-buy into its
        // small tableau). Affordability still needs the full price up front.
        const effCost =
          affinityOn(state) && p.classId === "liquidator"
            ? def.cost - Math.floor((def.cost * CP.liquidatorRefundPct) / 2)
            : def.cost;
        const net = cheap
          ? cardPerTurnValue(state, cardTypeId, p) * horizon - effCost
          : cardAcquisitionValue(
              state,
              p,
              heldTypes,
              cardTypeId,
              P0,
              horizon,
              effCost,
            );
        if (net < 1) continue;
        out.push({
          kind: "buyCard",
          describe: `buy ${def.name}`,
          prescore: net / 10,
          apply: (s) => buyCard(s, p.id, slot),
        });
      }
    }

    // At the limit: sell the least-productive card to make room for a
    // strictly better one (never after buying this turn — avoids churn).
    // Skipped in cheap mode: swaps are top-level decisions.
    if (!cheap && atCardLimit && !state.turn.boughtCard) {
      const sellable = p.cards.filter(
        (c) =>
          !c.borrowedFrom && !GAME_CONFIG.starterCards.includes(c.cardTypeId),
      );
      let dropCard: (typeof sellable)[number] | null = null;
      let dropLoss = Infinity;
      for (const c of sellable) {
        const loss =
          P0 -
          boardProfitForCards(state, p, removeOne(heldTypes, c.cardTypeId));
        if (loss < dropLoss) {
          dropLoss = loss;
          dropCard = c;
        }
      }
      if (dropCard) {
        const without = removeOne(heldTypes, dropCard.cardTypeId);
        const dropCost = getCard(dropCard.cardTypeId).cost;
        // The Liquidator gets a better sell-back rate; use the real one.
        const refund =
          p.classId === "liquidator"
            ? Math.ceil(dropCost * GAME_CONFIG.classParams.liquidatorRefundPct)
            : Math.ceil(dropCost / 2);
        // The Liquidator's cheap resale is captured in the buy-side effCost
        // discount; keep the swap bar high so it doesn't churn its 6-card
        // tableau for marginal gains.
        let bestSwapNet = 3;
        let found = false;
        for (let slot = 0; slot < state.cardMarket.length; slot++) {
          const cardTypeId = state.cardMarket[slot];
          if (cardTypeId === null) continue;
          if (cardTypeId === dropCard.cardTypeId) continue;
          if (without.includes(cardTypeId)) continue;
          const def = getCard(cardTypeId);
          if (def.cost > p.cash + refund) continue;
          if (def.cost + reserve > p.cash + refund) continue;
          const Pswap = boardProfitForCards(state, p, [...without, cardTypeId]);
          const net = (Pswap - P0) * horizon + refund - def.cost;
          if (net > bestSwapNet) {
            bestSwapNet = net;
            found = true;
          }
        }
        if (found) {
          const inst = dropCard.instanceId;
          out.push({
            kind: "swapSell",
            describe: `sell ${getCard(dropCard.cardTypeId).name} to upgrade the board`,
            prescore: bestSwapNet / 10,
            apply: (s) => sellCard(s, p.id, inst),
          });
        }
      }
    }
  }

  // -- staging buys: accumulate expensive prestige baskets across turns --
  // A fully-tooled, unclaimed prestige recipe whose one-shot activation is
  // unaffordable can still be assembled a few inputs at a time. Buying an
  // input converts cash into held coverage: the prestige-potential gradient
  // rewards it exactly when the plan is worth the tied-up cash (and the
  // surplus-sell pass protects the staged units via stagingTargets).
  // Only start (or extend) a basket that can still be finished: the final
  // activation needs its own future turn, so staging on the second-to-last
  // round is already a dead end.
  if (difficulty !== "easy" && p.classId !== "regenerist" && roundsLeft >= 2) {
    for (const recipe of RECIPES) {
      if (!recipe.prestige || recipe.prestige <= 0) continue;
      const productId = Object.keys(recipe.outputs)[0];
      if (state.prestigeClaimed[productId] !== undefined) continue;
      if (cardsPartFor(p, recipe.requiredCardTypes) < 1) continue;
      // Missing input units, cheapest first, as far as cash allows.
      const buys: [ResourceId, number][] = [];
      let cost = 0;
      const wants = Object.entries(recipe.inputs)
        .map(([rid, n]) => ({
          rid,
          short: Math.max(0, (n ?? 0) - (p.resources[rid] ?? 0)),
          price: buyPriceOr(state, rid, 99),
        }))
        .filter((w) => w.short > 0)
        .sort((a, b) => a.price - b.price);
      if (wants.length === 0) continue; // basket complete
      for (const w of wants) {
        const quote = calculateMarketQuote(
          w.rid,
          "buy",
          w.short,
          state.market[w.rid],
        );
        if (quote.units < w.short) continue; // market can't supply now
        if (cost + quote.total > p.cash - 5) break; // keep a small float
        buys.push([w.rid, w.short]);
        cost += quote.total;
      }
      if (buys.length === 0) continue;
      const units = buys.reduce((s2, [, n]) => s2 + n, 0);
      out.push({
        kind: "stageBuy",
        describe: `stage ${buys.map(([rid, n]) => `${n} ${rid}`).join(", ")} for ${recipe.name}`,
        prescore: 0.6 * units,
        apply: (s) => {
          let s2 = s;
          for (const [rid, n] of buys) s2 = buyResource(s2, p.id, rid, n);
          return s2;
        },
      });
    }
  }

  // -- market roads & surplus sales --
  const keep =
    difficulty === "easy"
      ? ({ food: 1 } as Record<ResourceId, number>)
      : keepTargets(state, p);
  const cashStarved = p.cash < 15;
  for (const r of RESOURCES) {
    const have = p.resources[r.id] ?? 0;
    const target = lastRound ? 0 : (keep[r.id] ?? 0);
    let surplus = have - target;
    if (surplus <= 0) continue;

    // Packaged goods: selling burns packaging; buy the shortfall only when
    // it pays for itself (Regenerist cannot buy, so sells what it can).
    let packagingToBuy = 0;
    if (GAME_CONFIG.packagedGoods.includes(r.id)) {
      const pk = p.resources.packaging ?? 0;
      if (pk < surplus) {
        const shortfall = surplus - pk;
        const pkQuote = calculateMarketQuote(
          "packaging",
          "buy",
          shortfall,
          state.market.packaging,
        );
        const unitRevenue = unitSellPrice(r.id, state.market[r.id]) ?? 0;
        if (
          p.classId !== "regenerist" &&
          pkQuote.units === shortfall &&
          pkQuote.total <= p.cash &&
          unitRevenue * shortfall > pkQuote.total
        ) {
          packagingToBuy = shortfall;
        } else {
          surplus = pk;
        }
      }
      if (surplus <= 0) continue;
    }

    const quote = calculateMarketQuote(
      r.id,
      "sell",
      surplus,
      state.market[r.id],
    );
    if (quote.units <= 0 || quote.total <= 0) continue;
    const units = quote.units;

    // Road the market first when selling a meaningful batch there. The Trader,
    // whose rebates pay double, lays road on smaller batches and prizes it more.
    const traderAff = affinityOn(state) && p.classId === "trader";
    const roadGate = traderAff ? 2 : 3;
    if (
      difficulty !== "easy" &&
      units >= roadGate &&
      !p.marketRoads.includes(r.id) &&
      (p.resources.asphalt ?? 0) >= GAME_CONFIG.roadCost &&
      roundsLeft >= 1
    ) {
      const rebate = traderAff
        ? GAME_CONFIG.classParams.traderRoadRebate
        : GAME_CONFIG.roadRebate;
      out.push({
        kind: "road",
        describe: `build market road to ${r.name}`,
        prescore: (units * rebate) / 10 + 0.05 + (traderAff ? 0.3 : 0),
        apply: (s) => buildMarketRoad(s, p.id, r.id),
      });
    }

    // Selling is nearly liquidation-neutral (inventory is already valued at
    // sell price), so its prescore is small: a liquidity nudge when cash is
    // short, a positive bias late, and a tiny default so idle surpluses
    // still get flushed at the bottom of the priority order. Rollouts skip
    // idle sells entirely — they add engine calls but no terminal value.
    if (cheap && !lastRound && !cashStarved) continue;
    const prescore = lastRound ? 0.2 : cashStarved ? 0.3 : 0.05;
    const pkBuy = packagingToBuy;
    out.push({
      kind: "sell",
      describe: `sell ${units} ${r.name}`,
      prescore,
      apply: (s) => {
        let s2 = s;
        if (pkBuy > 0) s2 = buyResource(s2, p.id, "packaging", pkBuy);
        return sellResource(s2, p.id, r.id, units);
      },
    });
  }

  return out;
}

/** Claim/decline logic for pending free-card grants (shared by the real turn
 * and rollouts): pick the highest-value tag-matching type not already held. */
function grantChoice(state: GameState, p: PlayerState): string | null {
  const grant = state.pendingGrants.find((g) => g.playerId === p.id);
  if (!grant) return null;
  const atLimit =
    p.cards.filter((c) => !c.borrowedFrom).length >= tableauLimit(p);
  if (atLimit) return null;
  let bestType: string | null = null;
  let bestValue = -1;
  const ownedTypes = new Set(p.cards.map((c) => c.cardTypeId));
  for (const c of CARDS) {
    if (c.tag !== grant.tag) continue;
    if (!state.deck.includes(c.id)) continue;
    if (ownedTypes.has(c.id)) continue; // no duplicates (v10)
    const v = cardPerTurnValue(state, c.id, p) + c.cost / 10;
    if (v > bestValue) {
      bestValue = v;
      bestType = c.id;
    }
  }
  return bestType;
}

// ---------------------------------------------------------------------------
// search: base policy + rollout improvement

const EPS = GAME_CONFIG.ai.epsilon;

/** End-of-turn income the player would collect if they stopped now. */
function incomeIfEnded(state: GameState): number {
  return state.turn.activations === 0
    ? GAME_CONFIG.income.noActivationBonus
    : GAME_CONFIG.income.base;
}

/**
 * Static turn-completion estimate: the shaped value now, plus the margins of
 * the remaining greedy activation schedule (respecting combo limits and
 * current sequence usage), plus end-of-turn income. One evaluation, no
 * engine calls — the cheap stand-in for a real rollout.
 */
function staticTerminal(state: GameState, playerId: string): number {
  const remaining = estimateBoardProfit(state, playerId);
  const income = remaining > 0 ? GAME_CONFIG.income.base : incomeIfEnded(state);
  return (
    evaluatePosition(state, playerId).total +
    (remaining + income) / GAME_CONFIG.scoring.economicDivisor
  );
}

/**
 * Roll the BASE POLICY (prescore-greedy) from `state` to the end of the AI's
 * turn (without actually ending it) and return the terminal shaped value plus
 * the income the turn would collect. The world is held static: no opponent
 * moves, no market drift — an explicitly optimistic model.
 */
function rolloutValue(
  inputState: GameState,
  playerId: string,
  difficulty: AiDifficulty,
  depth: number,
): number {
  let state = inputState;
  for (let i = 0; i < depth; i++) {
    const p = active(state);
    if (p.id !== playerId || state.status !== "active") break;
    // Grants first — always claim the best available type.
    if (state.pendingGrants.some((g) => g.playerId === p.id)) {
      state = claimCardGrant(state, p.id, grantChoice(state, p));
      continue;
    }
    const candidates = enumerateCandidates(state, p, difficulty, true);
    let best: Candidate | null = null;
    for (const c of candidates) {
      if (c.prescore <= EPS) continue;
      if (!best || c.prescore > best.prescore) best = c;
    }
    if (!best) break;
    try {
      state = best.apply(state);
    } catch {
      break; // a stale candidate is a terminal, not a crash
    }
  }
  return (
    evaluatePosition(state, playerId).total +
    incomeIfEnded(state) / GAME_CONFIG.scoring.economicDivisor
  );
}

/** Format the motive deltas behind a decision, for logs and the UI. */
function motiveNote(d0: ValueBreakdown, d1: ValueBreakdown): string {
  const bits: string[] = [];
  const dv = d1.total - d0.total;
  bits.push(`ΔV ${dv >= 0 ? "+" : ""}${dv.toFixed(1)}`);
  const parts: [string, number][] = [
    ["R", d1.R - d0.R],
    ["engine", d1.engine - d0.engine],
    ["prestige", d1.prestige - d0.prestige],
    ["position", d1.position - d0.position],
  ];
  for (const [name, delta] of parts) {
    if (Math.abs(delta) >= 0.05) {
      bits.push(`${name} ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`);
    }
  }
  return bits.join(", ");
}

/** One AI decision step. Returns the new state and whether the turn ended. */
export function stepAiTurn(inputState: GameState): {
  state: GameState;
  done: boolean;
  description: string;
} {
  let state = inputState;
  const p = active(state);
  if (!p.isAi || state.status !== "active") {
    return { state, done: true, description: "not an AI turn" };
  }
  const difficulty = p.aiDifficulty ?? "normal";

  // 0) Claim any pending free-card grant (decline when the tableau is full).
  if (state.pendingGrants.some((g) => g.playerId === p.id)) {
    const choice = grantChoice(state, p);
    state = claimCardGrant(state, p.id, choice);
    return {
      state,
      done: false,
      description: choice ? `claimed free ${choice}` : "declined grant",
    };
  }

  const candidates = enumerateCandidates(state, p, difficulty);

  // ── easy: greedy on the analytic prescore (margins only), breadth 1 ──
  if (difficulty === "easy") {
    const ranked = candidates
      .filter((c) => c.prescore > EPS)
      .sort((a, b) => b.prescore - a.prescore);
    for (const c of ranked) {
      let roll: number;
      [state, roll] = drawRandom(state);
      if (roll < GAME_CONFIG.ai.easyMistakeChance) continue; // seeded slip
      state = c.apply(state);
      return { state, done: false, description: c.describe };
    }
    state = endTurn(state, p.id);
    return { state, done: true, description: "ended turn" };
  }

  // ── normal/hard: evaluate top candidates with Ṽ, roll the best out ──
  const choice = chooseAction(state, p, difficulty, candidates);
  if (!choice.best) {
    state = endTurn(state, p.id);
    return { state, done: true, description: "ended turn" };
  }
  return {
    state: choice.best.next,
    done: false,
    description: `${choice.best.c.describe} [${motiveNote(choice.v0, choice.best.v1)}]`,
  };
}

interface ScoredCandidate {
  c: Candidate;
  next: GameState;
  v1: ValueBreakdown;
  terminal: number;
}

/** The search core for normal/hard: evaluate the top candidates by prescore
 * with the full value function, roll the best of them out, and pick the best
 * terminal — or none, when ending the turn now is worth more. */
function chooseAction(
  state: GameState,
  p: PlayerState,
  difficulty: AiDifficulty,
  candidates: Candidate[],
): {
  v0: ValueBreakdown;
  endNowValue: number;
  scored: ScoredCandidate[];
  best: ScoredCandidate | null;
} {
  const evalK = GAME_CONFIG.ai.evalBreadth[difficulty] ?? 4;
  const rolloutK = GAME_CONFIG.ai.rolloutBreadth[difficulty] ?? 2;
  const depth = GAME_CONFIG.ai.rolloutDepth[difficulty] ?? 10;

  const v0 = evaluatePosition(state, p.id);
  const endNowValue =
    v0.total + incomeIfEnded(state) / GAME_CONFIG.scoring.economicDivisor;

  const top = candidates
    .sort((a, b) => b.prescore - a.prescore)
    .slice(0, evalK);

  const scored: ScoredCandidate[] = [];
  for (const c of top) {
    try {
      const next = c.apply(state);
      scored.push({
        c,
        next,
        v1: evaluatePosition(next, p.id),
        terminal: -Infinity,
      });
    } catch {
      // an unexpectedly illegal candidate is skipped, never fatal
    }
  }
  scored.sort((a, b) => b.v1.total - a.v1.total);

  // WHICH action: rank by one-step shaped value. (The static completion
  // estimate is NOT used to rank — its remaining-schedule term is nearly
  // common to all candidates and its noise would let bad actions win.)
  // On hard, real rollouts refine the ranking among the top candidates:
  // a faithful simulation of the rest of the turn beats a one-step look.
  let best: ScoredCandidate | null = scored.length > 0 ? scored[0] : null;
  if (rolloutK > 0 && scored.length > 1) {
    let bestRolled: ScoredCandidate | null = null;
    for (let i = 0; i < Math.min(rolloutK, scored.length); i++) {
      const s = scored[i];
      s.terminal = rolloutValue(s.next, p.id, difficulty, depth);
      if (!bestRolled || s.terminal > bestRolled.terminal) bestRolled = s;
    }
    if (bestRolled) best = bestRolled;
  }

  // ACT vs END: acting must beat ending the turn right now (which banks the
  // no-activation income bonus but forfeits the rest of the schedule). Here
  // the completion estimate is the honest comparison, applied to one side.
  if (best) {
    if (best.terminal === -Infinity) {
      best.terminal = staticTerminal(best.next, p.id);
    }
    if (best.terminal <= endNowValue + EPS) best = null;
  }
  return { v0, endNowValue, scored, best };
}

/** Legibility/debug: the AI's full scored decision at `state`, WITHOUT
 * executing anything. Includes every enumerated candidate's prescore and the
 * evaluated candidates' value breakdowns and terminals. */
export function explainAiDecision(state: GameState): {
  v0: ValueBreakdown;
  endNowValue: number;
  candidates: { describe: string; prescore: number }[];
  scored: {
    describe: string;
    prescore: number;
    v1: ValueBreakdown;
    terminal: number;
  }[];
  chosen: string | null;
} {
  const p = active(state);
  const difficulty = p.aiDifficulty ?? "normal";
  const candidates = enumerateCandidates(state, p, difficulty);
  const choice = chooseAction(state, p, difficulty, candidates);
  return {
    v0: choice.v0,
    endNowValue: choice.endNowValue,
    candidates: candidates
      .map((c) => ({ describe: c.describe, prescore: c.prescore }))
      .sort((a, b) => b.prescore - a.prescore),
    scored: choice.scored.map((s) => ({
      describe: s.c.describe,
      prescore: s.c.prescore,
      v1: s.v1,
      // Candidates the search didn't need a terminal for still get one here,
      // so the explanation is complete.
      terminal:
        s.terminal === -Infinity ? staticTerminal(s.next, p.id) : s.terminal,
    })),
    chosen: choice.best ? choice.best.c.describe : null,
  };
}

/** Run a full AI turn with loop guards. Always terminates. */
export function runAiTurn(inputState: GameState): AiTurnReport {
  let state = inputState;
  const playerId = state.players[state.activePlayerIndex].id;
  let actions = 0;
  let hitGuard = false;
  const steps: string[] = [];
  const max = GAME_CONFIG.ai.maxActionsPerTurn;
  for (;;) {
    if (actions >= max) {
      hitGuard = true;
      state = endTurn(state, playerId);
      break;
    }
    const step = stepAiTurn(state);
    state = step.state;
    actions += 1;
    steps.push(step.description);
    if (step.done) break;
  }
  return { state, actions, hitGuard, steps };
}

export { unitBuyPrice, unitSellPrice };
