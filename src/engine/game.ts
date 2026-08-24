// Core rules engine (v3). Every public function takes a GameState and returns
// a NEW GameState (clone-then-mutate); callers never see partial mutations,
// and any thrown EngineError leaves the original state untouched (atomicity).

import type {
  ActivationOption,
  CardInstance,
  GameModifiers,
  GameRecord,
  GameSettings,
  GameState,
  LogEntryType,
  MarketConfig,
  PlayerMetrics,
  PlayerState,
  PlayerStats,
  ResourceDefinition,
  ResourceId,
  ScoreBreakdown,
} from "./types";
import { EngineError } from "./types";
import { hashSeed, nextInt, shuffle } from "./rng";
import { RESOURCES, RESOURCE_MAP, getResource } from "./data/resources";
import { CARD_MAP, buildDeckList, getCard } from "./data/cards";
import { RECIPE_MAP, RECIPES, getRecipe } from "./data/recipes";
import { sequenceKey, SEQUENCES } from "./data/sequences";
import { GAME_CONFIG } from "./data/config";
import { calculateMarketQuote, unitSellPrice } from "./market";

export { calculateMarketQuote, sequenceKey };

// ---------------------------------------------------------------------------
// helpers

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function addLog(
  state: GameState,
  type: LogEntryType,
  playerId: string | null,
  message: string,
): void {
  state.logSeq += 1;
  if (state.quiet) return;
  state.log.push({
    seq: state.logSeq,
    round: state.round,
    playerId,
    type,
    message,
  });
  if (state.log.length > GAME_CONFIG.maxLogEntries) {
    state.log.splice(0, state.log.length - GAME_CONFIG.maxLogEntries);
  }
}

function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayerIndex];
}

function requireActive(state: GameState, playerId: string): PlayerState {
  if (state.status !== "active") {
    throw new EngineError("The game is over.");
  }
  const p = activePlayer(state);
  if (p.id !== playerId) {
    throw new EngineError(`It is not ${playerId}'s turn.`);
  }
  return p;
}

function emptyResources(): Record<ResourceId, number> {
  const out: Record<ResourceId, number> = {};
  for (const r of RESOURCES) out[r.id] = 0;
  return out;
}

export function defaultModifiers(): GameModifiers {
  return {
    knifeFight: false,
    randomResources: false,
    viscousMarkets: false,
    cyclicalEconomy: false,
  };
}

function emptyMetrics(): PlayerMetrics {
  return {
    produced: {},
    sold: {},
    bought: {},
    soldDollars: {},
    boughtDollars: {},
    activationsByRecipe: {},
    marketRoadsBuilt: 0,
    playerRoadsBuilt: 0,
    cardsBought: 0,
    cardsSold: 0,
    grantsClaimed: 0,
    grantsDeclined: 0,
    cardsBorrowed: 0,
    borrowFeesPaid: 0,
    prestigeEvents: 0,
    incomeCollected: 0,
    noActivationTurns: 0,
    turnsPlayed: 0,
  };
}

/** Sparse-record increment helper for metrics maps. */
function bump(rec: Record<string, number>, key: string, n: number): void {
  if (n === 0) return;
  rec[key] = (rec[key] ?? 0) + n;
}

function emptyStats(): PlayerStats {
  return {
    borrowFeesCollected: 0,
    borrowFeesSeq: 0,
    rebateDollars: 0,
    rebateDollarsSeq: 0,
    maxCombosInTurn: 0,
    maxCombosSeq: 0,
    totalActivations: 0,
    nonConsumingActivations: 0,
    nonConsumingSeq: 0,
    verticalFinished: 0,
    verticalSeq: 0,
  };
}

// ---- Player-class parameter accessors (v9) ----
const CP = GAME_CONFIG.classParams;

/** Tableau card limit for a player (Parasite/Liquidator are smaller). */
export function tableauLimit(p: PlayerState): number {
  return p.classId === "parasite" || p.classId === "liquidator"
    ? CP.smallTableauLimit
    : GAME_CONFIG.tableauCardLimit;
}
function borrowCostFor(p: PlayerState): number {
  return p.classId === "parasite"
    ? CP.parasiteBorrowCost
    : GAME_CONFIG.borrowCost;
}
function borrowsPerOwnerFor(p: PlayerState): number {
  return p.classId === "parasite"
    ? CP.parasiteBorrowsPerOwner
    : CP.defaultBorrowsPerOwner;
}
function cardRefundFor(p: PlayerState, cost: number): number {
  return p.classId === "liquidator"
    ? Math.ceil(cost * CP.liquidatorRefundPct)
    : Math.ceil(cost / 2);
}
function roadRebateFor(seller: PlayerState): number {
  return seller.classId === "trader"
    ? CP.traderRoadRebate
    : GAME_CONFIG.roadRebate;
}
function activationsPerFoodFor(p: PlayerState): number {
  return p.classId === "lineBoss"
    ? CP.lineBossActivationsPerFood
    : GAME_CONFIG.activationsPerFood;
}
/** Prestige actually awarded to a player (Trader earns half). */
function prestigeFor(p: PlayerState, amount: number): number {
  return p.classId === "trader" ? Math.floor(amount / 2) : amount;
}

/** A player's net worth: cash + inventory sell value + floor(card cost / 2). */
function playerNetWorth(state: GameState, p: PlayerState): number {
  const cardTotal = p.cards.reduce((s, c) => s + getCard(c.cardTypeId).cost, 0);
  return (
    p.cash +
    inventorySellValue(state, p) +
    Math.floor(cardTotal / GAME_CONFIG.scoring.cardValueDivisor)
  );
}

/** Count of a player's cards that occupy tableau slots. Borrowed cards and
 * cards staged in the Sequence Assembly area do NOT count (v8). `sequencer`
 * defaults to the active turn's staging list when this player is active. */
function tableauCount(state: GameState, p: PlayerState): number {
  const staged =
    activePlayer(state).id === p.id ? (state.turn.sequencer ?? []) : [];
  return p.cards.filter(
    (c) => !c.borrowedFrom && !staged.includes(c.instanceId),
  ).length;
}

/** Can this ordered list of staged card types still become a COMPLETE facility
 * that the player actually owns the cards to finish? The list must be a prefix
 * of some recipe's card sequence AND the player must own enough instances of
 * every card type that recipe needs. Single-card sequences must be
 * non-production (production cards activate inline on the tableau). */
function canCompleteFacility(p: PlayerState, cardTypes: string[]): boolean {
  const ownedByType = new Map<string, number>();
  for (const c of p.cards) {
    ownedByType.set(c.cardTypeId, (ownedByType.get(c.cardTypeId) ?? 0) + 1);
  }
  return RECIPES.some((r) => {
    const req = r.requiredCardTypes;
    if (req.length < cardTypes.length) return false;
    if (!cardTypes.every((t, i) => req[i] === t)) return false;
    if (req.length === 1 && getCard(req[0]).category === "production") {
      return false;
    }
    // The player must own enough cards of every type this facility needs.
    const need = new Map<string, number>();
    for (const t of req) need.set(t, (need.get(t) ?? 0) + 1);
    for (const [t, cnt] of need) {
      if ((ownedByType.get(t) ?? 0) < cnt) return false;
    }
    return true;
  });
}

/** Effective (post-modifier) elastic drift step for a resource this game. */
function effectiveDriftStep(
  state: GameState,
  r: ResourceDefinition,
  stock: number,
): number {
  const eq = state.marketConfig.equilibrium[r.id] ?? r.equilibrium;
  const dmax = state.marketConfig.driftMax[r.id] ?? r.driftMax;
  const diff = eq - stock;
  if (diff === 0) return 0;
  const magnitude = Math.min(Math.ceil(Math.abs(diff) / 2), dmax);
  return diff > 0 ? magnitude : -magnitude;
}

/** Once every resource has been produced (by anyone), schedule the game to end
 * after the following round. */
function checkAllProduced(state: GameState): void {
  if (state.allProducedRound !== null) return;
  for (const r of RESOURCES) {
    if ((state.producedTotals[r.id] ?? 0) <= 0) return;
  }
  state.allProducedRound = state.round;
  addLog(
    state,
    "game",
    null,
    `Every resource has now been produced — the game will end after round ${Math.min(
      state.maxRounds,
      state.round + 1,
    )}.`,
  );
}

/** The round at which the game ends (min of the round limit and one round
 * after every resource was first produced). */
function endRoundFor(state: GameState): number {
  return state.allProducedRound !== null
    ? Math.min(state.maxRounds, state.allProducedRound + 1)
    : state.maxRounds;
}

function resourceName(id: ResourceId): string {
  return getResource(id).name;
}

function fmtBundle(bundle: Partial<Record<ResourceId, number>>): string {
  const parts = Object.entries(bundle)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([id, n]) => `${n} ${resourceName(id)}`);
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

function newInstance(state: GameState, cardTypeId: string): CardInstance {
  return {
    instanceId: `c${state.nextInstanceId++}`,
    cardTypeId,
    usedSequences: [],
    ...(cardTypeId === "farm" ? { harvestOutput: 2 } : {}),
  };
}

function findInstance(p: PlayerState, instanceId: string): CardInstance {
  const inst = p.cards.find((c) => c.instanceId === instanceId);
  if (!inst) throw new EngineError(`Card instance ${instanceId} not found.`);
  return inst;
}

/** Combo rule: can this instance still take part in the given sequence? */
export function canUseInSequence(inst: CardInstance, seqKey: string): boolean {
  const maxUses = inst.borrowedFrom
    ? GAME_CONFIG.borrowedMaxUses
    : GAME_CONFIG.maxUsesPerTurn;
  return (
    !inst.usedSequences.includes(seqKey) && inst.usedSequences.length < maxUses
  );
}

