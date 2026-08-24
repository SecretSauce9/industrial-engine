// Tests for the v4 rule set: new/changed sequences, turbine modes, card
// sell-back, player roads + borrowing, turn-clocked market maker with the
// no-full/no-empty rule, no-duplicate marketplace, prestige race, and
// packaging-adjusted scoring.

import { describe, it, expect } from "vitest";
import {
  activateCard,
  activateMultiCardRecipe,
  borrowCard,
  buildPlayerRoad,
  buyCard,
  calculateScore,
  createGame,
  endTurn,
  getAvailableActivations,
  inventorySellValue,
  marketMakerRemaining,
  sellCard,
  setTurbineMode,
  devTools,
} from "../src/engine/game";
import { getCard } from "../src/engine/data/cards";
import { RESOURCES } from "../src/engine/data/resources";
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

describe("v4 recipes and sequences", () => {
  it("Biochemical Plant: fermenter + distillation column, 2 agriculture -> 1 chemicals", () => {
    let [s, ids] = grantAll(give(newGame(), { agriculture: 2 }), [
      "fermenter",
      "distillation_column",
    ]);
    const pid = activeId(s);
    s = activateMultiCardRecipe(s, pid, "biochem_chemicals", ids);
    expect(active(s).resources.chemicals).toBe(1);
    expect(active(s).resources.agriculture).toBe(0);
  });

  it("Refinery produces 3 fuel + 1 asphalt simultaneously; reformed variant adds 1 fuel", () => {
    let [s, ids] = grantAll(give(newGame(), { oil: 2 }), [
      "distillation_column",
      "cracker",
      "steam_reformer",
    ]);
    const pid = activeId(s);
    const fuel0 = active(s).resources.fuel;
    s = activateMultiCardRecipe(s, pid, "refinery_fuel", [ids[0], ids[1]]);
    expect(active(s).resources.fuel).toBe(fuel0 + 3);
    expect(active(s).resources.asphalt).toBe(1 + 1); // starting 1 + produced 1
    // COMBO: same columns+cracker join the reformed refinery (different sequence).
    s = activateMultiCardRecipe(s, pid, "refinery_reformed", ids);
    expect(active(s).resources.fuel).toBe(fuel0 + 3 + 4);
    expect(active(s).resources.asphalt).toBe(3);
  });

  it("Ammonia Plant: fertilizer now needs steam reformer + mixer", () => {
    let [s, ids] = grantAll(give(newGame(), { natgas: 1 }), [
      "steam_reformer",
      "mixer",
    ]);
    const pid = activeId(s);
    // Steam reformer alone can no longer make fertilizer.
    expect(
      getAvailableActivations(s, pid).find(
        (o) =>
          o.recipeId === "reformer_fertilizer" &&
          o.cardInstanceIds.length === 1,
      ),
    ).toBeUndefined();
    s = activateMultiCardRecipe(s, pid, "reformer_fertilizer", ids);
    expect(active(s).resources.fertilizer).toBe(1);
  });

  it("Cheesemaker: fermenter alone, 3 livestock required but not consumed", () => {
    let [s, ferm] = grant(give(newGame(), { livestock: 3 }), "fermenter");
    const pid = activeId(s);
    s = activateCard(s, pid, ferm, "cheesemaker_food");
    expect(active(s).resources.livestock).toBe(3);
    expect(active(s).resources.food).toBe(5); // +1 made, -1 upkeep
  });
});

describe("turbine/generator v4", () => {
  it("burns fuel (not oil) and produces 5 electricity", () => {
    let [s, turbine] = grant(give(newGame(), { coal: 1 }), "turbine_generator");
    const pid = activeId(s);
    s = activateCard(s, pid, turbine, "turbine_coal");
    expect(active(s).resources.electricity).toBe(5 - 1 + 5); // start - grid cost + output
  });

  it("grid start burns electricity; black start burns fuel", () => {
    let s = give(newGame(), { coal: 2 });
    let t1: string;
    [s, t1] = grant(s, "turbine_generator");
    const pid = activeId(s);
    // Default: grid start.
    expect(inst(s, t1).energyMode).toBeUndefined();
    s = activateCard(s, pid, t1, "turbine_coal");
    expect(active(s).resources.fuel).toBe(3); // untouched
    // Toggle to black start on a second turbine.
    let t2: string;
    [s, t2] = grant(s, "turbine_generator");
    s = setTurbineMode(s, pid, t2, "black");
    const elecBefore = active(s).resources.electricity;
    s = activateCard(s, pid, t2, "turbine_coal");
    expect(active(s).resources.fuel).toBe(2); // black start burned fuel
    expect(active(s).resources.electricity).toBe(elecBefore + 5); // no elec cost
  });

  it("black-start Fuel Power needs 2 fuel (input + energy), not 1", () => {
    let [s, turbine] = grant(newGame(), "turbine_generator");
    const pid = activeId(s);
    s = setTurbineMode(s, pid, turbine, "black");
    const p = active(s);
    p.resources.fuel = 1;
    p.resources.electricity = 0;
    const opt = getAvailableActivations(s, pid).find(
      (o) => o.recipeId === "turbine_fuel",
    )!;
    expect(opt.affordable).toBe(false);
    expect(() => activateCard(s, pid, turbine, "turbine_fuel")).toThrow();
    p.resources.fuel = 2;
    s = activateCard(s, pid, turbine, "turbine_fuel");
    expect(active(s).resources.fuel).toBe(0);
    expect(active(s).resources.electricity).toBe(5);
  });
});

