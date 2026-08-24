// Balance / configuration validation (v3). Used by `npm run balance`, and the
// same checks run inside the unit-test suite so bad data cannot ship silently.

import { RESOURCES, MARKET_CAPACITY } from "./data/resources";
import { CARDS, CARD_MAP } from "./data/cards";
import { RECIPES } from "./data/recipes";
import { SEQUENCES, sequenceKey } from "./data/sequences";
import { GAME_CONFIG } from "./data/config";

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  stats: {
    resourceCount: number;
    cardCount: number;
    recipeCount: number;
    medianInputValue: number;
    medianOutputValue: number;
  };
}

/** Mid-ladder reference price (used for margin sanity checks). */
function midPrice(resourceId: string): number {
  const def = RESOURCES.find((r) => r.id === resourceId)!;
  const ladder = def.priceLadder;
  return (ladder[5] + ladder[6]) / 2;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Per-activation operating overhead at mid-market (1 energy + food share). */
function activationOverhead(recipe: (typeof RECIPES)[number]): number {
  const tag =
    recipe.requiredCardTypes.length > 1
      ? "machinery"
      : CARD_MAP[recipe.requiredCardTypes[0]]?.tag;
  let total = 0;
  if (tag) {
    const cost = GAME_CONFIG.activationEnergy[tag];
    total += midPrice(cost.resource) * cost.amount;
  }
  total += midPrice("food") / GAME_CONFIG.activationsPerFood;
  return total;
}

export function validateBalance(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const resourceIds = new Set(RESOURCES.map((r) => r.id));

  // --- Resource ladders & market dynamics ---
  for (const r of RESOURCES) {
    if (r.priceLadder.length !== 12) {
      errors.push(
        `${r.id}: price ladder has ${r.priceLadder.length} slots, expected 12.`,
      );
    }
    for (let i = 1; i < r.priceLadder.length; i++) {
      if (r.priceLadder[i] < r.priceLadder[i - 1]) {
        errors.push(`${r.id}: price ladder decreases at slot ${i}.`);
      }
    }
    if (r.priceLadder.some((p) => !Number.isInteger(p) || p < 0)) {
      errors.push(`${r.id}: ladder contains non-integer or negative prices.`);
    }
    if (r.capacity !== MARKET_CAPACITY) {
      errors.push(`${r.id}: capacity ${r.capacity} != ${MARKET_CAPACITY}.`);
    }
    if (r.initialStock < 0 || r.initialStock > r.capacity) {
      errors.push(`${r.id}: initial stock ${r.initialStock} out of range.`);
    }
    if (r.equilibrium < 0 || r.equilibrium > r.capacity) {
      errors.push(`${r.id}: equilibrium ${r.equilibrium} out of range.`);
    }
    if (r.driftMax < 1) {
      errors.push(`${r.id}: driftMax must be >= 1.`);
    }
    for (let stock = 1; stock <= r.capacity; stock++) {
      const buy = r.priceLadder[r.capacity - stock];
      const sellAfter = Math.max(
        0,
        r.priceLadder[r.capacity - (stock - 1) - 1] - GAME_CONFIG.marketSpread,
      );
      if (sellAfter >= buy) {
        errors.push(
          `${r.id}: buy@stock ${stock} then sell would profit (${buy} -> ${sellAfter}).`,
        );
      }
    }
  }

  // --- Stage-gap check: producing an intermediate from purchased raws at
  //     opening prices must clear a healthy first-cycle margin. ---
  const openingBuy = (rid: string) => {
    const def = RESOURCES.find((r) => r.id === rid)!;
    return def.priceLadder[def.capacity - def.initialStock];
  };
  const openingSell = (rid: string) => {
    const def = RESOURCES.find((r) => r.id === rid)!;
    return Math.max(
      0,
      def.priceLadder[def.capacity - def.initialStock - 1] -
        GAME_CONFIG.marketSpread,
    );
  };
  for (const probe of [
    { recipe: "glass_furnace_glass", out: "glass" },
    { recipe: "sawmill_lumber", out: "lumber" },
    { recipe: "blast_steel", out: "steel" },
    { recipe: "concrete_batch", out: "concrete" },
  ]) {
    const recipe = RECIPES.find((r) => r.id === probe.recipe)!;
    const inputCost = Object.entries(recipe.inputs).reduce(
      (s, [rid, n]) => s + openingBuy(rid) * (n ?? 0),
      0,
    );
    const margin = openingSell(probe.out) - inputCost - 3; // ~3 = energy+food
    if (margin < 3) {
      warnings.push(
        `First-cycle margin for ${probe.recipe} is only ${margin} — the spec wants a high-profit opening.`,
      );
    }
  }

  // --- Recipes reference valid resources/cards; margin stats ---
  const cardIds = new Set(CARDS.map((c) => c.id));
  const inputValues: number[] = [];
  const outputValues: number[] = [];
  for (const recipe of RECIPES) {
    for (const t of recipe.requiredCardTypes) {
      if (!cardIds.has(t))
        errors.push(`Recipe ${recipe.id}: unknown card type ${t}.`);
    }
    for (const rid of Object.keys(recipe.inputs)) {
      if (!resourceIds.has(rid))
        errors.push(`Recipe ${recipe.id}: unknown input ${rid}.`);
    }
    for (const rid of Object.keys(recipe.requires ?? {})) {
      if (!resourceIds.has(rid))
        errors.push(`Recipe ${recipe.id}: unknown requirement ${rid}.`);
    }
    for (const rid of Object.keys(recipe.outputs)) {
      if (!resourceIds.has(rid))
        errors.push(`Recipe ${recipe.id}: unknown output ${rid}.`);
    }
    if (
      Object.keys(recipe.outputs).length === 0 &&
      recipe.special !== "fertilize"
    ) {
      errors.push(`Recipe ${recipe.id}: produces nothing.`);
    }
    // Multi-card sequences must be registered with a display name.
    if (recipe.requiredCardTypes.length > 1) {
      const key = sequenceKey(recipe.requiredCardTypes);
      if (!SEQUENCES.some((s) => s.key === key)) {
        errors.push(
          `Recipe ${recipe.id}: sequence ${key} has no definition/name.`,
        );
      }
    }
    const inVal =
      Object.entries(recipe.inputs).reduce(
        (s, [rid, n]) => s + midPrice(rid) * (n ?? 0),
        0,
      ) + activationOverhead(recipe);
    const outVal = Object.entries(recipe.outputs).reduce(
      (s, [rid, n]) => s + midPrice(rid) * (n ?? 0),
      0,
    );
    if (
      recipe.special !== "fertilize" &&
      Object.keys(recipe.inputs).length > 0
    ) {
      inputValues.push(inVal);
      outputValues.push(outVal);
      if (outVal + (recipe.prestige ?? 0) * 10 <= inVal) {
        warnings.push(
          `Recipe ${recipe.id}: mid-market output value ${outVal} (+prestige) <= input+overhead value ${inVal}.`,
        );
      }
    }
    for (const [rid, outN] of Object.entries(recipe.outputs)) {
      const inN = recipe.inputs[rid] ?? 0;
      const otherInputs = Object.entries(recipe.inputs).filter(
        ([r]) => r !== rid,
      );
      if ((outN ?? 0) > inN && inN > 0 && otherInputs.length === 0) {
        errors.push(`Recipe ${recipe.id}: net-positive self-loop on ${rid}.`);
      }
    }
  }

  // --- Sequences reference real cards and have at least one recipe ---
  for (const s of SEQUENCES) {
    for (const t of s.cards) {
      if (!cardIds.has(t)) errors.push(`Sequence ${s.key}: unknown card ${t}.`);
    }
    if (!RECIPES.some((r) => sequenceKey(r.requiredCardTypes) === s.key)) {
      errors.push(`Sequence ${s.key} (${s.name}) has no recipes.`);
    }
  }

  // --- Cards ---
  for (const c of CARDS) {
    if (c.recipeIds.length === 0) errors.push(`Card ${c.id}: has no recipes.`);
    if (c.cost <= 0) errors.push(`Card ${c.id}: non-positive cost.`);
    const isStarter = GAME_CONFIG.starterCards.includes(c.id);
    // v8: decks were thinned by one copy each to match the tableau limit.
    const minCopies = isStarter ? 0 : c.category === "production" ? 3 : 2;
    if (c.deckCount < minCopies) {
      errors.push(
        `Card ${c.id}: deck count ${c.deckCount} below required minimum.`,
      );
    }
    if (c.id === "ranch" || c.id === "solar_panels") {
      if (c.tag !== undefined) errors.push(`Card ${c.id}: must be untagged.`);
    } else if (c.category === "production") {
      if (c.tag !== "vehicles")
        errors.push(`Card ${c.id}: production cards must be tagged vehicles.`);
    } else if (c.tag !== "machinery") {
      errors.push(
        `Card ${c.id}: non-production cards must be tagged machinery.`,
      );
    }
  }
  for (const recipe of RECIPES) {
    for (const t of recipe.requiredCardTypes) {
      const card = CARD_MAP[t];
      if (card && !card.recipeIds.includes(recipe.id)) {
        errors.push(`Card ${t} does not list recipe ${recipe.id}.`);
      }
    }
  }

  const medIn = median(inputValues);
  const medOut = median(outputValues);
  if (medOut <= medIn) {
    errors.push(
      `Median recipe output value (${medOut}) is not above median input value (${medIn}).`,
    );
  }

  return {
    errors,
    warnings,
    stats: {
      resourceCount: RESOURCES.length,
      cardCount: CARDS.length,
      recipeCount: RECIPES.length,
      medianInputValue: medIn,
      medianOutputValue: medOut,
    },
  };
}
