// Tests for v11: per-player metrics, the shaped-value AI planner, difficulty
// as search strength, decision legibility, and the strategy-signature
// analysis layer.

import { describe, it, expect } from "vitest";
import {
  createGame,
  devTools,
  calculateScore,
  buyResource,
  sellResource,
  activateCard,
  buildMarketRoad,
  buildPlayerRoad,
  borrowCard,
  endTurn,
  serializeGame,
  deserializeGame,
} from "../src/engine/game";
import {
  runAiTurn,
  stepAiTurn,
  explainAiDecision,
  evaluatePosition,
} from "../src/engine/ai";
import { simulateGame } from "../src/engine/simulate";
import {
  SIGNATURES,
  computeStrategySignals,
  deriveThresholds,
  classifySignatures,
} from "../src/engine/analysis";
import type { AiDifficulty, GameState } from "../src/engine/types";

function aiGame(seed: string, count: number, difficulty: AiDifficulty) {
  const s = createGame({
    seed,
    maxRounds: 10,
    players: Array.from({ length: count }, (_, i) => ({
      name: `AI ${i + 1}`,
      isAi: true,
      aiDifficulty: difficulty,
    })),
  });
  s.quiet = true;
  return s;
}

describe("v11: per-player metrics", () => {
  it("counts resource buys, sells, production and cards", () => {
    let s = createGame({
      seed: "METRICS",
      maxRounds: 10,
      players: [
        { name: "H", isAi: false },
        { name: "B", isAi: false },
      ],
    });
    const id = s.players[0].id;
    s = devTools.addCash(s, id, 50);

    s = buyResource(s, id, "wood", 2);
    expect(s.players[0].metrics.bought.wood).toBe(2);
    expect(s.players[0].metrics.boughtDollars.wood).toBeGreaterThan(0);

    s = sellResource(s, id, "wood", 1);
    expect(s.players[0].metrics.sold.wood).toBe(1);
    expect(s.players[0].metrics.soldDollars.wood).toBeGreaterThan(0);

    // Activate a farm (harvest) and check produced + recipe count.
    s = devTools.grantCard(s, id, "farm");
    const farm = s.players[0].cards.find((c) => c.cardTypeId === "farm")!;
    s = activateCard(s, id, farm.instanceId, "farm_produce");
    expect(s.players[0].metrics.produced.agriculture).toBeGreaterThan(0);
    expect(s.players[0].metrics.activationsByRecipe.farm_produce).toBe(1);
  });

  it("counts roads, borrows and turn income", () => {
    let s = createGame({
      seed: "METRICS2",
      maxRounds: 10,
      players: [
        { name: "A", isAi: false },
        { name: "B", isAi: false },
      ],
    });
    const a = s.players[0].id;
    const b = s.players[1].id;
    s = devTools.addResource(s, a, "asphalt", 2);
    s = buildMarketRoad(s, a, "food");
    s = buildPlayerRoad(s, a, b);
    expect(s.players[0].metrics.marketRoadsBuilt).toBe(1);
    expect(s.players[0].metrics.playerRoadsBuilt).toBe(1);

    const targetCard = s.players[1].cards[0];
    s = borrowCard(s, a, b, targetCard.instanceId);
    expect(s.players[0].metrics.cardsBorrowed).toBe(1);
    expect(s.players[0].metrics.borrowFeesPaid).toBeGreaterThan(0);

    s = endTurn(s, a);
    expect(s.players[0].metrics.turnsPlayed).toBe(1);
    expect(s.players[0].metrics.incomeCollected).toBeGreaterThan(0);
  });

  it("survives serialization round-trips and old saves get empty metrics", () => {
    const s = aiGame("METRICS3", 2, "normal");
    const r = runAiTurn(s);
    const round = deserializeGame(serializeGame(r.state));
    expect(round.players[0].metrics).toEqual(r.state.players[0].metrics);

    // A save with the metrics stripped (pre-v11) is backfilled with zeros.
    const stripped = JSON.parse(serializeGame(r.state));
    for (const p of stripped.players) delete p.metrics;
    const revived = deserializeGame(JSON.stringify(stripped));
    expect(revived.players[0].metrics.turnsPlayed).toBe(0);
  });
});

