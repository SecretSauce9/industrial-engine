// Player classes (v9): optional asymmetric setups chosen at game start.
// "No class" is the neutral default. The mechanical effects live in game.ts
// (searched by classId); this file holds the display metadata and the few
// shared constants.

import type { ClassId } from "../types";

export interface ClassDef {
  id: ClassId;
  name: string;
  description: string;
}

export const CLASSES: ClassDef[] = [
  {
    id: "none",
    name: "No class",
    description: "Standard rules, no bonuses or drawbacks.",
  },
  {
    id: "equilibrist",
    name: "Equilibrist",
    description:
      "Receives a second market-maker drift tick each turn (a preview of the next player's tick, which they still receive).",
  },
  {
    id: "regenerist",
    name: "Regenerist",
    description:
      "Cannot buy resources; can only produce raw agriculture and livestock, but produces intermediates and finished freely. Starts with Farm, Ranch, Fermenter and +2 asphalt. All activation outputs +1.",
  },
  {
    id: "trader",
    name: "Trader",
    description:
      "Road rebates pay $4 instead of $2. Starts with 8 asphalt. All prestige earned is halved.",
  },
  {
    id: "hipster",
    name: "Hipster",
    description:
      "Doubles the intermediate output of any sequence the first time it is used. Cannot take the first seat in turn order.",
  },
  {
    id: "parasite",
    name: "Parasite",
    description:
      "Tableau limited to 6, but may borrow up to 2 cards from each other player, borrowing costs $1, and starts with roads to every other player.",
  },
  {
    id: "landBaron",
    name: "Land Baron",
    description:
      "Produces +1 extra of raw resources, and selling only moves a resource's price once per two units sold.",
  },
  {
    id: "liquidator",
    name: "Liquidator",
    description:
      "Tableau limited to 6, but selling a card returns 80% of its printed cost (rounded up).",
  },
  {
    id: "lineBoss",
    name: "Line Boss",
    description:
      "Owes 1 food only every 4 activations, and machinery activations cost 1 electricity per 2 activations instead of every time.",
  },
];

export const CLASS_MAP: Record<string, ClassDef> = Object.fromEntries(
  CLASSES.map((c) => [c.id, c]),
);