function resetTurnFlags(state: GameState): void {
  state.turn = {
    activations: 0,
    boughtCard: false,
    boughtCards: 0,
    committed: {},
    sequencer: [],
    soldCard: false,
  };
}

/** Invariant check used after every mutation in dev/test. */
function assertInvariants(state: GameState): void {
  for (const p of state.players) {
    if (p.cash < 0)
      throw new EngineError(`Invariant: ${p.id} has negative cash`);
    for (const [rid, n] of Object.entries(p.resources)) {
      if (n < 0 || !Number.isInteger(n)) {
        throw new EngineError(`Invariant: ${p.id} has invalid ${rid} = ${n}`);
      }
    }
    for (const c of p.cards) {
      if (c.usedSequences.length > GAME_CONFIG.maxUsesPerTurn) {
        throw new EngineError(`Invariant: ${c.instanceId} exceeded combo uses`);
      }
    }
  }
  for (const r of RESOURCES) {
    const s = state.market[r.id];
    if (s < 0 || s > r.capacity || !Number.isInteger(s)) {
      throw new EngineError(`Invariant: market stock for ${r.id} = ${s}`);
    }
  }
  for (const [rid, queue] of Object.entries(state.rebates)) {
    if (!RESOURCE_MAP[rid])
      throw new EngineError(`Invariant: rebate for unknown ${rid}`);
    for (const e of queue) {
      if (e.units <= 0)
        throw new EngineError(`Invariant: empty rebate entry for ${rid}`);
    }
  }
}

// ---------------------------------------------------------------------------
// turn-clocked market maker

/** Freeze this round's elastic equilibrium adjustment as per-resource budgets. */
function initMarketMaker(state: GameState): void {
  const fresh: Record<string, number> = {};
  for (const r of RESOURCES) {
    const step = effectiveDriftStep(state, r, state.market[r.id]);
    if (step !== 0) fresh[r.id] = step;
  }
  // Cyclical economy: apply the PREVIOUS round's frozen drift this round, and
  // stash the current one for next round (a one-round lag).
  let budgets = fresh;
  if (state.marketConfig.cyclical) {
    budgets = state.marketConfig.laggedBudgets ?? {};
    state.marketConfig.laggedBudgets = fresh;
  }
  state.marketMaker = { budgets, applied: {}, turnIndex: 0 };
}

/**
 * Apply one turn's share of the frozen market-maker budget (Bresenham split
 * across the round's player turns), then enforce the no-full/no-empty rule.
 * Boundary fixes consume the budget when they point the same way; otherwise
 * they are free corrections, never double counted.
 */
function applyMarketMakerTick(state: GameState): void {
  const N = state.players.length;
  const mm = state.marketMaker;
  const t = Math.min(mm.turnIndex + 1, N);
  const moves: string[] = [];
  for (const r of RESOURCES) {
    const budget = mm.budgets[r.id] ?? 0;
    const done = mm.applied[r.id] ?? 0;
    const target =
      budget >= 0 ? Math.floor((budget * t) / N) : Math.ceil((budget * t) / N);
    let step = target - done;
    const stock = state.market[r.id];
    step = Math.max(-stock, Math.min(r.capacity - stock, step));
    let next = stock + step;
    // No market may START a player's turn completely full or empty.
    let extra = 0;
    if (next <= 0) extra = 1;
    else if (next >= r.capacity) extra = -1;
    next += extra;
    state.market[r.id] = next;
    const remaining = budget - done - step;
    const countsExtra =
      extra !== 0 &&
      remaining !== 0 &&
      Math.sign(extra) === Math.sign(remaining);
    mm.applied[r.id] = done + step + (countsExtra ? extra : 0);
    const delta = next - stock;
    if (delta !== 0) moves.push(`${r.name} ${delta > 0 ? "+" : ""}${delta}`);
  }
  mm.turnIndex = t;
  if (moves.length > 0) {
    addLog(
      state,
      "restock",
      null,
      `Market maker adjusts: ${moves.join(", ")}.`,
    );
  }
}

/** Equilibrist bonus (v9): apply the NEXT player's upcoming market-maker tick
 * to the stock now, WITHOUT advancing the budget accounting — so the next
 * player still receives that same tick normally on their turn. */
function applyEquilibristBonusTick(state: GameState): void {
  const N = state.players.length;
  const mm = state.marketMaker;
  const t = Math.min(mm.turnIndex + 1, N);
  const moves: string[] = [];
  for (const r of RESOURCES) {
    const budget = mm.budgets[r.id] ?? 0;
    const applied = mm.applied[r.id] ?? 0;
    const target =
      budget >= 0 ? Math.floor((budget * t) / N) : Math.ceil((budget * t) / N);
    let step = target - applied;
    const stock = state.market[r.id];
    step = Math.max(-stock, Math.min(r.capacity - stock, step));
    let next = stock + step;
    if (next <= 0) next = Math.min(r.capacity, 1);
    else if (next >= r.capacity) next = Math.max(0, r.capacity - 1);
    if (next !== stock)
      moves.push(`${r.name} ${next - stock > 0 ? "+" : ""}${next - stock}`);
    state.market[r.id] = next;
  }
  if (moves.length > 0) {
    addLog(
      state,
      "restock",
      null,
      `Equilibrist preview tick: ${moves.join(", ")}.`,
    );
  }
}

/** Remaining (unapplied) market-maker budget for a resource — for the UI. */
export function marketMakerRemaining(
  state: GameState,
  resourceId: string,
): number {
  return (
    (state.marketMaker.budgets[resourceId] ?? 0) -
    (state.marketMaker.applied[resourceId] ?? 0)
  );
}

// ---------------------------------------------------------------------------
// game creation

export function createGame(settings: GameSettings): GameState {
  const { seed, players } = settings;
  const maxRounds = settings.maxRounds ?? GAME_CONFIG.defaultRounds;
  if (
    players.length < GAME_CONFIG.minPlayers ||
    players.length > GAME_CONFIG.maxPlayers
  ) {
    throw new EngineError(
      `Player count must be ${GAME_CONFIG.minPlayers}-${GAME_CONFIG.maxPlayers}.`,
    );
  }

  let rng = hashSeed(seed);

  let seatOrder: number[];
  [rng, seatOrder] = shuffle(
    rng,
    players.map((_, i) => i),
  );
  // A Hipster may not take the first seat: swap seat 0 with the earliest
  // non-Hipster seat if needed (unless everyone is a Hipster).
  if (players[seatOrder[0]]?.classId === "hipster") {
    const swap = seatOrder.findIndex(
      (idx) => players[idx]?.classId !== "hipster",
    );
    if (swap > 0) {
      [seatOrder[0], seatOrder[swap]] = [seatOrder[swap], seatOrder[0]];
    }
  }

  const modifiers: GameModifiers = {
    ...defaultModifiers(),
    ...(settings.modifiers ?? {}),
  };

  let deck: string[];
  [rng, deck] = shuffle(rng, buildDeckList());

  // Knife fight: remove one deck copy of each named component (before the
  // marketplace is dealt).
  if (modifiers.knifeFight) {
    for (const id of GAME_CONFIG.knifeFightReductions) {
      const idx = deck.indexOf(id);
      if (idx !== -1) deck.splice(idx, 1);
    }
  }

  const slots = GAME_CONFIG.marketplaceSlots;
  // Fill without duplicates when possible (scan the deck in order).
  const cardMarket: (string | null)[] = [];
  for (let i = 0; i < slots; i++) {
    let idx = deck.findIndex((c) => !cardMarket.includes(c));
    if (idx === -1) idx = 0; // only duplicates remain
    const drawn = deck.splice(idx, 1)[0];
    cardMarket.push(drawn ?? null);
  }
  const isProduction = (id: string | null) =>
    id !== null && CARD_MAP[id].category === "production";
  let productionCount = cardMarket.filter(isProduction).length;
  if (productionCount < GAME_CONFIG.minInitialProductionCards) {
    // Prefer production cards that would not duplicate a face-up card.
    for (const preferUnique of [true, false]) {
      for (
        let deckIdx = 0;
        deckIdx < deck.length &&
        productionCount < GAME_CONFIG.minInitialProductionCards;
        deckIdx++
      ) {
        if (!isProduction(deck[deckIdx])) continue;
        if (preferUnique && cardMarket.includes(deck[deckIdx])) continue;
        for (let slot = cardMarket.length - 1; slot >= 0; slot--) {
          if (!isProduction(cardMarket[slot])) {
            const tmp = cardMarket[slot] as string;
            cardMarket[slot] = deck[deckIdx];
            deck[deckIdx] = tmp;
            productionCount++;
            break;
          }
        }
      }
      if (productionCount >= GAME_CONFIG.minInitialProductionCards) break;
    }
  }

  const market: Record<ResourceId, number> = {};
  for (const r of RESOURCES) market[r.id] = r.initialStock;

  // Per-game market parameters (random-resources / viscous-markets modifiers).
  const equilibrium: Record<string, number> = {};
  const driftMax: Record<string, number> = {};
  for (const r of RESOURCES) {
    let eq = r.equilibrium;
    if (modifiers.randomResources) {
      const span = GAME_CONFIG.randomResourceMaxShift;
      let roll: number;
      [rng, roll] = nextInt(rng, span * 2 + 1); // 0..2*span
      eq = Math.max(0, Math.min(r.capacity, r.equilibrium + (roll - span)));
    }
    equilibrium[r.id] = eq;
    driftMax[r.id] = modifiers.viscousMarkets ? 1 : r.driftMax;
  }
  const marketConfig: MarketConfig = {
    equilibrium,
    driftMax,
    cyclical: modifiers.cyclicalEconomy,
  };

  const state: GameState = {
    version: GAME_CONFIG.stateVersion,
    seed,
    rngState: rng,
    round: 1,
    maxRounds,
    activePlayerIndex: 0,
    players: [],
    market,
    rebates: {},
    marketMaker: { budgets: {}, applied: {}, turnIndex: 0 },
    prestigeClaimed: {},
    pendingGrants: [],
    cardMarket,
    deck,
    turn: {
      activations: 0,
      boughtCard: false,
      boughtCards: 0,
      committed: {},
      sequencer: [],
      soldCard: false,
    },
    log: [],
    logSeq: 0,
    producedTotals: {},
    modifiers,
    marketConfig,
    allProducedRound: null,
    statSeq: 0,
    status: "active",
    nextInstanceId: 1,
    aiClassAffinity:
      settings.aiClassAffinity ?? GAME_CONFIG.ai.classAffinityDefault,
  };

  state.players = seatOrder.map((setupIndex, seat) => {
    const setup = players[setupIndex];
    const classId = setup.classId ?? "none";
    const resources = emptyResources();
    for (const [rid, n] of Object.entries(GAME_CONFIG.startingResources)) {
      resources[rid] = n;
    }
    // Class starting adjustments.
    if (classId === "regenerist") {
      resources.asphalt = (resources.asphalt ?? 0) + CP.regeneristExtraAsphalt;
    } else if (classId === "trader") {
      resources.asphalt = CP.traderStartAsphalt;
    }
    const starterIds = [...GAME_CONFIG.starterCards];
    if (classId === "regenerist") starterIds.push(...CP.regeneristStartCards);
    return {
      id: `p${seat + 1}`,
      name: setup.name || `Player ${seat + 1}`,
      isAi: setup.isAi,
      aiDifficulty: setup.isAi ? (setup.aiDifficulty ?? "normal") : undefined,
      cash: GAME_CONFIG.startingCash[seat],
      prestige: 0,
      resources,
      cards: starterIds.map((id) => newInstance(state, id)),
      marketRoads: [],
      playerRoads: [],
      stats: emptyStats(),
      metrics: emptyMetrics(),
      everPurchased: {},
      classId,
      netWorthMark: 0,
      netWorthDelta: 0,
      usedSequenceKeysEver: [],
      saleCarry: {},
      machineryActs: 0,
      borrowedFromCount: {},
    };
  });

  // Parasite starts with roads to every other player.
  for (const p of state.players) {
    if (p.classId === "parasite") {
      p.playerRoads = state.players
        .filter((other) => other.id !== p.id)
        .map((other) => other.id);
    }
  }
  // Initialize each player's net-worth mark to their opening net worth.
  for (const p of state.players) p.netWorthMark = playerNetWorth(state, p);

  const activeMods = (
    [
      ["knifeFight", "Knife fight"],
      ["randomResources", "Random resources"],
      ["viscousMarkets", "Viscous markets"],
      ["cyclicalEconomy", "Cyclical economy"],
    ] as const
  )
    .filter(([k]) => modifiers[k])
    .map(([, label]) => label);
  addLog(
    state,
    "game",
    null,
    `Game started (seed ${seed}, ${state.players.length} players, ${maxRounds} rounds${
      activeMods.length ? `, modifiers: ${activeMods.join(", ")}` : ""
    }). Turn order: ${state.players.map((p) => p.name).join(" → ")}.`,
  );
  initMarketMaker(state);
  applyMarketMakerTick(state); // player 1's share arrives before they act
  if (state.players[0].classId === "equilibrist") {
    applyEquilibristBonusTick(state);
  }
  addLog(
    state,
    "turn",
    state.players[0].id,
    `Round 1 — ${state.players[0].name}'s turn.`,
  );
  return state;
}

