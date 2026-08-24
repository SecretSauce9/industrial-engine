// Resource definitions and price ladders — the central economic balance file.
//
// Price ladder mechanics (see src/engine/market.ts):
//   buyPrice  = ladder[capacity - stock]          (scarcer -> further right -> pricier)
//   sellPrice = ladder[capacity - stock - 1] - 1  (one-credit bid/ask spread)
//
// v3 market dynamics — ELASTIC equilibrium drift. At the end of each round
// every resource moves toward its equilibrium stock by
//   step = min(ceil(|equilibrium - stock| / 2), driftMax)
// so markets snap back harder the further they are pushed. One player working
// a lane sustains a medium margin; two players saturate it to a low margin.
//
// v3 pricing — bigger gaps between production stages. Producing an
// intermediate from purchased raws clears ~4-6 credits in the first cycles
// (~50% of the component-card investment); finished goods are priced off the
// full purchase cost of their intermediate inputs plus a margin, with the big
// prestige products (machinery/vehicles) near cash-parity when every input is
// bought at market.
//
// Flavor text is written in the register of Vaclav Smil's "How the World
// Really Works": materials-and-energy first, quantitative, and tied to the
// production sequences that turn each resource into the next.

import type { ResourceDefinition } from "../types";

export const MARKET_CAPACITY = 12;

function res(
  id: string,
  name: string,
  category: ResourceDefinition["category"],
  priceLadder: number[],
  initialStock: number,
  equilibrium: number,
  driftMax: number,
  flavor: string,
): ResourceDefinition {
  return {
    id,
    name,
    category,
    priceLadder,
    initialStock,
    capacity: MARKET_CAPACITY,
    equilibrium,
    driftMax,
    flavor,
  };
}

// Raw: start plentiful (cheap first-cycle inputs), equilibrate at 6.
const RAW = { stock: 10, eq: 6, drift: 3 };
// Intermediates: equilibrate at 6 with a moderate snap.
const MID = { stock: 6, eq: 6, drift: 2 };
// Staples (electricity/fuel/food) are burned constantly: bigger pool, hard snap.
const STAPLE = { stock: 8, eq: 8, drift: 3 };
// Fuel equilibrates one lower than the other staples (v7).
const FUEL_EQ = 7;
// Finished: scarce, equilibrate at 3.
const FIN = { stock: 2, eq: 3, drift: 2 };

