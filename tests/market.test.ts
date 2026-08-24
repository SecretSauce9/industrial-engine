// Sequential market pricing, spread, edge conditions, and the v2
// packaging-on-sale rule.

import { describe, it, expect } from "vitest";
import {
  buyResource,
  sellResource,
  calculateMarketQuote,
} from "../src/engine/game";
import { getResource } from "../src/engine/data/resources";
import { newGame, active, activeId, give, fund } from "./helpers";

describe("resource market", () => {
  it("buying one resource reduces cash and market stock correctly", () => {
    const s0 = newGame();
    const pid = activeId(s0);
    const def = getResource("oil");
    const stock = s0.market.oil;
    const expectedPrice = def.priceLadder[def.capacity - stock];
    const cash0 = active(s0).cash;

    const s1 = buyResource(s0, pid, "oil", 1);
    expect(active(s1).cash).toBe(cash0 - expectedPrice);
    expect(s1.market.oil).toBe(stock - 1);
    expect(active(s1).resources.oil).toBe(1);
    expect(s0.market.oil).toBe(stock); // original untouched
  });

  it("buying several units applies sequentially increasing ladder prices", () => {
    const s0 = fund(newGame(), 200);
    const pid = activeId(s0);
    const def = getResource("oil");
    const stock = s0.market.oil; // 10
    const p0 = def.priceLadder[def.capacity - stock];
    const p1 = def.priceLadder[def.capacity - (stock - 1)];
    const p2 = def.priceLadder[def.capacity - (stock - 2)];

    const quote = calculateMarketQuote("oil", "buy", 3, stock);
    expect(quote.unitPrices).toEqual([p0, p1, p2]);
    expect(quote.total).toBe(p0 + p1 + p2);

    const cash0 = active(s0).cash;
    const s1 = buyResource(s0, pid, "oil", 3);
    expect(active(s1).cash).toBe(cash0 - quote.total);
    expect(s1.market.oil).toBe(stock - 3);
    expect(p1).toBeGreaterThanOrEqual(p0);
    expect(p2).toBeGreaterThanOrEqual(p1);
  });

  it("selling several units applies sequential prices and the spread", () => {
    let s = give(newGame(), { steel: 3 });
    const pid = activeId(s);
    const def = getResource("steel");
    const stock = s.market.steel; // 6
    const r0 = Math.max(0, def.priceLadder[def.capacity - stock - 1] - 1);
    const r1 = Math.max(0, def.priceLadder[def.capacity - (stock + 1) - 1] - 1);
    const r2 = Math.max(0, def.priceLadder[def.capacity - (stock + 2) - 1] - 1);

    const quote = calculateMarketQuote("steel", "sell", 3, stock);
    expect(quote.unitPrices).toEqual([r0, r1, r2]);

    const cash0 = active(s).cash;
    s = sellResource(s, pid, "steel", 3);
    expect(active(s).cash).toBe(cash0 + r0 + r1 + r2);
    expect(s.market.steel).toBe(stock + 3);
    expect(active(s).resources.steel).toBe(0);
    expect(r1).toBeLessThanOrEqual(r0);
    expect(r2).toBeLessThanOrEqual(r1);
  });

  it("buying and immediately selling cannot create money (any resource, any stock)", () => {
    const s0 = fund(newGame(), 500);
    for (const rid of Object.keys(s0.market)) {
      const def = getResource(rid);
      for (let stock = 1; stock <= def.capacity; stock++) {
        const buy = calculateMarketQuote(rid, "buy", 1, stock);
        const sell = calculateMarketQuote(rid, "sell", 1, stock - 1);
        expect(sell.total).toBeLessThan(buy.total);
      }
    }
    const pid = activeId(s0);
    let s = buyResource(s0, pid, "oil", 1);
    s = sellResource(s, pid, "oil", 1);
    expect(active(s).cash).toBeLessThan(active(s0).cash);
  });

  it("cannot buy from an empty market", () => {
    const s0 = newGame();
    s0.market.oil = 0;
    expect(() => buyResource(s0, activeId(s0), "oil", 1)).toThrow();
    const quote = calculateMarketQuote("oil", "buy", 2, 0);
    expect(quote.units).toBe(0);
    expect(quote.total).toBe(0);
  });

  it("cannot sell into a full market", () => {
    let s = give(newGame(), { oil: 2 });
    s.market.oil = getResource("oil").capacity;
    expect(() => sellResource(s, activeId(s), "oil", 1)).toThrow();
    const quote = calculateMarketQuote("oil", "sell", 1, 12);
    expect(quote.units).toBe(0);
  });

  it("rejects zero, negative, and fractional quantities", () => {
    const s = fund(give(newGame(), { oil: 5 }), 100);
    const pid = activeId(s);
    expect(() => buyResource(s, pid, "oil", 0)).toThrow();
    expect(() => buyResource(s, pid, "oil", -2)).toThrow();
    expect(() => buyResource(s, pid, "oil", 1.5)).toThrow();
    expect(() => sellResource(s, pid, "oil", 0)).toThrow();
  });

  it("cannot buy with insufficient cash", () => {
    const s = newGame();
    const p = active(s);
    p.cash = 0;
    expect(() => buyResource(s, p.id, "oil", 1)).toThrow();
  });

  it("selling pharmaceuticals/electronics/clothing consumes 1 packaging per unit", () => {
    for (const rid of ["pharmaceuticals", "electronics", "clothing"]) {
      let s = give(newGame(), { [rid]: 2, packaging: 3 });
      const pid = activeId(s);
      const cash0 = active(s).cash;
      s = sellResource(s, pid, rid, 2);
      expect(active(s).resources[rid]).toBe(0);
      expect(active(s).resources.packaging).toBe(1);
      expect(active(s).cash).toBeGreaterThan(cash0);
    }
  });

  it("selling packaged goods is blocked without enough packaging", () => {
    let s = give(newGame(), { clothing: 2, packaging: 1 });
    const pid = activeId(s);
    expect(() => sellResource(s, pid, "clothing", 2)).toThrow(/packaging/);
    // Selling within the packaging budget works.
    s = sellResource(s, pid, "clothing", 1);
    expect(active(s).resources.packaging).toBe(0);
  });

  it("selling non-packaged goods needs no packaging", () => {
    let s = give(newGame(), { buildings: 1, machinery: 1, transportation: 1 });
    const pid = activeId(s);
    s = sellResource(s, pid, "buildings", 1);
    s = sellResource(s, pid, "machinery", 1);
    s = sellResource(s, pid, "transportation", 1);
    expect(active(s).resources.packaging).toBe(0); // never had or needed any
  });
});