// ---------------------------------------------------------------------------
// turn flow

/** Reset the given player's cards and turn flags. */
export function startTurn(input: GameState): GameState {
  const state = clone(input);
  const p = activePlayer(state);
  for (const c of p.cards) c.usedSequences = [];
  resetTurnFlags(state);
  return state;
}

/** Draw the first deck card that would not duplicate a face-up card;
 * duplicates are allowed only when the whole deck would duplicate.
 *
 * `exclude` names a card (the one that was just cycled out) which must not
 * replace itself unless there is no other non-duplicate replacement in the
 * deck. */
function drawNonDuplicate(
  state: GameState,
  exclude: string | null = null,
): string | null {
  if (state.deck.length === 0) return null;
  // Best: a card that neither duplicates the face-up market nor is the
  // just-cycled card replacing itself.
  let idx = state.deck.findIndex(
    (c) => !state.cardMarket.includes(c) && c !== exclude,
  );
  // Next: any non-duplicate card (permits the excluded card only because no
  // other non-duplicate replacement exists).
  if (idx === -1)
    idx = state.deck.findIndex((c) => !state.cardMarket.includes(c));
  // Last resort: the whole deck would duplicate the market — take the top.
  if (idx === -1) idx = 0;
  return state.deck.splice(idx, 1)[0];
}

/** End-of-turn marketplace cycle (v9): at least 2 cards leave the shop each
 * turn. Cards bought this turn already count toward that, so the cycle tops up
 * the difference by returning the oldest (bottom-right) cards to the deck. */
function cycleMarketplace(state: GameState): void {
  const MIN_CYCLE = 2;
  let toCycle = Math.max(0, MIN_CYCLE - state.turn.boughtCards);
  const returned: string[] = [];
  const arrived: string[] = [];
  while (toCycle > 0) {
    const lastIdx = state.cardMarket.length - 1;
    const last = state.cardMarket[lastIdx];
    if (last === null && state.deck.length === 0) break; // nothing to cycle
    state.cardMarket.splice(lastIdx, 1);
    if (last !== null) {
      state.deck.push(last);
      returned.push(getCard(last).name);
    }
    // A cycled card can't immediately replace itself unless it is the only
    // non-duplicate replacement available (v5).
    const drawn = drawNonDuplicate(state, last);
    state.cardMarket.unshift(drawn);
    if (drawn !== null) arrived.push(getCard(drawn).name);
    toCycle -= 1;
  }
  if (returned.length > 0 || arrived.length > 0) {
    addLog(
      state,
      "restock",
      null,
      `Marketplace cycles${returned.length ? `: ${returned.join(", ")} return${returned.length === 1 ? "s" : ""} to the deck` : ""}${arrived.length ? `${returned.length ? ", " : ": "}${arrived.join(", ")} arrive${arrived.length === 1 ? "s" : ""}` : ""}.`,
    );
  }
}

interface RecordDef {
  key: string;
  label: string;
  description: string;
  kind: "max" | "min";
  get: (p: PlayerState) => number;
  seq?: (p: PlayerState) => number;
  /** Minimum value to qualify (max-trackers). */
  min?: number;
  /** Maximum value to qualify (min-trackers). */
  max?: number;
}

const RECORD_DEFS: RecordDef[] = [
  {
    key: "landlord",
    label: "The Landlord",
    description: "Most borrow fees collected",
    kind: "max",
    get: (p) => p.stats.borrowFeesCollected,
    seq: (p) => p.stats.borrowFeesSeq,
    min: 6,
  },
  {
    key: "roadBaron",
    label: "The Road Baron",
    description: "Most rebate dollars earned",
    kind: "max",
    get: (p) => p.stats.rebateDollars,
    seq: (p) => p.stats.rebateDollarsSeq,
    min: 10,
  },
  {
    key: "combo",
    label: "The Combo",
    description: "Most facilities activated in a single turn",
    kind: "max",
    get: (p) => p.stats.maxCombosInTurn,
    seq: (p) => p.stats.maxCombosSeq,
    min: 8,
  },
  {
    key: "stillness",
    label: "Stillness",
    description: "Fewest activations all game",
    kind: "min",
    get: (p) => p.stats.totalActivations,
    max: 30,
  },
  {
    key: "rancher",
    label: "The Rancher",
    description: "Most non-consuming activations",
    kind: "max",
    get: (p) => p.stats.nonConsumingActivations,
    seq: (p) => p.stats.nonConsumingSeq,
    min: 8,
  },
  {
    key: "vertical",
    label: "Vertical Integration",
    description: "Most finished goods from only self-produced inputs",
    kind: "max",
    get: (p) => p.stats.verticalFinished,
    seq: (p) => p.stats.verticalSeq,
    min: 3,
  },
];

/** Current record standings (v7) — pure; does NOT award prestige. Ties go to
 * whoever reached the record first (earliest stamped seq; earliest seat for
 * min-trackers). Used by the in-game trackers panel and by awardRecords. */
export function computeRecords(state: GameState): GameRecord[] {
  const records: GameRecord[] = [];
  for (const d of RECORD_DEFS) {
    let winner: PlayerState | null = null;
    let winSeq = Infinity;
    for (const p of state.players) {
      const v = d.get(p);
      if (d.kind === "max") {
        if (d.min !== undefined && v < d.min) continue;
        const seq = d.seq ? d.seq(p) : 0;
        if (
          !winner ||
          v > d.get(winner) ||
          (v === d.get(winner) && seq < winSeq)
        ) {
          winner = p;
          winSeq = seq;
        }
      } else {
        if (d.max !== undefined && v > d.max) continue;
        // Fewest wins; earlier seat breaks ties (players are in seat order).
        if (!winner || v < d.get(winner)) winner = p;
      }
    }
    records.push({
      key: d.key,
      label: d.label,
      description: d.description,
      winnerId: winner?.id ?? null,
      value: winner ? d.get(winner) : 0,
      prestige: GAME_CONFIG.recordPrestige,
    });
  }
  return records;
}

/** Threshold metadata for the trackers panel (min to qualify / max allowed). */
export function recordThresholds(): {
  key: string;
  label: string;
  description: string;
  min?: number;
  max?: number;
}[] {
  return RECORD_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    min: d.min,
    max: d.max,
  }));
}

export interface RecordStanding {
  key: string;
  label: string;
  description: string;
  kind: "max" | "min";
  min?: number;
  max?: number;
  holderId: string | null;
  players: { id: string; name: string; value: number; qualifies: boolean }[];
}

