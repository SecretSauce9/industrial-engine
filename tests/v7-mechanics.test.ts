// Tests for the v7 rule set: tableau card limit, all-produced end condition,
// fuel start/equilibrium, grain-mill/ethanol yields, setup modifiers, and the
// end-of-game record trackers.

import { describe, it, expect } from "vitest";
import {
  createGame,
  endTurn,
  buyCard,
  borrowCard,
  buildPlayerRoad,
  activateCard,
  devTools,
} from "../src/engine/game";
import { RESOURCES, getResource } from "../src/engine/data/resources";
import { CARD_MAP } from "../src/engine/data/cards";
import { GAME_CONFIG } from "../src/engine/data/config";
import {
  newGame,
  active,
  activeId,
  grant,
  grantAll,
  give,
  fund,
} from "./helpers";

describe("v7: tableau card limit", () => {
  it("caps a tableau at 9 non-borrowed cards", () => {
    let s = fund(newGame("LIMIT", 2, 10), 500);
    const pid = activeId(s);
    [s] = grantAll(s, [
      "grinder",
      "mixer",
      "furnace",
      "cracker",
      "assembler",
      "forming_machine",
      "polymerizer",
      "distillation_column",
    ]); // + Construction starter = 9
    expect(active(s).cards.length).toBe(9);
    const slot = s.cardMarket.findIndex((c) => c !== null);
    expect(() => buyCard(s, pid, slot)).toThrow(/tableau is full/i);
  });

  it("borrowed cards do not count toward the limit", () => {
    let s = fund(newGame("BORROWCAP", 2, 10), 500);
    const p1 = activeId(s);
    const p2 = s.players.find((pl) => pl.id !== p1)!.id;
    [s] = grantAll(s, [
      "grinder",
      "mixer",
      "furnace",
      "cracker",
      "assembler",
      "forming_machine",
      "polymerizer",
      "distillation_column",
    ]); // 9 cards
    s = give(s, { asphalt: 1 });
    s = devTools.grantCard(s, p2, "grinder");
    const lent = s.players.find((pl) => pl.id === p2)!.cards[0].instanceId;
    s = buildPlayerRoad(s, p1, p2);
    s = borrowCard(s, p1, p2, lent); // must succeed despite full tableau
    const me = s.players.find((pl) => pl.id === p1)!;
    expect(me.cards.length).toBe(10);
    expect(me.cards.filter((c) => !c.borrowedFrom).length).toBe(9);
  });
});

describe("v7: all-resources-produced end condition", () => {
  it("schedules the end once every resource has been produced", () => {
    let s = newGame("ALLPROD", 2, 10);
    for (const r of RESOURCES) {
      if (r.id !== "agriculture") s.producedTotals[r.id] = 1;
    }
    let farm: string;
    [s, farm] = grant(s, "farm");
    const pid = activeId(s);
    s = activateCard(s, pid, farm, "farm_produce"); // produces agriculture
    expect(s.allProducedRound).toBe(s.round);
  });

  it("ends exactly one round after all resources are produced", () => {
    let s = newGame("ENDTIME", 2, 10);
    s.allProducedRound = 3;
    s.round = 3;
    s.activePlayerIndex = 0;
    s = endTurn(s, activeId(s)); // round 3, -> P2
    s = endTurn(s, activeId(s)); // -> round 4
    expect(s.status).toBe("active");
    expect(s.round).toBe(4);
    s = endTurn(s, activeId(s)); // round 4, -> P2
    s = endTurn(s, activeId(s)); // -> ends (round 4 = allProduced+1)
    expect(s.status).toBe("finished");
  });

  it("never extends past the original round limit", () => {
    let s = newGame("ENDCAP", 2, 10);
    s.allProducedRound = 9; // 9 + 1 = 10 = maxRounds, not 11
    s.round = 10;
    s.activePlayerIndex = s.players.length - 1;
    s = endTurn(s, activeId(s));
    expect(s.status).toBe("finished");
  });
});

describe("v7: fuel and recipe tweaks", () => {
  it("fuel equilibrium is one lower than the other staples", () => {
    expect(getResource("fuel").equilibrium).toBe(7);
    expect(getResource("electricity").equilibrium).toBe(8);
    expect(getResource("food").equilibrium).toBe(8);
  });

  it("players start with 3 fuel", () => {
    const s = newGame();
    for (const p of s.players) expect(p.resources.fuel).toBe(3);
  });

  it("grain mill turns 2 agriculture into 2 food", () => {
    let [s, g] = grant(give(newGame(), { agriculture: 2 }), "grinder");
    const pid = activeId(s);
    const produced0 = s.producedTotals.food ?? 0;
    s = activateCard(s, pid, g, "grain_mill_food");
    // Raw recipe output is 2 (net warehouse change is +1 after 1 food upkeep).
    expect((s.producedTotals.food ?? 0) - produced0).toBe(2);
    expect(active(s).resources.agriculture).toBe(0);
  });
});

