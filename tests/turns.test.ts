// Turn/round advancement, game end, income, marketplace cycling, scoring.

import { describe, it, expect } from "vitest";
import {
  activateCard,
  buyCard,
  calculateScore,
  endTurn,
  devTools,
} from "../src/engine/game";
import { RESOURCES } from "../src/engine/data/resources";
import { CARD_MAP } from "../src/engine/data/cards";
import { GAME_CONFIG } from "../src/engine/data/config";
import { newGame, grant, give, activeId, active } from "./helpers";

function playFullRound(state: ReturnType<typeof newGame>) {
  let s = state;
  for (let i = 0; i < s.players.length; i++) {
    s = endTurn(s, activeId(s));
    if (s.status === "finished") break;
  }
  return s;
}

describe("turns, rounds, game end", () => {
  it("End Turn advances correctly through players and rounds", () => {
    let s = newGame("ADV", 3);
    expect(s.round).toBe(1);
    expect(s.activePlayerIndex).toBe(0);
    s = endTurn(s, activeId(s));
    expect(s.activePlayerIndex).toBe(1);
    expect(s.round).toBe(1);
    s = endTurn(s, activeId(s));
    expect(s.activePlayerIndex).toBe(2);
    s = endTurn(s, activeId(s));
    expect(s.activePlayerIndex).toBe(0);
    expect(s.round).toBe(2);
    expect(() => endTurn(s, s.players[2].id)).toThrow();
  });

  it("income is 4 at end of turn, doubled to 8 with no activations", () => {
    let s = newGame("INCOME", 2);
    const cash0 = active(s).cash;
    s = endTurn(s, activeId(s)); // passive turn
    expect(s.players[0].cash).toBe(
      cash0 + GAME_CONFIG.income.noActivationBonus,
    );

    let s2 = newGame("INCOME2", 2);
    let solar: string;
    [s2, solar] = grant(s2, "solar_panels");
    const cash2 = active(s2).cash;
    s2 = activateCard(s2, activeId(s2), solar, "solar_electricity");
    s2 = endTurn(s2, activeId(s2));
    expect(s2.players[0].cash).toBe(cash2 + GAME_CONFIG.income.base);
  });

  it("cards reset only at the proper player's next turn", () => {
    let s = newGame("RESET", 3);
    let rig: string;
    [s, rig] = grant(s, "oil_rig");
    const owner = activeId(s);
    s = activateCard(s, owner, rig, "oil_rig_produce");
    const rigOf = (st: typeof s) =>
      st.players[0].cards.find((c) => c.instanceId === rig)!;
    expect(rigOf(s).usedSequences.length).toBe(1);
    s = endTurn(s, owner);
    expect(rigOf(s).usedSequences.length).toBe(1);
    s = endTurn(s, activeId(s));
    expect(rigOf(s).usedSequences.length).toBe(1);
    s = endTurn(s, activeId(s)); // back to p1, round 2
    expect(rigOf(s).usedSequences).toEqual([]);
  });

  it("the game ends after the final turn of the last round", () => {
    let s = newGame("END", 2, 10);
    for (let round = 0; round < 10; round++) {
      expect(s.status).toBe("active");
      s = playFullRound(s);
    }
    expect(s.status).toBe("finished");
    expect(s.round).toBe(10);
    expect(() => endTurn(s, s.players[0].id)).toThrow();
  });

  it("startingCash follows seat order", () => {
    const s = newGame("CASH", 4);
    expect(s.players.map((p) => p.cash)).toEqual(GAME_CONFIG.startingCash);
  });

  it("every player starts with a Construction card and no other cards", () => {
    const s = newGame("START", 3);
    for (const p of s.players) {
      expect(p.cards.map((c) => c.cardTypeId)).toEqual(["construction"]);
      expect(p.prestige).toBe(0);
    }
  });

  it("initial marketplace contains at least 3 production cards", () => {
    for (const seed of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      const s = newGame(seed, 4);
      const prod = s.cardMarket.filter(
        (id) => id !== null && CARD_MAP[id].category === "production",
      ).length;
      expect(prod).toBeGreaterThanOrEqual(3);
    }
  });

  it("buying shifts right with a new card top-left", () => {
    let s = newGame("CYCLE", 2);
    s = devTools.addCash(s, activeId(s), 200);
    const pid = activeId(s);
    const before = [...s.cardMarket];
    // v4: the refill is the first deck card that is NOT already face-up.
    const remaining = before.filter((_, i) => i !== 2);
    const expected = s.deck.find((c) => !remaining.includes(c)) ?? s.deck[0];
    s = buyCard(s, pid, 2);
    expect(s.cardMarket[0]).toBe(expected);
    expect(s.cardMarket[1]).toBe(before[0]);
    expect(s.cardMarket[3]).toBe(before[3]);
    // No duplicates while alternatives exist.
    const nonNull = s.cardMarket.filter((c) => c !== null);
    expect(new Set(nonNull).size).toBe(nonNull.length);
  });

  it("v9: at least two cards cycle each turn (two oldest when none bought)", () => {
    let s = newGame("CYCLE2", 2);
    const before = [...s.cardMarket];
    const len = s.deck.length;
    s = endTurn(s, activeId(s));
    // The two oldest (bottom-right) cards returned to the deck; two new cards
    // arrived at the front, so the old front two are now shifted to slots 2-3.
    expect(s.cardMarket[2]).toBe(before[0]);
    expect(s.cardMarket[3]).toBe(before[1]);
    expect(s.deck).toContain(before[5]);
    expect(s.deck).toContain(before[4]);
    expect(s.cardMarket.filter((c) => c !== null).length).toBe(6);
    expect(s.deck.length).toBe(len); // 2 out, 2 in — net zero
  });

  it("v9: only the oldest card cycles when exactly one was bought", () => {
    let s = newGame("CYCLE3", 2);
    s = devTools.addCash(s, activeId(s), 200);
    const pid = activeId(s);
    const before = [...s.cardMarket];
    s = buyCard(s, pid, 0); // buy 1 → shifts, new card at front
    const afterBuy = [...s.cardMarket];
    s = endTurn(s, pid);
    // One more (the oldest) cycles, so 2 total left the shop this turn.
    expect(s.deck).toContain(before[5]);
    expect(s.cardMarket[1]).toBe(afterBuy[0]);
    expect(s.cardMarket.filter((c) => c !== null).length).toBe(6);
  });

  it("Construction never appears in the deck or marketplace", () => {
    const s = newGame("NOCONSTR", 4);
    expect(s.deck).not.toContain("construction");
    expect(s.cardMarket).not.toContain("construction");
  });

  it("scoring follows the formula (warehouse inventory + card value)", () => {
    let s = newGame("SCORE", 2);
    s = give(s, { oil: 2 });
    let rig: string;
    [s, rig] = grant(s, "oil_rig");
    void rig;
    const [p1] = s.players;
    p1.cash = 100;
    p1.prestige = 4;
    const scores = calculateScore(s);
    const row = scores.find((r) => r.playerId === p1.id)!;
    expect(row.inventoryValue).toBeGreaterThan(0);
    expect(row.finalScore).toBe(row.prestige + Math.floor(row.netWorth / 10));
    expect(row.cardValue).toBe(Math.floor((9 + 10) / 2)); // construction + rig
  });

  it("shared victory when fully tied", () => {
    const s = newGame("TIE", 2);
    s.players[0].cash = 50;
    s.players[1].cash = 50;
    const scores = calculateScore(s);
    expect(scores[0].rank).toBe(1);
    expect(scores[1].rank).toBe(1);
    expect(scores.every((r) => r.sharedVictory)).toBe(true);
  });

  it("no legal action creates negative cash or inventory (invariants hold)", () => {
    let s = newGame("INVAR", 2);
    let rig: string;
    [s, rig] = grant(s, "oil_rig");
    const pid = activeId(s);
    s = activateCard(s, pid, rig, "oil_rig_produce");
    for (const p of s.players) {
      expect(p.cash).toBeGreaterThanOrEqual(0);
      for (const r of RESOURCES) {
        expect(p.resources[r.id]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
