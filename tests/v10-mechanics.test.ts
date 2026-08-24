// Tests for v10: the AI no longer buys duplicate cards, and plastic and
// chemicals are balanced against each other.

import { describe, it, expect } from "vitest";
import { createGame, devTools } from "../src/engine/game";
import { runAiTurn } from "../src/engine/ai";
import { getResource } from "../src/engine/data/resources";
import { getCard } from "../src/engine/data/cards";

describe("v10: plastic vs chemicals balance", () => {
  const eqBuy = (id: string) => {
    const d = getResource(id);
    return d.priceLadder[d.capacity - d.equilibrium];
  };
  const eqSell = (id: string) => {
    const d = getResource(id);
    return d.priceLadder[d.capacity - d.equilibrium - 1] - 1;
  };

  it("chemicals are at least as valuable as plastic", () => {
    expect(eqBuy("chemicals")).toBeGreaterThanOrEqual(eqBuy("plastic"));
    expect(eqSell("chemicals")).toBeGreaterThanOrEqual(eqSell("plastic"));
  });

  it("the plastic and chemicals maker cards cost the same", () => {
    expect(getCard("petrochemical_complex").cost).toBe(
      getCard("polymerizer").cost,
    );
  });
});

describe("v10: AI never buys duplicate cards", () => {
  it("does not buy a card type it already owns", () => {
    let s = createGame({
      seed: "NODUP",
      maxRounds: 10,
      players: [
        { name: "AI", isAi: true, aiDifficulty: "normal" },
        { name: "B", isAi: true, aiDifficulty: "normal" },
      ],
    });
    const aiId = s.players[s.activePlayerIndex].id;
    // Give the AI a working factory board and plenty of cash, then fill the
    // whole marketplace with duplicates of cards it holds.
    s = devTools.grantCard(s, aiId, "forming_machine");
    s = devTools.grantCard(s, aiId, "assembler");
    s = devTools.addCash(s, aiId, 200);
    s = devTools.addResource(s, aiId, "chemicals", 3);
    s.cardMarket = s.cardMarket.map(() => "forming_machine");

    const r = runAiTurn(s);
    const ai = r.state.players.find((p) => p.id === aiId)!;
    const forming = ai.cards.filter(
      (c) => c.cardTypeId === "forming_machine" && !c.borrowedFrom,
    ).length;
    expect(forming).toBe(1); // never bought the duplicate
  });

  it("full AI games end with no duplicate cards held by normal AIs", () => {
    for (const seed of ["A", "B", "C"]) {
      let s = createGame({
        seed,
        maxRounds: 10,
        players: [
          { name: "A", isAi: true, aiDifficulty: "normal" },
          { name: "B", isAi: true, aiDifficulty: "normal" },
        ],
      });
      let guard = 0;
      while (s.status === "active" && guard++ < 500) {
        const r = runAiTurn(s);
        s = r.state;
        if (r.hitGuard) break;
      }
      for (const p of s.players) {
        const counts = new Map<string, number>();
        for (const c of p.cards) {
          if (c.borrowedFrom || c.cardTypeId === "construction") continue;
          counts.set(c.cardTypeId, (counts.get(c.cardTypeId) ?? 0) + 1);
        }
        for (const n of counts.values()) expect(n).toBeLessThanOrEqual(1);
      }
    }
  });
});