/** Full per-player standings for every record (v8) — for the trackers panel,
 * so each player can see their own count, not just the current leader. */
export function recordStandings(state: GameState): RecordStanding[] {
  const winners = computeRecords(state);
  return RECORD_DEFS.map((d) => {
    const rec = winners.find((r) => r.key === d.key)!;
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      kind: d.kind,
      min: d.min,
      max: d.max,
      holderId: rec.winnerId,
      players: state.players.map((p) => {
        const value = d.get(p);
        const qualifies =
          d.kind === "max"
            ? d.min === undefined || value >= d.min
            : d.max === undefined || value <= d.max;
        return { id: p.id, name: p.name, value, qualifies };
      }),
    };
  });
}

/** Award the end-of-game record prestige (v7). */
function awardRecords(state: GameState): GameRecord[] {
  const records = computeRecords(state);
  for (const rec of records) {
    if (!rec.winnerId) continue;
    const winner = state.players.find((p) => p.id === rec.winnerId);
    if (!winner) continue;
    const awarded = prestigeFor(winner, GAME_CONFIG.recordPrestige);
    winner.prestige += awarded;
    addLog(
      state,
      "prestige",
      winner.id,
      `${winner.name} earns the "${rec.label}" record (${rec.description.toLowerCase()}: ${rec.value}) — +${awarded} prestige${winner.classId === "trader" ? " (Trader, halved)" : ""}.`,
    );
  }
  return records;
}

/** End the game: award record prestige and freeze the final state. */
function finishGame(state: GameState): void {
  state.status = "finished";
  state.records = awardRecords(state);
  addLog(state, "game", null, `Game over after round ${state.round}.`);
  assertInvariants(state);
}

export function endTurn(input: GameState, playerId: string): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);

  // The Combo record: most activations in a single turn.
  if (state.turn.activations > p.stats.maxCombosInTurn) {
    p.stats.maxCombosInTurn = state.turn.activations;
    p.stats.maxCombosSeq = ++state.statSeq;
  }

  // Borrowed cards disappear at the end of the borrower's turn.
  const returned = p.cards.filter((c) => c.borrowedFrom);
  if (returned.length > 0) {
    p.cards = p.cards.filter((c) => !c.borrowedFrom);
    addLog(
      state,
      "borrow",
      p.id,
      `${p.name} returns ${returned.length} borrowed card${returned.length === 1 ? "" : "s"}.`,
    );
  }

  const income =
    state.turn.activations === 0
      ? GAME_CONFIG.income.noActivationBonus
      : GAME_CONFIG.income.base;
  p.cash += income;
  p.metrics.incomeCollected += income;
  if (state.turn.activations === 0) p.metrics.noActivationTurns += 1;
  p.metrics.turnsPlayed += 1;
  addLog(
    state,
    "income",
    p.id,
    `${p.name} collects $${income} income${state.turn.activations === 0 ? " (doubled: no activations this turn)" : ""}.`,
  );

  // Record how much the ending player's net worth moved over their turn (v9).
  p.netWorthDelta = playerNetWorth(state, p) - p.netWorthMark;

  cycleMarketplace(state);

  const lastSeat = state.players.length - 1;
  if (state.activePlayerIndex < lastSeat) {
    state.activePlayerIndex += 1;
  } else {
    if (state.round >= endRoundFor(state)) {
      finishGame(state);
      return state;
    }
    state.round += 1;
    state.activePlayerIndex = 0;
    addLog(state, "round", null, `Round ${state.round} begins.`);
    // New round: freeze a fresh market-maker budget from current stocks.
    initMarketMaker(state);
  }

  // The incoming player's market-maker share arrives before they act.
  applyMarketMakerTick(state);
  // Equilibrist also receives the NEXT player's upcoming tick as a preview
  // (which the next player still gets normally on their turn).
  if (activePlayer(state).classId === "equilibrist") {
    applyEquilibristBonusTick(state);
  }

  const next = activePlayer(state);
  for (const c of next.cards) c.usedSequences = [];
  next.borrowedFromCount = {};
  next.netWorthMark = playerNetWorth(state, next);
  resetTurnFlags(state);
  addLog(state, "turn", next.id, `Round ${state.round} — ${next.name}'s turn.`);
  assertInvariants(state);
  return state;
}

// ---------------------------------------------------------------------------
// market roads & rebates

/** Build a road to a resource market (1 asphalt). Enables spread rebates. */
export function buildMarketRoad(
  input: GameState,
  playerId: string,
  resourceId: ResourceId,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  getResource(resourceId);
  if (p.marketRoads.includes(resourceId)) {
    throw new EngineError(
      `You already have a road to the ${resourceName(resourceId)} market.`,
    );
  }
  if ((p.resources.asphalt ?? 0) < GAME_CONFIG.roadCost) {
    throw new EngineError(
      `Building a market road costs ${GAME_CONFIG.roadCost} asphalt.`,
    );
  }
  p.resources.asphalt -= GAME_CONFIG.roadCost;
  p.marketRoads.push(resourceId);
  p.metrics.marketRoadsBuilt += 1;
  addLog(
    state,
    "road",
    p.id,
    `${p.name} built a road to the ${resourceName(resourceId)} market (1 asphalt) — future sales there earn spread rebates.`,
  );
  assertInvariants(state);
  return state;
}

/** Credit pending rebates for `units` purchased by `buyerId` (FIFO,
 * skipping the buyer's own entries). */
function creditRebates(
  state: GameState,
  resourceId: ResourceId,
  buyerId: string,
  units: number,
): void {
  const queue = state.rebates[resourceId];
  if (!queue || queue.length === 0) return;
  const credited = new Map<string, number>();
  let remaining = units;
  while (remaining > 0) {
    const entry = queue.find((e) => e.playerId !== buyerId && e.units > 0);
    if (!entry) break;
    entry.units -= 1;
    remaining -= 1;
    credited.set(entry.playerId, (credited.get(entry.playerId) ?? 0) + 1);
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].units <= 0) queue.splice(i, 1);
  }
  if (queue.length === 0) delete state.rebates[resourceId];
  for (const [pid, n] of credited) {
    const seller = state.players.find((pl) => pl.id === pid);
    if (!seller) continue;
    const amount = n * roadRebateFor(seller);
    seller.cash += amount;
    seller.stats.rebateDollars += amount; // Road Baron (v7)
    seller.stats.rebateDollarsSeq = ++state.statSeq;
    addLog(
      state,
      "rebate",
      pid,
      `${seller.name} receives a $${amount} spread rebate (${n} ${resourceName(resourceId)} bought via their market road).`,
    );
  }
}

// ---------------------------------------------------------------------------
// market actions

export function buyResource(
  input: GameState,
  playerId: string,
  resourceId: ResourceId,
  quantity: number,
): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new EngineError("Quantity must be a positive integer.");
  }
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (p.classId === "regenerist") {
    throw new EngineError(
      "The Regenerist cannot buy resources — everything must be produced.",
    );
  }
  const stock = state.market[resourceId];
  const quote = calculateMarketQuote(resourceId, "buy", quantity, stock);
  if (quote.units < quantity) {
    throw new EngineError(
      `Only ${quote.units} ${resourceName(resourceId)} available to buy.`,
    );
  }
  if (p.cash < quote.total) {
    throw new EngineError(
      `Not enough cash: need ${quote.total}, have ${p.cash}.`,
    );
  }
  p.cash -= quote.total;
  p.resources[resourceId] = (p.resources[resourceId] ?? 0) + quantity;
  p.everPurchased[resourceId] = true; // taints Vertical Integration (v7)
  bump(p.metrics.bought, resourceId, quantity);
  bump(p.metrics.boughtDollars, resourceId, quote.total);
  state.market[resourceId] = stock - quantity;
  addLog(
    state,
    "buyResource",
    p.id,
    `${p.name} bought ${quantity} ${resourceName(resourceId)} for $${quote.total}.`,
  );
  // Purchases trigger spread rebates for road-connected earlier sellers.
  creditRebates(state, resourceId, p.id, quantity);
  assertInvariants(state);
  return state;
}

export function sellResource(
  input: GameState,
  playerId: string,
  resourceId: ResourceId,
  quantity: number,
): GameState {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new EngineError("Quantity must be a positive integer.");
  }
  const state = clone(input);
  const p = requireActive(state, playerId);
  if ((p.resources[resourceId] ?? 0) < quantity) {
    throw new EngineError(
      `Not enough ${resourceName(resourceId)} in the warehouse (have ${p.resources[resourceId] ?? 0}).`,
    );
  }
  const needsPackaging = GAME_CONFIG.packagedGoods.includes(resourceId);
  if (needsPackaging && (p.resources.packaging ?? 0) < quantity) {
    throw new EngineError(
      `Selling ${resourceName(resourceId)} costs 1 packaging per unit (have ${p.resources.packaging ?? 0}, need ${quantity}).`,
    );
  }
  const stock = state.market[resourceId];
  const def = getResource(resourceId);
  let revenue: number;
  let stockMove: number;
  if (p.classId === "landBaron") {
    // Land Baron: the ladder only moves once per 2 units sold, so the price
    // holds up on bulk sales. A per-resource carry tracks the odd unit.
    let carry = p.saleCarry[resourceId] ?? 0;
    let effStock = stock;
    revenue = 0;
    stockMove = 0;
    let sold = 0;
    for (let i = 0; i < quantity; i++) {
      const price = unitSellPrice(resourceId, effStock);
      if (price === null) break; // market full at this effective stock
      revenue += price;
      sold += 1;
      carry += 1;
      if (carry >= 2) {
        carry = 0;
        if (effStock < def.capacity) {
          effStock += 1;
          stockMove += 1;
        }
      }
    }
    if (sold < quantity) {
      throw new EngineError(
        `Market can only absorb ${sold} ${resourceName(resourceId)}.`,
      );
    }
    p.saleCarry[resourceId] = carry;
  } else {
    const quote = calculateMarketQuote(resourceId, "sell", quantity, stock);
    if (quote.units < quantity) {
      throw new EngineError(
        `Market can only absorb ${quote.units} ${resourceName(resourceId)}.`,
      );
    }
    revenue = quote.total;
    stockMove = quantity;
  }
  p.cash += revenue;
  p.resources[resourceId] -= quantity;
  if (needsPackaging) p.resources.packaging -= quantity;
  bump(p.metrics.sold, resourceId, quantity);
  bump(p.metrics.soldDollars, resourceId, revenue);
  state.market[resourceId] = Math.min(def.capacity, stock + stockMove);
  const hasRoad = p.marketRoads.includes(resourceId);
  if (hasRoad) {
    const queue = state.rebates[resourceId] ?? (state.rebates[resourceId] = []);
    const last = queue[queue.length - 1];
    if (last && last.playerId === p.id) last.units += quantity;
    else queue.push({ playerId: p.id, units: quantity });
  }
  addLog(
    state,
    "sellResource",
    p.id,
    `${p.name} sold ${quantity} ${resourceName(resourceId)} for $${revenue}${needsPackaging ? ` (used ${quantity} packaging)` : ""}${hasRoad ? ` — ${quantity} spread rebate${quantity === 1 ? "" : "s"} pending via market road` : ""}.`,
  );
  assertInvariants(state);
  return state;
}

