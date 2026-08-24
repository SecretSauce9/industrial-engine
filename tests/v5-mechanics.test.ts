// Tests for the v5 rule set: marketplace self-replacement, the pharma/clothing
// price bump (spread over input + packaging), the sand-cost increase, and
// running non-production standalone cards through the Sequence Assembly path.

import { describe, it, expect } from "vitest";
import {
  activateMultiCardRecipe,
  canActivate,
  endTurn,
} from "../src/engine/game";
import { getResource } from "../src/engine/data/resources";
import { RECIPE_MAP } from "../src/engine/data/recipes";
import { getCard } from "../src/engine/data/cards";
import { validateBalance } from "../src/engine/validate";
import { GAME_CONFIG } from "../src/engine/data/config";
import { newGame, active, activeId, grant } from "./helpers";

/** Equilibrium single-unit sell price for a resource. */
function eqSell(id: string): number {
  const d = getResource(id);
  return (
    d.priceLadder[d.capacity - d.equilibrium - 1] - GAME_CONFIG.marketSpread
  );
}
/** Equilibrium single-unit buy price for a resource. */
function eqBuy(id: string): number {
  const d = getResource(id);
  return d.priceLadder[d.capacity - d.equilibrium];
}

describe("v5: marketplace self-replacement", () => {
  it("a cycled card does not replace itself when another non-duplicate exists", () => {
    let s = newGame("V5-SELFREP", 2);
    // Face-up market; bottom-right (last) is Ranch.
    s.cardMarket = [
      "coal_mine",
      "forest",
      "oil_rig",
      "gas_well",
      "farm",
      "ranch",
    ];
    // Deck top is a *duplicate copy* of the card being cycled out; a distinct
    // non-duplicate (grinder) sits behind it. Old logic would redraw ranch.
    s.deck = ["ranch", "grinder", "mixer"];
    // One card was "bought" so exactly one cycles (isolates self-replacement).
    s.turn.boughtCards = 1;
    s = endTurn(s, activeId(s));
    expect(s.cardMarket[0]).toBe("grinder");
    expect(s.cardMarket[0]).not.toBe("ranch");
  });

  it("a cycled card may replace itself only when it is the sole non-duplicate", () => {
    let s = newGame("V5-SELFREP2", 2);
    s.cardMarket = [
      "coal_mine",
      "forest",
      "oil_rig",
      "gas_well",
      "farm",
      "ranch",
    ];
    // Every remaining deck card duplicates the face-up market, so the only
    // non-duplicate replacement is the cycled card itself.
    s.deck = ["coal_mine", "forest"];
    s.turn.boughtCards = 1; // exactly one cycles
    s = endTurn(s, activeId(s));
    expect(s.cardMarket[0]).toBe("ranch");
  });
});

describe("v5: pharmaceuticals & clothing price bump", () => {
  it("equilibrium sell price is $5 higher than the pre-v5 ladder", () => {
    // Pre-v5 equilibrium sells were pharma 21, clothing 19.
    expect(eqSell("pharmaceuticals")).toBe(26);
    expect(eqSell("clothing")).toBe(24);
  });

  it("there is now a positive spread over input + packaging", () => {
    // The v5 complaint was ~zero spread once packaging was included.
    const pharmaSpread =
      eqSell("pharmaceuticals") - eqBuy("chemicals") - eqBuy("packaging");
    const clothingSpread =
      eqSell("clothing") - eqBuy("textiles") - eqBuy("packaging");
    expect(pharmaSpread).toBeGreaterThan(0);
    expect(clothingSpread).toBeGreaterThan(0);
  });
});

describe("v6: concrete consumes more sand (price unchanged)", () => {
  it("concrete's recipe takes 2 sand", () => {
    const concrete = RECIPE_MAP.concrete_batch;
    expect(concrete.inputs.sand).toBe(2);
  });

  it("sand keeps its original cheap opening cost of 1", () => {
    const sand = getResource("sand");
    const openingBuy = sand.priceLadder[sand.capacity - sand.initialStock];
    expect(openingBuy).toBe(1);
  });

  it("concrete's market price ladder is unchanged", () => {
    expect(getResource("concrete").priceLadder).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
  });

  it("glass and concrete still keep a healthy first-cycle margin", () => {
    const { warnings } = validateBalance();
    expect(warnings.some((w) => w.includes("glass_furnace_glass"))).toBe(false);
    expect(warnings.some((w) => w.includes("concrete_batch"))).toBe(false);
  });
});

describe("v5: standalone cards in sequence assembly", () => {
  it("a non-production standalone card activates through the sequence path", () => {
    const [s0, id] = grant(newGame("V5-STANDALONE"), "solar_panels");
    const pid = activeId(s0);
    // Solar Panels are non-production and run on their own — the exact case
    // the sequence-assembly panel now accepts.
    expect(getCard("solar_panels").category).not.toBe("production");
    expect(canActivate(s0, pid, "solar_electricity", [id]).ok).toBe(true);

    const elec0 = active(s0).resources.electricity ?? 0;
    const s1 = activateMultiCardRecipe(s0, pid, "solar_electricity", [id]);
    expect(active(s1).resources.electricity ?? 0).toBe(elec0 + 2);
  });
});
