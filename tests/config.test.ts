// Spec conformance of the data files + balance validation (v3).

import { describe, it, expect } from "vitest";
import { RESOURCES, RESOURCE_MAP } from "../src/engine/data/resources";
import { CARDS, CARD_MAP, buildDeckList } from "../src/engine/data/cards";
import { RECIPES, RECIPE_MAP } from "../src/engine/data/recipes";
import { SEQUENCES, sequenceKey } from "../src/engine/data/sequences";
import { GAME_CONFIG } from "../src/engine/data/config";
import { validateBalance } from "../src/engine/validate";

const RAW = [
  "oil",
  "coal",
  "natgas",
  "agriculture",
  "livestock",
  "metal",
  "wood",
  "sand",
];
const INTERMEDIATE = [
  "plastic",
  "concrete",
  "glass",
  "lumber",
  "steel",
  "alloy",
  "asphalt",
  "fertilizer",
  "chemicals",
  "food",
  "electricity",
  "fuel",
  "textiles",
  "packaging",
];
const FINISHED = [
  "buildings",
  "machinery",
  "transportation",
  "electronics",
  "pharmaceuticals",
  "clothing",
];

describe("configuration integrity", () => {
  it("every configured recipe and card references valid IDs", () => {
    const resourceIds = new Set(RESOURCES.map((r) => r.id));
    for (const recipe of RECIPES) {
      for (const t of recipe.requiredCardTypes) {
        expect(CARD_MAP[t]).toBeDefined();
      }
      for (const rid of [
        ...Object.keys(recipe.inputs),
        ...Object.keys(recipe.requires ?? {}),
        ...Object.keys(recipe.outputs),
      ]) {
        expect(resourceIds.has(rid)).toBe(true);
      }
    }
    for (const card of CARDS) {
      for (const rid of card.recipeIds) {
        expect(RECIPE_MAP[rid]).toBeDefined();
      }
      expect(card.recipeIds.length).toBeGreaterThan(0);
    }
  });

  it("all 28 spec resources exist with the exact ids and categories", () => {
    for (const id of RAW) expect(RESOURCE_MAP[id]?.category).toBe("raw");
    for (const id of INTERMEDIATE)
      expect(RESOURCE_MAP[id]?.category).toBe("intermediate");
    for (const id of FINISHED)
      expect(RESOURCE_MAP[id]?.category).toBe("finished");
    expect(RESOURCES.length).toBe(
      RAW.length + INTERMEDIATE.length + FINISHED.length,
    );
    expect(RESOURCE_MAP.natgas.name).toBe("Natural Gas");
    expect(RESOURCE_MAP.transportation.name).toBe("Vehicles");
  });

  it("v3 card roster: components added, replaced facilities removed", () => {
    const expected = [
      "oil_rig",
      "gas_well",
      "coal_mine",
      "farm",
      "ranch",
      "polymetallic_mine",
      "forest",
      "excavator",
      "turbine_generator",
      "solar_panels",
      "slaughterhouse",
      "steam_reformer",
      "grinder",
      "mixer",
      "distillation_column",
      "forming_machine",
      "assembler",
      "cracker",
      "polymerizer",
      "furnace",
      "fermenter",
      "petrochemical_complex",
      "construction",
    ];
    for (const id of expected) expect(CARD_MAP[id]).toBeDefined();
    expect(CARDS.length).toBe(expected.length);
    // Replaced facilities are gone.
    for (const gone of [
      "refinery",
      "ethanol_plant",
      "steam_cracker",
      "pulp_mill",
      "plastics_extruder",
      "textile_mill",
      "grain_mill",
      "electric_arc_furnace",
      "blast_furnace",
      "glass_furnace",
      "sawmill",
      "concrete_batch_plant",
      "factory",
      "pasteurizer",
    ]) {
      expect(CARD_MAP[gone]).toBeUndefined();
    }
  });

  it("the sequence table matches the change request", () => {
    const seqOf = (id: string) => RECIPE_MAP[id].requiredCardTypes;
    expect(seqOf("refinery_fuel")).toEqual(["distillation_column", "cracker"]);
    expect(seqOf("refinery_reformed")).toEqual([
      "distillation_column",
      "cracker",
      "steam_reformer",
    ]);
    expect(seqOf("biochem_chemicals")).toEqual([
      "fermenter",
      "distillation_column",
    ]);
    expect(seqOf("cheesemaker_food")).toEqual(["fermenter"]);
    expect(seqOf("refinery_plastic")).toEqual([
      "distillation_column",
      "cracker",
      "polymerizer",
    ]);
    expect(seqOf("ethanol_fuel")).toEqual([
      "grinder",
      "fermenter",
      "distillation_column",
    ]);
    expect(seqOf("cracker_plastic")).toEqual(["cracker", "polymerizer"]);
    expect(seqOf("cracker_chemicals")).toEqual([
      "cracker",
      "petrochemical_complex",
    ]);
    expect(seqOf("pulp_packaging")).toEqual(["grinder", "forming_machine"]);
    expect(seqOf("extruder_packaging")).toEqual(["forming_machine"]);
    expect(seqOf("textile_from_agriculture")).toEqual([
      "forming_machine",
      "assembler",
    ]);
    expect(seqOf("textile_from_livestock")).toEqual([
      "forming_machine",
      "assembler",
    ]);
    expect(seqOf("textile_from_plastic")).toEqual([
      "forming_machine",
      "assembler",
    ]);
    expect(seqOf("grain_mill_food")).toEqual(["grinder"]);
    expect(seqOf("chemicals_joint")).toEqual([
      "distillation_column",
      "cracker",
      "petrochemical_complex",
    ]);
    expect(seqOf("eaf_steel")).toEqual(["grinder", "furnace"]);
    expect(seqOf("eaf_alloy")).toEqual(["grinder", "furnace"]);
    expect(seqOf("blast_steel")).toEqual(["mixer", "furnace"]);
    expect(seqOf("glass_furnace_glass")).toEqual(["mixer", "furnace"]);
    expect(seqOf("sawmill_lumber")).toEqual(["grinder"]);
    expect(seqOf("concrete_batch")).toEqual(["furnace", "mixer"]);
    for (const f of [
      "factory_clothing",
      "factory_pharma",
      "factory_machinery",
      "factory_transportation",
      "factory_electronics",
    ]) {
      expect(seqOf(f)).toEqual(["forming_machine", "assembler"]);
    }
    // Standalone survivors + v4 sequence moves.
    expect(seqOf("turbine_coal")).toEqual(["turbine_generator"]);
    expect(seqOf("turbine_fuel")).toEqual(["turbine_generator"]);
    expect(seqOf("slaughterhouse_food")).toEqual(["slaughterhouse"]);
    expect(seqOf("reformer_fertilizer")).toEqual(["steam_reformer", "mixer"]);
    expect(seqOf("construction_buildings")).toEqual(["construction"]);
  });

  it("every multi-card sequence has a named definition", () => {
    for (const recipe of RECIPES) {
      if (recipe.requiredCardTypes.length > 1) {
        const key = sequenceKey(recipe.requiredCardTypes);
        expect(SEQUENCES.some((s) => s.key === key)).toBe(true);
      }
    }
  });

  it("deck construction meets copy minimums; construction stays out", () => {
    const deck = buildDeckList();
    const counts = new Map<string, number>();
    for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const card of CARDS) {
      const n = counts.get(card.id) ?? 0;
      if (card.id === "construction") expect(n).toBe(0);
      else if (card.category === "production")
        expect(n).toBeGreaterThanOrEqual(3);
      else expect(n).toBeGreaterThanOrEqual(2);
    }
  });

  it("prestige values match the spec", () => {
    expect(RECIPE_MAP.factory_clothing.prestige).toBe(4);
    expect(RECIPE_MAP.factory_electronics.prestige).toBe(5);
    expect(RECIPE_MAP.factory_pharma.prestige).toBe(6);
    expect(RECIPE_MAP.construction_buildings.prestige).toBe(8);
    expect(RECIPE_MAP.factory_machinery.prestige).toBe(10);
    expect(RECIPE_MAP.factory_transportation.prestige).toBe(14);
    for (const [rid, val] of Object.entries(GAME_CONFIG.prestigeByProduct)) {
      const recipe = RECIPES.find(
        (r) => (r.outputs[rid] ?? 0) > 0 && r.prestige,
      );
      expect(recipe?.prestige).toBe(val);
    }
  });

  it("stage price gaps: intermediates clear raw chains, finished clear intermediates", () => {
    const mid = (rid: string) => {
      const l = RESOURCE_MAP[rid].priceLadder;
      return (l[5] + l[6]) / 2;
    };
    // Single-input intermediates are worth well over their raw input.
    expect(mid("glass")).toBeGreaterThan(mid("sand") + 5);
    expect(mid("lumber")).toBeGreaterThan(mid("wood") + 5);
    expect(mid("plastic")).toBeGreaterThan(mid("oil") + 5);
    expect(mid("steel")).toBeGreaterThan(mid("metal") + mid("coal") + 5);
    // Buildings clear the sum of their intermediate inputs.
    const buildingInputs =
      mid("concrete") + mid("steel") + mid("glass") + mid("lumber");
    expect(mid("buildings")).toBeGreaterThan(buildingInputs);
  });

  it("balance validation passes with no errors", () => {
    const result = validateBalance();
    expect(result.errors).toEqual([]);
    expect(result.stats.medianOutputValue).toBeGreaterThan(
      result.stats.medianInputValue,
    );
  });
});