// ---------------------------------------------------------------------------
// card acquisition

export function buyCard(
  input: GameState,
  playerId: string,
  slotIndex: number,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (slotIndex < 0 || slotIndex >= state.cardMarket.length) {
    throw new EngineError("Invalid marketplace slot.");
  }
  const cardTypeId = state.cardMarket[slotIndex];
  if (cardTypeId === null) {
    throw new EngineError("That marketplace slot is empty.");
  }
  const def = getCard(cardTypeId);
  if (tableauCount(state, p) >= tableauLimit(p)) {
    throw new EngineError(
      `Your tableau is full (max ${tableauLimit(p)} cards). Sell a card first.`,
    );
  }
  if (p.cash < def.cost) {
    throw new EngineError(`Not enough cash for ${def.name} ($${def.cost}).`);
  }
  p.cash -= def.cost;
  p.cards.push(newInstance(state, cardTypeId));
  state.cardMarket.splice(slotIndex, 1);
  state.cardMarket.unshift(drawNonDuplicate(state));
  state.turn.boughtCard = true;
  state.turn.boughtCards += 1;
  p.metrics.cardsBought += 1;
  addLog(
    state,
    "buyCard",
    p.id,
    `${p.name} bought ${def.name} for $${def.cost}.`,
  );
  assertInvariants(state);
  return state;
}

/** Claim a pending free-card grant (earned by producing machinery/vehicles).
 * Pass null to decline the grant. */
export function claimCardGrant(
  input: GameState,
  playerId: string,
  cardTypeId: string | null,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const idx = state.pendingGrants.findIndex((g) => g.playerId === playerId);
  if (idx === -1) {
    throw new EngineError("No pending card grant to claim.");
  }
  const grant = state.pendingGrants[idx];
  if (cardTypeId === null) {
    state.pendingGrants.splice(idx, 1);
    p.metrics.grantsDeclined += 1;
    addLog(
      state,
      "grant",
      p.id,
      `${p.name} declined a free ${grant.tag} card.`,
    );
    return state;
  }
  const def = getCard(cardTypeId);
  if (def.tag !== grant.tag) {
    throw new EngineError(
      `This grant is for a ${grant.tag}-tagged card; ${def.name} is ${def.tag ?? "untagged"}.`,
    );
  }
  if (tableauCount(state, p) >= tableauLimit(p)) {
    throw new EngineError(
      `Your tableau is full (max ${tableauLimit(p)} cards); sell a card before claiming this grant.`,
    );
  }
  const deckIdx = state.deck.indexOf(cardTypeId);
  if (deckIdx === -1) {
    throw new EngineError(`No ${def.name} remains in the deck.`);
  }
  state.deck.splice(deckIdx, 1);
  state.pendingGrants.splice(idx, 1);
  p.cards.push(newInstance(state, cardTypeId));
  p.metrics.grantsClaimed += 1;
  addLog(
    state,
    "grant",
    p.id,
    `${p.name} claims a free ${def.name} from the deck (production grant).`,
  );
  assertInvariants(state);
  return state;
}

/** Sell an owned card back into the deck for half its printed cost
 * (rounded up). Starter and borrowed cards cannot be sold. */
export function sellCard(
  input: GameState,
  playerId: string,
  instanceId: string,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const inst = findInstance(p, instanceId);
  if (inst.borrowedFrom) {
    throw new EngineError("Borrowed cards cannot be sold.");
  }
  if (GAME_CONFIG.starterCards.includes(inst.cardTypeId)) {
    throw new EngineError("Starter cards cannot be sold back to the deck.");
  }
  const def = getCard(inst.cardTypeId);
  const refund = cardRefundFor(p, def.cost);
  p.cards = p.cards.filter((c) => c.instanceId !== instanceId);
  // A staged card that is sold also leaves the Sequence Assembly area.
  state.turn.sequencer = state.turn.sequencer.filter((id) => id !== instanceId);
  if (activePlayer(state).id === p.id) state.turn.soldCard = true;
  state.deck.push(inst.cardTypeId); // bottom of the deck
  p.cash += refund;
  p.metrics.cardsSold += 1;
  addLog(
    state,
    "sellCard",
    p.id,
    `${p.name} sold ${def.name} back to the deck for $${refund}.`,
  );
  assertInvariants(state);
  return state;
}

/** Build a road to another player (1 asphalt). Enables borrowing. */
export function buildPlayerRoad(
  input: GameState,
  playerId: string,
  targetPlayerId: string,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (targetPlayerId === playerId) {
    throw new EngineError("You cannot build a road to yourself.");
  }
  const target = state.players.find((pl) => pl.id === targetPlayerId);
  if (!target) throw new EngineError("Unknown player.");
  if (p.playerRoads.includes(targetPlayerId)) {
    throw new EngineError(`You already have a road to ${target.name}.`);
  }
  if ((p.resources.asphalt ?? 0) < GAME_CONFIG.roadCost) {
    throw new EngineError(
      `Building a road costs ${GAME_CONFIG.roadCost} asphalt.`,
    );
  }
  p.resources.asphalt -= GAME_CONFIG.roadCost;
  p.playerRoads.push(targetPlayerId);
  p.metrics.playerRoadsBuilt += 1;
  addLog(
    state,
    "road",
    p.id,
    `${p.name} built a road to ${target.name} (1 asphalt) — their cards can now be borrowed.`,
  );
  assertInvariants(state);
  return state;
}

/** Borrow another player's card for one turn: pay $2 to its owner; a copy
 * appears on your tableau with a single-activation limit and vanishes when
 * your turn ends. Requires a road to that player. */
export function borrowCard(
  input: GameState,
  playerId: string,
  ownerId: string,
  ownerInstanceId: string,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (ownerId === playerId) {
    throw new EngineError("You cannot borrow your own card.");
  }
  const owner = state.players.find((pl) => pl.id === ownerId);
  if (!owner) throw new EngineError("Unknown player.");
  if (!p.playerRoads.includes(ownerId)) {
    throw new EngineError(
      `You need a road to ${owner.name} to borrow their cards.`,
    );
  }
  const source = owner.cards.find((c) => c.instanceId === ownerInstanceId);
  if (!source) throw new EngineError("That card was not found on their board.");
  if (source.borrowedFrom) {
    throw new EngineError("Borrowed cards cannot be borrowed onward.");
  }
  // Per-owner borrow cap this turn (Parasite may borrow 2 from each; 1 default).
  const alreadyBorrowed = p.borrowedFromCount[ownerId] ?? 0;
  if (alreadyBorrowed >= borrowsPerOwnerFor(p)) {
    throw new EngineError(
      `You can only borrow ${borrowsPerOwnerFor(p)} card${borrowsPerOwnerFor(p) === 1 ? "" : "s"} from ${owner.name} per turn.`,
    );
  }
  const cost = borrowCostFor(p);
  if (p.cash < cost) {
    throw new EngineError(`Borrowing costs $${cost}.`);
  }
  p.cash -= cost;
  owner.cash += cost;
  owner.stats.borrowFeesCollected += cost; // The Landlord (v7)
  owner.stats.borrowFeesSeq = ++state.statSeq;
  p.borrowedFromCount[ownerId] = alreadyBorrowed + 1;
  p.metrics.cardsBorrowed += 1;
  p.metrics.borrowFeesPaid += cost;
  const def = getCard(source.cardTypeId);
  const copy = newInstance(state, source.cardTypeId);
  copy.borrowedFrom = ownerId;
  if (source.harvestOutput !== undefined)
    copy.harvestOutput = source.harvestOutput;
  p.cards.push(copy);
  addLog(
    state,
    "borrow",
    p.id,
    `${p.name} pays ${owner.name} $${cost} to borrow their ${def.name} for this turn (1 activation).`,
  );
  assertInvariants(state);
  return state;
}

/** Toggle a Turbine/Generator between grid start (electricity) and black
 * start (fuel) for its activation cost. */
export function setTurbineMode(
  input: GameState,
  playerId: string,
  instanceId: string,
  mode: "grid" | "black",
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const inst = findInstance(p, instanceId);
  if (inst.cardTypeId !== "turbine_generator") {
    throw new EngineError(
      "Only the Turbine/Generator has an energy-mode toggle.",
    );
  }
  inst.energyMode = mode;
  return state;
}

// ---------------------------------------------------------------------------
// sequence-assembly staging (v8)