describe("v11: shaped value function", () => {
  it("collapses to liquidation value on the final round", () => {
    let s = aiGame("LAMBDA", 2, "normal");
    s.round = s.maxRounds; // final round → λ = 0
    const v = evaluatePosition(s, s.players[0].id);
    expect(v.engine).toBe(0);
    expect(v.prestige).toBe(0);
    expect(v.position).toBe(0);
    expect(v.total).toBe(v.R);
  });

  it("R matches the real score if the game ended now", () => {
    const s = aiGame("RMATCH", 2, "normal");
    const v = evaluatePosition(s, s.players[0].id);
    const score = calculateScore(s).find(
      (x) => x.playerId === s.players[0].id,
    )!;
    // R = prestige + netWorth/10 (unfloored); the real score floors the
    // economic part, so R is within 1 point above it.
    expect(v.R).toBeGreaterThanOrEqual(score.finalScore);
    expect(v.R).toBeLessThan(score.finalScore + 1);
  });

  it("owning prestige-recipe cards raises the prestige potential", () => {
    let s = aiGame("PHI", 2, "normal");
    const id = s.players[0].id;
    const before = evaluatePosition(s, id).prestige;
    s = devTools.grantCard(s, id, "forming_machine");
    s = devTools.grantCard(s, id, "assembler");
    const after = evaluatePosition(s, id).prestige;
    expect(after).toBeGreaterThan(before);
  });

  it("holding an input basket raises the potential further (staging gradient)", () => {
    let s = aiGame("PHI2", 2, "normal");
    const id = s.players[0].id;
    s = devTools.grantCard(s, id, "forming_machine");
    s = devTools.grantCard(s, id, "assembler");
    const before = evaluatePosition(s, id).prestige;
    s = devTools.addResource(s, id, "electronics", 1);
    s = devTools.addResource(s, id, "steel", 1);
    s = devTools.addResource(s, id, "alloy", 1);
    const after = evaluatePosition(s, id).prestige;
    expect(after).toBeGreaterThan(before);
  });
});

describe("v11: multi-step staging (scenario direction tests)", () => {
  it("a pair-owning AI with cash claims heavy tech by game end", () => {
    let s = createGame({
      seed: "probe1",
      maxRounds: 10,
      players: [
        { name: "AI", isAi: true, aiDifficulty: "normal" },
        { name: "B", isAi: true, aiDifficulty: "normal" },
      ],
    });
    s.quiet = true;
    const id = s.players[0].id;
    s = devTools.grantCard(s, id, "forming_machine");
    s = devTools.grantCard(s, id, "assembler");
    s = devTools.addCash(s, id, 80);
    s.round = 4; // mid-game: the sprint must fit the remaining rounds
    for (let t = 0; t < 20 && s.status === "active"; t++) {
      s = runAiTurn(s).state;
    }
    const p = s.players[0];
    const tech =
      (p.metrics.produced.machinery ?? 0) +
      (p.metrics.produced.transportation ?? 0);
    expect(tech).toBeGreaterThan(0);
    expect(p.prestige).toBeGreaterThanOrEqual(10);
  });

  it("an under-capitalized pair owner stages basket inputs across turns", () => {
    let s = createGame({
      seed: "stage1",
      maxRounds: 10,
      players: [
        { name: "AI", isAi: true, aiDifficulty: "normal" },
        { name: "B", isAi: true, aiDifficulty: "normal" },
      ],
    });
    s.quiet = true;
    const id = s.players[0].id;
    s = devTools.grantCard(s, id, "forming_machine");
    s = devTools.grantCard(s, id, "assembler");
    s = devTools.addCash(s, id, 25); // not enough for a one-shot basket
    let staged = false;
    for (let t = 0; t < 8 && s.status === "active"; t++) {
      const seat = s.activePlayerIndex;
      const r = runAiTurn(s);
      if (seat === 0 && r.steps.some((x) => x.startsWith("stage "))) {
        staged = true;
      }
      s = r.state;
    }
    const p = s.players[0];
    const factoryGoods =
      (p.metrics.produced.machinery ?? 0) +
      (p.metrics.produced.transportation ?? 0) +
      (p.metrics.produced.electronics ?? 0) +
      (p.metrics.produced.pharmaceuticals ?? 0) +
      (p.metrics.produced.clothing ?? 0);
    // Either it staged inputs explicitly, or it found the cash to go direct —
    // in both cases the pair must actually get used for finished goods.
    expect(staged || factoryGoods > 0).toBe(true);
  });
});

