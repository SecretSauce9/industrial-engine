// Tests for the v9 rule set: player classes, the net-worth delta, and the
// record-min / marketplace-cycle tweaks.

import { describe, it, expect } from "vitest";
import {
  createGame,
  activateCard,
  activateMultiCardRecipe,
  endTurn,
  buyResource,
  sellResource,
  sellCard,
  borrowCard,
  devTools,
} from "../src/engine/game";
import { GAME_CONFIG } from "../src/engine/data/config";
import type { ClassId, GameState } from "../src/engine/types";

function game(classes: (ClassId | undefined)[], seed = "V9"): GameState {
  return createGame({
    seed,
    maxRounds: 12,
    players: classes.map((c, i) => ({
      name: `P${i + 1}`,
      isAi: false,
      classId: c,
    })),
  });
}
function rotateTo(s: GameState, pid: string): GameState {
  let guard = 0;
  while (s.players[s.activePlayerIndex].id !== pid && guard++ < 20) {
    s = endTurn(s, s.players[s.activePlayerIndex].id);
  }
  return s;
}
const find = (s: GameState, cls: ClassId) =>
  s.players.find((p) => p.classId === cls)!;

describe("v9: Regenerist", () => {
  it("starts with Farm/Ranch/Fermenter and +2 asphalt, and cannot buy", () => {
    const s = game(["regenerist", "none"]);
    const reg = find(s, "regenerist");
    expect(reg.resources.asphalt).toBe(3); // base 1 + 2
    expect(new Set(reg.cards.map((c) => c.cardTypeId))).toEqual(
      new Set(["construction", "farm", "ranch", "fermenter"]),
    );
    const s2 = rotateTo(s, reg.id);
    expect(() => buyResource(s2, reg.id, "oil", 1)).toThrow(/cannot buy/i);
  });

  it("adds +1 to activation outputs but can't make disallowed raws", () => {
    let s = game(["regenerist", "none"]);
    const reg = find(s, "regenerist");
    s = rotateTo(s, reg.id);
    // Farm harvest: base 2 agriculture, +1 = 3.
    const farm = reg.cards.find((c) => c.cardTypeId === "farm")!.instanceId;
    const a0 = find(s, "regenerist").resources.agriculture ?? 0;
    s = activateCard(s, reg.id, farm, "farm_produce");
    expect((find(s, "regenerist").resources.agriculture ?? 0) - a0).toBe(3);
    // Excavator (produces sand, a disallowed raw) is blocked.
    const [s4, exc] = grantTo(s, reg.id, "excavator");
    expect(() => activateCard(s4, reg.id, exc, "excavator_produce")).toThrow(
      /only agriculture and livestock/i,
    );
  });
});

function grantTo(
  s: GameState,
  pid: string,
  cardId: string,
): [GameState, string] {
  const next = devTools.grantCard(s, pid, cardId);
  const p = next.players.find((pl) => pl.id === pid)!;
  return [next, p.cards[p.cards.length - 1].instanceId];
}

describe("v9: Trader", () => {
  it("starts with 8 asphalt and halves prestige earned", () => {
    let s = game(["trader", "none"]);
    const tr = find(s, "trader");
    expect(tr.resources.asphalt).toBe(8);
    s = rotateTo(s, tr.id);
    // Give the inputs to sew clothing (prestige 4 → halved to 2).
    let ids: string[];
    let st = devTools.addResource(s, tr.id, "textiles", 1);
    [st, ids] = grantAll2(st, tr.id, ["forming_machine", "assembler"]);
    const before = find(st, "trader").prestige;
    st = activateMultiCardRecipe(st, tr.id, "factory_clothing", ids);
    expect(find(st, "trader").prestige - before).toBe(2); // 4 halved
  });
});

function grantAll2(
  s: GameState,
  pid: string,
  cardIds: string[],
): [GameState, string[]] {
  let st = s;
  const ids: string[] = [];
  for (const c of cardIds) {
    let id: string;
    [st, id] = grantTo(st, pid, c);
    ids.push(id);
  }
  return [st, ids];
}

