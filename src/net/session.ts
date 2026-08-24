// MultiplayerSession — protocol/state-machine on top of a NetTransport.
//
// Responsibilities:
//   - Host owns the authoritative LobbyState (seats + settings + phase) and
//     assigns joining peers to open human seats.
//   - Relays full serialized GameState between the active-seat "driver" and
//     everyone else, with a monotonic sequence guard.
//   - Exposes a tiny event API the React hook binds to.
//
// It deliberately knows nothing about React or the engine's internals — it only
// moves opaque serialized states and lobby metadata around.

import type { GameModifiers } from "../engine/types";
import type { LobbyState, NetMessage, PeerId, Seat } from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";
import type { NetTransport, TransportMember } from "./transport";

type Listener<T> = (value: T) => void;

export interface ChatLine {
  from: PeerId;
  name: string;
  text: string;
}

/** Initial table configuration a host opens the lobby with. */
export interface HostConfig {
  seed: string;
  maxRounds: number;
  modifiers: GameModifiers;
  aiClassAffinity: boolean;
  seats: Omit<Seat, "index" | "ownerId">[];
  hostName: string;
}

export class MultiplayerSession {
  readonly transport: NetTransport;
  private lobby: LobbyState;
  private stateSeq = 0;
  private lastSeenSeq = 0;

  private readonly lobbyListeners = new Set<Listener<LobbyState>>();
  private readonly stateListeners = new Set<Listener<{ state: string; seq: number }>>();
  private readonly chatListeners = new Set<Listener<ChatLine>>();
  private readonly offFns: (() => void)[] = [];

  constructor(transport: NetTransport, initial: LobbyState) {
    this.transport = transport;
    this.lobby = initial;
    this.offFns.push(transport.onMessage((m) => this.handle(m)));
    this.offFns.push(
      transport.onMembersChanged((members) => this.onMembers(members)),
    );
    if (!transport.isHost) {
      // Announce ourselves so the host can seat us.
      transport.send({
        t: "hello",
        v: PROTOCOL_VERSION,
        from: transport.localId,
        name: this.myName(),
      });
    }
  }

  // ---- Factory: build the initial lobby a host starts with ---------------
  static hostLobby(transport: NetTransport, cfg: HostConfig): MultiplayerSession {
    const seats: Seat[] = cfg.seats.map((s, index) => ({
      ...s,
      index,
      ownerId: null,
    }));
    // Host claims the first human seat.
    const firstHuman = seats.find((s) => s.kind === "human");
    if (firstHuman) {
      firstHuman.ownerId = transport.localId;
      firstHuman.name = cfg.hostName;
    }
    const lobby: LobbyState = {
      hostId: transport.localId,
      seed: cfg.seed,
      maxRounds: cfg.maxRounds,
      modifiers: cfg.modifiers,
      aiClassAffinity: cfg.aiClassAffinity,
      seats,
      phase: "lobby",
    };
    const session = new MultiplayerSession(transport, lobby);
    session.dedupe();
    session.broadcastLobby();
    return session;
  }

  /** A joiner starts with an empty placeholder lobby until the host's snapshot
   * arrives. */
  static joinLobby(transport: NetTransport): MultiplayerSession {
    const placeholder: LobbyState = {
      hostId: "",
      seed: "",
      maxRounds: 0,
      modifiers: {
        knifeFight: false,
        randomResources: false,
        viscousMarkets: false,
        cyclicalEconomy: false,
      },
      aiClassAffinity: true,
      seats: [],
      phase: "lobby",
    };
    return new MultiplayerSession(transport, placeholder);
  }

  // ---- Public accessors ---------------------------------------------------
  get localId(): PeerId {
    return this.transport.localId;
  }
  get isHost(): boolean {
    return this.transport.isHost;
  }
  getLobby(): LobbyState {
    return this.lobby;
  }
  private myName(): string {
    // Once seated, use the seat name. Before that (a joiner announcing itself),
    // fall back to the name the transport was created with (present in its
    // member list) so the host seats us under our chosen name, not "Player".
    const mine = this.lobby.seats.find((s) => s.ownerId === this.localId);
    if (mine) return mine.name;
    const me = this.transport.members().find((m) => m.id === this.localId);
    return me?.name ?? "Player";
  }

