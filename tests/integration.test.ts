// Integration tests (v3): complete production chains through sequences and
// the warehouse, exercising combos, markets, rebates, prestige, and grants —
// all through public engine calls only.

import { describe, it, expect } from "vitest";
import {
  activateCard,
  activateMultiCardRecipe,
  buildMarketRoad,
  buyResource,
  claimCardGrant,
  sellResource,
  endTurn,
  devTools,
} from "../src/engine/game";
import {
  newGame,
  grantAll,
  grant,
  give,
  fund,
  active,
  activeId,
} from "./helpers";

describe("integration: full production chains", () => {
  it("oil -> plastic -> electronics -> machinery chain with combo reuse", () => {
    let s = fund(newGame("CHAIN", 2, 10), 150);
    const p1 = activeId(s);
    let ids: string[];
    [s, ids] = grantAll(s, [
      "distillation_column",
      "cracker",
      "polymerizer",
      "forming_machine",
      "assembler",
    ]);
    const [distill, cracker, poly, forming, assembler] = ids;

    // Buy oil cheap in the opening glut; refine plastic via the 3-card line.
    s = buyResource(s, p1, "oil", 2);
    s = activateMultiCardRecipe(s, p1, "refinery_plastic", [
      distill,
      cracker,
      poly,
    ]);
    expect(active(s).resources.plastic).toBe(1);

    // COMBO: the same distillation column + cracker also run the Refinery
    // sequence this turn (different sequence key).
    s = activateMultiCardRecipe(s, p1, "refinery_fuel", [distill, cracker]);
    // Start 3 fuel (v7) + 3 from refining = 6.
    expect(active(s).resources.fuel).toBeGreaterThanOrEqual(6);

    // Electronics at the Factory sequence (buy the other inputs).
    s = buyResource(s, p1, "alloy", 1);
    s = buyResource(s, p1, "glass", 1);
    s = buyResource(s, p1, "chemicals", 1);
    s = activateMultiCardRecipe(s, p1, "factory_electronics", [
      forming,
      assembler,
    ]);
    expect(active(s).resources.electronics).toBe(1);
    expect(active(s).prestige).toBe(5);

    // The same forming machine + assembler pair cannot run a second
    // Factory-sequence recipe this turn; next turn it assembles machinery.
    expect(() =>
      activateMultiCardRecipe(s, p1, "factory_machinery", [forming, assembler]),
    ).toThrow(/already run this sequence/i);
    s = endTurn(s, p1);
    s = endTurn(s, activeId(s));
    s = buyResource(s, p1, "plastic", 1);
    s = buyResource(s, p1, "steel", 1);
    s = buyResource(s, p1, "alloy", 1);
    s = activateMultiCardRecipe(s, p1, "factory_machinery", [
      forming,
      assembler,
    ]);
    expect(active(s).resources.machinery).toBe(1);
    expect(active(s).prestige).toBe(15);

    // Producing machinery grants a free machinery card (resource kept).
    expect(s.pendingGrants).toEqual([{ playerId: p1, tag: "machinery" }]);
    s = claimCardGrant(s, p1, "furnace");
    expect(active(s).cards.some((c) => c.cardTypeId === "furnace")).toBe(true);
    expect(active(s).resources.machinery).toBe(1);

    // Sell it; prestige survives.
    const cashBefore = active(s).cash;
    s = sellResource(s, p1, "machinery", 1);
    expect(active(s).cash).toBeGreaterThan(cashBefore + 80);
    expect(active(s).prestige).toBe(15);
  });

  it("buildings chain via Construction with market inputs and a market road", () => {
    let s = fund(newGame("CHAIN3", 2, 10), 80);
    const p1 = activeId(s);
    const construction = active(s).cards[0];
    s = buyResource(s, p1, "concrete", 1);
    s = buyResource(s, p1, "steel", 1);
    s = buyResource(s, p1, "glass", 1);
    s = buyResource(s, p1, "lumber", 1);
    s = activateCard(s, p1, construction.instanceId, "construction_buildings");
    expect(active(s).resources.buildings).toBe(1);
    expect(active(s).prestige).toBe(8);

    // Sell through a market road; the rebate arrives when P2 buys.
    s = buildMarketRoad(s, p1, "buildings");
    s = sellResource(s, p1, "buildings", 1);
    s = endTurn(s, p1);
    const p2 = activeId(s);
    s = devTools.addCash(s, p2, 100);
    const p1Cash = s.players.find((p) => p.id === p1)!.cash;
    s = buyResource(s, p2, "buildings", 1);
    expect(s.players.find((p) => p.id === p1)!.cash).toBe(p1Cash + 2); // $2 rebate
  });

  it("livestock engine: ranch feeds the Cheesemaker and manure without consumption", () => {
    let s = newGame("CHAIN4", 2, 12);
    let ranch: string, ferm: string;
    [s, ranch] = grant(s, "ranch");
    [s, ferm] = grant(s, "fermenter");
    const p1 = activeId(s);

    s = activateCard(s, p1, ranch, "ranch_produce");
    s = endTurn(s, p1);
    s = endTurn(s, activeId(s));
    s = activateCard(s, p1, ranch, "ranch_produce");
    expect(active(s).resources.livestock).toBe(4);

    // 4 livestock: the Cheesemaker commits 3; manure (needs 3 more) is blocked.
    s = activateCard(s, p1, ferm, "cheesemaker_food");
    expect(active(s).resources.livestock).toBe(4);
    expect(() => activateCard(s, p1, ranch, "ranch_manure")).toThrow();

    // Later, with 6 livestock, both run across turns.
    s = endTurn(s, p1);
    s = endTurn(s, activeId(s));
    s = activateCard(s, p1, ranch, "ranch_produce");
    expect(active(s).resources.livestock).toBe(6);
    s = activateCard(s, p1, ferm, "cheesemaker_food");
    s = endTurn(s, p1);
    s = endTurn(s, activeId(s));
    s = activateCard(s, p1, ranch, "ranch_manure");
    expect(active(s).resources.fertilizer).toBe(1);
    expect(active(s).resources.livestock).toBe(6);
  });

  it("ethanol three-card sequence works", () => {
    // v7: 2 agriculture -> 4 fuel.
    let [s, ids] = grantAll(give(newGame(), { agriculture: 2 }), [
      "grinder",
      "fermenter",
      "distillation_column",
    ]);
    const pid = activeId(s);
    const fuel0 = active(s).resources.fuel;
    s = activateMultiCardRecipe(s, pid, "ethanol_fuel", ids);
    expect(active(s).resources.fuel).toBe(fuel0 + 4);
    expect(active(s).resources.agriculture).toBe(0);
  });

  it("dev tools advance rounds", () => {
    let s = newGame("DEV", 2, 10);
    s = devTools.advanceRound(s);
    expect(s.round).toBe(2);
    expect(s.activePlayerIndex).toBe(0);
  });
});
