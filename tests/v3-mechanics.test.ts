// Tests for the v3 rule set: sequences + combo system, market roads with
// spread rebates, farm harvest cap, elastic drift, free-card grants, and the
// rebalanced opening economy.

import { describe, it, expect } from "vitest";
import {
  activateCard,
  activateMultiCardRecipe,
  buildMarketRoad,
  buyResource,
  canActivate,
  claimCardGrant,
  endTurn,
  getAvailableActivations,
  sellResource,
  devTools,
} from "../src/engine/game";
import { getResource, elasticDriftStep } from "../src/engine/data/resources";
import { SEQUENCE_MAP, sequenceKey } from "../src/engine/data/sequences";
import {
  newGame,
  grant,
  grantAll,
  give,
  fund,
  active,
  activeId,
  inst,
} from "./helpers";

describe("sequences and the combo system", () => {
  it("a valid sequence activates and marks every member card used", () => {
    let [s, ids] = grantAll(give(newGame(), { metal: 1, coal: 1 }), [
      "mixer",
      "furnace",
    ]);
    const pid = activeId(s);
    s = activateMultiCardRecipe(s, pid, "blast_steel", ids);
    expect(active(s).resources.steel).toBe(1);
    expect(active(s).resources.metal).toBe(0);
    const key = sequenceKey(["mixer", "furnace"]);
    expect(inst(s, ids[0]).usedSequences).toEqual([key]);
    expect(inst(s, ids[1]).usedSequences).toEqual([key]);
  });

  it("sequence order matters: mixer>furnace differs from furnace>mixer", () => {
    let [s, ids] = grantAll(give(newGame(), { metal: 1, coal: 2, sand: 2 }), [
      "mixer",
      "furnace",
    ]);
    const pid = activeId(s);
    const [mixer, furnace] = ids;
    // Concrete requires furnace THEN mixer.
    expect(() =>
      activateMultiCardRecipe(s, pid, "concrete_batch", [mixer, furnace]),
    ).toThrow(/position/i);
    s = activateMultiCardRecipe(s, pid, "concrete_batch", [furnace, mixer]);
    expect(active(s).resources.concrete).toBe(1);
    // ...and it counts as the furnace>mixer sequence for both cards.
    const key = sequenceKey(["furnace", "mixer"]);
    expect(inst(s, mixer).usedSequences).toContain(key);
    expect(inst(s, furnace).usedSequences).toContain(key);
  });

  it("a card can be reused up to 3 times, each in a DIFFERENT sequence", () => {
    // grinder alone (Mill/Sawmill), grinder+furnace (EAF), grinder+forming (Pulp Mill)
    let [s, ids] = grantAll(
      give(newGame(), { wood: 2, metal: 1, agriculture: 1 }),
      [
        "grinder",
        "furnace",
        "forming_machine",
        "fermenter",
        "distillation_column",
      ],
    );
    const pid = activeId(s);
    const [grinder, furnace, forming] = ids;
    s = activateCard(s, pid, grinder, "sawmill_lumber"); // [grinder]
    s = activateMultiCardRecipe(s, pid, "eaf_alloy", [grinder, furnace]); // [grinder>furnace]
    s = activateMultiCardRecipe(s, pid, "pulp_packaging", [grinder, forming]); // [grinder>forming_machine]
    expect(inst(s, grinder).usedSequences.length).toBe(3);
    // 4th use in yet another sequence (ethanol) is blocked: combo cap.
    const opt = getAvailableActivations(s, pid).find(
      (o) => o.recipeId === "ethanol_fuel",
    );
    expect(opt).toBeUndefined(); // grinder exhausted -> no eligible option
    expect(() =>
      activateMultiCardRecipe(s, pid, "ethanol_fuel", [
        grinder,
        ids[3],
        ids[4],
      ]),
    ).toThrow(/combo|no.*uses/i);
  });

  it("the same sequence cannot be repeated, even for a different recipe", () => {
    // [grinder] covers both Mill Grain and Saw Lumber — one per turn per grinder.
    let [s, grinder] = grant(
      give(newGame(), { wood: 1, agriculture: 2 }),
      "grinder",
    );
    const pid = activeId(s);
    s = activateCard(s, pid, grinder, "sawmill_lumber");
    expect(() => activateCard(s, pid, grinder, "grain_mill_food")).toThrow(
      /already run this sequence/i,
    );
    // A SECOND grinder can still mill grain.
    let g2: string;
    [s, g2] = grant(s, "grinder");
    s = activateCard(s, pid, g2, "grain_mill_food");
    expect(active(s).resources.food).toBeGreaterThanOrEqual(5);
  });

  it("a sequence costs 1 electricity total (not per card)", () => {
    let [s, ids] = grantAll(give(newGame(), { oil: 1 }), [
      "distillation_column",
      "cracker",
      "polymerizer",
    ]);
    const pid = activeId(s);
    const elec0 = active(s).resources.electricity;
    s = activateMultiCardRecipe(s, pid, "refinery_plastic", ids);
    expect(active(s).resources.electricity).toBe(elec0 - 1); // flat 1
    expect(active(s).resources.plastic).toBe(1);
  });

  it("the same instance cannot fill two slots of one sequence", () => {
    let [s, ids] = grantAll(give(newGame(), { natgas: 1 }), ["cracker"]);
    const pid = activeId(s);
    expect(() =>
      activateMultiCardRecipe(s, pid, "cracker_plastic", [ids[0], ids[0]]),
    ).toThrow();
  });

  it("canActivate mirrors engine legality for explicit instances", () => {
    let [s, ids] = grantAll(give(newGame(), { sand: 1 }), ["mixer", "furnace"]);
    const pid = activeId(s);
    expect(canActivate(s, pid, "glass_furnace_glass", ids).ok).toBe(true);
    expect(
      canActivate(s, pid, "glass_furnace_glass", [ids[1], ids[0]]).ok,
    ).toBe(false);
    const p = active(s);
    p.resources.sand = 0;
    const res = canActivate(s, pid, "glass_furnace_glass", ids);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/sand/i);
  });

  it("factory recipes now run on forming machine + assembler", () => {
    let [s, ids] = grantAll(give(newGame(), { chemicals: 1 }), [
      "forming_machine",
      "assembler",
    ]);
    const pid = activeId(s);
    s = activateMultiCardRecipe(s, pid, "factory_pharma", ids);
    expect(active(s).resources.pharmaceuticals).toBe(1);
    expect(active(s).prestige).toBe(6);
    // Same pair cannot also sew clothing this turn (same sequence).
    expect(() =>
      activateMultiCardRecipe(s, pid, "factory_clothing", ids),
    ).toThrow(/already run this sequence/i);
  });

  it("every multi-card sequence has a facility display name", () => {
    expect(SEQUENCE_MAP[sequenceKey(["mixer", "furnace"])].name).toMatch(
      /Furnace/,
    );
    expect(SEQUENCE_MAP[sequenceKey(["furnace", "mixer"])].name).toMatch(
      /Concrete/,
    );
    expect(
      SEQUENCE_MAP[sequenceKey(["distillation_column", "cracker"])].name,
    ).toBe("Refinery");
    expect(
      SEQUENCE_MAP[sequenceKey(["forming_machine", "assembler"])].name,
    ).toMatch(/Factory/);
  });
});