/** Stage one of the active player's cards into the Sequence Assembly area. The
 * card must extend the current staging into a valid facility/recipe prefix, and
 * staged cards stop counting toward the tableau limit. */
export function addToSequencer(
  input: GameState,
  playerId: string,
  instanceId: string,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const inst = findInstance(p, instanceId);
  if (state.turn.sequencer.includes(instanceId)) {
    throw new EngineError(
      "That card is already in the Sequence Assembly area.",
    );
  }
  const nextTypes = [
    ...state.turn.sequencer.map((id) => findInstance(p, id).cardTypeId),
    inst.cardTypeId,
  ];
  if (!canCompleteFacility(p, nextTypes)) {
    throw new EngineError(
      `${getCard(inst.cardTypeId).name} can't build a facility from here (you need the other cards it combines with).`,
    );
  }
  state.turn.sequencer.push(instanceId);
  return state;
}

/** Remove a card from the Sequence Assembly area, returning it to the tableau —
 * blocked if the tableau is already at the card limit. */
export function removeFromSequencer(
  input: GameState,
  playerId: string,
  instanceId: string,
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (!state.turn.sequencer.includes(instanceId)) return state;
  // Returning a card makes it count toward the tableau again.
  if (tableauCount(state, p) >= tableauLimit(p)) {
    throw new EngineError(
      `Your tableau is full (max ${tableauLimit(p)}); sell or play a card before returning this one.`,
    );
  }
  state.turn.sequencer = state.turn.sequencer.filter((id) => id !== instanceId);
  return state;
}

/** Empty the Sequence Assembly area, returning every staged card to the
 * tableau. Blocked if doing so would exceed the tableau limit. */
export function clearSequencer(input: GameState, playerId: string): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const staged = state.turn.sequencer.length;
  const base = p.cards.filter(
    (c) => !c.borrowedFrom && !state.turn.sequencer.includes(c.instanceId),
  ).length;
  if (base + staged > tableauLimit(p)) {
    throw new EngineError(
      `Returning ${staged} card${staged === 1 ? "" : "s"} would exceed the tableau limit (${tableauLimit(p)}); sell or play a card first.`,
    );
  }
  state.turn.sequencer = [];
  return state;
}

/** Load a complete facility's cards into an EMPTY Sequence Assembly area. */
export function loadFacility(
  input: GameState,
  playerId: string,
  instanceIds: string[],
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  if (state.turn.sequencer.length > 0) {
    throw new EngineError(
      "Clear the Sequence Assembly area before loading a facility.",
    );
  }
  for (const id of instanceIds) findInstance(p, id); // validate ownership
  state.turn.sequencer = [...instanceIds];
  return state;
}

// ---------------------------------------------------------------------------
// activations

interface ActivationCheck {
  ok: boolean;
  reason?: string;
  energyNeeded: Record<ResourceId, number>;
  foodNeeded: number;
}

/** Activation energy: 1 unit per activation — machinery for sequences,
 * otherwise the standalone card's own tag (untagged = free). */
function activationEnergy(
  recipe: (typeof RECIPES)[number],
  primary?: CardInstance,
): Record<string, number> {
  // Turbine/Generator honors its grid-start/black-start toggle: grid start
  // burns electricity (default), black start burns fuel.
  if (
    recipe.requiredCardTypes.length === 1 &&
    recipe.requiredCardTypes[0] === "turbine_generator"
  ) {
    return (primary?.energyMode ?? "grid") === "black"
      ? { fuel: 1 }
      : { electricity: 1 };
  }
  const tag =
    recipe.requiredCardTypes.length > 1
      ? "machinery"
      : getCard(recipe.requiredCardTypes[0]).tag;
  if (!tag) return {};
  const cost = GAME_CONFIG.activationEnergy[tag];
  return { [cost.resource]: cost.amount };
}

/** Evaluate every activation requirement without mutating anything. */
function checkActivation(
  state: GameState,
  p: PlayerState,
  recipeId: string,
  instances: CardInstance[],
): ActivationCheck {
  const recipe = getRecipe(recipeId);
  const seqKey = sequenceKey(recipe.requiredCardTypes);
  const fail = (reason: string): ActivationCheck => ({
    ok: false,
    reason,
    energyNeeded: {},
    foodNeeded: 0,
  });

  // Combo rule per instance.
  for (const inst of instances) {
    if (inst.usedSequences.includes(seqKey)) {
      return fail(
        `${getCard(inst.cardTypeId).name} has already run this sequence this turn.`,
      );
    }
    if (inst.usedSequences.length >= GAME_CONFIG.maxUsesPerTurn) {
      return fail(
        `${getCard(inst.cardTypeId).name} has no combo uses left this turn (max ${GAME_CONFIG.maxUsesPerTurn}).`,
      );
    }
  }

  // Regenerist can only produce agriculture and livestock among raw resources.
  if (p.classId === "regenerist") {
    for (const rid of Object.keys(recipe.outputs)) {
      const def = getResource(rid);
      if (def.category === "raw" && !CP.regeneristRawAllowed.includes(rid)) {
        return fail(
          `Regenerist can't produce ${def.name} — only agriculture and livestock among raws.`,
        );
      }
    }
  }

  // Energy (1 per activation). Line Boss covers 2 machinery activations with
  // one electricity, so every second machinery activation is free.
  const energyNeeded = activationEnergy(recipe, instances[0]);
  if (
    p.classId === "lineBoss" &&
    (energyNeeded.electricity ?? 0) > 0 &&
    p.machineryActs % 2 === 1
  ) {
    delete energyNeeded.electricity;
  }

  // Food upkeep (Line Boss owes 1 food only every 4 activations).
  const foodNeeded =
    state.turn.activations % activationsPerFoodFor(p) === 0 ? 1 : 0;

  // Combined consumption per resource: recipe inputs + activation energy +
  // food upkeep. (E.g. black-start Fuel Power consumes fuel BOTH as input
  // and as energy — the checks must not double-book the same unit.)
  const consumed: Record<string, number> = {};
  for (const [rid, n] of Object.entries(recipe.inputs)) {
    consumed[rid] = (consumed[rid] ?? 0) + (n ?? 0);
  }
  for (const [rid, n] of Object.entries(energyNeeded)) {
    consumed[rid] = (consumed[rid] ?? 0) + n;
  }
  if (foodNeeded > 0) consumed.food = (consumed.food ?? 0) + foodNeeded;
  for (const [rid, n] of Object.entries(consumed)) {
    if ((p.resources[rid] ?? 0) < n) {
      const label =
        (recipe.inputs[rid] ?? 0) > 0
          ? `Needs ${n} ${resourceName(rid)} in the warehouse (input + activation costs; has ${p.resources[rid] ?? 0}).`
          : rid === "food"
            ? "Needs 1 food (activation upkeep)."
            : `Needs ${n} ${resourceName(rid)} (activation cost).`;
      return fail(label);
    }
  }

  // Non-consumed requirements + per-turn commitment ledger. They must be
  // present on top of anything this activation consumes.
  for (const [rid, nRaw] of Object.entries(recipe.requires ?? {})) {
    const n = nRaw ?? 0;
    const left = (p.resources[rid] ?? 0) - (consumed[rid] ?? 0);
    if (left < n) {
      return fail(`Needs ${n} ${resourceName(rid)} present (not consumed).`);
    }
    const committed = state.turn.committed[rid] ?? 0;
    if (left - committed < n) {
      return fail(
        `Your ${resourceName(rid)} has already backed a non-consuming activation this turn.`,
      );
    }
  }

  return { ok: true, energyNeeded, foodNeeded };
}

/** Non-mutating activation check for specific instances (used by the UI). */
export function canActivate(
  state: GameState,
  playerId: string,
  recipeId: string,
  cardInstanceIds: string[],
): { ok: boolean; reason?: string } {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return { ok: false, reason: "Unknown player." };
  if (state.status !== "active" || activePlayer(state).id !== playerId) {
    return { ok: false, reason: "Not your turn." };
  }
  const recipe = RECIPE_MAP[recipeId];
  if (!recipe) return { ok: false, reason: "Unknown recipe." };
  if (cardInstanceIds.length !== recipe.requiredCardTypes.length) {
    return { ok: false, reason: "Wrong number of cards for this sequence." };
  }
  if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
    return {
      ok: false,
      reason: "The same card instance cannot fill two slots.",
    };
  }
  const instances: CardInstance[] = [];
  for (let i = 0; i < recipe.requiredCardTypes.length; i++) {
    const inst = p.cards.find((c) => c.instanceId === cardInstanceIds[i]);
    if (!inst) return { ok: false, reason: "Card instance not found." };
    if (inst.cardTypeId !== recipe.requiredCardTypes[i]) {
      return {
        ok: false,
        reason: `Position ${i + 1} must be a ${getCard(recipe.requiredCardTypes[i]).name}.`,
      };
    }
    instances.push(inst);
  }
  const check = checkActivation(state, p, recipeId, instances);
  return { ok: check.ok, reason: check.reason };
}

/**
 * All activation options for the given player: one entry per recipe per
 * eligible PRIMARY instance, with partners chosen as the first eligible
 * instance of each later sequence position.
 */