  /** Is this client responsible for driving the given active player?
   *
   * The engine shuffles seat order from the seed, so the game's
   * `activePlayerIndex` does NOT line up with lobby seat order — only the
   * player *name* carries through `createGame`. Seat names are kept unique
   * (see `dedupe`) so a name maps to exactly one seat. The seat's human owner
   * drives their own turn; the host drives AI seats and any dropped seat. */
  amDriver(playerName: string): boolean {
    const seat = this.lobby.seats.find((s) => s.name === playerName);
    if (!seat) return this.isHost; // unknown seat → host drives, as a safety net
    if (seat.ownerId) return seat.ownerId === this.localId;
    return this.isHost; // AI or dropped seat → host drives
  }

  /** True once every human seat has a connected owner. */
  canStart(): boolean {
    return (
      this.isHost &&
      this.lobby.seats.length >= 2 &&
      this.lobby.seats
        .filter((s) => s.kind === "human")
        .every((s) => s.ownerId !== null)
    );
  }

  // ---- Host mutations -----------------------------------------------------
  /** Host: replace the editable roster/settings and rebroadcast. Preserves the
   * current owners of human seats where possible (by position). */
  updateConfig(patch: {
    seed?: string;
    maxRounds?: number;
    modifiers?: GameModifiers;
    aiClassAffinity?: boolean;
    seats?: Omit<Seat, "index" | "ownerId">[];
  }): void {
    if (!this.isHost) return;
    if (patch.seats) {
      const prevOwners = this.lobby.seats.map((s) => s.ownerId);
      this.lobby.seats = patch.seats.map((s, index) => ({
        ...s,
        index,
        ownerId: s.kind === "human" ? (prevOwners[index] ?? null) : null,
      }));
    }
    if (patch.seed !== undefined) this.lobby.seed = patch.seed;
    if (patch.maxRounds !== undefined) this.lobby.maxRounds = patch.maxRounds;
    if (patch.modifiers) this.lobby.modifiers = patch.modifiers;
    if (patch.aiClassAffinity !== undefined)
      this.lobby.aiClassAffinity = patch.aiClassAffinity;
    this.fillOpenSeats();
    this.dedupe();
    this.broadcastLobby();
  }

  /** Host: seat any connected members who aren't yet in a seat into the open
   * human seats (e.g. after the host converts an AI seat to human while a
   * player is already waiting in the lobby). Returns whether anything changed. */
  private fillOpenSeats(): boolean {
    if (!this.isHost) return false;
    const seated = new Set(
      this.lobby.seats.map((s) => s.ownerId).filter((id): id is PeerId => !!id),
    );
    let changed = false;
    for (const m of this.transport.members()) {
      if (m.id === this.localId || seated.has(m.id)) continue;
      const open = this.lobby.seats.find(
        (s) => s.kind === "human" && s.ownerId === null,
      );
      if (!open) break;
      open.ownerId = m.id;
      if (m.name) open.name = m.name;
      seated.add(m.id);
      changed = true;
    }
    return changed;
  }

  /** Ensure every seat name is unique so it maps 1:1 to a game player (the
   * engine only carries the name through createGame). Duplicates get a
   * " (2)", " (3)" suffix. */
  private dedupe(): void {
    const seen = new Map<string, number>();
    for (const s of this.lobby.seats) {
      const base = s.name?.trim() || (s.kind === "ai" ? "AI" : "Player");
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      s.name = n === 1 ? base : `${base} (${n})`;
    }
  }

  /** Host: move to the playing phase. The caller (App) then builds the game
   * from `getLobby()` and calls `broadcastState` with the initial state. */
  start(): void {
    if (!this.canStart()) return;
    this.lobby.phase = "playing";
    this.broadcastLobby();
  }

  // ---- Driver → everyone: state relay ------------------------------------
  broadcastState(serialized: string): void {
    this.stateSeq += 1;
    this.lastSeenSeq = this.stateSeq;
    this.transport.send({
      t: "state",
      v: PROTOCOL_VERSION,
      seq: this.stateSeq,
      state: serialized,
    });
  }

