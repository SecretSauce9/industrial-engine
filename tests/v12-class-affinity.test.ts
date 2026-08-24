// Tests for v12: AI class affinity — the value function accounts for each
// class's mechanics, and the planner is nudged toward exercising them. All
// behavior is gated behind GameState.aiClassAffinity.

import { describe, it, expect } from "vitest";
import {
  createGame,
  devTools,
  getAvailableActivations,
  serializeGame,
  deserializeGame,
} from "../src/engine/game";
import { runAiTurn, planOption } from "../src/engine/ai";
import { GAME_CONFIG } from "../src/engine/data/config";
import type { ClassId, GameState } from "../src/engine/types";

function classGame(
  cls: ClassId,
  affinity: boolean,
  seed = "AFF",
  extra: ClassId = "none",
): GameState {
  const s = createGame({
    seed,
    maxRounds: 10,
    players: [
      { name: "C", isAi: true, aiDifficulty: "normal", classId: cls },
      { name: "B", isAi: true, aiDifficulty: "normal", classId: extra },
    ],
    aiClassAffinity: affinity,
  });
  s.quiet = true;
  return s;
}

/** The player with the given class (seat order is shuffled, and the Hipster
 * is barred from the first seat, so never assume seat 0). */
function playerOf(state: GameState, cls: ClassId): string {
  return state.players.find((p) => p.classId === cls)!.id;
}

/** planOption margin for one specific recipe for one specific player — isolates
 * the class-affected activation from class-independent options like the
 * universal Construct Building. */
function marginFor(
  state: GameState,
  playerId: string,
  recipeId: string,
): number | null {
  const p = state.players.find((x) => x.id === playerId)!;
  const opt = getAvailableActivations(state, playerId).find(
    (o) => o.recipeId === recipeId,
  );
  if (!opt) return null;
  const plan = planOption(state, p, opt);
  return plan ? plan.margin : null;
}

describe("v12: affinity flag plumbing", () => {
  it("defaults to the config value and honors the setup override", () => {
    const def = createGame({
      seed: "D",
      maxRounds: 10,
      players: [
        { name: "A", isAi: true },
        { name: "B", isAi: true },
      ],
    });
    expect(def.aiClassAffinity).toBe(GAME_CONFIG.ai.classAffinityDefault);

    const off = classGame("trader", false);
    expect(off.aiClassAffinity).toBe(false);
  });

  it("survives serialization and old saves get the default", () => {
    const s = classGame("hipster", true);
    const round = deserializeGame(serializeGame(s));
    expect(round.aiClassAffinity).toBe(true);

    const stripped = JSON.parse(serializeGame(s));
    delete stripped.aiClassAffinity;
    const revived = deserializeGame(JSON.stringify(stripped));
    expect(revived.aiClassAffinity).toBe(GAME_CONFIG.ai.classAffinityDefault);
  });
});

describe("v12: value function is class-aware (gated)", () => {
  // Each test builds one board, then toggles the flag on the SAME state so the
  // only difference is affinity — no seed/seat confound.
  it("Regenerist values its +1 output bonus", () => {
    let s = classGame("regenerist", false, "REGEN");
    const id = playerOf(s, "regenerist");
    s = devTools.grantCard(s, id, "grinder");
    s = devTools.addResource(s, id, "wood", 2);
    const off = marginFor(s, id, "sawmill_lumber")!;
    s.aiClassAffinity = true;
    const on = marginFor(s, id, "sawmill_lumber")!;
    expect(on).toBeGreaterThan(off); // +1 lumber
  });

  it("Hipster values a novel sequence's doubled intermediate output", () => {
    let s = classGame("hipster", false, "HIP");
    const id = playerOf(s, "hipster");
    s = devTools.grantCard(s, id, "grinder");
    s = devTools.addResource(s, id, "wood", 2);
    const off = marginFor(s, id, "sawmill_lumber")!;
    s.aiClassAffinity = true;
    const on = marginFor(s, id, "sawmill_lumber")!;
    expect(on).toBeGreaterThan(off); // fresh sequence doubles lumber
  });

  it("Line Boss prices its cheaper food/energy into activation margins", () => {
    let s = classGame("lineBoss", false, "LB");
    const id = playerOf(s, "lineBoss");
    s = devTools.grantCard(s, id, "polymetallic_mine");
    const off = marginFor(s, id, "mine_produce")!;
    s.aiClassAffinity = true;
    const on = marginFor(s, id, "mine_produce")!;
    // Cheaper food/electricity overhead ⇒ a strictly better margin here.
    expect(on).toBeGreaterThan(off);
  });

  it("Land Baron values its +1 raw output only when affinity is on", () => {
    let s = classGame("landBaron", false, "LB2");
    const id = playerOf(s, "landBaron");
    s = devTools.grantCard(s, id, "polymetallic_mine");
    const off = marginFor(s, id, "mine_produce")!;
    s.aiClassAffinity = true;
    const on = marginFor(s, id, "mine_produce")!;
    expect(on).toBeGreaterThan(off); // +1 metal (raw)
  });
});

