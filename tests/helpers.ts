// Shared test helpers (v3 rules).

import type { GameState } from "../src/engine/types";
import { createGame, devTools } from "../src/engine/game";

/** Deterministic 2-player human game. */
export function newGame(
  seed = "TEST-SEED",
  players = 2,
  maxRounds = 10,
): GameState {
  return createGame({
    seed,
    maxRounds,
    players: Array.from({ length: players }, (_, i) => ({
      name: `P${i + 1}`,
      isAi: false,
    })),
  });
}

export function activeId(state: GameState): string {
  return state.players[state.activePlayerIndex].id;
}

export function active(state: GameState) {
  return state.players[state.activePlayerIndex];
}

/** Grant a card to the ACTIVE player, returning [state, instanceId]. */
export function grant(
  state: GameState,
  cardTypeId: string,
): [GameState, string] {
  const pid = activeId(state);
  const next = devTools.grantCard(state, pid, cardTypeId);
  const p = next.players.find((pl) => pl.id === pid)!;
  return [next, p.cards[p.cards.length - 1].instanceId];
}

/** Grant several cards, returning [state, instanceIds]. */
export function grantAll(
  state: GameState,
  cardTypeIds: string[],
): [GameState, string[]] {
  let s = state;
  const ids: string[] = [];
  for (const t of cardTypeIds) {
    let id: string;
    [s, id] = grant(s, t);
    ids.push(id);
  }
  return [s, ids];
}

/** Give warehouse resources to the ACTIVE player. */
export function give(
  state: GameState,
  resources: Record<string, number>,
): GameState {
  const pid = activeId(state);
  let s = state;
  for (const [rid, n] of Object.entries(resources)) {
    s = devTools.addResource(s, pid, rid, n);
  }
  return s;
}

/** Give cash to the ACTIVE player. */
export function fund(state: GameState, amount: number): GameState {
  return devTools.addCash(state, activeId(state), amount);
}

/** Find a card instance on the active player. */
export function inst(state: GameState, instanceId: string) {
  return active(state).cards.find((c) => c.instanceId === instanceId)!;
}
