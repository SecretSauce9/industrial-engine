// Tests for the v8 rule set: extruder/refinery/Exodia recipes, the thinned
// deck, and the Sequence Assembly staging area (cards staged there don't count
// toward the tableau limit; adds must extend a valid facility).

import { describe, it, expect } from "vitest";
import {
  activateMultiCardRecipe,
  addToSequencer,
  removeFromSequencer,
  loadFacility,
  buyCard,
  sellCard,
} from "../src/engine/game";
import { getResource } from "../src/engine/data/resources";
import { RECIPE_MAP } from "../src/engine/data/recipes";
import { CARD_MAP, buildDeckList } from "../src/engine/data/cards";
import {
  newGame,
  active,
  activeId,
  grant,
  grantAll,
  give,
  fund,
} from "./helpers";

describe("v8: recipe changes", () => {
  it("Plastics Extruder outputs 2 packaging", () => {
    expect(RECIPE_MAP.extruder_packaging.outputs.packaging).toBe(2);
    let [s, fm] = grant(give(newGame(), { plastic: 1 }), "forming_machine");
    const pid = activeId(s);
    const p0 = s.producedTotals.packaging ?? 0;
    s = activateMultiCardRecipe(s, pid, "extruder_packaging", [fm]);
    expect((s.producedTotals.packaging ?? 0) - p0).toBe(2);
  });

  it("Mixer added to the refinery yields an extra asphalt", () => {
    expect(RECIPE_MAP.refinery_asphalt.outputs.asphalt).toBe(2);
    expect(RECIPE_MAP.refinery_asphalt.outputs.fuel).toBe(3);
    expect(RECIPE_MAP.refinery_reformed_asphalt.outputs.asphalt).toBe(2);
    let [s, ids] = grantAll(give(newGame(), { oil: 1 }), [
      "distillation_column",
      "cracker",
      "mixer",
    ]);
    const pid = activeId(s);
    const a0 = active(s).resources.asphalt ?? 0;
    s = activateMultiCardRecipe(s, pid, "refinery_asphalt", ids);
    expect((active(s).resources.asphalt ?? 0) - a0).toBe(2);
  });

  it("asphalt price ladder was shifted down by 1", () => {
    expect(getResource("asphalt").priceLadder).toEqual([
      4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12,
    ]);
  });

  it("Exodia: 2 oil + 1 natgas → 3 fuel, 1 asphalt, 1 chemicals, 1 plastic", () => {
    const r = RECIPE_MAP.exodia;
    expect(r.inputs).toEqual({ oil: 2, natgas: 1 });
    expect(r.outputs).toEqual({
      fuel: 3,
      asphalt: 1,
      chemicals: 1,
      plastic: 1,
    });
    let [s, ids] = grantAll(give(newGame(), { oil: 2, natgas: 1 }), [
      "distillation_column",
      "cracker",
      "steam_reformer",
      "mixer",
      "polymerizer",
      "petrochemical_complex",
    ]);
    const pid = activeId(s);
    const before = {
      chemicals: active(s).resources.chemicals ?? 0,
      plastic: active(s).resources.plastic ?? 0,
    };
    s = activateMultiCardRecipe(s, pid, "exodia", ids);
    expect(active(s).resources.oil).toBe(0);
    expect(active(s).resources.natgas).toBe(0);
    expect((active(s).resources.chemicals ?? 0) - before.chemicals).toBe(1);
    expect((active(s).resources.plastic ?? 0) - before.plastic).toBe(1);
  });
});

