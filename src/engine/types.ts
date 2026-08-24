// Core shared types for the Industrial Engine rules engine (v3 rules).
// The engine is pure TypeScript: no React, no DOM, fully serializable state.
//
// v3: resources flow directly through the warehouse (per-card storage and
// card-to-warehouse roads are deprecated). Transformations are performed by
// SEQUENCES of component cards with a combo system; roads now connect to
// individual resource MARKETS and rebate the bid/ask spread.

export type ResourceId = string;
export type CardTypeId = string;
export type CardInstanceId = string;
export type PlayerId = string;
export type RecipeId = string;

export type ResourceCategory = "raw" | "intermediate" | "finished";

export interface ResourceDefinition {
  id: ResourceId;
  name: string;
  category: ResourceCategory;
  /** Ascending 12-slot price ladder. prices[0] = cheapest (market full). */
  priceLadder: number[];
  initialStock: number;
  capacity: number;
  /** Stock level the market drifts toward at the end of each round. */
  equilibrium: number;
  /**
   * Cap on the per-round drift step. The drift itself is ELASTIC:
   * step = min(ceil(|equilibrium − stock| / 2), driftMax) — it snaps back
   * harder the further the market is from equilibrium.
   */
  driftMax: number;
  /** Smil-style flavor text (materials-and-energy framing). */
  flavor: string;
}

export interface RecipeDefinition {
  id: RecipeId;
  name: string;
  /**
   * The ordered card-type SEQUENCE that performs this recipe. One entry =
   * a standalone card; several entries = a sequence assembled from component
   * cards (order matters: mixer→furnace is not furnace→mixer). All consumed
   * inputs come from the warehouse and outputs go to the warehouse.
   */
  requiredCardTypes: CardTypeId[];
  /** Consumed inputs (taken from the warehouse). */
  inputs: Partial<Record<ResourceId, number>>;
  /**
   * Non-consumed requirements (must be in the warehouse). A given quantity
   * can back only one requires-activation per turn (commitment ledger).
   */
  requires?: Partial<Record<ResourceId, number>>;
  /** Outputs (produced into the warehouse). */
  outputs: Partial<Record<ResourceId, number>>;
  /** Permanent prestige awarded when this recipe produces its outputs. */
  prestige?: number;
  /**
   * Special engine handling:
   *  - "harvest": output equals the farm instance's current harvestOutput
   *    (max 3), which then drops by 1 (min 0).
   *  - "fertilize": consumes inputs and raises the farm's harvestOutput by 2,
   *    capped at 3; blocked when already at the cap.
   */
  special?: "harvest" | "fertilize";
  /** Short flavor/explanation used by tooltips and the rules reference. */
  note?: string;
}

export type CardCategory =
  | "production"
  | "energy"
  | "materials"
  | "agrifood"
  | "manufacturing";

/** Activation-cost tag: machinery burns electricity, vehicles burn fuel.
 * v3: the cost is 1 unit per ACTIVATION (sequences count once). */
export type CardTag = "machinery" | "vehicles";

export interface CardDefinition {
  id: CardTypeId;
  name: string;
  category: CardCategory;
  cost: number;
  recipeIds: RecipeId[];
  /** Number of copies of this card in the full deck (0 = starter-only). */
  deckCount: number;
  /** Untagged cards (Ranch, Solar Panels) have no activation energy cost. */
  tag?: CardTag;
  /** Smil-style flavor text (materials-and-energy framing). */
  flavor: string;
}

export interface CardInstance {
  instanceId: CardInstanceId;
  cardTypeId: CardTypeId;
  /**
   * Combo tracking: the sequence keys this instance has been used in this
   * turn. A card may be used up to MAX_USES_PER_TURN (3) times, each in a
   * DIFFERENT sequence. Standalone cards have exactly one possible sequence
   * (their own type), so they naturally activate once per turn. Borrowed
   * cards are limited to 1 activation regardless.
   */
  usedSequences: string[];
  /** Farms only: current Harvest Crops yield (starts at 2, max 3). */
  harvestOutput?: number;
  /** Turbine/Generator only: activation energy mode (default "grid"). */
  energyMode?: "grid" | "black";
  /** Set when this is a card borrowed from another player for one turn. */
  borrowedFrom?: PlayerId;
}

export type AiDifficulty = "easy" | "normal" | "hard";

/** Optional player class (v9). "none" is the neutral default. */
export type ClassId =
  | "none"
  | "equilibrist"
  | "regenerist"
  | "trader"
  | "hipster"
  | "parasite"
  | "landBaron"
  | "liquidator"
  | "lineBoss";

export interface PlayerSetup {
  name: string;
  isAi: boolean;
  aiDifficulty?: AiDifficulty;
  classId?: ClassId;
}

/** Per-player record-tracker stats (v7). Each max-tracker carries a `Seq`
 * marking WHEN it last reached its current value, for first-to-record ties. */