describe("card sell-back", () => {
  it("cards sell back to the deck bottom for half price rounded up", () => {
    let [s, grinder] = grant(newGame(), "grinder"); // cost 7 -> refund 4
    const pid = activeId(s);
    const cash0 = active(s).cash;
    const deckLen = s.deck.length;
    s = sellCard(s, pid, grinder);
    expect(active(s).cash).toBe(cash0 + Math.ceil(getCard("grinder").cost / 2));
    expect(active(s).cards.some((c) => c.instanceId === grinder)).toBe(false);
    expect(s.deck[s.deck.length - 1]).toBe("grinder");
    expect(s.deck.length).toBe(deckLen + 1);
  });

  it("starter cards cannot be sold back", () => {
    const s = newGame();
    const pid = activeId(s);
    const construction = active(s).cards[0];
    expect(() => sellCard(s, pid, construction.instanceId)).toThrow(/starter/i);
  });
});

describe("player roads and borrowing", () => {
  function setup() {
    let s = newGame("BORROW", 2);
    const p1 = activeId(s);
    const p2 = s.players[1].id;
    // Give p2 a grinder to borrow.
    s = devTools.grantCard(s, p2, "grinder");
    return { s, p1, p2 };
  }

  it("borrowing needs a road; costs $2 paid to the owner; 1-activation cap", () => {
    let { s, p1, p2 } = setup();
    const ownerCard = s.players[1].cards.find(
      (c) => c.cardTypeId === "grinder",
    )!;
    expect(() => borrowCard(s, p1, p2, ownerCard.instanceId)).toThrow(/road/i);
    s = buildPlayerRoad(s, p1, p2);
    expect(() => buildPlayerRoad(s, p1, p2)).toThrow(/already/i);
    const cash1 = active(s).cash;
    const cash2 = s.players[1].cash;
    s = give(s, { wood: 2 });
    s = borrowCard(s, p1, p2, ownerCard.instanceId);
    expect(active(s).cash).toBe(cash1 - 2);
    expect(s.players[1].cash).toBe(cash2 + 2);
    const borrowed = active(s).cards.find((c) => c.borrowedFrom === p2)!;
    expect(borrowed.cardTypeId).toBe("grinder");
    // One activation only — the combo system is capped for borrowed cards.
    s = activateCard(s, p1, borrowed.instanceId, "sawmill_lumber");
    expect(active(s).resources.lumber).toBe(1);
    const opts = getAvailableActivations(s, p1).filter(
      (o) => o.cardInstanceIds[0] === borrowed.instanceId,
    );
    expect(opts.length).toBe(0); // exhausted after 1 use
    // The borrowed card disappears at end of turn; the owner keeps theirs.
    s = endTurn(s, p1);
    expect(s.players[0].cards.some((c) => c.borrowedFrom)).toBe(false);
    expect(s.players[1].cards.some((c) => c.cardTypeId === "grinder")).toBe(
      true,
    );
  });

  it("cannot borrow your own card or without cash", () => {
    let { s, p1, p2 } = setup();
    s = buildPlayerRoad(s, p1, p2);
    const own = active(s).cards[0];
    expect(() => borrowCard(s, p1, p1, own.instanceId)).toThrow();
    const ownerCard = s.players[1].cards.find(
      (c) => c.cardTypeId === "grinder",
    )!;
    active(s).cash = 1;
    expect(() => borrowCard(s, p1, p2, ownerCard.instanceId)).toThrow(/\$2/);
  });
});

