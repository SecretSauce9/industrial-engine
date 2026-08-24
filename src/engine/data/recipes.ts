// Canonical recipe data (v3). Recipes are pure data — UI components and the
// AI both read from here; nothing is hard-coded into interface components.
//
// requiredCardTypes is the ordered card SEQUENCE that performs the recipe
// (one entry = standalone card). Inputs and non-consumed `requires` come from
// the warehouse; outputs go to the warehouse.

import type { RecipeDefinition } from "../types";

export const RECIPES: RecipeDefinition[] = [
  // ---------------- Production (standalone, zero-input) ----------------
  {
    id: "oil_rig_produce",
    name: "Drill for Oil",
    requiredCardTypes: ["oil_rig"],
    inputs: {},
    outputs: { oil: 2 },
  },
  {
    id: "gas_well_produce",
    name: "Extract Natural Gas",
    requiredCardTypes: ["gas_well"],
    inputs: {},
    outputs: { natgas: 2 },
  },
  {
    id: "coal_mine_produce",
    name: "Mine Coal",
    requiredCardTypes: ["coal_mine"],
    inputs: {},
    outputs: { coal: 2 },
  },
  {
    id: "farm_produce",
    name: "Harvest Crops",
    requiredCardTypes: ["farm"],
    inputs: {},
    outputs: { agriculture: 2 }, // nominal; actual yield = farm's harvestOutput
    special: "harvest",
    note: "Yield equals this Farm's current output (starts at 2, max 4) and drops by 1 after each harvest, to a minimum of 0.",
  },
  {
    id: "farm_compost",
    name: "Composting",
    requiredCardTypes: ["farm"],
    inputs: { agriculture: 2 },
    outputs: { fertilizer: 1 },
    note: "Alternate Farm mode: compost crops into fertilizer.",
  },
  {
    id: "farm_fertilize",
    name: "Fertilized Harvest",
    requiredCardTypes: ["farm"],
    inputs: { fertilizer: 1 },
    outputs: { agriculture: 2 }, // nominal; actual yield = farm's harvestOutput
    special: "fertilize",
    note: "Alternate harvest: spend 1 fertilizer to harvest at the current yield AND raise this Farm's yield by 1 afterward (max 4), instead of the normal drop.",
  },
  {
    id: "ranch_produce",
    name: "Raise Livestock",
    requiredCardTypes: ["ranch"],
    inputs: {},
    outputs: { livestock: 2 },
  },
  {
    id: "ranch_manure",
    name: "Manure Processing",
    requiredCardTypes: ["ranch"],
    inputs: {},
    requires: { livestock: 3 },
    outputs: { fertilizer: 1 },
    note: "Alternate Ranch mode: needs 3 livestock (not consumed).",
  },
  {
    id: "mine_produce",
    name: "Mine Ore",
    requiredCardTypes: ["polymetallic_mine"],
    inputs: {},
    outputs: { metal: 2 },
  },
  {
    id: "forest_produce",
    name: "Log Timber",
    requiredCardTypes: ["forest"],
    inputs: {},
    outputs: { wood: 2 },
  },
  {
    id: "excavator_produce",
    name: "Excavate Sand",
    requiredCardTypes: ["excavator"],
    inputs: {},
    outputs: { sand: 2 },
  },

  // ---------------- Standalone transformation cards ----------------
  {
    id: "turbine_coal",
    name: "Coal Power",
    requiredCardTypes: ["turbine_generator"],
    inputs: { coal: 1 },
    outputs: { electricity: 5 },
  },
  {
    id: "turbine_gas",
    name: "Gas Power",
    requiredCardTypes: ["turbine_generator"],
    inputs: { natgas: 1 },
    outputs: { electricity: 5 },
  },
  {
    id: "turbine_fuel",
    name: "Fuel Power",
    requiredCardTypes: ["turbine_generator"],
    inputs: { fuel: 1 },
    outputs: { electricity: 5 },
    note: "The Turbine/Generator can start on grid electricity or 'black start' on fuel (toggle on the card).",
  },
  {
    id: "solar_electricity",
    name: "Solar Generation",
    requiredCardTypes: ["solar_panels"],
    inputs: {},
    outputs: { electricity: 2 },
    note: "No resource input and no activation energy cost (Solar Panels are untagged).",
  },
  {
    id: "slaughterhouse_food",
    name: "Process Meat",
    requiredCardTypes: ["slaughterhouse"],
    inputs: { livestock: 2 },
    outputs: { food: 1, textiles: 1 },
  },
  {
    id: "reformer_fertilizer",
    name: "Synthesize Ammonia Fertilizer",
    requiredCardTypes: ["steam_reformer", "mixer"],
    inputs: { natgas: 1 },
    outputs: { fertilizer: 1 },
  },
  {
    id: "cheesemaker_food",
    name: "Make Cheese",
    requiredCardTypes: ["fermenter"],
    inputs: {},
    requires: { livestock: 3 },
    outputs: { food: 1 },
    note: "Needs 3 livestock (not consumed).",
  },
  {
    id: "biochem_chemicals",
    name: "Biochemical Synthesis",
    requiredCardTypes: ["fermenter", "distillation_column"],
    inputs: { agriculture: 2 },
    outputs: { chemicals: 1 },
  },

  // ---------------- Sequence: [grinder] — Grain Mill / Sawmill ----------------
  {
    id: "grain_mill_food",
    name: "Mill Grain",
    requiredCardTypes: ["grinder"],
    inputs: { agriculture: 2 },
    outputs: { food: 2 },
  },
  {
    id: "sawmill_lumber",
    name: "Saw Lumber",
    requiredCardTypes: ["grinder"],
    inputs: { wood: 1 },
    outputs: { lumber: 1 },
  },

  // ---------------- Sequence: [forming_machine] — Plastics Extruder ----------------
  {
    id: "extruder_packaging",
    name: "Molded Packaging",
    requiredCardTypes: ["forming_machine"],
    inputs: { plastic: 1 },
    outputs: { packaging: 2 },
  },

  // ---------------- Sequence: [distillation_column, cracker] — Refinery ----------------
  {
    id: "refinery_fuel",
    name: "Refine Crude",
    requiredCardTypes: ["distillation_column", "cracker"],
    inputs: { oil: 1 },
    outputs: { fuel: 3, asphalt: 1 },
    note: "Produces fuel and asphalt simultaneously.",
  },
  {
    id: "refinery_reformed",
    name: "Refine Crude (Reformed)",
    requiredCardTypes: ["distillation_column", "cracker", "steam_reformer"],
    inputs: { oil: 1 },
    outputs: { fuel: 4, asphalt: 1 },
    note: "Adding a Steam Reformer to the Refinery yields one extra fuel.",
  },
  {
    id: "refinery_asphalt",
    name: "Refine Crude (Coker)",
    requiredCardTypes: ["distillation_column", "cracker", "mixer"],
    inputs: { oil: 1 },
    outputs: { fuel: 3, asphalt: 2 },
    note: "Adding a Mixer after the Cracker yields one extra asphalt.",
  },
  {
    id: "refinery_reformed_asphalt",
    name: "Refine Crude (Reformed Coker)",
    requiredCardTypes: [
      "distillation_column",
      "cracker",
      "steam_reformer",
      "mixer",
    ],
    inputs: { oil: 1 },
    outputs: { fuel: 4, asphalt: 2 },
    note: "Steam Reformer (+1 fuel) and Mixer (+1 asphalt) together.",
  },

  // ---- Sequence: [distillation_column, cracker, polymerizer] — Plastics Refinery ----
  {
    id: "refinery_plastic",
    name: "Refine Plastic",
    requiredCardTypes: ["distillation_column", "cracker", "polymerizer"],
    inputs: { oil: 1 },
    outputs: { plastic: 1 },
  },

  // ---- Sequence: [grinder, fermenter, distillation_column] — Ethanol Plant ----
  {
    id: "ethanol_fuel",
    name: "Ferment Ethanol",
    requiredCardTypes: ["grinder", "fermenter", "distillation_column"],
    inputs: { agriculture: 2 },
    outputs: { fuel: 4 },
  },

  // ---------------- Sequence: [cracker, polymerizer] — Steam Cracker ----------------
  {
    id: "cracker_plastic",
    name: "Crack Gas to Plastic",
    requiredCardTypes: ["cracker", "polymerizer"],
    inputs: { natgas: 1 },
    outputs: { plastic: 1 },
  },

  // ---- Sequence: [cracker, petrochemical_complex] — Steam Cracker (Chemicals) ----
  {
    id: "cracker_chemicals",
    name: "Crack Gas to Chemicals",
    requiredCardTypes: ["cracker", "petrochemical_complex"],
    inputs: { natgas: 1 },
    outputs: { chemicals: 1 },
  },

  // ---- Sequence: [distillation_column, cracker, petrochemical_complex] ----
  {
    id: "chemicals_joint",
    name: "Petrochemical Synthesis",
    requiredCardTypes: [
      "distillation_column",
      "cracker",
      "petrochemical_complex",
    ],
    inputs: { oil: 1 },
    outputs: { chemicals: 1 },
  },

  // ---- Sequence: the full six-card "Exodia" line ----
  {
    id: "exodia",
    name: "Exodia",
    requiredCardTypes: [
      "distillation_column",
      "cracker",
      "steam_reformer",
      "mixer",
      "polymerizer",
      "petrochemical_complex",
    ],
    inputs: { oil: 2, natgas: 1 },
    outputs: { fuel: 3, asphalt: 1, chemicals: 1, plastic: 1 },
    note: "The complete refining-and-petrochemical line, assembled as one.",
  },

  // ---------------- Sequence: [grinder, forming_machine] — Pulp Mill ----------------
  {
    id: "pulp_packaging",
    name: "Pulp Packaging",
    requiredCardTypes: ["grinder", "forming_machine"],
    inputs: { wood: 1 },
    outputs: { packaging: 1 },
  },

  // ---- Sequence: [forming_machine, assembler] — Factory / Textile Mill ----
  {
    id: "textile_from_agriculture",
    name: "Weave Plant Fiber",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { agriculture: 1 },
    outputs: { textiles: 1 },
  },
  {
    id: "textile_from_livestock",
    name: "Weave Wool",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: {},
    requires: { livestock: 3 },
    outputs: { textiles: 1 },
    note: "Needs 3 livestock (not consumed).",
  },
  {
    id: "textile_from_plastic",
    name: "Synthetic Textiles",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { plastic: 1 },
    outputs: { textiles: 1 },
  },
  {
    id: "factory_clothing",
    name: "Sew Clothing",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { textiles: 1 },
    outputs: { clothing: 1 },
    prestige: 4,
  },
  {
    id: "factory_pharma",
    name: "Formulate Pharmaceutical",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { chemicals: 1 },
    outputs: { pharmaceuticals: 1 },
    prestige: 6,
  },
  {
    id: "factory_machinery",
    name: "Assemble Machinery",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { plastic: 1, steel: 1, alloy: 1, electronics: 1 },
    outputs: { machinery: 1 },
    prestige: 10,
    note: "Producing machinery also grants a free machinery-tagged card from the deck (you keep the resource).",
  },
  {
    id: "factory_transportation",
    name: "Assemble Vehicles",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { plastic: 1, glass: 1, steel: 1, alloy: 1, electronics: 1 },
    outputs: { transportation: 1 },
    prestige: 14,
    note: "Producing vehicles also grants a free vehicles-tagged card from the deck (you keep the resource).",
  },
  {
    id: "factory_electronics",
    name: "Fabricate Electronics",
    requiredCardTypes: ["forming_machine", "assembler"],
    inputs: { plastic: 1, alloy: 1, glass: 1, chemicals: 1 },
    outputs: { electronics: 1 },
    prestige: 5,
  },

  // ---------------- Sequence: [grinder, furnace] — Electric Arc Furnace ----------------
  {
    id: "eaf_steel",
    name: "Electric Arc Steel",
    requiredCardTypes: ["grinder", "furnace"],
    inputs: { metal: 1, natgas: 1 },
    outputs: { steel: 1 },
  },
  {
    id: "eaf_alloy",
    name: "Alloy Smelting",
    requiredCardTypes: ["grinder", "furnace"],
    inputs: { metal: 1 },
    outputs: { alloy: 1 },
  },

  // ---------------- Sequence: [mixer, furnace] — Blast / Glass Furnace ----------------
  {
    id: "blast_steel",
    name: "Blast Furnace Steel",
    requiredCardTypes: ["mixer", "furnace"],
    inputs: { metal: 1, coal: 1 },
    outputs: { steel: 1 },
  },
  {
    id: "glass_furnace_glass",
    name: "Melt Glass",
    requiredCardTypes: ["mixer", "furnace"],
    inputs: { sand: 1 },
    outputs: { glass: 1 },
  },

  // ---------------- Sequence: [furnace, mixer] — Concrete Batch Plant ----------------
  {
    id: "concrete_batch",
    name: "Batch Concrete",
    requiredCardTypes: ["furnace", "mixer"],
    // v6: concrete consumes 2 sand (was 1) to make it a little less
    // profitable — its market price is deliberately left unchanged.
    inputs: { sand: 2, coal: 1 },
    outputs: { concrete: 1 },
    note: "Note the order: Furnace then Mixer (the reverse of the Blast/Glass Furnace sequence).",
  },

  // ---------------- Construction: buildings (standalone starter card) ----------------
  {
    id: "construction_buildings",
    name: "Construct Building",
    requiredCardTypes: ["construction"],
    inputs: { concrete: 1, steel: 1, glass: 1, lumber: 1 },
    outputs: { buildings: 1 },
    prestige: 8,
    note: "Every player starts with one Construction card.",
  },
];

export const RECIPE_MAP: Record<string, RecipeDefinition> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
);

export function getRecipe(id: string): RecipeDefinition {
  const def = RECIPE_MAP[id];
  if (!def) throw new Error(`Unknown recipe: ${id}`);
  return def;
}