export function getAvailableActivations(
  state: GameState,
  playerId: string,
): ActivationOption[] {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return [];
  const options: ActivationOption[] = [];
  const seen = new Set<string>();
  for (const primary of p.cards) {
    const def = getCard(primary.cardTypeId);
    for (const recipeId of def.recipeIds) {
      const recipe = getRecipe(recipeId);
      if (recipe.requiredCardTypes[0] !== primary.cardTypeId) continue;
      const seqKey = sequenceKey(recipe.requiredCardTypes);
      if (!canUseInSequence(primary, seqKey)) continue;
      const key = `${recipeId}:${primary.instanceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chosen: CardInstance[] = [primary];
      let ok = true;
      for (const typeId of recipe.requiredCardTypes.slice(1)) {
        const pick = p.cards.find(
          (inst) =>
            inst.cardTypeId === typeId &&
            canUseInSequence(inst, seqKey) &&
            !chosen.includes(inst),
        );
        if (!pick) {
          ok = false;
          break;
        }
        chosen.push(pick);
      }
      if (!ok) continue;
      const check = checkActivation(state, p, recipeId, chosen);
      options.push({
        recipeId,
        cardInstanceIds: chosen.map((i) => i.instanceId),
        affordable: check.ok,
        reason: check.reason,
      });
    }
  }
  return options;
}

export interface FacilityOption {
  key: string;
  name: string;
  icon: string;
  /** One available instance per card in the sequence, in order. */
  cardInstanceIds: string[];
}

/**
 * Facilities the player can assemble RIGHT NOW from ready tableau cards: for
 * each defined sequence, a distinct still-usable instance for every card slot.
 * Used by the Sequence Assembly quick-load chips.
 */
export function availableFacilities(
  state: GameState,
  playerId: string,
): FacilityOption[] {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return [];
  const out: FacilityOption[] = [];
  for (const s of SEQUENCES) {
    const chosen: CardInstance[] = [];
    let ok = true;
    for (const typeId of s.cards) {
      const pick = p.cards.find(
        (inst) =>
          inst.cardTypeId === typeId &&
          canUseInSequence(inst, s.key) &&
          !chosen.includes(inst),
      );
      if (!pick) {
        ok = false;
        break;
      }
      chosen.push(pick);
    }
    if (!ok) continue;
    out.push({
      key: s.key,
      name: s.name,
      icon: s.icon,
      cardInstanceIds: chosen.map((i) => i.instanceId),
    });
  }
  return out;
}

/**
 * Activate a recipe using the given card instances (one eligible instance per
 * sequence position, in order). Atomic: all costs and effects apply together.
 */
export function activateMultiCardRecipe(
  input: GameState,
  playerId: string,
  recipeId: string,
  cardInstanceIds: string[],
): GameState {
  const state = clone(input);
  const p = requireActive(state, playerId);
  const recipe = getRecipe(recipeId);
  const seqKey = sequenceKey(recipe.requiredCardTypes);

  if (cardInstanceIds.length !== recipe.requiredCardTypes.length) {
    throw new EngineError(
      `${recipe.name} needs ${recipe.requiredCardTypes.length} card(s), got ${cardInstanceIds.length}.`,
    );
  }
  if (new Set(cardInstanceIds).size !== cardInstanceIds.length) {
    throw new EngineError("The same card instance cannot be used twice.");
  }

  const instances: CardInstance[] = [];
  for (let i = 0; i < recipe.requiredCardTypes.length; i++) {
    const typeId = recipe.requiredCardTypes[i];
    const inst = findInstance(p, cardInstanceIds[i]);
    if (inst.cardTypeId !== typeId) {
      throw new EngineError(
        `${recipe.name} requires a ${getCard(typeId).name} in position ${i + 1}.`,
      );
    }
    instances.push(inst);
  }

  const check = checkActivation(state, p, recipeId, instances);
  if (!check.ok)
    throw new EngineError(check.reason ?? "Activation requirements not met.");

  // ---- Apply atomically ----
  for (const [rid, n] of Object.entries(check.energyNeeded)) {
    p.resources[rid] -= n;
  }
  if (check.foodNeeded > 0) p.resources.food -= check.foodNeeded;

  for (const [rid, n] of Object.entries(recipe.inputs)) {
    p.resources[rid] -= n ?? 0;
  }
  for (const [rid, n] of Object.entries(recipe.requires ?? {})) {
    state.turn.committed[rid] = (state.turn.committed[rid] ?? 0) + (n ?? 0);
  }

  // Class output bonuses (v9): Hipster doubles intermediate output the first
  // time a sequence is used; Regenerist adds +1 to every output; Land Baron
  // adds +1 to raw outputs.
  const producedNow: Record<string, number> = {};
  const isNewSeqForHipster =
    p.classId === "hipster" && !p.usedSequenceKeysEver.includes(seqKey);
  const effOut = (rid: string, n: number): number => {
    if (n <= 0) return n;
    const cat = getResource(rid).category;
    let out = n;
    if (isNewSeqForHipster && cat === "intermediate") out *= 2;
    if (p.classId === "regenerist") out += 1;
    if (p.classId === "landBaron" && cat === "raw") out += 1;
    return out;
  };
  const produce = (rid: string, n: number): void => {
    const eff = effOut(rid, n);
    if (eff <= 0) return;
    p.resources[rid] = (p.resources[rid] ?? 0) + eff;
    producedNow[rid] = (producedNow[rid] ?? 0) + eff;
    state.producedTotals[rid] = (state.producedTotals[rid] ?? 0) + eff;
    bump(p.metrics.produced, rid, eff);
  };

  let producedText: string;
  if (recipe.special === "harvest" || recipe.special === "fertilize") {
    // Both harvest at the farm's current yield; fertilize also raises it (v7).
    const inst = instances[0];
    const yieldNow = Math.min(
      inst.harvestOutput ?? 2,
      GAME_CONFIG.farmMaxHarvest,
    );
    if (yieldNow > 0) produce("agriculture", yieldNow);
    inst.harvestOutput =
      recipe.special === "fertilize"
        ? Math.min(GAME_CONFIG.farmMaxHarvest, yieldNow + 1)
        : Math.max(0, yieldNow - 1);
    producedText = `${producedNow.agriculture ?? 0} Agriculture${
      recipe.special === "fertilize" ? " with fertilizer" : ""
    } (next harvest: ${inst.harvestOutput})`;
  } else {
    for (const [rid, n] of Object.entries(recipe.outputs)) produce(rid, n ?? 0);
    producedText = fmtBundle(producedNow);
  }
  if (isNewSeqForHipster) p.usedSequenceKeysEver.push(seqKey);
  // Line Boss counts machinery activations to charge electricity every 2.
  if ((activationEnergy(recipe, instances[0]).electricity ?? 0) > 0) {
    p.machineryActs += 1;
  }

  for (const inst of instances) inst.usedSequences.push(seqKey);
  state.turn.activations += 1;
  bump(p.metrics.activationsByRecipe, recipeId, 1);

  // ---- Record trackers (v7) ----
  p.stats.totalActivations += 1; // Stillness (fewest)
  const requiresCount = Object.values(recipe.requires ?? {}).filter(
    (n) => (n ?? 0) > 0,
  ).length;
  if (requiresCount > 0) {
    p.stats.nonConsumingActivations += 1; // The Rancher
    p.stats.nonConsumingSeq = ++state.statSeq;
  }
  // Vertical Integration: a finished good made without any purchased input.
  const finishedUnits = Object.entries(producedNow)
    .filter(
      ([rid, n]) => (n ?? 0) > 0 && getResource(rid).category === "finished",
    )
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  if (finishedUnits > 0) {
    const inputRids = Object.keys(recipe.inputs).filter(
      (rid) => (recipe.inputs[rid] ?? 0) > 0,
    );
    if (
      inputRids.length > 0 &&
      inputRids.every((rid) => !p.everPurchased[rid])
    ) {
      p.stats.verticalFinished += finishedUnits;
      p.stats.verticalSeq = ++state.statSeq;
    }
  }
  // Once every resource has been produced, schedule the game's final round.
  checkAllProduced(state);

  const cardNames = instances
    .map((i) => getCard(i.cardTypeId).name)
    .join(" → ");
  const costBits: string[] = [];
  for (const [rid, n] of Object.entries(check.energyNeeded)) {
    costBits.push(`${n} ${resourceName(rid)}`);
  }
  if (check.foodNeeded > 0) costBits.push(`${check.foodNeeded} food`);
  addLog(
    state,
    "activate",
    p.id,
    `${p.name} activated ${cardNames}: ${recipe.name} (${fmtBundle(recipe.inputs)} → ${producedText})${costBits.length ? ` [cost: ${costBits.join(", ")}]` : ""}.`,
  );

  if (recipe.prestige && recipe.prestige > 0) {
    // Prestige goes only to the FIRST player to produce each finished good.
    const productId = Object.keys(recipe.outputs)[0];
    const claimant = state.prestigeClaimed[productId];
    if (claimant === undefined) {
      state.prestigeClaimed[productId] = p.id;
      const awarded = prestigeFor(p, recipe.prestige);
      p.prestige += awarded;
      p.metrics.prestigeEvents += 1;
      addLog(
        state,
        "prestige",
        p.id,
        `${p.name} is the FIRST to produce ${resourceName(productId)}: ${awarded} prestige${p.classId === "trader" ? " (Trader, halved)" : ""}!`,
      );
    } else if (claimant !== p.id) {
      addLog(
        state,
        "prestige",
        p.id,
        `No prestige: ${resourceName(productId)} was first produced by ${state.players.find((pl) => pl.id === claimant)?.name ?? claimant}.`,
      );
    }
  }

  // Producing machinery/vehicles grants a free card choice (resource kept).
  for (const [rid, n] of Object.entries(producedNow)) {
    const tag = GAME_CONFIG.productionCardGrants[rid];
    if (!tag) continue;
    for (let i = 0; i < (n ?? 0); i++) {
      state.pendingGrants.push({ playerId: p.id, tag });
    }
    addLog(
      state,
      "grant",
      p.id,
      `${p.name} earned a free ${tag} card choice for producing ${resourceName(rid)}.`,
    );
  }

  assertInvariants(state);
  return state;
}

/** Convenience wrapper for single-card recipes. */
export function activateCard(
  input: GameState,
  playerId: string,
  cardInstanceId: string,
  recipeId: string,
): GameState {
  return activateMultiCardRecipe(input, playerId, recipeId, [cardInstanceId]);
}

// ---------------------------------------------------------------------------
// scoring

/** Sequential sell value of a player's warehouse against current stock. */
export function inventorySellValue(state: GameState, p: PlayerState): number {
  let total = 0;
  let packagedUnits = 0;
  for (const r of RESOURCES) {
    const qty = p.resources[r.id] ?? 0;
    if (qty <= 0) continue;
    const quote = calculateMarketQuote(r.id, "sell", qty, state.market[r.id]);
    total += quote.total;
    if (GAME_CONFIG.packagedGoods.includes(r.id)) packagedUnits += qty;
  }
  // Packaged goods are valued net of the packaging their sale would consume.
  if (packagedUnits > 0) {
    const pkDef = getResource("packaging");
    const idx = Math.min(
      pkDef.capacity - 1,
      Math.max(0, pkDef.capacity - state.market.packaging),
    );
    total = Math.max(0, total - packagedUnits * pkDef.priceLadder[idx]);
  }
  return total;
}

export function calculateScore(state: GameState): ScoreBreakdown[] {
  const rows = state.players.map((p) => {
    const inventoryValue = inventorySellValue(state, p);
    const printedCardTotal = p.cards.reduce(
      (sum, c) => sum + getCard(c.cardTypeId).cost,
      0,
    );
    const cardValue = Math.floor(
      printedCardTotal / GAME_CONFIG.scoring.cardValueDivisor,
    );
    const netWorth = p.cash + inventoryValue + cardValue;
    const economicScore = Math.floor(
      netWorth / GAME_CONFIG.scoring.economicDivisor,
    );
    const finalScore = p.prestige + economicScore;
    const finishedHeld = RESOURCES.filter(
      (r) => r.category === "finished",
    ).reduce((sum, r) => sum + (p.resources[r.id] ?? 0), 0);
    return {
      playerId: p.id,
      name: p.name,
      cash: p.cash,
      inventoryValue,
      cardValue,
      netWorth,
      economicScore,
      prestige: p.prestige,
      finalScore,
      finishedHeld,
      rank: 0,
      sharedVictory: false,
    };
  });

  const cmp = (a: ScoreBreakdown, b: ScoreBreakdown) =>
    b.finalScore - a.finalScore ||
    b.prestige - a.prestige ||
    b.netWorth - a.netWorth ||
    b.finishedHeld - a.finishedHeld;
  rows.sort(cmp);
  rows.forEach((row, i) => {
    row.rank = i > 0 && cmp(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
  });
  const winners = rows.filter((r) => r.rank === 1);
  if (winners.length > 1) winners.forEach((w) => (w.sharedVictory = true));
  return rows;
}

// ---------------------------------------------------------------------------
// serialization

export function serializeGame(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGame(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EngineError("Saved game is not valid JSON.");
  }
  const s = parsed as GameState;
  if (typeof s !== "object" || s === null) {
    throw new EngineError("Saved game has an invalid shape.");
  }
  if (s.version !== GAME_CONFIG.stateVersion) {
    throw new EngineError(
      `Saved game version ${String(s.version)} is not compatible with ${GAME_CONFIG.stateVersion}.`,
    );
  }
  const required: (keyof GameState)[] = [
    "seed",
    "rngState",
    "round",
    "maxRounds",
    "activePlayerIndex",
    "players",
    "market",
    "cardMarket",
    "deck",
    "turn",
    "status",
    "nextInstanceId",
  ];
  for (const key of required) {
    if (!(key in s)) throw new EngineError(`Saved game is missing "${key}".`);
  }
  if (!Array.isArray(s.players) || s.players.length < 1) {
    throw new EngineError("Saved game has no players.");
  }
  for (const r of RESOURCES) {
    if (typeof s.market[r.id] !== "number") {
      throw new EngineError(`Saved game is missing market entry for ${r.id}.`);
    }
  }
  if (typeof s.rebates !== "object" || s.rebates === null) s.rebates = {};
  if (s.turn && !Array.isArray(s.turn.sequencer)) s.turn.sequencer = [];
  if (s.turn && typeof s.turn.soldCard !== "boolean") s.turn.soldCard = false;
  if (s.turn && typeof s.turn.boughtCards !== "number") {
    s.turn.boughtCards = s.turn.boughtCard ? 1 : 0;
  }
  if (typeof s.marketMaker !== "object" || s.marketMaker === null) {
    s.marketMaker = { budgets: {}, applied: {}, turnIndex: 0 };
  }
  if (typeof s.prestigeClaimed !== "object" || s.prestigeClaimed === null) {
    s.prestigeClaimed = {};
  }
  if (!Array.isArray(s.pendingGrants)) s.pendingGrants = [];
  if (typeof s.producedTotals !== "object" || s.producedTotals === null) {
    s.producedTotals = {};
  }
  if (typeof s.modifiers !== "object" || s.modifiers === null) {
    s.modifiers = defaultModifiers();
  }
  if (typeof s.marketConfig !== "object" || s.marketConfig === null) {
    const equilibrium: Record<string, number> = {};
    const driftMax: Record<string, number> = {};
    for (const r of RESOURCES) {
      equilibrium[r.id] = r.equilibrium;
      driftMax[r.id] = r.driftMax;
    }
    s.marketConfig = { equilibrium, driftMax, cyclical: false };
  }
  if (s.allProducedRound === undefined) s.allProducedRound = null;
  if (typeof s.statSeq !== "number") s.statSeq = 0;
  if (typeof s.aiClassAffinity !== "boolean") {
    s.aiClassAffinity = GAME_CONFIG.ai.classAffinityDefault;
  }
  for (const p of s.players) {
    for (const r of RESOURCES) {
      if (typeof p.resources[r.id] !== "number") p.resources[r.id] = 0;
    }
    if (!Array.isArray(p.marketRoads)) p.marketRoads = [];
    if (!Array.isArray(p.playerRoads)) p.playerRoads = [];
    if (typeof p.stats !== "object" || p.stats === null) p.stats = emptyStats();
    if (typeof p.metrics !== "object" || p.metrics === null) {
      p.metrics = emptyMetrics();
    }
    if (typeof p.everPurchased !== "object" || p.everPurchased === null) {
      p.everPurchased = {};
    }
    if (typeof p.classId !== "string") p.classId = "none";
    if (typeof p.netWorthMark !== "number") p.netWorthMark = 0;
    if (typeof p.netWorthDelta !== "number") p.netWorthDelta = 0;
    if (!Array.isArray(p.usedSequenceKeysEver)) p.usedSequenceKeysEver = [];
    if (typeof p.saleCarry !== "object" || p.saleCarry === null) {
      p.saleCarry = {};
    }
    if (typeof p.machineryActs !== "number") p.machineryActs = 0;
    if (
      typeof p.borrowedFromCount !== "object" ||
      p.borrowedFromCount === null
    ) {
      p.borrowedFromCount = {};
    }
    for (const c of p.cards) {
      if (!CARD_MAP[c.cardTypeId]) {
        throw new EngineError(
          `Saved game references unknown card ${c.cardTypeId}.`,
        );
      }
      if (!Array.isArray(c.usedSequences)) c.usedSequences = [];
    }
  }
  for (const id of s.deck) {
    if (!CARD_MAP[id]) {
      throw new EngineError(`Saved game deck references unknown card ${id}.`);
    }
  }
  assertInvariants(s);
  return s;
}

// ---------------------------------------------------------------------------
// dev tools (clearly separated from ordinary play; used by the dev panel)

export const devTools = {
  addCash(input: GameState, playerId: string, amount: number): GameState {
    const state = clone(input);
    const p = state.players.find((pl) => pl.id === playerId);
    if (!p) throw new EngineError("Unknown player.");
    p.cash = Math.max(0, p.cash + amount);
    addLog(
      state,
      "dev",
      playerId,
      `[dev] ${p.name} cash ${amount >= 0 ? "+" : ""}${amount}.`,
    );
    return state;
  },
  addResource(
    input: GameState,
    playerId: string,
    resourceId: ResourceId,
    amount: number,
  ): GameState {
    const state = clone(input);
    const p = state.players.find((pl) => pl.id === playerId);
    if (!p) throw new EngineError("Unknown player.");
    getResource(resourceId);
    p.resources[resourceId] = Math.max(
      0,
      (p.resources[resourceId] ?? 0) + amount,
    );
    addLog(
      state,
      "dev",
      playerId,
      `[dev] ${p.name} ${resourceName(resourceId)} ${amount >= 0 ? "+" : ""}${amount}.`,
    );
    return state;
  },
  /** Grant a market road without paying asphalt. */
  addMarketRoad(
    input: GameState,
    playerId: string,
    resourceId: ResourceId,
  ): GameState {
    const state = clone(input);
    const p = state.players.find((pl) => pl.id === playerId);
    if (!p) throw new EngineError("Unknown player.");
    getResource(resourceId);
    if (!p.marketRoads.includes(resourceId)) p.marketRoads.push(resourceId);
    addLog(
      state,
      "dev",
      playerId,
      `[dev] market road to ${resourceName(resourceId)} added.`,
    );
    return state;
  },
  grantCard(input: GameState, playerId: string, cardTypeId: string): GameState {
    const state = clone(input);
    const p = state.players.find((pl) => pl.id === playerId);
    if (!p) throw new EngineError("Unknown player.");
    const def = getCard(cardTypeId);
    p.cards.push(newInstance(state, cardTypeId));
    addLog(state, "dev", playerId, `[dev] ${p.name} granted ${def.name}.`);
    return state;
  },
  advanceRound(input: GameState): GameState {
    let state = clone(input);
    const startRound = state.round;
    let guard = 0;
    while (
      state.status === "active" &&
      state.round === startRound &&
      guard++ < 10
    ) {
      state = endTurn(state, activePlayer(state).id);
    }
    return state;
  },
};

export {
  RESOURCES,
  RESOURCE_MAP,
  CARD_MAP,
  RECIPE_MAP,
  activePlayer as getActivePlayer,
};
