// Headless balance simulation: `npm run simulate [-- games players difficulty [baseline.json]]`
// Runs seeded AI-only games and reports aggregate statistics from the
// per-player metrics (v11). Optionally dumps a machine-readable baseline.

import { writeFileSync } from "node:fs";
import { simulateGame } from "../src/engine/simulate";
import { RESOURCES } from "../src/engine/data/resources";
import { CARDS } from "../src/engine/data/cards";
import { RECIPES } from "../src/engine/data/recipes";
import {
  SIGNATURES,
  computeStrategySignals,
  deriveThresholds,
  type SignatureId,
} from "../src/engine/analysis";

const args = process.argv.slice(2).filter((a) => a !== "--");
const GAMES = Number(args[0] ?? 200);
const PLAYERS = Number(args[1] ?? 4);
const DIFFICULTY = (args[2] ?? "normal") as "easy" | "normal" | "hard";
const BASELINE_PATH = args[3];

const pct = (vals: number[], q: number): number => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// ---- accumulators ----
const scores: number[] = [];
const prestiges: number[] = [];
const cashes: number[] = [];
let unfinished = 0;
let guardHits = 0;
const winsBySeat = new Array(PLAYERS).fill(0);
const cardCounts: Record<string, number> = {};
for (const c of CARDS) cardCounts[c.id] = 0;
const producedByResource: Record<string, number> = {};
const soldByResource: Record<string, number> = {};
const boughtByResource: Record<string, number> = {};
for (const r of RESOURCES) {
  producedByResource[r.id] = 0;
  soldByResource[r.id] = 0;
  boughtByResource[r.id] = 0;
}
const recipeActs: Record<string, number> = {};
for (const r of RECIPES) recipeActs[r.id] = 0;
const allSignals: Record<SignatureId, number>[] = [];
const baselineRows: object[] = [];

console.log(
  `Simulating ${GAMES} games (${PLAYERS} ${DIFFICULTY} AIs, 10 rounds)...`,
);
const t0 = Date.now();

for (let g = 0; g < GAMES; g++) {
  const result = simulateGame(`sim-${g}`, PLAYERS, DIFFICULTY, 10);
  if (!result.finished) unfinished++;
  guardHits += result.guardHits;
  for (const seat of result.winnerSeats) {
    winsBySeat[seat] += 1 / result.winnerSeats.length;
  }
  for (const s of result.scores) {
    scores.push(s.finalScore);
    prestiges.push(s.prestige);
    cashes.push(s.cash);
  }
  for (const p of result.finalState.players) {
    for (const c of p.cards) cardCounts[c.cardTypeId] += 1;
    const m = p.metrics;
    for (const r of RESOURCES) {
      producedByResource[r.id] += m.produced[r.id] ?? 0;
      soldByResource[r.id] += m.sold[r.id] ?? 0;
      boughtByResource[r.id] += m.bought[r.id] ?? 0;
    }
    for (const [rid, n] of Object.entries(m.activationsByRecipe)) {
      recipeActs[rid] = (recipeActs[rid] ?? 0) + n;
    }
    const signals = computeStrategySignals(p);
    allSignals.push(signals);
    if (BASELINE_PATH) {
      const seat = result.finalState.players.indexOf(p);
      const score = result.scores.find((s) => s.playerId === p.id)!;
      baselineRows.push({
        seed: result.seed,
        seat,
        finalScore: score.finalScore,
        prestige: score.prestige,
        netWorth: score.netWorth,
        won: result.winnerSeats.includes(seat),
        signals,
        metrics: m,
      });
    }
  }
}

const seconds = ((Date.now() - t0) / 1000).toFixed(1);
const playerGames = GAMES * PLAYERS;
const avg = (vals: number[]) =>
  vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);

