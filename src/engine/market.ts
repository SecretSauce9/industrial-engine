// Sequential market pricing — pure functions, no state mutation.
//
//   buy one unit:  buyIndex  = capacity - stock; price = ladder[buyIndex]
//   sell one unit: sellIndex = capacity - stock - 1; revenue = max(0, ladder[sellIndex] - spread)
//
// Multi-unit transactions are processed one unit at a time, recalculating the
// price after every unit. Buying then immediately selling always loses the
// spread: after buying at ladder[C-S], stock is S-1, so the sell index is
// C-(S-1)-1 = C-S — the same ladder slot — and revenue is that price minus 1.

import type { MarketQuote, ResourceId } from "./types";
import { getResource } from "./data/resources";
import { GAME_CONFIG } from "./data/config";

/** One-unit buy price at the given stock, or null when stock is 0. */
export function unitBuyPrice(
  resourceId: ResourceId,
  stock: number,
): number | null {
  const def = getResource(resourceId);
  if (stock <= 0) return null;
  return def.priceLadder[def.capacity - stock];
}

/** One-unit sell revenue at the given stock, or null when the market is full. */
export function unitSellPrice(
  resourceId: ResourceId,
  stock: number,
): number | null {
  const def = getResource(resourceId);
  if (stock >= def.capacity) return null;
  return Math.max(
    0,
    def.priceLadder[def.capacity - stock - 1] - GAME_CONFIG.marketSpread,
  );
}

/**
 * Quote a sequential multi-unit buy or sell.
 * `units` in the result is clamped to what the market can actually absorb.
 */
export function calculateMarketQuote(
  resourceId: ResourceId,
  kind: "buy" | "sell",
  requested: number,
  stock: number,
): MarketQuote {
  const def = getResource(resourceId);
  const unitPrices: number[] = [];
  let s = stock;
  let total = 0;
  for (let i = 0; i < requested; i++) {
    if (kind === "buy") {
      const p = unitBuyPrice(resourceId, s);
      if (p === null) break;
      unitPrices.push(p);
      total += p;
      s -= 1;
    } else {
      const p = unitSellPrice(resourceId, s);
      if (p === null) break;
      unitPrices.push(p);
      total += p;
      s += 1;
    }
  }
  if (s < 0 || s > def.capacity) {
    throw new Error(
      `Market quote produced invalid stock ${s} for ${resourceId}`,
    );
  }
  return {
    resourceId,
    kind,
    requested,
    units: unitPrices.length,
    unitPrices,
    total,
  };
}
