// Transport layer — the thin pipe the session sends/receives messages over.
//
// Two implementations, one interface:
//   - LocalBroadcastTransport: BroadcastChannel between browser tabs on the
//     same machine. Needs no Steam and no Electron, so the ENTIRE multiplayer
//     flow can be exercised by opening the dev build in two tabs. This is the
//     primary way to test the netcode without a Steam partner account.
//   - SteamTransport: talks to the Electron main process (window.desktop.steam)
//     which owns the real Steamworks lobby + networking. Used in the packaged
//     desktop/Steam build.
//
// The session logic above the transport is identical for both.

import type { NetMessage, PeerId } from "./protocol";
import { parseMessage } from "./protocol";

export interface TransportMember {
  id: PeerId;
  name: string;
}

export interface NetTransport {
  /** This peer's stable id. */
  readonly localId: PeerId;
  /** True if this peer created (hosts) the session. */
  readonly isHost: boolean;
  /** Broadcast a message to every peer in the session (including, harmlessly,
   * not to self — the session never needs its own echo). */
  send(msg: NetMessage): void;
  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  onMessage(cb: (msg: NetMessage) => void): () => void;
  /** Current members (best-effort; may be just {self} until presence resolves). */
  members(): TransportMember[];
  /** Subscribe to membership changes (joins/drops). Returns an unsubscribe fn. */
  onMembersChanged(cb: (members: TransportMember[]) => void): () => void;
  /** Leave and release resources. */
  close(): void;
}

/** Detect the desktop Steam bridge exposed by electron/preload.cjs. */
export function steamAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { desktop?: { steam?: unknown } }).desktop?.steam
  );
}

// ---------------------------------------------------------------------------
// LocalBroadcastTransport — cross-tab, no Steam. Great for development/testing.
// ---------------------------------------------------------------------------

const CHANNEL = "industrial-engine:mp:v1";

interface Envelope {
  kind: "msg" | "presence";
  senderId: PeerId;
  senderName: string;
  isHost: boolean;
  payload?: unknown;
}

