// Strategy-signature ANALYSIS (v11). Pure observation over PlayerMetrics:
// nothing here is read by the rules engine or by the AI's value function.
//
// Each signature is a monotone scalar signal computed from a player's
// end-of-game metrics. Signals are NOT comparable across signatures (their
// units differ); they are compared across players/games against a seeded
// BASELINE distribution — a player "lights up" a signature when their signal
// clears a percentile threshold from that baseline. A single game may light
// up several signatures, or none. Buckets are never forced.

import type { GameState, PlayerState } from "./types";

export type SignatureId =
  | "roadStaple" // Road-and-staple specialist: rebates + staple sales
  | "trader" // Resource trader: units flipped through the warehouse
  | "engine" // Engine accumulator: big tableau, many activations
  | "lateTech" // Late-game tech: machinery / vehicles / electronics
  | "builder" // Builder: buildings, concrete, roads
  | "consumer" // Consumer-goods engine: pharma + clothing
  | "petroleum" // Petroleum specialist: oil/gas ladder end-to-end
  | "farmer"; // Farmer/rancher: farm & ranch economy

export const SIGNATURES: SignatureId[] = [
  "roadStaple",
  "trader",
  "engine",
  "lateTech",
  "builder",
  "consumer",
  "petroleum",
  "farmer",
];

const STAPLES = ["electricity", "fuel", "food"];
const TECH_GOODS = ["machinery", "transportation", "electronics"];
const CONSUMER_GOODS = ["pharmaceuticals", "clothing"];
const PETRO_GOODS = ["fuel", "asphalt", "plastic", "chemicals"];
const FARM_GOODS = ["agriculture", "livestock", "food"];
const FARM_RECIPES = [
  "farm_produce",
  "farm_compost",
  "farm_fertilize",
  "ranch_produce",
  "ranch_manure",
  "slaughterhouse_food",
  "cheesemaker_food",
  "grain_mill_food",
];
const PETRO_RECIPES = [
  "refinery_fuel",
  "refinery_reformed",
  "refinery_asphalt",
  "refinery_reformed_asphalt",
  "refinery_plastic",
  "cracker_plastic",
  "cracker_chemicals",
  "chemicals_joint",
  "exodia",
];

function sumOver(rec: Record<string, number>, keys: string[]): number {
  return keys.reduce((s, k) => s + (rec[k] ?? 0), 0);
}

/** Compute the eight strategy signals for one player. Analysis-only. */
export function computeStrategySignals(
  p: PlayerState,
): Record<SignatureId, number> {
  const m = p.metrics;
  const acts = m.activationsByRecipe;

  // Units flipped through the warehouse: bought AND sold the same resource.
  let flipped = 0;
  for (const rid of Object.keys(m.sold)) {
    flipped += Math.min(m.sold[rid] ?? 0, m.bought[rid] ?? 0);
  }

  return {
    roadStaple:
      p.stats.rebateDollars +
      sumOver(m.soldDollars, STAPLES) +
      3 * m.marketRoadsBuilt,
    trader: flipped,
    engine: p.stats.totalActivations + 2 * (m.cardsBought + m.grantsClaimed),
    lateTech: sumOver(m.produced, TECH_GOODS),
    builder:
      3 * (m.produced.buildings ?? 0) +
      (m.produced.concrete ?? 0) +
      m.marketRoadsBuilt +
      m.playerRoadsBuilt,
    consumer: sumOver(m.produced, CONSUMER_GOODS),
    petroleum: sumOver(m.produced, PETRO_GOODS) + sumOver(acts, PETRO_RECIPES),
    farmer: sumOver(acts, FARM_RECIPES) + sumOver(m.produced, FARM_GOODS),
  };
}

/** Per-signature thresholds (signal value that "lights up" the signature). */
export type SignatureThresholds = Record<SignatureId, number>;

/**
 * Derive thresholds from a baseline sample of signals: a signature lights up
 * when a player's signal reaches the given percentile of the NONZERO baseline
 * values (zero-inflation would otherwise push thresholds to meaninglessness),
 * with a small absolute floor so a trivial dabble never counts.
 */
export function deriveThresholds(
  samples: Record<SignatureId, number>[],
  percentile = 0.75,
): SignatureThresholds {
  const out = {} as SignatureThresholds;
  for (const sig of SIGNATURES) {
    const vals = samples
      .map((s) => s[sig])
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (vals.length === 0) {
      out[sig] = Infinity; // never observed: unreachable until the game changes
      continue;
    }
    const idx = Math.min(vals.length - 1, Math.floor(percentile * vals.length));
    out[sig] = Math.max(vals[idx], 2);
  }
  return out;
}

/** Which signatures a player's game lights up, given thresholds. */
export function classifySignatures(
  p: PlayerState,
  thresholds: SignatureThresholds,
): SignatureId[] {
  const signals = computeStrategySignals(p);
  return SIGNATURES.filter((sig) => signals[sig] >= thresholds[sig]);
}

/** Convenience: signals for every player in a finished game. */
export function gameSignals(state: GameState): Record<SignatureId, number>[] {
  return state.players.map((p) => computeStrategySignals(p));
}