  sendChat(text: string): void {
    this.transport.send({
      t: "chat",
      v: PROTOCOL_VERSION,
      from: this.localId,
      name: this.myName(),
      text,
    });
  }

  // ---- Subscriptions ------------------------------------------------------
  onLobby(cb: Listener<LobbyState>): () => void {
    this.lobbyListeners.add(cb);
    cb(this.lobby);
    return () => this.lobbyListeners.delete(cb);
  }
  onState(cb: Listener<{ state: string; seq: number }>): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  onChat(cb: Listener<ChatLine>): () => void {
    this.chatListeners.add(cb);
    return () => this.chatListeners.delete(cb);
  }

  leave(): void {
    this.transport.send({ t: "bye", v: PROTOCOL_VERSION, from: this.localId });
    this.offFns.forEach((off) => off());
    this.lobbyListeners.clear();
    this.stateListeners.clear();
    this.chatListeners.clear();
    this.transport.close();
  }

  // ---- Internals ----------------------------------------------------------
  private broadcastLobby(): void {
    this.transport.send({ t: "lobby", v: PROTOCOL_VERSION, lobby: this.lobby });
    this.emitLobby();
  }
  private emitLobby(): void {
    // Emit a fresh snapshot: the lobby is mutated in place, so passing the same
    // object reference to React's setState would be skipped (Object.is bail-out)
    // and the UI would not re-render on phase/seat/option changes.
    const snapshot: LobbyState = {
      ...this.lobby,
      modifiers: { ...this.lobby.modifiers },
      seats: this.lobby.seats.map((s) => ({ ...s })),
    };
    this.lobbyListeners.forEach((cb) => cb(snapshot));
  }

  private handle(m: NetMessage): void {
    switch (m.t) {
      case "hello":
        if (this.isHost) this.seatJoiner(m.from, m.name);
        break;
      case "lobby":
        if (!this.isHost) {
          this.lobby = m.lobby;
          this.emitLobby();
        }
        break;
      case "state":
        if (m.seq > this.lastSeenSeq) {
          this.lastSeenSeq = m.seq;
          this.stateSeq = Math.max(this.stateSeq, m.seq);
          this.stateListeners.forEach((cb) => cb({ state: m.state, seq: m.seq }));
        }
        break;
      case "chat":
        this.chatListeners.forEach((cb) =>
          cb({ from: m.from, name: m.name, text: m.text }),
        );
        break;
      case "bye":
        if (this.isHost) this.releaseSeatsOf(m.from);
        break;
    }
  }

  /** Host: give a newly-arrived peer the first open human seat. */
  private seatJoiner(peerId: PeerId, name: string): void {
    if (this.lobby.seats.some((s) => s.ownerId === peerId)) {
      this.broadcastLobby(); // already seated — just resync them
      return;
    }
    const open = this.lobby.seats.find(
      (s) => s.kind === "human" && s.ownerId === null,
    );
    if (open) {
      open.ownerId = peerId;
      if (name) open.name = name;
    }
    this.dedupe();
    this.broadcastLobby();
  }

  /** Host: on a dropped/leaving peer, free their seats (host will drive them). */
  private releaseSeatsOf(peerId: PeerId): void {
    let changed = false;
    for (const s of this.lobby.seats) {
      if (s.ownerId === peerId) {
        s.ownerId = null;
        changed = true;
      }
    }
    if (changed) this.broadcastLobby();
  }

  private onMembers(members: TransportMember[]): void {
    if (!this.isHost) return;
    // Release seats whose owner is no longer present, then seat any newly
    // connected members waiting for an open seat.
    const present = new Set(members.map((mm) => mm.id));
    let changed = false;
    for (const s of this.lobby.seats) {
      if (s.ownerId && !present.has(s.ownerId)) {
        s.ownerId = null;
        changed = true;
      }
    }
    if (this.fillOpenSeats()) changed = true;
    if (changed) {
      this.dedupe();
      this.broadcastLobby();
    }
  }
}
