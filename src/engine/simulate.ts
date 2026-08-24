// Headless AI-only game simulation, used by `npm run simulate` and by tests.

import type { AiDifficulty, GameState, ScoreBreakdown } from "./types";
import { createGame, calculateScore } from "./game";
import { runAiTurn } from "./ai";

export interface SimResult {
  seed: string;
  finished: boolean;
  rounds: number;
  guardHits: number;
  totalAiActions: number;
  scores: ScoreBreakdown[];
  /** Winner seat indices (0-based, ties possible). */
  winnerSeats: number[];
  finalState: GameState;
}

export function simulateGame(
  seed: string,
  playerCount: number,
  difficulty: AiDifficulty = "normal",
  maxRounds = 10,
): SimResult {
  let state = createGame({
    seed,
    maxRounds,
    players: Array.from({ length: playerCount }, (_, i) => ({
      name: `AI ${i + 1}`,
      isAi: true,
      aiDifficulty: difficulty,
    })),
  });
  state.quiet = true;

  let guardHits = 0;
  let totalAiActions = 0;
  // Absolute safety valve: rounds * players * guard actions.
  const hardLimit = maxRounds * playerCount + 8;
  let turns = 0;
  while (state.status === "active" && turns < hardLimit) {
    const report = runAiTurn(state);
    state = report.state;
    totalAiActions += report.actions;
    if (report.hitGuard) guardHits += 1;
    turns += 1;
  }

  const scores = calculateScore(state);
  const winners = scores.filter((s) => s.rank === 1);
  const winnerSeats = winners.map((w) =>
    state.players.findIndex((p) => p.id === w.playerId),
  );
  return {
    seed,
    finished: state.status === "finished",
    rounds: state.round,
    guardHits,
    totalAiActions,
    scores,
    winnerSeats,
    finalState: state,
  };
}