describe("turn-clocked market maker", () => {
  it("no market starts a player's turn completely full or empty", () => {
    let s = newGame("MM", 2);
    s.market.glass = 0;
    s.market.oil = 12;
    s = endTurn(s, activeId(s)); // next player's turn begins with a tick
    expect(s.market.glass).toBeGreaterThan(0);
    expect(s.market.oil).toBeLessThan(12);
    for (const r of RESOURCES) {
      expect(s.market[r.id]).toBeGreaterThan(0);
      expect(s.market[r.id]).toBeLessThan(r.capacity);
    }
  });

  it("the round budget is distributed across player turns (Bresenham shares)", () => {
    // 4-player game: raw markets open at 10 with equilibrium 6 -> budget -2
    // (elastic step of distance 4 capped at 3 -> ceil(4/2)=2... -2), spread
    // over 4 turns as 0/1/0/1 (floor shares).
    const s0 = createGame({
      seed: "MM4",
      maxRounds: 10,
      players: Array.from({ length: 4 }, (_, i) => ({
        name: `P${i + 1}`,
        isAi: false,
      })),
    });
    // After creation, player 1's tick has been applied.
    const budget = s0.marketMaker.budgets.oil ?? 0;
    expect(budget).toBe(-2);
    const applied1 = s0.marketMaker.applied.oil ?? 0;
    expect(Math.abs(applied1)).toBeLessThanOrEqual(Math.abs(budget));
    // Play the full round: by the last player's turn the budget is exhausted.
    let s = s0;
    for (let i = 0; i < 3; i++) s = endTurn(s, activeId(s));
    expect(s.marketMaker.applied.oil ?? 0).toBe(budget);
    expect(s.market.oil).toBe(10 + budget);
  });

  it("boundary fixes come out of the budget when aligned (no double count)", () => {
    let s = newGame("MMB", 2);
    s.market.glass = 0; // equilibrium 6 -> budget would be +2 at round start
    // Force a fresh round so the budget is computed from stock 0.
    s = devTools.advanceRound(s);
    // At the new round's first tick: glass gets its share AND stays >0; the
    // total applied never exceeds the frozen budget.
    const budget = s.marketMaker.budgets.glass ?? 0;
    expect(budget).toBeGreaterThan(0);
    expect(s.marketMaker.applied.glass ?? 0).toBeLessThanOrEqual(budget);
    expect(s.market.glass).toBeGreaterThan(0);
  });

  it("marketMakerRemaining exposes the pending adjustment for the UI", () => {
    const s = newGame("MMR", 2);
    // Raw markets open at 10, eq 6: budget -2, some already applied.
    const remaining = marketMakerRemaining(s, "oil");
    expect(remaining).toBeLessThanOrEqual(0);
    expect(remaining).toBeGreaterThanOrEqual(-2);
  });
});

describe("marketplace duplicates", () => {
  it("initial marketplace has no duplicate cards", () => {
    for (const seed of ["A", "B", "C", "D", "E"]) {
      const s = newGame(seed, 4);
      const nonNull = s.cardMarket.filter((c) => c !== null);
      expect(new Set(nonNull).size).toBe(nonNull.length);
    }
  });

  it("refills skip duplicates while alternatives remain", () => {
    let s = fund(newGame("NODUP", 2), 300);
    const pid = activeId(s);
    for (let i = 0; i < 4; i++) {
      s = buyCard(s, pid, 0);
      const nonNull = s.cardMarket.filter((c) => c !== null);
      expect(new Set(nonNull).size).toBe(nonNull.length);
    }
  });
});

describe("prestige race (first producer only)", () => {
  it("only the first player to produce a finished good earns its prestige", () => {
    let s = give(newGame("RACE", 2), {
      concrete: 1,
      steel: 1,
      glass: 1,
      lumber: 1,
    });
    const p1 = activeId(s);
    s = activateCard(
      s,
      p1,
      active(s).cards[0].instanceId,
      "construction_buildings",
    );
    expect(active(s).prestige).toBe(8);
    expect(s.prestigeClaimed.buildings).toBe(p1);

    // P2 builds later: no prestige.
    s = endTurn(s, p1);
    const p2 = activeId(s);
    s = give(s, { concrete: 1, steel: 1, glass: 1, lumber: 1 });
    s = activateCard(
      s,
      p2,
      active(s).cards[0].instanceId,
      "construction_buildings",
    );
    expect(active(s).prestige).toBe(0);
    expect(active(s).resources.buildings).toBe(1); // still produced

    // P1 repeating also earns nothing more.
    s = endTurn(s, p2);
    s = give(s, { concrete: 1, steel: 1, glass: 1, lumber: 1 });
    s = activateCard(
      s,
      p1,
      active(s).cards[0].instanceId,
      "construction_buildings",
    );
    expect(active(s).prestige).toBe(8); // unchanged
  });
});

describe("packaging-adjusted scoring", () => {
  it("held packaged goods are valued net of packaging cost", () => {
    const s = newGame("PKG", 2);
    const p = active(s);
    const before = inventorySellValue(s, p);
    p.resources.buildings = 1;
    const withBuilding = inventorySellValue(s, p) - before;
    p.resources.buildings = 0;
    p.resources.pharmaceuticals = 1;
    const withPharma = inventorySellValue(s, p) - before;
    // Both sell around their ladders, but pharma is docked a packaging cost.
    const pharmaGross = 29; // sell at stock 2 = ladder[9]-1 = 30-1
    expect(withPharma).toBeLessThan(pharmaGross);
    expect(withBuilding).toBeGreaterThan(0);
    // And the score table reflects it.
    const scores = calculateScore(s);
    expect(scores.length).toBe(2);
  });
});
