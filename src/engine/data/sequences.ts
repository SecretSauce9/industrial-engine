// Sequence definitions (v3): ordered card combinations that stand in for the
// removed facility cards. A sequence's KEY is its card types joined by ">".
// Order matters: mixer>furnace (Blast/Glass Furnace) is a different sequence
// from furnace>mixer (Concrete Batch Plant).
//
// Each facility carries an ICON (used by the Sequence Assembly quick-load
// chips) and Smil-style FLAVOR text tying it to its production sequence.

import type { CardTypeId } from "../types";

export interface SequenceDefinition {
  key: string;
  cards: CardTypeId[];
  /** The facility this sequence replaces/represents (shown in the UI). */
  name: string;
  /** Emoji icon shown on the quick-load chip and flavor box. */
  icon: string;
  /** Smil-style flavor text. */
  flavor: string;
}

export function sequenceKey(cards: readonly CardTypeId[]): string {
  return cards.join(">");
}

function seq(
  cards: CardTypeId[],
  name: string,
  icon: string,
  flavor: string,
): SequenceDefinition {
  return { key: sequenceKey(cards), cards, name, icon, flavor };
}

/** Multi-card (and named single-card) sequences that replace old facilities. */
export const SEQUENCES: SequenceDefinition[] = [
  seq(
    ["grinder"],
    "Grain Mill / Sawmill",
    "🪚",
    "One Grinder standing in for two ancient trades — milling grain into food and sawing logs into lumber. Reduction is the whole art.",
  ),
  seq(
    ["forming_machine"],
    "Plastics Extruder/Molder",
    "🧴",
    "A Forming Machine shaping molten plastic into product — or into the packaging that every finished good is sold in.",
  ),
  seq(
    ["fermenter"],
    "Cheesemaker",
    "🧀",
    "A lone Fermenter set to dairy: microbes turning milk into cheese, no heat and no fuel required.",
  ),
  seq(
    ["fermenter", "distillation_column"],
    "Biochemical Plant",
    "🧫",
    "Ferment, then distil — living chemistry followed by a Distillation Column's sharp separation, yielding refined chemicals from farm sugars.",
  ),
  seq(
    ["distillation_column", "cracker", "steam_reformer"],
    "Refinery",
    "🛢️",
    "The full refinery train: distil the crude, crack its heavy fractions, reform for extra hydrogen — oil becomes fuel and asphalt.",
  ),
  seq(
    ["steam_reformer", "mixer"],
    "Ammonia Plant",
    "🌱",
    "Reform natural gas for hydrogen, then mix it into fixed nitrogen. Roughly half the world's food leans on this one reaction.",
  ),
  seq(
    ["distillation_column", "cracker"],
    "Refinery",
    "🛢️",
    "Distil and crack — the core of any refinery, separating crude and breaking its heavy ends down into fuel.",
  ),
  seq(
    ["distillation_column", "cracker", "mixer"],
    "Refinery (Coker)",
    "🛢️",
    "A Mixer on the tail of the refinery blends the heavy bottoms into extra asphalt.",
  ),
  seq(
    ["distillation_column", "cracker", "steam_reformer", "mixer"],
    "Refinery (Reformed Coker)",
    "🛢️",
    "Steam reforming for extra fuel and a Mixer for extra asphalt — the refinery worked to its limit.",
  ),
  seq(
    [
      "distillation_column",
      "cracker",
      "steam_reformer",
      "mixer",
      "polymerizer",
      "petrochemical_complex",
    ],
    "Exodia",
    "🔱",
    "The forbidden assembly — distillation, cracking, reforming, mixing, polymerizing, and petrochemistry chained into a single monstrous line that pours out fuel, asphalt, chemicals, and plastic at once.",
  ),
  seq(
    ["distillation_column", "cracker", "polymerizer"],
    "Plastics Refinery",
    "🧪",
    "Refine the oil, then chain the light monomers into polymer — the route from a barrel of crude all the way to solid plastic.",
  ),
  seq(
    ["grinder", "fermenter", "distillation_column"],
    "Ethanol Plant",
    "🥃",
    "Grind the grain, ferment its sugars, distil the wash — biofuel that must forever compete with dirt-cheap fossil energy.",
  ),
  seq(
    ["cracker", "polymerizer"],
    "Steam Cracker (Plastics)",
    "♨️",
    "A Cracker feeding a Polymerizer: split hydrocarbons into monomers and immediately chain them into plastic.",
  ),
  seq(
    ["cracker", "petrochemical_complex"],
    "Steam Cracker (Chemicals)",
    "⚗️",
    "The same crack, routed into a Petrochemical Complex for base chemicals rather than plastic.",
  ),
  seq(
    ["grinder", "forming_machine"],
    "Pulp Mill",
    "🧻",
    "Grind wood to pulp, then form it — the paper-and-packaging end of the forest.",
  ),
  seq(
    ["forming_machine", "assembler"],
    "Factory / Textile Mill",
    "🏭",
    "The general assembly line: form the parts, assemble the whole. It sews textiles and clothing and builds pharmaceuticals, electronics, machinery, and vehicles alike.",
  ),
  seq(
    ["distillation_column", "cracker", "petrochemical_complex"],
    "Petrochemical Refinery",
    "🔬",
    "A full refinery feeding a petrochemical complex — the deepest route from crude oil down to specialty chemicals.",
  ),
  seq(
    ["grinder", "furnace"],
    "Electric Arc Furnace",
    "⚡",
    "A Grinder charging scrap into a Furnace run on electricity — steel remade from steel that already exists.",
  ),
  seq(
    ["mixer", "furnace"],
    "Blast / Glass Furnace",
    "🔥",
    "Mix the charge, then fire it: iron ore and coal become steel, or sand becomes glass, in the same roaring heat.",
  ),
  seq(
    ["furnace", "mixer"],
    "Concrete Batch Plant",
    "🏗️",
    "Fire the cement, then mix in sand — the order reversed from the Blast Furnace. Out comes the grey stuff we pour more of than anything but water.",
  ),
];

export const SEQUENCE_MAP: Record<string, SequenceDefinition> =
  Object.fromEntries(SEQUENCES.map((s) => [s.key, s]));

/** Display name for any sequence key (falls back to the card's own name). */
export function sequenceName(key: string): string | undefined {
  return SEQUENCE_MAP[key]?.name;
}

/** Emoji icon for a sequence key, if it names a facility. */
export function sequenceIcon(key: string): string | undefined {
  return SEQUENCE_MAP[key]?.icon;
}