export interface PlayerStats {
  /** Landlord: borrow fees collected from other players. */
  borrowFeesCollected: number;
  borrowFeesSeq: number;
  /** Road Baron: total spread-rebate dollars earned. */
  rebateDollars: number;
  rebateDollarsSeq: number;
  /** The Combo: most activations performed in a single turn. */
  maxCombosInTurn: number;
  maxCombosSeq: number;
  /** Stillness: total activations over the whole game (fewest wins). */
  totalActivations: number;
  /** The Rancher: activations of non-consuming (`requires`-based) recipes. */
  nonConsumingActivations: number;
  nonConsumingSeq: number;
  /** Vertical Integration: finished goods made without any purchased input. */
  verticalFinished: number;
  verticalSeq: number;
}

/**
 * Per-player lifetime METRICS (v11). Pure observation: these counters are
 * written wherever the engine mutates the world and are never read by any
 * rule. They exist so the simulation/balance suite (and the AI's rationale
 * logs) can answer "who did what" per player instead of relying on global
 * tallies. All Records are sparse — read with `?? 0`.
 */
export interface PlayerMetrics {
  /** Units produced by this player's activations, per resource. */
  produced: Record<ResourceId, number>;
  /** Units sold to the market, per resource. */
  sold: Record<ResourceId, number>;
  /** Units bought from the market, per resource. */
  bought: Record<ResourceId, number>;
  /** Dollars received from market sales, per resource. */
  soldDollars: Record<ResourceId, number>;
  /** Dollars spent on market buys, per resource. */
  boughtDollars: Record<ResourceId, number>;
  /** Activation counts per recipe — unique facilities used, Exodia count,
   * harvest/fertilize counts all derive from this one map. */
  activationsByRecipe: Record<RecipeId, number>;
  /** Roads built to resource markets / to other players. */
  marketRoadsBuilt: number;
  playerRoadsBuilt: number;
  /** Marketplace cards bought / sold back to the deck. */
  cardsBought: number;
  cardsSold: number;
  /** Free production grants claimed / declined. */
  grantsClaimed: number;
  grantsDeclined: number;
  /** Cards borrowed from other players, and fees paid to do so. */
  cardsBorrowed: number;
  borrowFeesPaid: number;
  /** First-producer prestige awards won (count of events, not points). */
  prestigeEvents: number;
  /** End-of-turn income collected, and how many turns had 0 activations. */
  incomeCollected: number;
  noActivationTurns: number;
  /** Turns this player has completed. */
  turnsPlayed: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  isAi: boolean;
  aiDifficulty?: AiDifficulty;
  cash: number;
  prestige: number;
  /** Warehouse inventory — ALL resources live here in v3. */
  resources: Record<ResourceId, number>;
  cards: CardInstance[];
  /** Resource markets this player has built a road to (spread rebates). */
  marketRoads: ResourceId[];
  /** Other players this player has built a road to (enables borrowing). */
  playerRoads: PlayerId[];
  /** Record-tracker statistics (v7). */
  stats: PlayerStats;
  /** Lifetime observation counters (v11) — see PlayerMetrics. */
  metrics: PlayerMetrics;
  /** Resources this player has ever purchased from the market (v7): used to
   * decide Vertical Integration (a finished good made from only self-produced
   * inputs). */
  everPurchased: Record<ResourceId, boolean>;
  /** Player class (v9). */
  classId: ClassId;
  /** Net worth measured at the start of this player's current/last turn (v9). */
  netWorthMark: number;
  /** Change in net worth over this player's most recent completed turn (v9). */
  netWorthDelta: number;
  /** Hipster: sequence keys this player has ever activated (first-use bonus). */
  usedSequenceKeysEver: string[];
  /** Land Baron: per-resource carry so the price ladder only moves every 2
   * units sold. */
  saleCarry: Record<ResourceId, number>;
  /** Line Boss: running count of machinery activations (electricity every 2). */
  machineryActs: number;
  /** Parasite: how many cards borrowed from each owner this turn. */
  borrowedFromCount: Record<PlayerId, number>;
}

/** Optional game setup modifiers (v7). Any combination may be active. */
export interface GameModifiers {
  /** Knife fight: one fewer copy of grinder/cracker/mixer/forming_machine. */
  knifeFight: boolean;
  /** Random resources: each equilibrium shifted by up to ±2. */
  randomResources: boolean;
  /** Viscous markets: every resource may drift at most 1 per round. */
  viscousMarkets: boolean;
  /** Cyclical economy: drift lags one round behind the stock it reacts to. */
  cyclicalEconomy: boolean;
}

/** Per-game effective market parameters (after modifiers are applied). */
export interface MarketConfig {
  equilibrium: Record<ResourceId, number>;
  driftMax: Record<ResourceId, number>;
  cyclical: boolean;
  /** Previous round's frozen drift budget, applied this round when cyclical. */
  laggedBudgets?: Record<ResourceId, number>;
}

/** An end-of-game record award (v7). */
export interface GameRecord {
  key: string;
  label: string;
  description: string;
  winnerId: PlayerId | null;
  value: number;
  prestige: number;
}

/** A pending spread rebate: `units` sales awaiting other players' buys. */
export interface RebateEntry {
  playerId: PlayerId;
  units: number;
}

