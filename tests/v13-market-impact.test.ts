// Tests for v13: the AI's board-profit estimate models its own market impact —
// producing many units of one good into a thin market is valued along the
// descending sell ladder, not at the top price for every unit.

import { describe, it, expect, afterEach } from "vitest";
import { createGame, devTools } from "../src/engine/game";
import {
  runAiTurn,
  evaluatePosition,
  setMarketImpactModel,
} from "../src/engine/ai";

// The model is a global balance knob (default on); always restore it so one
// test can't leak its setting into the next.
afterEach(() => setMarketImpactModel(true));

function floodBoard() {
  let s = createGame({
    seed: "FLOOD",
    maxRounds: 10,
    players: [
      { name: "A", isAi: true, aiDifficulty: "normal" },
      { name: "B", isAi: true, aiDifficulty: "normal" },
    ],
  });
  s.quiet = true;
  const id = s.players[0].id;
  // Three lumber mills all dump into the single lumber market.
  s = devTools.grantCard(s, id, "grinder");
  s = devTools.grantCard(s, id, "grinder");
  s = devTools.grantCard(s, id, "grinder");
  s = devTools.addResource(s, id, "wood", 9);
  return { s, id };
}

describe("v13: own-market impact in board valuation", () => {
  it("lowers the engine potential of a market-flooding board", () => {
    const { s, id } = floodBoard();

    setMarketImpactModel(false);
    const off = evaluatePosition(s, id).engine;
    setMarketImpactModel(true);
    const on = evaluatePosition(s, id).engine;

    // Flooding one thin market must be worth strictly less than pricing every
    // unit at the top of the ladder.
    expect(on).toBeLessThan(off);
    expect(on).toBeGreaterThan(0); // still a productive board, just not infinite
  });

  it("does not penalize a single, absorbable activation", () => {
    // One modest activation sells within the ladder's depth, so the model
    // should leave its valuation essentially unchanged.
    let s = createGame({
      seed: "ONE",
      maxRounds: 10,
      players: [
        { name: "A", isAi: true, aiDifficulty: "normal" },
        { name: "B", isAi: true, aiDifficulty: "normal" },
      ],
    });
    s.quiet = true;
    const id = s.players[0].id;
    s = devTools.grantCard(s, id, "grinder");
    s = devTools.addResource(s, id, "wood", 2);

    setMarketImpactModel(false);
    const off = evaluatePosition(s, id).engine;
    setMarketImpactModel(true);
    const on = evaluatePosition(s, id).engine;
    expect(Math.abs(on - off)).toBeLessThan(0.3);
  });

  it("games stay healthy and deterministic with the model on", () => {
    setMarketImpactModel(true);
    const play = () => {
      let s = createGame({
        seed: "MI-HEALTH",
        maxRounds: 10,
        players: [
          { name: "P0", isAi: true, aiDifficulty: "hard" as const },
          { name: "P1", isAi: true, aiDifficulty: "hard" as const },
        ],
      });
      s.quiet = true;
      let guard = 0;
      let hits = 0;
      while (s.status === "active" && guard++ < 60) {
        const r = runAiTurn(s);
        if (r.hitGuard) hits++;
        s = r.state;
      }
      return { s, hits };
    };
    const a = play();
    const b = play();
    expect(a.s.status).toBe("finished");
    expect(a.hits).toBe(0);
    expect(a.s.market).toEqual(b.s.market);
  });
});