console.log(`\nDone in ${seconds}s.\n`);
console.log(
  `Final score:  avg ${avg(scores).toFixed(1)}  p10 ${pct(scores, 0.1)}  p50 ${pct(scores, 0.5)}  p90 ${pct(scores, 0.9)}  max ${Math.max(...scores)}`,
);
console.log(
  `Prestige:     avg ${avg(prestiges).toFixed(1)}  p50 ${pct(prestiges, 0.5)}`,
);
console.log(
  `End cash:     avg ${avg(cashes).toFixed(1)}  p50 ${pct(cashes, 0.5)}`,
);
console.log(`Games not finishing:   ${unfinished}`);
console.log(`AI loop-guard hits:    ${guardHits}`);

console.log(`\nWin rate by seat (seat 1 = first player):`);
winsBySeat.forEach((w, i) =>
  console.log(`  seat ${i + 1}: ${((w / GAMES) * 100).toFixed(1)}%`),
);

// ---- strategy signatures (thresholds from this run's own distribution) ----
const thresholds = deriveThresholds(allSignals);
const litCounts: Record<SignatureId, number> = Object.fromEntries(
  SIGNATURES.map((s) => [s, 0]),
) as Record<SignatureId, number>;
let totalLit = 0;
let noneLit = 0;
for (const sig of allSignals) {
  let lit = 0;
  for (const s of SIGNATURES) {
    if (sig[s] >= thresholds[s]) {
      litCounts[s] += 1;
      lit += 1;
    }
  }
  totalLit += lit;
  if (lit === 0) noneLit += 1;
}
console.log(`\nStrategy signatures lit (threshold = p75 of nonzero baseline):`);
for (const s of SIGNATURES) {
  console.log(
    `  ${s.padEnd(12)} ${(((litCounts[s] ?? 0) / playerGames) * 100).toFixed(1).padStart(5)}%   (threshold ${thresholds[s] === Infinity ? "∞ (never observed!)" : thresholds[s].toFixed(1)})`,
  );
}
console.log(
  `  avg signatures per player-game: ${(totalLit / playerGames).toFixed(2)};  none lit: ${((noneLit / playerGames) * 100).toFixed(1)}%`,
);

// ---- coverage red flags ----
const neverProduced = RESOURCES.filter(
  (r) => producedByResource[r.id] === 0,
).map((r) => r.id);
const neverOwned = CARDS.filter((c) => cardCounts[c.id] === 0).map((c) => c.id);
const neverActivated = RECIPES.filter((r) => (recipeActs[r.id] ?? 0) === 0).map(
  (r) => r.id,
);
console.log(`\nCoverage:`);
console.log(
  `  resources never produced: ${neverProduced.length ? neverProduced.join(", ") : "none"}`,
);
console.log(
  `  cards never owned:        ${neverOwned.length ? neverOwned.join(", ") : "none"}`,
);
console.log(
  `  recipes never activated:  ${neverActivated.length ? neverActivated.join(", ") : "none"}`,
);

console.log(`\nPer player-game averages (produced / sold / bought):`);
for (const r of RESOURCES) {
  const p = producedByResource[r.id] / playerGames;
  const s = soldByResource[r.id] / playerGames;
  const b = boughtByResource[r.id] / playerGames;
  console.log(
    `  ${r.id.padEnd(16)} ${p.toFixed(2).padStart(6)} / ${s.toFixed(2).padStart(6)} / ${b.toFixed(2).padStart(6)}`,
  );
}

console.log(`\nCards owned at game end (per game, avg):`);
const cardRows = Object.entries(cardCounts)
  .map(([id, n]) => [id, n / GAMES] as const)
  .sort((a, b) => b[1] - a[1]);
for (const [id, avgN] of cardRows) {
  console.log(`  ${id.padEnd(24)} ${avgN.toFixed(2)}`);
}

if (BASELINE_PATH) {
  const payload = {
    games: GAMES,
    players: PLAYERS,
    difficulty: DIFFICULTY,
    thresholds,
    rows: baselineRows,
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(payload));
  console.log(`\nBaseline written to ${BASELINE_PATH}`);
}

if (unfinished > 0 || guardHits > 0) process.exit(1);
