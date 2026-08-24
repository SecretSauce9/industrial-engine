// Card definitions (v3): costs, deck counts, categories, tags.
//
// The old facility cards (Refinery, Factory, Sawmill, ...) are replaced by
// SEQUENCES of the component cards below (see data/sequences.ts). Cards not
// replaced (production, Ranch, Solar Panels, Turbine/Generator,
// Slaughterhouse, Steam Reformer, Petrochemical Complex, Construction) still
// activate on their own.
//
// Tags: production cards are "vehicles", everything else "machinery", except
// Ranch and Solar Panels (untagged). v3 energy cost is 1 unit per ACTIVATION
// (a whole sequence costs 1 electricity, not 1 per card).
//
// Flavor text follows Vaclav Smil's "How the World Really Works" register:
// concrete about materials and energy, and tied to what each card does in a
// production sequence.

import type { CardDefinition, CardTag } from "../types";
import { RECIPES } from "./recipes";

// v8: every card has one fewer copy in the deck than before (tighter deck to
// match the 9-card tableau limit). Construction stays starter-only (0).
const PRODUCTION_COPIES = 3;

function card(
  id: string,
  name: string,
  category: CardDefinition["category"],
  cost: number,
  deckCount: number,
  flavor: string,
  tag?: CardTag,
): CardDefinition {
  const recipeIds = RECIPES.filter((r) => r.requiredCardTypes.includes(id)).map(
    (r) => r.id,
  );
  return { id, name, category, cost, recipeIds, deckCount, tag, flavor };
}