describe("market roads and spread rebates", () => {
  it("building a market road costs 1 asphalt; players start with 1", () => {
    let s = newGame();
    const pid = activeId(s);
    expect(active(s).resources.asphalt).toBe(1);
    s = buildMarketRoad(s, pid, "glass");
    expect(active(s).resources.asphalt).toBe(0);
    expect(active(s).marketRoads).toEqual(["glass"]);
    expect(() => buildMarketRoad(s, pid, "glass")).toThrow(/already/i);
    expect(() => buildMarketRoad(s, pid, "steel")).toThrow(/asphalt/i);
  });

  it("road sales enqueue rebates; another player's purchase pays the spread", () => {
    let s = give(newGame("REBATE", 2), { glass: 3 });
    const p1 = activeId(s);
    s = buildMarketRoad(s, p1, "glass");
    s = sellResource(s, p1, "glass", 3);
    expect(s.rebates.glass).toEqual([{ playerId: p1, units: 3 }]);
    const cashAfterSale = s.players.find((p) => p.id === p1)!.cash;

    // P1's own purchase does NOT trigger its own rebate.
    s = buyResource(s, p1, "glass", 1);
    expect(s.players.find((p) => p.id === p1)!.cash).toBeLessThan(
      cashAfterSale,
    );
    expect(s.rebates.glass[0].units).toBe(3);

    // P2 buys 2: P1 gets $4 rebate ($2 per unit).
    s = endTurn(s, p1);
    const p2 = activeId(s);
    s = fund(s, 50);
    const p1CashBefore = s.players.find((p) => p.id === p1)!.cash;
    s = buyResource(s, p2, "glass", 2);
    expect(s.players.find((p) => p.id === p1)!.cash).toBe(p1CashBefore + 4);
    expect(s.rebates.glass[0].units).toBe(1);

    // Rebates cap at the number sold: buying 2 more only rebates 1 unit ($2).
    const p1CashBefore2 = s.players.find((p) => p.id === p1)!.cash;
    s = buyResource(s, p2, "glass", 2);
    expect(s.players.find((p) => p.id === p1)!.cash).toBe(p1CashBefore2 + 2);
    expect(s.rebates.glass).toBeUndefined();
  });

  it("selling without a road earns no rebate entry", () => {
    let s = give(newGame(), { glass: 2 });
    const pid = activeId(s);
    s = sellResource(s, pid, "glass", 2);
    expect(s.rebates.glass).toBeUndefined();
  });

  it("multiple road sellers are credited in the order they sold (FIFO)", () => {
    let s = give(newGame("FIFO", 3), { glass: 2 });
    const p1 = activeId(s);
    s = buildMarketRoad(s, p1, "glass");
    s = sellResource(s, p1, "glass", 2);
    s = endTurn(s, p1);
    const p2 = activeId(s);
    s = give(s, { glass: 2 });
    s = devTools.addMarketRoad(s, p2, "glass");
    s = sellResource(s, p2, "glass", 2);
    s = endTurn(s, p2);
    // P3 buys 3: first 2 units rebate P1 (older), 1 unit rebates P2.
    const p3 = activeId(s);
    s = fund(s, 60);
    const cash1 = s.players.find((p) => p.id === p1)!.cash;
    const cash2 = s.players.find((p) => p.id === p2)!.cash;
    s = buyResource(s, p3, "glass", 3);
    expect(s.players.find((p) => p.id === p1)!.cash).toBe(cash1 + 4);
    expect(s.players.find((p) => p.id === p2)!.cash).toBe(cash2 + 2);
    expect(s.rebates.glass).toEqual([{ playerId: p2, units: 1 }]);
  });
});