/** A pending free-card grant (earned by producing machinery/vehicles). */
export interface CardGrant {
  playerId: PlayerId;
  tag: CardTag;
}

/** Per-turn bookkeeping for the ACTIVE player; reset when a turn starts. */
export interface TurnFlags {
  /** Activations performed this turn (1 food due per 3, paid up front). */
  activations: number;
  /** Whether a marketplace card was bought this turn (controls cycling). */
  boughtCard: boolean;
  /** How many marketplace cards were bought this turn (v9): the end-of-turn
   * cycle tops up so at least 2 cards leave the shop each turn. */
  boughtCards: number;
  /** Non-consumed `requires` quantities already committed this turn. */
  committed: Record<ResourceId, number>;
  /** Card instances staged in the Sequence Assembly area (v8). Ordered.
   * These do NOT count toward the tableau card limit. Cleared each turn. */
  sequencer: CardInstanceId[];
  /** Whether a tableau card was sold this turn (v9) — the AI uses this to
   * avoid buying and selling cards in the same turn. */
  soldCard: boolean;
}

export type LogEntryType =
  | "game"
  | "round"
  | "turn"
  | "buyResource"
  | "sellResource"
  | "buyCard"
  | "sellCard"
  | "activate"
  | "prestige"
  | "restock"
  | "income"
  | "road"
  | "rebate"
  | "grant"
  | "borrow"
  | "dev";

export interface LogEntry {
  seq: number;
  round: number;
  playerId: PlayerId | null;
  type: LogEntryType;
  message: string;
}

export interface GameSettings {
  seed: string;
  maxRounds: number;
  players: PlayerSetup[];
  modifiers?: GameModifiers;
  /** When true, AI players lean into their class's signature mechanic — the
   * value function accounts for the class's bonuses and the planner is nudged
   * toward the actions that exercise them (v12). Off = classes play as vanilla
   * AIs (the pre-v12 behavior). */
  aiClassAffinity?: boolean;
}

export interface GameState {
  /** Bump when the serialized shape changes incompatibly. */
  version: number;
  seed: string;
  rngState: number;
  round: number;
  maxRounds: number;
  activePlayerIndex: number;
  players: PlayerState[];
  /** Current stock per resource (0..capacity). */
  market: Record<ResourceId, number>;
  /** FIFO spread-rebate queues per resource (oldest sale first). */
  rebates: Record<ResourceId, RebateEntry[]>;
  /**
   * Turn-clocked market maker: at each round start the elastic equilibrium
   * adjustment is frozen as a per-resource budget, then distributed evenly
   * (Bresenham shares) across the round's player turns, applied at the start
   * of each turn. Boundary fixes (no full/empty market at turn start) consume
   * this budget when they point the same way.
   */
  marketMaker: {
    budgets: Record<ResourceId, number>;
    applied: Record<ResourceId, number>;
    /** Turns already ticked this round (0..playerCount). */
    turnIndex: number;
  };
  /** First producer of each finished resource (prestige goes only to them). */
  prestigeClaimed: Record<ResourceId, PlayerId>;
  /** Pending free-card grants, in the order they were earned. */
  pendingGrants: CardGrant[];
  /** Six marketplace slots; null = empty (deck exhausted). */
  cardMarket: (CardTypeId | null)[];
  deck: CardTypeId[];
  turn: TurnFlags;
  log: LogEntry[];
  logSeq: number;
  /** Lifetime units produced by activations, per resource. */
  producedTotals: Record<ResourceId, number>;
  /** Active setup modifiers (v7). */
  modifiers: GameModifiers;
  /** Effective per-game market parameters after modifiers (v7). */
  marketConfig: MarketConfig;
  /** Round in which every resource had first been produced (v7); the game
   * then ends after the following round. Null until that happens. */
  allProducedRound: number | null;
  /** Monotonic counter stamped onto record-tracker updates for tie-breaks. */
  statSeq: number;
  /** End-of-game record awards (v7); set when the game finishes. */
  records?: GameRecord[];
  status: "active" | "finished";
  nextInstanceId: number;
  /** Set true by the headless simulator to skip log accumulation. */
  quiet?: boolean;
  /** AI class-affinity behavior (v12): see GameSettings.aiClassAffinity. */
  aiClassAffinity?: boolean;
}

export interface MarketQuote {
  resourceId: ResourceId;
  kind: "buy" | "sell";
  units: number;
  requested: number;
  unitPrices: number[];
  total: number;
}

export interface ActivationOption {
  recipeId: RecipeId;
  /** One eligible instance id per required card type, in sequence order. */
  cardInstanceIds: CardInstanceId[];
  /** False when any activation requirement is unmet (see reason). */
  affordable: boolean;
  /** Human-readable explanation when affordable is false. */
  reason?: string;
}

export interface ScoreBreakdown {
  playerId: PlayerId;
  name: string;
  cash: number;
  inventoryValue: number;
  cardValue: number;
  netWorth: number;
  economicScore: number;
  prestige: number;
  finalScore: number;
  finishedHeld: number;
  rank: number;
  sharedVictory: boolean;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
