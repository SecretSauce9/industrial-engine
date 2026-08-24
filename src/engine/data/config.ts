// Central game configuration (v3). Everything here is intentionally editable
// for balance work; see BALANCE.md for rationale.

export const GAME_CONFIG = {
  /** Serialized-state version; bump on incompatible changes. */
  stateVersion: 6,

  /** Default number of rounds (configurable at game setup). */
  defaultRounds: 10,
  minRounds: 4,
  maxRounds: 30,

  minPlayers: 2,
  maxPlayers: 4,

  /** Starting cash by seat (first player, second, third, fourth). */
  startingCash: [30, 33, 36, 39],

  /** Starting warehouse resources for every player. */
  startingResources: {
    electricity: 5,
    fuel: 3,
    food: 5,
    asphalt: 1,
  } as Record<string, number>,

  /** Card types every player starts with (ready). */
  starterCards: ["construction"],

  /** Max cards a player may hold in their tableau (v7). Construction counts;
   * borrowed cards do NOT count toward the limit. */
  tableauCardLimit: 9,

  /** Knife-fight modifier: card types that lose one deck copy each (v7). */
  knifeFightReductions: ["grinder", "cracker", "mixer", "forming_machine"],

  /** Random-resources modifier: max absolute equilibrium shift (v7). */
  randomResourceMaxShift: 2,

  /** End-of-game record awards (v7): 2 prestige to the record holder, ties to
   * whoever reached it first, with a min/max cutoff to qualify at all. */
  recordPrestige: 2,

  /** Player-class parameters (v9). */
  classParams: {
    smallTableauLimit: 6, // Parasite & Liquidator
    parasiteBorrowCost: 1,
    parasiteBorrowsPerOwner: 2,
    defaultBorrowsPerOwner: 1,
    traderRoadRebate: 4,
    liquidatorRefundPct: 0.8,
    lineBossActivationsPerFood: 4,
    regeneristRawAllowed: ["agriculture", "livestock"] as string[],
    regeneristExtraAsphalt: 2,
    regeneristStartCards: ["farm", "ranch", "fermenter"] as string[],
    traderStartAsphalt: 8,
  },

  /** Marketplace face-up slots. */
  marketplaceSlots: 6,
  /** The initial marketplace must contain at least this many production cards. */
  minInitialProductionCards: 3,

  /** Bid/ask spread in credits (sell price = ladder price minus this).
   * This is also the per-unit rebate paid through market roads. */
  marketSpread: 1,

  /** Cost in asphalt to build a road (to a resource market or a player). */
  roadCost: 1,

  /** Rebate per sold unit later purchased by another player (via road). */
  roadRebate: 2,

  /** Cash cost (paid to the owner) to borrow a card for one turn. */
  borrowCost: 2,

  /** Borrowed cards may activate at most this many times. */
  borrowedMaxUses: 1,

  /** Turn income: base, and the doubled amount when a player performs no
   * activations that turn. Paid when the turn ends. */
  income: { base: 4, noActivationBonus: 8 },

  /** Activation upkeep: 1 food is due for each block of this many
   * activations (paid up front — the 1st, 4th, 7th... activation). */
  activationsPerFood: 3,

  /** Energy cost per ACTIVATION (not per card): sequences are machinery and
   * cost 1 electricity; standalone cards cost by their own tag. */
  activationEnergy: {
    machinery: { resource: "electricity", amount: 1 },
    vehicles: { resource: "fuel", amount: 1 },
  } as Record<string, { resource: string; amount: number }>,

  /** Combo system: max uses of one card instance per turn (each use must be
   * in a different sequence). */
  maxUsesPerTurn: 3,

  /** Maximum Harvest Crops output for a Farm (fertilizer cannot raise yield
   * beyond this). */
  farmMaxHarvest: 4,

  /** Selling these finished goods consumes 1 packaging per unit sold. */
  packagedGoods: ["pharmaceuticals", "electronics", "clothing"],

  /** Producing these resources grants a free card choice from the deck with
   * the mapped tag (the resource is kept). */
  productionCardGrants: {
    machinery: "machinery",
    transportation: "vehicles",
  } as Record<string, "machinery" | "vehicles">,

  /** Scoring knobs. */
  scoring: {
    economicDivisor: 10,
    cardValueDivisor: 2,
  },

  /** Prestige awarded per finished product (also stored on recipes). */
  prestigeByProduct: {
    clothing: 4,
    electronics: 5,
    pharmaceuticals: 6,
    buildings: 8,
    machinery: 10,
    transportation: 14,
  } as Record<string, number>,

  /** AI safety guards and search strength (v11). Difficulty = search
   * strength: every tier shares the same value function; higher tiers
   * evaluate more candidates and roll more of them out, so each tier
   * considers a superset of the moves below it (monotone by construction). */
  ai: {
    maxActionsPerTurn: 140,
    easyMistakeChance: 0.2,
    /** Candidates given a full value-function evaluation per decision. */
    evalBreadth: { normal: 4, hard: 8 } as Record<string, number>,
    /** Top candidates given a REAL rollout (base policy simulated through
     * engine calls to end of turn); the rest get a static completion
     * estimate. Normal relies purely on the static estimate; hard buys
     * fidelity with compute. */
    rolloutBreadth: { normal: 0, hard: 4 } as Record<string, number>,
    /** Max base-policy steps inside one real rollout. */
    rolloutDepth: { normal: 10, hard: 14 } as Record<string, number>,
    /** Minimum value gain (in score points) to act instead of ending. */
    epsilon: 0.03,
    /** Default for GameSettings.aiClassAffinity when unset (v12). The per-class
     * measurement (BALANCE.md) showed the nudge raises average class scores
     * (mean +2.3; parasite +7.8, hipster +6.9, land baron +3.2), so it is ON
     * by default. */
    classAffinityDefault: true,
  },

  /** Cap kept on the in-memory/serialized action log. */
  maxLogEntries: 400,

  /** localStorage keys (bumped for the incompatible v6 state). */
  storage: {
    save: "industrial-engine:save:v9",
    settings: "industrial-engine:settings:v1",
    /** Set once the player has seen (or dismissed) the tutorial. */
    tutorialSeen: "industrial-engine:tutorial:v1",
  },
};