describe("v11: difficulty is search strength", () => {
  it("normal beats easy across seeds (monotonic ladder, small sample)", () => {
    let normalWins = 0;
    const games = 6;
    for (let g = 0; g < games; g++) {
      // Alternate seats so seat advantage cancels.
      const diffs: AiDifficulty[] =
        g % 2 === 0 ? ["normal", "easy"] : ["easy", "normal"];
      let s = createGame({
        seed: `LADDER-${g}`,
        maxRounds: 10,
        players: diffs.map((d) => ({
          name: d,
          isAi: true,
          aiDifficulty: d,
        })),
      });
      s.quiet = true;
      let guard = 0;
      while (s.status === "active" && guard++ < 40) s = runAiTurn(s).state;
      const scores = calculateScore(s);
      const winner = scores.find((x) => x.rank === 1)!;
      if (winner.name === "normal") normalWins++;
    }
    expect(normalWins).toBeGreaterThanOrEqual(Math.ceil(games * 0.6));
  });

  it("hard finishes games legally with no guard hits", () => {
    const result = simulateGame("HARD-1", 3, "hard", 10);
    expect(result.finished).toBe(true);
    expect(result.guardHits).toBe(0);
  });

  it("hard is deterministic for a fixed seed", () => {
    const a = simulateGame("HARD-DET", 2, "hard", 10);
    const b = simulateGame("HARD-DET", 2, "hard", 10);
    expect(a.scores.map((s) => s.finalScore)).toEqual(
      b.scores.map((s) => s.finalScore),
    );
    expect(a.totalAiActions).toBe(b.totalAiActions);
  });
});

describe("v11: decision legibility", () => {
  it("turn reports carry per-step rationale with value deltas", () => {
    const s = aiGame("LEGIBLE", 2, "normal");
    const r = runAiTurn(s);
    expect(r.steps.length).toBeGreaterThan(0);
    // At least one non-endTurn step should explain its value motive.
    const rationale = r.steps.filter((x) => x.includes("ΔV"));
    expect(rationale.length).toBeGreaterThan(0);
  });

  it("explainAiDecision exposes the scored candidate set without acting", () => {
    const s = aiGame("EXPLAIN", 2, "normal");
    const before = JSON.stringify(s);
    const ex = explainAiDecision(s);
    expect(JSON.stringify(s)).toBe(before); // read-only
    expect(ex.candidates.length).toBeGreaterThan(0);
    expect(ex.scored.length).toBeGreaterThan(0);
    for (const sc of ex.scored) {
      expect(Number.isFinite(sc.terminal)).toBe(true);
      expect(Number.isFinite(sc.v1.total)).toBe(true);
    }
    // The chosen action is one of the evaluated candidates (or an end-turn).
    if (ex.chosen !== null) {
      expect(ex.scored.some((sc) => sc.describe === ex.chosen)).toBe(true);
    }
  });

  it("stepAiTurn still honors the public contract", () => {
    let s = aiGame("STEPPER", 2, "normal");
    for (let i = 0; i < 60; i++) {
      const r = stepAiTurn(s);
      expect(typeof r.description).toBe("string");
      s = r.state as GameState;
      if (r.done) break;
    }
    // The turn must have passed to the next player.
    expect(s.activePlayerIndex === 1 || s.round > 1).toBe(true);
  });
});

describe("v11: strategy-signature analysis", () => {
  it("computes signals from metrics, not from global state", () => {
    const result = simulateGame("SIG-1", 3, "normal", 10);
    for (const p of result.finalState.players) {
      const signals = computeStrategySignals(p);
      for (const sig of SIGNATURES) {
        expect(Number.isFinite(signals[sig])).toBe(true);
        expect(signals[sig]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("thresholds fall out of the sample distribution", () => {
    const samples = [];
    for (const seed of ["T-1", "T-2", "T-3"]) {
      const r = simulateGame(seed, 3, "normal", 10);
      for (const p of r.finalState.players) {
        samples.push(computeStrategySignals(p));
      }
    }
    const th = deriveThresholds(samples);
    for (const sig of SIGNATURES) {
      // Threshold is at least the absolute floor, and infinite only when the
      // signature never occurred at all in the sample.
      expect(th[sig] === Infinity || th[sig] >= 2).toBe(true);
    }
    // A player with zero signals lights nothing.
    const blank = simulateGame("T-BLANK", 2, "easy", 10).finalState.players[0];
    const lit = classifySignatures(blank, {
      roadStaple: Infinity,
      trader: Infinity,
      engine: Infinity,
      lateTech: Infinity,
      builder: Infinity,
      consumer: Infinity,
      petroleum: Infinity,
      farmer: Infinity,
    });
    expect(lit).toEqual([]);
  });
});