export const CARDS: CardDefinition[] = [
  // ---- Production (tag: vehicles, except Ranch) ----
  card(
    "oil_rig",
    "Oil Rig",
    "production",
    10,
    PRODUCTION_COPIES,
    "A steel derrick and a pump lifting crude from a kilometer down. Nearly everything petrochemical begins at this hole in the ground.",
    "vehicles",
  ),
  card(
    "gas_well",
    "Gas Well",
    "production",
    9,
    PRODUCTION_COPIES,
    "Taps the methane a Steam Reformer will later crack for hydrogen — often the very same field that gives up the oil.",
    "vehicles",
  ),
  card(
    "coal_mine",
    "Coal Mine",
    "production",
    8,
    PRODUCTION_COPIES,
    "Bulk energy, and just as vital, the carbon reductant a Blast Furnace needs to pull oxygen out of iron ore.",
    "vehicles",
  ),
  card(
    "farm",
    "Farm",
    "production",
    9,
    PRODUCTION_COPIES,
    "Sunlight, soil, and water converted into grain. Fertilizer lifts its yield; each harvest draws the field down until it is replenished.",
    "vehicles",
  ),
  card(
    "ranch",
    "Ranch",
    "production",
    9,
    PRODUCTION_COPIES,
    "Grazing land turning cheap forage into livestock. Untagged — it needs neither electricity nor fuel to run.",
  ), // untagged
  card(
    "polymetallic_mine",
    "Polymetallic Mine",
    "production",
    10,
    PRODUCTION_COPIES,
    "One ore body yielding several metals at once. The rock is common; the energy to separate the metals from it is not.",
    "vehicles",
  ),
  card(
    "forest",
    "Forest",
    "production",
    7,
    PRODUCTION_COPIES,
    "Managed woodland felled for timber — the one structural material we regrow on a human timescale.",
    "vehicles",
  ),
  card(
    "excavator",
    "Excavator",
    "production",
    6,
    PRODUCTION_COPIES,
    "Earth-moving on an industrial scale, stripping overburden to reach sand and stone. Cheap to buy, indispensable to build.",
    "vehicles",
  ),

  // ---- Standalone transformation cards ----
  card(
    "turbine_generator",
    "Turbine/Generator",
    "energy",
    12,
    2,
    "Burns fuel or gas to spin a generator — five units of electricity a cycle. Grid start sips a little electricity to spin up; black start burns its own fuel when the grid is dark.",
    "machinery",
  ),
  card(
    "solar_panels",
    "Solar Panels",
    "energy",
    11,
    2,
    "Photovoltaics: sunlight straight to current, no fuel and no moving parts. Untagged, so activating it costs no energy at all.",
  ), // untagged
  card(
    "slaughterhouse",
    "Slaughterhouse",
    "agrifood",
    9,
    2,
    "Renders livestock into food and textiles together — protein and hide from the same animal in one energy-hungry pass.",
    "machinery",
  ),
  card(
    "steam_reformer",
    "Steam Reformer",
    "materials",
    9,
    2,
    "Strips hydrogen from natural gas with high-pressure steam. It feeds the Ammonia Plant for fertilizer and lengthens a Refinery's fuel yield.",
    "machinery",
  ),

  // ---- Sequence component cards ----
  card(
    "grinder",
    "Grinder/Shredder/Cutter",
    "materials",
    7,
    4,
    "The universal size-reducer: it pulps wood, cracks grain, and cuts feedstock for a dozen facilities downstream.",
    "machinery",
  ),
  card(
    "mixer",
    "Mixer",
    "materials",
    7,
    3,
    "Blends and proportions inputs. Paired with a Furnace it batches concrete or glass; paired with a Steam Reformer it makes ammonia fertilizer.",
    "machinery",
  ),
  card(
    "distillation_column",
    "Distillation Column",
    "materials",
    9,
    3,
    "Separates a heated mixture into fractions by boiling point — the beating heart of every Refinery and Biochemical Plant.",
    "machinery",
  ),
  card(
    "forming_machine",
    "Forming Machine",
    "manufacturing",
    8,
    4,
    "Extrudes, molds, and shapes. Alone it forms plastics and packaging; with an Assembler it becomes a Factory or Textile Mill.",
    "machinery",
  ),
  card(
    "assembler",
    "Assembler",
    "manufacturing",
    10,
    4,
    "Fits precisely-made parts into finished goods. With a Forming Machine it assembles clothing, pharmaceuticals, electronics, machinery, and vehicles.",
    "machinery",
  ),
  card(
    "cracker",
    "Cracker",
    "materials",
    10,
    3,
    "Breaks heavy hydrocarbons into lighter, more valuable molecules under heat and pressure — the step that turns crude into fuel and monomers.",
    "machinery",
  ),
  card(
    "polymerizer",
    "Polymerizer",
    "materials",
    9,
    2,
    "Links small monomers into long polymer chains. Downstream of a Cracker, this is where oil finally becomes plastic.",
    "machinery",
  ),
  card(
    "furnace",
    "Furnace",
    "materials",
    9,
    4,
    "Raw heat past 1,500°C. It reduces ore to steel, melts sand to glass, or fires the cement in concrete — depending on what it is sequenced with.",
    "machinery",
  ),
  card(
    "fermenter",
    "Fermenter",
    "agrifood",
    7,
    2,
    "Microbes doing chemistry for free — sugars to alcohol, or on its own, milk to cheese. Slow, cool, and quietly powerful.",
    "machinery",
  ),
  card(
    "petrochemical_complex",
    "Petrochemical Complex",
    "materials",
    9,
    2,
    "The sprawling downstream of a barrel of oil: a Cracker's partner for turning hydrocarbons into the base chemicals everything synthetic starts from.",
    "machinery",
  ),

  // ---- Construction: starter card, one per player, not in the deck ----
  card(
    "construction",
    "Construction",
    "manufacturing",
    9,
    0,
    "The starter facility every player owns — the crew and formwork that turn concrete, glass, steel, and lumber into finished buildings.",
    "machinery",
  ),
];

export const CARD_MAP: Record<string, CardDefinition> = Object.fromEntries(
  CARDS.map((c) => [c.id, c]),
);

export function getCard(id: string): CardDefinition {
  const def = CARD_MAP[id];
  if (!def) throw new Error(`Unknown card: ${id}`);
  return def;
}

/** Full deck as a flat list of card type ids (unshuffled). */
export function buildDeckList(): string[] {
  const deck: string[] = [];
  for (const c of CARDS) {
    for (let i = 0; i < c.deckCount; i++) deck.push(c.id);
  }
  return deck;
}