export const RESOURCES: ResourceDefinition[] = [
  // ---- Raw ----
  res(
    "oil",
    "Oil",
    "raw",
    [2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "The densest energy source humanity ever tapped: a single kilogram holds more usable work than a day of hard human labor. Distilled and cracked, it becomes fuel and nearly every synthetic molecule downstream.",
  ),
  res(
    "coal",
    "Coal",
    "raw",
    [1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "The fuel that built the industrial age and still smelts most of its steel. In the blast furnace it is not merely heat but the carbon that tears oxygen away from iron ore.",
  ),
  res(
    "natgas",
    "Natural Gas",
    "raw",
    [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "Mostly methane, the cleanest-burning fossil fuel — and the feedstock a Steam Reformer strips for hydrogen, the first step toward the ammonia that fertilizes half the planet's harvest.",
  ),
  res(
    "agriculture",
    "Agriculture",
    "raw",
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "Grain and oilseed: photosynthesis banked as calories. Milled into food, fermented for ethanol, or reduced to the feedstock a Biochemical Plant draws on.",
  ),
  res(
    "livestock",
    "Livestock",
    "raw",
    [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "Animals turn feed into protein, hide, and fiber at a steep energy discount — several calories in for every one out. A Slaughterhouse renders them into food and textiles in a single pass.",
  ),
  res(
    "metal",
    "Metal",
    "raw",
    [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "Ore is common; the metal locked inside it is not. Freeing it demands furnaces and enormous energy, which is why a tonne of finished metal embodies far more than a tonne of rock.",
  ),
  res(
    "wood",
    "Wood",
    "raw",
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "The oldest structural material and still the cheapest carbon we deliberately grow. A Grinder shreds it to pulp; a saw squares it into lumber.",
  ),
  res(
    "sand",
    "Sand",
    "raw",
    [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
    RAW.stock,
    RAW.eq,
    RAW.drift,
    "The most-mined solid on Earth after we stopped counting water — the literal foundation of concrete and the raw stuff of glass. Improbably, the world is running short of the right kind.",
  ),

  // ---- Intermediate (big markup over raw-chain cost) ----
  res(
    "plastic",
    "Plastic",
    "intermediate",
    [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    MID.stock,
    MID.eq,
    MID.drift,
    "Fossil carbon rearranged into long chains: light, cheap, and durable to a fault. A Cracker breaks oil into monomers that a Polymerizer stitches back together.",
  ),
  res(
    "concrete",
    "Concrete",
    "intermediate",
    [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
    MID.stock,
    MID.eq,
    MID.drift,
    "Humanity places more of it than any material but water — billions of tonnes a year of sand, gravel, and fired cement, mixed and set. Cheap, grey, and utterly load-bearing.",
  ),
  res(
    "glass",
    "Glass",
    "intermediate",
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    MID.stock,
    MID.eq,
    MID.drift,
    "Melted sand, transparent and ancient. The Furnace does the work — drive silica past its softening point and it flows, then freezes into a solid that never quite stops being a liquid.",
  ),
  res(
    "lumber",
    "Lumber",
    "intermediate",
    [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    MID.stock,
    MID.eq,
    MID.drift,
    "Wood sawn, sized, and dried. Structurally efficient and, unlike steel or cement, it locks carbon away instead of releasing it.",
  ),
  res(
    "steel",
    "Steel",
    "intermediate",
    [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    MID.stock,
    MID.eq,
    MID.drift,
    "Iron married to a sliver of carbon in the Blast Furnace — the alloy that frames the modern world. Nothing of comparable strength is produced in greater tonnage.",
  ),
  res(
    "alloy",
    "Alloy",
    "intermediate",
    [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    MID.stock,
    MID.eq,
    MID.drift,
    "Base metal blended with others to buy hardness, heat tolerance, or corrosion resistance. Here it is the recipe, not the mass, that carries the value.",
  ),
  res(
    "asphalt",
    "Asphalt",
    "intermediate",
    // v8: shifted down ~1 to offset the extra asphalt from Mixer-coker refining.
    [4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12],
    MID.stock,
    MID.eq,
    MID.drift,
    "The heavy residue left at the bottom of the barrel once the light fuels are cracked away. Spread thin, it becomes the roads that carry everything else — and the roads you lay to a market.",
  ),
  res(
    "fertilizer",
    "Fertilizer",
    "intermediate",
    [7, 8, 8, 9, 9, 10, 11, 11, 12, 13, 14, 15],
    MID.stock,
    MID.eq,
    MID.drift,
    "Synthetic nitrogen, fixed from air and natural gas in the Ammonia Plant. Roughly half the nitrogen atoms in your body were first bound by this one industrial reaction.",
  ),
  res(
    "chemicals",
    "Chemicals",
    "intermediate",
    // v10: chemicals are at least as valuable as plastic (same ladder) — both
    // are petrochemical products, and chemicals feed the pharmaceutical chain.
    [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    MID.stock,
    MID.eq,
    MID.drift,
    "The precise intermediates industry runs on — solvents, reagents, feedstocks. A Biochemical Plant or a petrochemical route converts crude inputs into exact molecules.",
  ),
  res(
    "food",
    "Food",
    "intermediate",
    [2, 2, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8],
    STAPLE.stock,
    STAPLE.eq,
    STAPLE.drift,
    "Processed calories, shelf-stable and portable. Every step from field to table spends energy, so the food on the shelf embodies far more than it will ever return.",
  ),
  res(
    "electricity",
    "Electricity",
    "intermediate",
    [1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5],
    STAPLE.stock,
    STAPLE.eq,
    STAPLE.drift,
    "The most useful and least storable form of energy — generated the instant it is consumed. Grids exist because we cannot warehouse it, only balance supply against demand.",
  ),
  res(
    "fuel",
    "Fuel",
    "intermediate",
    [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7],
    STAPLE.stock,
    FUEL_EQ,
    STAPLE.drift,
    "Refined hydrocarbons, energy-dense and pourable. What moves the vehicles — and what fires a turbine's black start when the grid it would normally lean on is dark.",
  ),
  res(
    "textiles",
    "Textiles",
    "intermediate",
    [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    MID.stock,
    MID.eq,
    MID.drift,
    "Fiber spun and woven — from livestock wool or synthetic plastic. Cheap cloth was among the very first triumphs of mechanized industry.",
  ),
  res(
    "packaging",
    "Packaging",
    "intermediate",
    [6, 7, 7, 8, 8, 9, 10, 10, 11, 12, 13, 14],
    MID.stock,
    MID.eq,
    MID.drift,
    "The unglamorous layer that lets goods survive shipping and the shelf. Invisible until it is missing, it is quietly consumed with every packaged good you sell.",
  ),

  // ---- Finished (priced off full intermediate purchase cost + margin) ----
  res(
    "buildings",
    "Buildings",
    "finished",
    [42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 78],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "Assembled from concrete, glass, steel, and lumber — the materials civilization pours, melts, smelts, and saws in the greatest quantity. Shelter is simply the sum of all four.",
  ),
  res(
    "machinery",
    "Machinery",
    "finished",
    [70, 74, 78, 82, 86, 90, 94, 98, 102, 107, 112, 117],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "The tools that make everything else — steel, alloy, plastic, and electronics assembled into capability. Being first to produce any good is a claim no rival can take from you.",
  ),
  res(
    "transportation",
    "Vehicles",
    "finished",
    [75, 79, 83, 87, 91, 95, 99, 103, 107, 112, 117, 122],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "Glass, steel, alloy, plastic, and electronics assembled into motion. Vehicles are the single largest reason crude oil is refined at all.",
  ),
  res(
    "electronics",
    "Electronics",
    "finished",
    [46, 48, 50, 52, 54, 56, 58, 60, 62, 65, 68, 71],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "Ultra-purified silicon and metals arranged with nanometer precision — the greatest value packed into the least mass of anything industry makes.",
  ),
  res(
    "pharmaceuticals",
    "Pharmaceuticals",
    "finished",
    [19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 31, 33],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "Chemicals refined into molecules that heal, priced for the research behind them rather than the grams in the vial. Packaging and regulation often cost more than the active compound.",
  ),
  res(
    "clothing",
    "Clothing",
    "finished",
    [17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 29, 31],
    FIN.stock,
    FIN.eq,
    FIN.drift,
    "Textiles cut and sewn — the finished end of a chain that runs from field or cracker to fiber to cloth. Packaged and branded, it sells far above the cost of its threads.",
  ),
];

export const RESOURCE_MAP: Record<string, ResourceDefinition> =
  Object.fromEntries(RESOURCES.map((r) => [r.id, r]));

export const RESOURCE_IDS = RESOURCES.map((r) => r.id);

export function getResource(id: string): ResourceDefinition {
  const def = RESOURCE_MAP[id];
  if (!def) throw new Error(`Unknown resource: ${id}`);
  return def;
}

/** Elastic drift step toward equilibrium (signed). */
export function elasticDriftStep(
  def: ResourceDefinition,
  stock: number,
): number {
  const diff = def.equilibrium - stock;
  if (diff === 0) return 0;
  const magnitude = Math.min(Math.ceil(Math.abs(diff) / 2), def.driftMax);
  return diff > 0 ? magnitude : -magnitude;
}