describe("v8: thinned deck", () => {
  it("each card has one fewer copy than the v7 baseline", () => {
    const deck = buildDeckList();
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    // Production cards: 3 copies; components/standalone: 2-4; construction: 0.
    expect(counts.get("oil_rig")).toBe(3);
    expect(counts.get("grinder")).toBe(4);
    expect(counts.get("mixer")).toBe(3);
    expect(counts.get("polymerizer")).toBe(2);
    expect(counts.get("construction") ?? 0).toBe(0);
    for (const c of CARD_MAP.oil_rig ? Object.values(CARD_MAP) : []) {
      if (c.id === "construction") continue;
      expect(c.deckCount).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("v8: sequence-assembly staging", () => {
  it("staged cards do not count toward the tableau limit", () => {
    let s = fund(newGame("STAGE", 2, 10), 500);
    const pid = activeId(s);
    // Fill to the 9-card cap (construction + 8).
    [s] = grantAll(s, [
      "grinder",
      "mixer",
      "furnace",
      "cracker",
      "assembler",
      "forming_machine",
      "polymerizer",
      "distillation_column",
    ]);
    // At the cap, buying is blocked...
    let slot = s.cardMarket.findIndex((c) => c !== null);
    expect(() => buyCard(s, pid, slot)).toThrow(/tableau is full/i);
    // ...but staging a card frees a tableau slot, allowing a purchase.
    const mixerId = active(s).cards.find(
      (c) => c.cardTypeId === "mixer",
    )!.instanceId;
    const furnaceId = active(s).cards.find(
      (c) => c.cardTypeId === "furnace",
    )!.instanceId;
    s = addToSequencer(s, pid, mixerId);
    s = addToSequencer(s, pid, furnaceId); // mixer>furnace is a valid facility
    slot = s.cardMarket.findIndex((c) => c !== null);
    s = buyCard(s, pid, slot); // now allowed
    expect(s.turn.sequencer).toEqual([mixerId, furnaceId]);
  });

  it("a card can only be staged if the player can complete a facility", () => {
    // Owning both mixer and furnace, mixer is stageable (mixer>furnace).
    let [s, ids] = grantAll(newGame(), ["mixer", "furnace", "oil_rig"]);
    const pid = activeId(s);
    const [mixer, , rig] = ids;
    s = addToSequencer(s, pid, mixer);
    // mixer>oil_rig is not a prefix of any facility.
    expect(() => addToSequencer(s, pid, rig)).toThrow(
      /can't build a facility/i,
    );
    // A lone furnace (no mixer/grinder owned) can't be staged at all.
    const [s2, furnaceOnly] = grant(newGame(), "furnace");
    expect(() => addToSequencer(s2, activeId(s2), furnaceOnly)).toThrow(
      /can't build a facility/i,
    );
    // A production card can't be staged on its own either.
    const [s3, rig2] = grant(newGame(), "oil_rig");
    expect(() => addToSequencer(s3, activeId(s3), rig2)).toThrow(
      /can't build a facility/i,
    );
  });

  it("returning a staged card is blocked when the tableau is full", () => {
    let s = fund(newGame("RETURN", 2, 10), 500);
    const pid = activeId(s);
    [s] = grantAll(s, [
      "grinder",
      "mixer",
      "furnace",
      "cracker",
      "assembler",
      "forming_machine",
      "polymerizer",
      "distillation_column",
    ]);
    const mixerId = active(s).cards.find(
      (c) => c.cardTypeId === "mixer",
    )!.instanceId;
    const furnaceId = active(s).cards.find(
      (c) => c.cardTypeId === "furnace",
    )!.instanceId;
    s = addToSequencer(s, pid, mixerId);
    s = addToSequencer(s, pid, furnaceId); // frees 2 tableau slots
    // Buy 2 cards to refill the tableau back to the 9 cap.
    s = buyCard(
      s,
      pid,
      s.cardMarket.findIndex((c) => c !== null),
    );
    s = buyCard(
      s,
      pid,
      s.cardMarket.findIndex((c) => c !== null),
    );
    expect(() => removeFromSequencer(s, pid, mixerId)).toThrow(
      /tableau is full/i,
    );
  });

  it("loadFacility requires an empty staging area", () => {
    let [s, ids] = grantAll(newGame(), ["mixer", "furnace"]);
    const pid = activeId(s);
    s = loadFacility(s, pid, ids);
    expect(s.turn.sequencer).toEqual(ids);
    expect(() => loadFacility(s, pid, ids)).toThrow(/Clear the Sequence/i);
  });

  it("selling a staged card removes it from the staging area", () => {
    let [s, g] = grant(fund(newGame(), 100), "grinder");
    const pid = activeId(s);
    s = addToSequencer(s, pid, g);
    expect(s.turn.sequencer).toContain(g);
    s = sellCard(s, pid, g);
    expect(s.turn.sequencer).not.toContain(g);
  });
});