describe("v9: Liquidator & Parasite tableau/borrow", () => {
  it("Liquidator refunds 80% (rounded up) on card sells", () => {
    let s = game(["liquidator", "none"]);
    const lq = find(s, "liquidator");
    s = rotateTo(s, lq.id);
    const [s2, g] = grantTo(s, lq.id, "grinder"); // cost 7 → ceil(0.8*7)=6
    const cash0 = find(s2, "liquidator").cash;
    const s3 = sellCard(s2, lq.id, g);
    expect(find(s3, "liquidator").cash - cash0).toBe(6);
  });

  it("Parasite starts with roads to all, borrows for $1, up to 2 per owner", () => {
    let s = game(["parasite", "none", "none"]);
    const par = find(s, "parasite");
    expect(par.playerRoads.length).toBe(2);
    s = rotateTo(s, par.id);
    const target = s.players.find((p) => p.id !== par.id)!;
    // Give the target two grinders to borrow.
    let st = devTools.grantCard(s, target.id, "grinder");
    st = devTools.grantCard(st, target.id, "mixer");
    const t = st.players.find((p) => p.id === target.id)!;
    const cash0 = st.players.find((p) => p.id === par.id)!.cash;
    st = borrowCard(st, par.id, target.id, t.cards[0].instanceId);
    st = borrowCard(st, par.id, target.id, t.cards[1].instanceId);
    const cash1 = st.players.find((p) => p.id === par.id)!.cash;
    expect(cash0 - cash1).toBe(2); // 2 borrows at $1 each
    // A third borrow from the same owner is blocked.
    st = devTools.grantCard(st, target.id, "furnace");
    const t2 = st.players.find((p) => p.id === target.id)!;
    const furnace = t2.cards.find((c) => c.cardTypeId === "furnace")!;
    expect(() => borrowCard(st, par.id, target.id, furnace.instanceId)).toThrow(
      /only borrow 2/i,
    );
  });
});

describe("v9: Line Boss", () => {
  it("charges 1 food per 4 activations and 1 electricity per 2 machinery", () => {
    let s = game(["lineBoss", "none"]);
    const lb = find(s, "lineBoss");
    s = rotateTo(s, lb.id);
    let ids: string[];
    [s, ids] = grantAll2(s, lb.id, [
      "grinder",
      "grinder",
      "grinder",
      "grinder",
    ]);
    s = devTools.addResource(s, lb.id, "wood", 4);
    const p0 = find(s, "lineBoss");
    const food0 = p0.resources.food ?? 0;
    const elec0 = p0.resources.electricity ?? 0;
    for (const g of ids) s = activateCard(s, lb.id, g, "sawmill_lumber");
    const p1 = find(s, "lineBoss");
    // 4 activations: food due only at activation 0 → 1 food.
    expect(food0 - (p1.resources.food ?? 0)).toBe(1);
    // machinery electricity at activations 0 and 2 → 2 electricity.
    expect(elec0 - (p1.resources.electricity ?? 0)).toBe(2);
  });
});

describe("v9: Land Baron", () => {
  it("produces +1 raw and moves the price ladder once per 2 units sold", () => {
    let s = game(["landBaron", "none"]);
    const lb = find(s, "landBaron");
    s = rotateTo(s, lb.id);
    const [s2, forest] = grantTo(s, lb.id, "forest"); // wood 2 → +1 = 3
    const w0 = find(s2, "landBaron").resources.wood ?? 0;
    let st = activateCard(s2, lb.id, forest, "forest_produce");
    expect((find(st, "landBaron").resources.wood ?? 0) - w0).toBe(3);
    // Selling 4 wood moves the market stock by only 2.
    st = devTools.addResource(st, lb.id, "wood", 4);
    const stock0 = st.market.wood;
    st = sellResource(st, lb.id, "wood", 4);
    expect(st.market.wood - stock0).toBe(2);
  });
});

describe("v9: Hipster", () => {
  it("cannot take the first seat", () => {
    for (const seed of ["H1", "H2", "H3", "H4"]) {
      const s = game(["hipster", "none"], seed);
      expect(s.players[0].classId).not.toBe("hipster");
    }
  });

  it("doubles intermediate output the first time a sequence is used", () => {
    let s = game(["none", "hipster"]);
    const hip = find(s, "hipster");
    s = rotateTo(s, hip.id);
    let ids: string[];
    [s, ids] = grantAll2(s, hip.id, ["grinder"]);
    s = devTools.addResource(s, hip.id, "wood", 2);
    const l0 = s.producedTotals.lumber ?? 0;
    // First use of the [grinder] sequence: lumber output doubled 1 → 2.
    s = activateCard(s, hip.id, ids[0], "sawmill_lumber");
    expect((s.producedTotals.lumber ?? 0) - l0).toBe(2);
  });
});

describe("v9: net-worth delta", () => {
  it("records how much a player's net worth changed over their turn", () => {
    let s = game(["none", "none"]);
    const pid = s.players[s.activePlayerIndex].id;
    // Sell nothing, just end the turn: income raises net worth by the base
    // income (no activations → doubled income).
    s = endTurn(s, pid);
    const p = s.players.find((x) => x.id === pid)!;
    expect(p.netWorthDelta).toBe(GAME_CONFIG.income.noActivationBonus);
  });
});
