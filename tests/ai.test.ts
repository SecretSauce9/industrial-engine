// AI termination, determinism, and rule compliance under v2 rules.

import { describe, it, expect } from "vitest";
import { createGame } from "../src/engine/game";
import { runAiTurn } from "../src/engine/ai";
import { simulateGame } from "../src/engine/simulate";
import { RESOURCES } from "../src/engine/data/resources";
import { GAME_CONFIG } from "../src/engine/data/config";

function aiGame(
  seed: string,
  count: number,
  difficulty: "easy" | "normal" | "hard",
) {
  return createGame({
    seed,
    maxRounds: 10,
    players: Array.from({ length: count }, (_, i) => ({
      name: `AI ${i + 1}`,
      isAi: true,
      aiDifficulty: difficulty,
    })),
  });
}

describe("AI", () => {
  it("AI turns always terminate (all difficulties, various counts)", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      for (const count of [2, 3, 4]) {
        let s = aiGame(`TERM-${difficulty}-${count}`, count, difficulty);
        s.quiet = true;
        const report = runAiTurn(s);
        expect(report.actions).toBeLessThanOrEqual(
          GAME_CONFIG.ai.maxActionsPerTurn + 1,
        );
        expect(
          report.state.activePlayerIndex !== s.activePlayerIndex ||
            report.state.round !== s.round,
        ).toBe(true);
      }
    }
  });

  it("full AI-only games finish without guard hits and keep invariants", () => {
    for (const seed of ["SIM-1", "SIM-2", "SIM-3"]) {
      const result = simulateGame(seed, 4, "normal", 10);
      expect(result.finished).toBe(true);
      expect(result.guardHits).toBe(0);
      for (const p of result.finalState.players) {
        expect(p.cash).toBeGreaterThanOrEqual(0);
        for (const r of RESOURCES) {
          expect(p.resources[r.id]).toBeGreaterThanOrEqual(0);
        }
        for (const c of p.cards) {
          expect(c.usedSequences.length).toBeLessThanOrEqual(3);
        }
      }
      for (const r of RESOURCES) {
        expect(result.finalState.market[r.id]).toBeGreaterThanOrEqual(0);
        expect(result.finalState.market[r.id]).toBeLessThanOrEqual(r.capacity);
      }
    }
  });

  it("AI games are deterministic for a fixed seed", () => {
    const a = simulateGame("DET-AI", 3, "normal", 10);
    const b = simulateGame("DET-AI", 3, "normal", 10);
    expect(a.scores.map((s) => s.finalScore)).toEqual(
      b.scores.map((s) => s.finalScore),
    );
    expect(a.finalState.market).toEqual(b.finalState.market);
    expect(a.totalAiActions).toBe(b.totalAiActions);
  });

  it("normal AI makes economic progress over a full game", () => {
    const result = simulateGame("PROGRESS", 2, "normal", 10);
    const best = result.scores[0];
    // A functioning AI turns its ~30 starting credits and income into
    // prestige-bearing production; a do-nothing player scores ~11. (v4:
    // prestige is first-producer-only, so totals are much lower than v3.)
    expect(best.finalScore).toBeGreaterThan(15);
    expect(best.prestige).toBeGreaterThan(0);
    expect(
      result.finalState.players.some((p) => p.cards.length > 1), // beyond starter
    ).toBe(true);
  });

  it("easy AI also finishes games", () => {
    const result = simulateGame("EASY", 3, "easy", 10);
    expect(result.finished).toBe(true);
    expect(result.guardHits).toBe(0);
  });
});
