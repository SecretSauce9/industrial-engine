// Tests for the v6 additions: the availableFacilities quick-load helper and
// the presence of flavor text / facility icons across all game data.

import { describe, it, expect } from "vitest";
import { availableFacilities } from "../src/engine/game";
import { RESOURCES } from "../src/engine/data/resources";
import { CARDS } from "../src/engine/data/cards";
import { SEQUENCES } from "../src/engine/data/sequences";
import { newGame, activeId, grantAll } from "./helpers";

describe("v6: availableFacilities quick-load", () => {
  it("lists facilities the player can assemble, with ordered instance ids", () => {
    const [s, ids] = grantAll(newGame(), ["mixer", "furnace"]);
    const [mixer, furnace] = ids;
    const facilities = availableFacilities(s, activeId(s));

    const blast = facilities.find((f) => f.key === "mixer>furnace");
    const concrete = facilities.find((f) => f.key === "furnace>mixer");
    expect(blast).toBeDefined();
    expect(concrete).toBeDefined();
    // Instance ids follow each sequence's card order.
    expect(blast!.cardInstanceIds).toEqual([mixer, furnace]);
    expect(concrete!.cardInstanceIds).toEqual([furnace, mixer]);
    expect(blast!.name).toBe("Blast / Glass Furnace");
    expect(blast!.icon.length).toBeGreaterThan(0);
  });

  it("includes single-card facilities (e.g. Grain Mill / Sawmill)", () => {
    const [s, ids] = grantAll(newGame(), ["grinder"]);
    const facilities = availableFacilities(s, activeId(s));
    const mill = facilities.find((f) => f.key === "grinder");
    expect(mill).toBeDefined();
    expect(mill!.cardInstanceIds).toEqual([ids[0]]);
  });

  it("returns nothing when the player owns no matching cards", () => {
    const s = newGame();
    // A fresh player only holds the Construction starter — no component cards.
    const facilities = availableFacilities(s, activeId(s));
    expect(facilities.every((f) => f.key !== "mixer>furnace")).toBe(true);
  });
});

describe("v6: flavor text & facility icons are complete", () => {
  it("every resource has flavor text", () => {
    for (const r of RESOURCES) {
      expect(r.flavor.trim().length).toBeGreaterThan(20);
    }
  });

  it("every card has flavor text", () => {
    for (const c of CARDS) {
      expect(c.flavor.trim().length).toBeGreaterThan(20);
    }
  });

  it("every facility has flavor text and an icon", () => {
    for (const s of SEQUENCES) {
      expect(s.flavor.trim().length).toBeGreaterThan(20);
      expect(s.icon.trim().length).toBeGreaterThan(0);
    }
  });
});
