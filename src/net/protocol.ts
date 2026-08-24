// Multiplayer wire protocol (v1).
//
// Model: "active-seat-authoritative full-state relay". The game is strictly
// turn-based, deterministic, and its entire state (including RNG) serializes to
// a string. So instead of streaming per-action commands, the client that owns
// the *currently active seat* runs the engine locally (exactly as in the local
// game) and then broadcasts the whole serialized GameState. Every other client
// replaces its state with the broadcast — desync is impossible because the
// state is authoritative and complete.
//
// The lobby host owns setup, seat assignment, and drives all AI seats (and any
// seat whose human owner has dropped). Trust model: on your turn, your client
// is authoritative for your own moves. That is the standard, zero-cost model
// for a friends/turn-based game; host-validated action replay (anti-cheat) is a
// future upgrade that this relay can evolve into without changing the transport.

import type { AiDifficulty, ClassId, GameModifiers } from "../engine/types";

/** Protocol version — bump on any incompatible message-shape change. */
export const PROTOCOL_VERSION = 1;

/** A stable per-connection identity (Steam ID string, or a random id for the
 * local BroadcastChannel transport used in the browser). */
export type PeerId = string;

/** One seat at the table. Order matches the eventual GameState.players order. */
export interface Seat {
  index: number;
  name: string;
  kind: "human" | "ai";
  aiDifficulty?: AiDifficulty;
  classId?: ClassId;
  /** Peer that controls this seat. null = open human seat (awaiting a join) or
   * a dropped player (temporarily driven by the host). AI seats are host-driven
   * and leave this null. */
  ownerId: PeerId | null;
}

/** Everything needed to render the lobby and, on start, build GameSettings. */
export interface LobbyState {
  hostId: PeerId;
  seed: string;
  maxRounds: number;
  modifiers: GameModifiers;
  aiClassAffinity: boolean;
  seats: Seat[];
  phase: "lobby" | "playing";
}

export type NetMessage =
  /** Sent by a joining peer to announce itself to the host. */
  | { t: "hello"; v: number; from: PeerId; name: string }
  /** Host → everyone: authoritative lobby snapshot (seats, settings, phase). */
  | { t: "lobby"; v: number; lobby: LobbyState }
  /** Driver → everyone: the full serialized GameState after a move. `seq`
   * increases monotonically so stale packets can be dropped. */
  | { t: "state"; v: number; seq: number; state: string }
  /** Any peer → everyone: lightweight lobby/game chat. */
  | { t: "chat"; v: number; from: PeerId; name: string; text: string }
  /** A peer is leaving cleanly (best-effort; Steam also fires drop events). */
  | { t: "bye"; v: number; from: PeerId };

/** Type guard + version check for anything arriving off the wire. */
export function parseMessage(raw: unknown): NetMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { t?: unknown; v?: unknown };
  if (typeof m.t !== "string") return null;
  if (m.v !== PROTOCOL_VERSION) return null; // ignore other protocol versions
  return raw as NetMessage;
}
