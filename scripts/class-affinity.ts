// v12 measurement: per-class scoring impact of the AI class-affinity nudge.
// Each class plays 1-vs-3-unclassed normal AIs, seats rotated so turn order
// cancels, under affinity OFF vs ON. Reports avg score and win rate per class.
//
//   npm run class-affinity [-- games]

import { createGame, calculateScore } from "../src/engine/game";
import { runAiTurn } from "../src/engine/ai";
import type { ClassId } from "../src/engine/types";

const args = process.argv.slice(2).filter((a) => a !== "--");
const GAMES = Number(args[0] ?? 120);
// Optional comma-separated class filter for fast iteration.
const FILTER = args[1] ? args[1].split(",") : null;

const ALL_CLASSES: ClassId[] = [
  "equilibrist",
  "regenerist",
  "trader",
  "hipster",
  "parasite",
  "landBaron",
  "liquidator",
  "lineBoss",
];
const CLASSES = FILTER
  ? ALL_CLASSES.filter((c) => FILTER.includes(c))
  : ALL_CLASSES;

interface Result {
  winRate: number;
  avgScore: number;
  avgOppScore: number;
}

function measure(cls: ClassId, affinity: boolean, games: number): Result {
  let wins = 0;
  let scoreC = 0;
  let scoreN = 0;
  for (let g = 0; g < games; g++) {
    const seatOfC = g % 4;
    let s = createGame({
      seed: `aff-${cls}-${g}`,
      maxRounds: 10,
      players: Array.from({ length: 4 }, (_, i) => ({
        name: i === seatOfC ? "C" : `N${i}`,
        isAi: true,
        aiDifficulty: "normal" as const,
        classId: i === seatOfC ? cls : ("none" as const),
      })),
    });
    s.quiet = true;
    s.aiClassAffinity = affinity;
    let guard = 0;
    while (s.status === "active" && guard++ < 60) s = runAiTurn(s).state;
    const scores = calculateScore(s);
    const winners = scores.filter((x) => x.rank === 1);
    for (const sc of scores) {
      if (sc.name === "C") {
        scoreC += sc.finalScore;
        if (sc.rank === 1) wins += 1 / winners.length;
      } else {
        scoreN += sc.finalScore;
      }
    }
  }
  return {
    winRate: (100 * wins) / games,
    avgScore: scoreC / games,
    avgOppScore: scoreN / (3 * games),
  };
}

console.log(
  `Class-affinity measurement — ${GAMES} games each, 1 classed vs 3 unclassed normal AIs.`,
);
console.log(`(fair win rate = 25%)\n`);
console.log(
  `class         | OFF: win%  score | ON: win%  score | Δscore  Δwin`,
);
console.log(
  `------------- | ---------------- | --------------- | ------------`,
);

const rows: { cls: ClassId; off: Result; on: Result }[] = [];
for (const cls of CLASSES) {
  const off = measure(cls, false, GAMES);
  const on = measure(cls, true, GAMES);
  rows.push({ cls, off, on });
  const dScore = on.avgScore - off.avgScore;
  const dWin = on.winRate - off.winRate;
  console.log(
    `${cls.padEnd(13)} | ${off.winRate.toFixed(0).padStart(4)}%  ${off.avgScore
      .toFixed(1)
      .padStart(5)}     | ${on.winRate.toFixed(0).padStart(4)}%  ${on.avgScore
      .toFixed(1)
      .padStart(5)}    | ${(dScore >= 0 ? "+" : "") + dScore.toFixed(1)}   ${
      (dWin >= 0 ? "+" : "") + dWin.toFixed(0)
    }%`,
  );
}

const improved = rows.filter((r) => r.on.avgScore > r.off.avgScore);
const meanDelta =
  rows.reduce((a, r) => a + (r.on.avgScore - r.off.avgScore), 0) / rows.length;
console.log(
  `\nClasses with higher avg score under affinity: ${improved.length}/${rows.length}` +
    ` (${improved.map((r) => r.cls).join(", ")})`,
);
console.log(`Mean Δscore across all classes: ${meanDelta.toFixed(2)}`);
