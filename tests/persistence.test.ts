// Save/load fidelity and seed determinism (v3 state shape).

import { describe, it, expect } from "vitest";
import {
  activateCard,
  buildMarketRoad,
  buyCard,
  buyResource,
  createGame,
  deserializeGame,
  endTurn,
  serializeGame,
} from "../src/engine/game";
import { newGame, grant, give, activeId } from "./helpers";

describe("persistence and determinism", () => {
  it("saving and loading preserves the exact game state", () => {
    let s = newGame("SAVE", 3);
    let rig: string;
    [s, rig] = grant(s, "oil_rig");
    const pid = activeId(s);
    s = activateCard(s, pid, rig, "oil_rig_produce");
    s = give(s, { glass: 2 });
    s = buildMarketRoad(s, pid, "oil");
    s = buyResource(s, pid, "metal", 2);
    s = buyCard(s, pid, 0);
    s = endTurn(s, pid);

    const json = serializeGame(s);
    const restored = deserializeGame(json);
    expect(restored).toEqual(s);
    expect(serializeGame(restored)).toBe(json);
    expect(restored.players[0].marketRoads).toEqual(["oil"]);
    expect(restored.turn).toEqual(s.turn);
    expect(restored.rebates).toEqual(s.rebates);
    expect(restored.pendingGrants).toEqual(s.pendingGrants);
  });

  it("rejects corrupt or incompatible saves", () => {
    expect(() => deserializeGame("not json {")).toThrow();
    expect(() => deserializeGame("{}")).toThrow();
    const s = newGame("BAD", 2);
    const tampered = JSON.parse(serializeGame(s));
    tampered.version = 2; // old v2 saves are incompatible
    expect(() => deserializeGame(JSON.stringify(tampered))).toThrow();
  });

  it("a fixed seed produces the same card-market sequence", () => {
    const make = () =>
      createGame({
        seed: "DETERMINISM",
        maxRounds: 10,
        players: [
          { name: "A", isAi: false },
          { name: "B", isAi: false },
        ],
      });
    const a = make();
    const b = make();
    expect(a.cardMarket).toEqual(b.cardMarket);
    expect(a.deck).toEqual(b.deck);
    expect(a.players.map((p) => p.name)).toEqual(b.players.map((p) => p.name));
    expect(a.rngState).toBe(b.rngState);

    const c = createGame({
      seed: "DIFFERENT-SEED",
      maxRounds: 10,
      players: [
        { name: "A", isAi: false },
        { name: "B", isAi: false },
      ],
    });
    expect(c.deck.join(",")).not.toBe(a.deck.join(","));
  });
});
