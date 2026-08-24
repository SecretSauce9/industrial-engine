// Card activation rules (v3): warehouse-direct resources, energy + food
// costs, non-consuming requirements, standalone cards, farm dynamics,
// prestige, and free-card grants.

import { describe, it, expect } from "vitest";
import {
  activateCard,
  buyCard,
  endTurn,
  getAvailableActivations,
  sellResource,
} from "../src/engine/game";
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

describe("card activation (standalone cards)", () => {
  it("a standalone card cannot activate twice during one turn", () => {
    let [s, rig] = grant(newGame(), "oil_rig");
    const pid = activeId(s);
    s = activateCard(s, pid, rig, "oil_rig_produce");
    expect(active(s).resources.oil).toBe(2); // straight to the warehouse
    expect(() => activateCard(s, pid, rig, "oil_rig_produce")).toThrow();
  });

  it("two separate copies of a card can each activate", () => {
    let [s, ids] = grantAll(newGame(), ["oil_rig", "oil_rig"]);
    const pid = activeId(s);
    s = activateCard(s, pid, ids[0], "oil_rig_produce");
    s = activateCard(s, pid, ids[1], "oil_rig_produce");
    expect(active(s).resources.oil).toBe(4);
  });

  it("a newly purchased card can activate immediately", () => {
    let s = fund(newGame(), 100);
    const pid = activeId(s);
    s.cardMarket[0] = "forest";
    s = buyCard(s, pid, 0);
    const p = active(s);
    const bought = p.cards[p.cards.length - 1];
    expect(bought.cardTypeId).toBe("forest");
    expect(bought.usedSequences).toEqual([]);
    s = activateCard(s, pid, bought.instanceId, "forest_produce");
    expect(active(s).resources.wood).toBe(2);
  });

  it("standalone machinery costs 1 electricity; production costs 1 fuel", () => {
    let s = give(newGame(), { livestock: 2 });
    let slaughter: string, rig: string;
    [s, slaughter] = grant(s, "slaughterhouse");
    [s, rig] = grant(s, "oil_rig");
    const pid = activeId(s);
    s = activateCard(s, pid, slaughter, "slaughterhouse_food");
    expect(active(s).resources.electricity).toBe(4);
    expect(active(s).resources.fuel).toBe(3);
    s = activateCard(s, pid, rig, "oil_rig_produce");
    expect(active(s).resources.fuel).toBe(2);
    expect(active(s).resources.electricity).toBe(4);
  });

  it("Ranch and Solar Panels are untagged: no energy cost", () => {
    let [s, ids] = grantAll(newGame(), ["ranch", "solar_panels"]);
    const pid = activeId(s);
    s = activateCard(s, pid, ids[0], "ranch_produce");
    s = activateCard(s, pid, ids[1], "solar_electricity");
    expect(active(s).resources.electricity).toBe(5 + 2); // +2 solar output
    expect(active(s).resources.fuel).toBe(3);
    expect(active(s).resources.livestock).toBe(2);
  });

  it("activation is blocked without the required energy", () => {
    let [s, slaughter] = grant(
      give(newGame(), { livestock: 2 }),
      "slaughterhouse",
    );
    const p = active(s);
    p.resources.electricity = 0;
    const opt = getAvailableActivations(s, p.id).find(
      (o) => o.recipeId === "slaughterhouse_food",
    )!;
    expect(opt.affordable).toBe(false);
    expect(opt.reason).toMatch(/Electricity/i);
    expect(() =>
      activateCard(s, p.id, slaughter, "slaughterhouse_food"),
    ).toThrow();
  });

  it("1 food is due on the 1st, 4th, 7th... activation of the turn", () => {
    let [s, ids] = grantAll(newGame(), [
      "solar_panels",
      "solar_panels",
      "solar_panels",
      "solar_panels",
    ]);
    const pid = activeId(s);
    expect(active(s).resources.food).toBe(5);
    s = activateCard(s, pid, ids[0], "solar_electricity"); // 1st: pays food
    expect(active(s).resources.food).toBe(4);
    s = activateCard(s, pid, ids[1], "solar_electricity");
    s = activateCard(s, pid, ids[2], "solar_electricity");
    expect(active(s).resources.food).toBe(4);
    s = activateCard(s, pid, ids[3], "solar_electricity"); // 4th: pays food
    expect(active(s).resources.food).toBe(3);
  });

  it("activation is blocked without food for the upkeep", () => {
    let [s, solar] = grant(newGame(), "solar_panels");
    const p = active(s);
    p.resources.food = 0;
    const opt = getAvailableActivations(s, p.id).find(
      (o) => o.recipeId === "solar_electricity",
    )!;
    expect(opt.affordable).toBe(false);
    expect(opt.reason).toMatch(/food/i);
    expect(() => activateCard(s, p.id, solar, "solar_electricity")).toThrow(
      /food/i,
    );
  });

  it("inputs are consumed from and outputs land in the warehouse, atomically", () => {
    let [s, sl] = grant(give(newGame(), { livestock: 2 }), "slaughterhouse");
    const pid = activeId(s);
    s = activateCard(s, pid, sl, "slaughterhouse_food");
    const p = active(s);
    expect(p.resources.livestock).toBe(0);
    expect(p.resources.food).toBe(5 + 1 - 1); // +1 produced, -1 upkeep
    expect(p.resources.textiles).toBe(1);
  });

  it("an activation fails safely when inputs are insufficient", () => {
    let [s, sl] = grant(give(newGame(), { livestock: 1 }), "slaughterhouse");
    const pid = activeId(s);
    expect(() => activateCard(s, pid, sl, "slaughterhouse_food")).toThrow();
    expect(active(s).resources.livestock).toBe(1); // nothing consumed
    expect(inst(s, sl).usedSequences).toEqual([]); // still ready
    expect(active(s).resources.electricity).toBe(5); // no energy charged
  });

  it("non-consuming livestock requirements work from the warehouse", () => {
    let [s, ferm] = grant(give(newGame(), { livestock: 3 }), "fermenter");
    const pid = activeId(s);
    s = activateCard(s, pid, ferm, "cheesemaker_food");
    expect(active(s).resources.livestock).toBe(3); // untouched
    expect(active(s).resources.food).toBe(5); // +1 produced, -1 upkeep
  });

  it("committed livestock cannot back a second requires-activation this turn", () => {
    let s = give(newGame(), { livestock: 3 });
    let ferm: string, ranch: string;
    [s, ferm] = grant(s, "fermenter");
    [s, ranch] = grant(s, "ranch");
    const pid = activeId(s);
    s = activateCard(s, pid, ferm, "cheesemaker_food"); // commits the 3
    const opt = getAvailableActivations(s, pid).find(
      (o) => o.recipeId === "ranch_manure",
    )!;
    expect(opt.affordable).toBe(false);
    expect(opt.reason).toMatch(/already backed/i);
    expect(() => activateCard(s, pid, ranch, "ranch_manure")).toThrow();
    // With 6 livestock, both work; and the ledger clears next turn.
    s = give(s, { livestock: 3 });
    s = activateCard(s, pid, ranch, "ranch_manure");
    expect(active(s).resources.fertilizer).toBe(1);
  });

  it("selling a finished product does not remove prestige", () => {
    let s = give(newGame(), {
      concrete: 1,
      steel: 1,
      glass: 1,
      lumber: 1,
    });
    const pid = activeId(s);
    const construction = active(s).cards[0];
    s = activateCard(s, pid, construction.instanceId, "construction_buildings");
    expect(active(s).prestige).toBe(8);
    expect(active(s).resources.buildings).toBe(1);
    s = sellResource(s, pid, "buildings", 1);
    expect(active(s).prestige).toBe(8);
  });

  it("a recipe cannot be activated with a wrong card type", () => {
    let [s, rig] = grant(newGame(), "oil_rig");
    expect(() => activateCard(s, activeId(s), rig, "forest_produce")).toThrow();
  });

  it("a player cannot act out of turn", () => {
    const s = newGame();
    const other = s.players[1].id;
    expect(() => activateCard(s, other, "c1", "oil_rig_produce")).toThrow();
  });

  it("cards reset at the owner's next turn", () => {
    let [s, rig] = grant(newGame(), "oil_rig");
    const p1 = activeId(s);
    s = activateCard(s, p1, rig, "oil_rig_produce");
    s = endTurn(s, p1);
    expect(
      s.players[0].cards.find((c) => c.instanceId === rig)!.usedSequences
        .length,
    ).toBe(1);
    s = endTurn(s, activeId(s));
    expect(
      s.players[0].cards.find((c) => c.instanceId === rig)!.usedSequences,
    ).toEqual([]);
  });
});