describe("farm harvest cap (v7: max 4, fertilize is an alternate harvest)", () => {
  const nextTurn = (s: ReturnType<typeof newGame>, pid: string) =>
    endTurn(endTurn(s, pid), activeId(endTurn(s, pid)));

  it("fertilized harvest produces at the current yield AND raises yield by 1 (max 4)", () => {
    let [s, farm] = grant(give(newGame(), { fertilizer: 3 }), "farm");
    const pid = activeId(s);
    // Fert #1: harvest 2, yield 2 -> 3, uses 1 fertilizer.
    s = activateCard(s, pid, farm, "farm_fertilize");
    expect(active(s).resources.agriculture).toBe(2);
    expect(inst(s, farm).harvestOutput).toBe(3);
    expect(active(s).resources.fertilizer).toBe(2);
    // Fert #2: harvest 3, yield 3 -> 4.
    s = nextTurn(s, pid);
    s = activateCard(s, pid, farm, "farm_fertilize");
    expect(active(s).resources.agriculture).toBe(5);
    expect(inst(s, farm).harvestOutput).toBe(4);
    // Fert #3: harvest 4, yield stays capped at 4.
    s = nextTurn(s, pid);
    s = activateCard(s, pid, farm, "farm_fertilize");
    expect(active(s).resources.agriculture).toBe(9);
    expect(inst(s, farm).harvestOutput).toBe(4);
  });

  it("normal harvest yields at most 4 and decays by 1 to a minimum of 0", () => {
    let [s, farm] = grant(give(newGame(), { fertilizer: 2 }), "farm");
    const pid = activeId(s);
    s = activateCard(s, pid, farm, "farm_fertilize"); // yield 2 -> 3
    s = nextTurn(s, pid);
    s = activateCard(s, pid, farm, "farm_fertilize"); // yield 3 -> 4
    expect(inst(s, farm).harvestOutput).toBe(4);
    s = nextTurn(s, pid);
    const agriBefore = active(s).resources.agriculture;
    s = activateCard(s, pid, farm, "farm_produce"); // harvest 4, yield 4 -> 3
    expect(active(s).resources.agriculture - agriBefore).toBe(4);
    expect(inst(s, farm).harvestOutput).toBe(3);
  });
});