export class LocalBroadcastTransport implements NetTransport {
  readonly localId: PeerId;
  readonly isHost: boolean;
  private readonly name: string;
  private readonly ch: BroadcastChannel;
  private readonly msgCbs = new Set<(m: NetMessage) => void>();
  private readonly memberCbs = new Set<(m: TransportMember[]) => void>();
  private readonly seen = new Map<PeerId, TransportMember>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: { isHost: boolean; name: string; id?: PeerId }) {
    this.isHost = opts.isHost;
    this.name = opts.name;
    this.localId = opts.id ?? `local-${Math.random().toString(36).slice(2, 10)}`;
    this.ch = new BroadcastChannel(CHANNEL);
    this.seen.set(this.localId, { id: this.localId, name: this.name });
    this.ch.onmessage = (e) => this.receive(e.data as Envelope);
    // Announce presence now and periodically so late-opening tabs discover us.
    this.announce();
    this.pingTimer = setInterval(() => this.announce(), 2000);
  }

  private announce() {
    const env: Envelope = {
      kind: "presence",
      senderId: this.localId,
      senderName: this.name,
      isHost: this.isHost,
    };
    this.ch.postMessage(env);
  }

  private receive(env: Envelope) {
    if (!env || env.senderId === this.localId) return;
    const known = this.seen.has(env.senderId);
    this.seen.set(env.senderId, { id: env.senderId, name: env.senderName });
    if (!known) {
      this.announce(); // let the newcomer learn about us too
      this.emitMembers();
    }
    if (env.kind === "msg") {
      const msg = parseMessage(env.payload);
      if (msg) this.msgCbs.forEach((cb) => cb(msg));
    }
  }

  private emitMembers() {
    const list = [...this.seen.values()];
    this.memberCbs.forEach((cb) => cb(list));
  }

  send(msg: NetMessage): void {
    const env: Envelope = {
      kind: "msg",
      senderId: this.localId,
      senderName: this.name,
      isHost: this.isHost,
      payload: msg,
    };
    this.ch.postMessage(env);
  }

  onMessage(cb: (m: NetMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  members(): TransportMember[] {
    return [...this.seen.values()];
  }

  onMembersChanged(cb: (m: TransportMember[]) => void): () => void {
    this.memberCbs.add(cb);
    cb(this.members());
    return () => this.memberCbs.delete(cb);
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try {
      this.ch.close();
    } catch {
      /* already closed */
    }
    this.msgCbs.clear();
    this.memberCbs.clear();
  }
}

// ---------------------------------------------------------------------------
// SteamTransport — bridges to the Electron main process's Steamworks lobby.
// The main-process surface is defined in electron/steam.cjs and exposed on
// window.desktop.steam by electron/preload.cjs.
// ---------------------------------------------------------------------------

/** Shape of the bridge the preload script exposes. Kept minimal and stable. */
export interface SteamBridge {
  getIdentity(): Promise<{ id: string; name: string }>;
  /** Create a Steam lobby (friends-only by default). Resolves the lobby id. */
  hostLobby(opts: { maxMembers: number; friendsOnly: boolean }): Promise<string>;
  /** Join a lobby by id (e.g. via a Steam invite / overlay). */
  joinLobby(lobbyId: string): Promise<void>;
  /** Open the Steam overlay's invite dialog for the current lobby. */
  inviteToLobby(): Promise<void>;
  /** Broadcast raw JSON text to all lobby members. */
  send(json: string): void;
  /** Leave the current lobby and tear down networking. */
  leave(): void;
  /** Inbound messages (raw JSON text) from other members. */
  onMessage(cb: (json: string) => void): () => void;
  /** Membership snapshots as members join/leave. */
  onMembers(cb: (members: { id: string; name: string }[]) => void): () => void;
}

function bridge(): SteamBridge {
  const b = (window as unknown as { desktop?: { steam?: SteamBridge } }).desktop
    ?.steam;
  if (!b) throw new Error("Steam bridge unavailable");
  return b;
}

export class SteamTransport implements NetTransport {
  readonly localId: PeerId;
  readonly isHost: boolean;
  private readonly name: string;
  private readonly msgCbs = new Set<(m: NetMessage) => void>();
  private readonly memberCbs = new Set<(m: TransportMember[]) => void>();
  private readonly offMsg: () => void;
  private readonly offMembers: () => void;
  private lastMembers: TransportMember[] = [];

  private constructor(opts: { isHost: boolean; id: PeerId; name: string }) {
    this.isHost = opts.isHost;
    this.localId = opts.id;
    this.name = opts.name;
    this.lastMembers = [{ id: this.localId, name: this.name }];
    this.offMsg = bridge().onMessage((json) => {
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch {
        return;
      }
      const msg = parseMessage(raw);
      if (msg) this.msgCbs.forEach((cb) => cb(msg));
    });
    this.offMembers = bridge().onMembers((members) => {
      this.lastMembers = members.map((m) => ({ id: m.id, name: m.name }));
      this.memberCbs.forEach((cb) => cb(this.lastMembers));
    });
  }

  /** Host a new Steam lobby. */
  static async host(name: string, maxMembers: number): Promise<SteamTransport> {
    const id = (await bridge().getIdentity()).id;
    await bridge().hostLobby({ maxMembers, friendsOnly: true });
    return new SteamTransport({ isHost: true, id, name });
  }

  /** Join an existing Steam lobby (from an invite). */
  static async join(name: string, lobbyId: string): Promise<SteamTransport> {
    const id = (await bridge().getIdentity()).id;
    await bridge().joinLobby(lobbyId);
    return new SteamTransport({ isHost: false, id, name });
  }

  invite(): void {
    void bridge().inviteToLobby();
  }

  send(msg: NetMessage): void {
    bridge().send(JSON.stringify(msg));
  }

  onMessage(cb: (m: NetMessage) => void): () => void {
    this.msgCbs.add(cb);
    return () => this.msgCbs.delete(cb);
  }

  members(): TransportMember[] {
    return this.lastMembers;
  }

  onMembersChanged(cb: (m: TransportMember[]) => void): () => void {
    this.memberCbs.add(cb);
    cb(this.lastMembers);
    return () => this.memberCbs.delete(cb);
  }

  close(): void {
    this.offMsg();
    this.offMembers();
    this.msgCbs.clear();
    this.memberCbs.clear();
    try {
      bridge().leave();
    } catch {
      /* ignore */
    }
  }
}