describe("v12: affinity nudges change behavior", () => {
  // The Parasite holds a Forming Machine + chemicals; the owner holds an
  // Assembler. Borrowing it unlocks Formulate Pharmaceutical.
  function borrowScenario(affinity: boolean): number {
    let s = createGame({
      seed: "PARA",
      maxRounds: 10,
      players: [
        { name: "P", isAi: true, aiDifficulty: "normal", classId: "parasite" },
        { name: "O", isAi: true, aiDifficulty: "normal", classId: "none" },
      ],
      aiClassAffinity: affinity,
    });
    s.quiet = true;
    const para = playerOf(s, "parasite");
    const owner = playerOf(s, "none");
    s = devTools.grantCard(s, para, "forming_machine");
    s = devTools.addResource(s, para, "chemicals", 2);
    s = devTools.addCash(s, para, 20);
    s = devTools.grantCard(s, owner, "assembler");
    // Run a full round so the Parasite takes its turn regardless of seat.
    let guard = 0;
    const start = s.players.find((p) => p.id === para)!.metrics.turnsPlayed;
    while (
      s.status === "active" &&
      guard++ < 8 &&
      s.players.find((p) => p.id === para)!.metrics.turnsPlayed === start
    ) {
      s = runAiTurn(s).state;
    }
    return s.players.find((p) => p.id === para)!.metrics.cardsBorrowed;
  }

  it("the Parasite borrows a card when affinity is on", () => {
    expect(borrowScenario(true)).toBeGreaterThan(0);
  });

  it("the Parasite does NOT borrow when affinity is off", () => {
    expect(borrowScenario(false)).toBe(0);
  });
});

describe("v12: class-affinity games stay healthy", () => {
  it("finish cleanly and deterministically with affinity on", () => {
    for (const cls of ["parasite", "hipster", "landBaron"] as ClassId[]) {
      const mk = () => {
        const s = createGame({
          seed: `HEALTH-${cls}`,
          maxRounds: 10,
          players: Array.from({ length: 4 }, (_, i) => ({
            name: `P${i}`,
            isAi: true,
            aiDifficulty: "normal" as const,
            classId: i === 0 ? cls : ("none" as const),
          })),
          aiClassAffinity: true,
        });
        s.quiet = true;
        let guard = 0;
        let g = s;
        let hits = 0;
        while (g.status === "active" && guard++ < 60) {
          const r = runAiTurn(g);
          if (r.hitGuard) hits++;
          g = r.state;
        }
        return { finished: g.status === "finished", hits, g };
      };
      const a = mk();
      const b = mk();
      expect(a.finished).toBe(true);
      expect(a.hits).toBe(0);
      // Determinism: identical seeds ⇒ identical market state.
      expect(a.g.market).toEqual(b.g.market);
    }
  });

  it("unclassed games are identical whether affinity is on or off", () => {
    // All players unclassed ⇒ the flag must be a pure no-op.
    const run = (aff: boolean) => {
      let s = createGame({
        seed: "NOOP",
        maxRounds: 10,
        players: Array.from({ length: 4 }, (_, i) => ({
          name: `P${i}`,
          isAi: true,
          aiDifficulty: "normal" as const,
        })),
        aiClassAffinity: aff,
      });
      s.quiet = true;
      let guard = 0;
      while (s.status === "active" && guard++ < 60) s = runAiTurn(s).state;
      return s;
    };
    const on = run(true);
    const off = run(false);
    expect(on.market).toEqual(off.market);
    expect(on.players.map((p) => p.prestige)).toEqual(
      off.players.map((p) => p.prestige),
    );
    expect(on.players.map((p) => p.cash)).toEqual(
      off.players.map((p) => p.cash),
    );
  });
});