describe("v7: setup modifiers", () => {
  const gameWith = (mods: Partial<Record<string, boolean>>) =>
    createGame({
      seed: "MODS",
      maxRounds: 10,
      players: [
        { name: "A", isAi: false },
        { name: "B", isAi: false },
      ],
      modifiers: {
        knifeFight: false,
        randomResources: false,
        viscousMarkets: false,
        cyclicalEconomy: false,
        ...mods,
      },
    });

  it("knife fight removes one copy of each named component", () => {
    const base = gameWith({});
    const knife = gameWith({ knifeFight: true });
    const count = (s: ReturnType<typeof gameWith>, id: string) =>
      s.deck.filter((c) => c === id).length +
      s.cardMarket.filter((c) => c === id).length;
    for (const id of GAME_CONFIG.knifeFightReductions) {
      expect(count(base, id) - count(knife, id)).toBe(1);
      expect(count(knife, id)).toBe(CARD_MAP[id].deckCount - 1);
    }
  });

  it("random resources shift equilibria by at most 2", () => {
    const s = gameWith({ randomResources: true });
    let anyShift = false;
    for (const r of RESOURCES) {
      const eq = s.marketConfig.equilibrium[r.id];
      expect(Math.abs(eq - r.equilibrium)).toBeLessThanOrEqual(2);
      if (eq !== r.equilibrium) anyShift = true;
    }
    expect(anyShift).toBe(true);
  });

  it("viscous markets cap drift at 1", () => {
    const s = gameWith({ viscousMarkets: true });
    for (const r of RESOURCES) {
      expect(s.marketConfig.driftMax[r.id]).toBe(1);
    }
  });

  it("cyclical economy lags the drift budget by a round", () => {
    let s = gameWith({ cyclicalEconomy: true });
    expect(s.marketConfig.cyclical).toBe(true);
    // Round 1 applies no lagged budget yet (nothing to lag from).
    expect(Object.keys(s.marketMaker.budgets).length).toBe(0);
    // After the first full round, a lagged budget has been captured.
    for (let i = 0; i < s.players.length; i++) s = endTurn(s, activeId(s));
    expect(s.round).toBe(2);
    expect(s.marketConfig.laggedBudgets).toBeDefined();
  });
});

describe("v7: end-of-game record trackers", () => {
  it("awards 2 prestige for each qualifying record, ties to who was first", () => {
    let s = newGame("RECORDS", 2, 4);
    const aId = s.players[0].id;
    const bId = s.players[1].id;
    const a = s.players[0];
    const b = s.players[1];
    a.stats.borrowFeesCollected = 8;
    a.stats.borrowFeesSeq = 1;
    a.stats.rebateDollars = 12;
    a.stats.rebateDollarsSeq = 2;
    a.stats.maxCombosInTurn = 9;
    a.stats.maxCombosSeq = 3;
    a.stats.nonConsumingActivations = 11;
    a.stats.nonConsumingSeq = 4;
    a.stats.verticalFinished = 3;
    a.stats.verticalSeq = 5;
    a.stats.totalActivations = 40; // > 30: disqualified from Stillness
    b.stats.totalActivations = 20; // <= 30: Stillness winner
    b.stats.borrowFeesCollected = 4; // < 6: doesn't qualify
    const aPrestige0 = a.prestige;

    s.round = s.maxRounds;
    s.activePlayerIndex = s.players.length - 1;
    s = endTurn(s, activeId(s));
    expect(s.status).toBe("finished");

    const byKey = Object.fromEntries((s.records ?? []).map((r) => [r.key, r]));
    expect(byKey.landlord.winnerId).toBe(aId);
    expect(byKey.roadBaron.winnerId).toBe(aId);
    expect(byKey.combo.winnerId).toBe(aId);
    expect(byKey.rancher.winnerId).toBe(aId);
    expect(byKey.vertical.winnerId).toBe(aId);
    expect(byKey.stillness.winnerId).toBe(bId);

    const aFinal = s.players.find((p) => p.id === aId)!;
    expect(aFinal.prestige).toBe(aPrestige0 + 5 * GAME_CONFIG.recordPrestige);
  });

  it("no record is awarded when nobody clears the threshold", () => {
    let s = newGame("NORECORD", 2, 4);
    // Everyone activates a lot (disqualifies Stillness) and earns nothing else.
    for (const p of s.players) p.stats.totalActivations = 99;
    s.round = s.maxRounds;
    s.activePlayerIndex = s.players.length - 1;
    s = endTurn(s, activeId(s));
    const byKey = Object.fromEntries((s.records ?? []).map((r) => [r.key, r]));
    expect(byKey.landlord.winnerId).toBeNull();
    expect(byKey.stillness.winnerId).toBeNull();
  });
});