describe("free-card grants for machinery/vehicles production", () => {
  it("producing machinery grants a machinery-card choice, keeping the resource", () => {
    let [s, ids] = grantAll(
      give(newGame(), { plastic: 1, steel: 1, alloy: 1, electronics: 1 }),
      ["forming_machine", "assembler"],
    );
    const pid = activeId(s);
    s = activateMultiCardRecipe(s, pid, "factory_machinery", ids);
    expect(active(s).resources.machinery).toBe(1); // resource kept
    expect(s.pendingGrants).toEqual([{ playerId: pid, tag: "machinery" }]);
    const deckCount = s.deck.filter((c) => c === "furnace").length;
    s = claimCardGrant(s, pid, "furnace");
    expect(active(s).cards.some((c) => c.cardTypeId === "furnace")).toBe(true);
    expect(s.deck.filter((c) => c === "furnace").length).toBe(deckCount - 1);
    expect(s.pendingGrants).toEqual([]);
    expect(active(s).resources.machinery).toBe(1); // still kept
  });

  it("producing vehicles grants a vehicles-card choice; tag mismatch rejected", () => {
    let [s, ids] = grantAll(
      give(newGame(), {
        plastic: 1,
        glass: 1,
        steel: 1,
        alloy: 1,
        electronics: 1,
      }),
      ["forming_machine", "assembler"],
    );
    const pid = activeId(s);
    s = activateMultiCardRecipe(s, pid, "factory_transportation", ids);
    expect(s.pendingGrants).toEqual([{ playerId: pid, tag: "vehicles" }]);
    expect(() => claimCardGrant(s, pid, "furnace")).toThrow(/vehicles/i);
    s = claimCardGrant(s, pid, "oil_rig");
    expect(active(s).cards.some((c) => c.cardTypeId === "oil_rig")).toBe(true);
  });

  it("grants can be declined; claiming without a grant fails", () => {
    let [s, ids] = grantAll(
      give(newGame(), { plastic: 1, steel: 1, alloy: 1, electronics: 1 }),
      ["forming_machine", "assembler"],
    );
    const pid = activeId(s);
    expect(() => claimCardGrant(s, pid, null)).toThrow(/no pending/i);
    s = activateMultiCardRecipe(s, pid, "factory_machinery", ids);
    s = claimCardGrant(s, pid, null); // decline
    expect(s.pendingGrants).toEqual([]);
  });
});

describe("elastic market drift", () => {
  it("drift strength grows with distance from equilibrium", () => {
    const oil = getResource("oil"); // eq 6, driftMax 3
    expect(elasticDriftStep(oil, 6)).toBe(0);
    expect(elasticDriftStep(oil, 7)).toBe(-1);
    expect(elasticDriftStep(oil, 8)).toBe(-1);
    expect(elasticDriftStep(oil, 9)).toBe(-2);
    expect(elasticDriftStep(oil, 10)).toBe(-2);
    expect(elasticDriftStep(oil, 12)).toBe(-3);
    expect(elasticDriftStep(oil, 0)).toBe(3);
    expect(elasticDriftStep(oil, 5)).toBe(1);
  });

  it("end-of-round drift applies the elastic step", () => {
    let s = newGame("DRIFT", 2);
    s.market.glass = 12; // glass eq 6, driftMax 2 -> step -2 (capped)
    s.market.steel = 0; // -> +2 (ceil(6/2)=3 capped at 2)
    s = endTurn(s, activeId(s));
    s = endTurn(s, activeId(s));
    expect(s.market.glass).toBe(10);
    expect(s.market.steel).toBe(2);
  });

  it("the first production cycle from purchased inputs is highly profitable", () => {
    // Buy sand at opening glut prices, melt glass, sell — per the v3 spec the
    // opening margin should be ~50% of the component-card investment.
    let [s, ids] = grantAll(fund(newGame("PROFIT", 2), 20), [
      "mixer",
      "furnace",
    ]);
    const pid = activeId(s);
    const cash0 = active(s).cash;
    s = buyResource(s, pid, "sand", 1);
    s = activateMultiCardRecipe(s, pid, "glass_furnace_glass", ids);
    s = sellResource(s, pid, "glass", 1);
    const profit = active(s).cash - cash0;
    // Ignores the 1 food + 1 electricity drawn from starting stock (~2¢).
    expect(profit).toBeGreaterThanOrEqual(7);
  });
});

describe("v3 starting conditions", () => {
  it("players start with 1 asphalt, 3 fuel, and 5 of the other staples", () => {
    const s = newGame();
    for (const p of s.players) {
      expect(p.resources.asphalt).toBe(1);
      expect(p.resources.electricity).toBe(5);
      expect(p.resources.fuel).toBe(3);
      expect(p.resources.food).toBe(5);
      expect(p.marketRoads).toEqual([]);
    }
  });
});
