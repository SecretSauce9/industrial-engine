// Steamworks bridge (main process) — validated against steamworks.js@0.4.0.
//
// Wraps steamworks.js — lobby matchmaking + P2P messaging — and exposes a small
// stable IPC surface consumed by electron/preload.cjs → window.desktop.steam →
// src/net/transport.ts (SteamTransport).
//
// Everything is guarded: if steamworks.js isn't installed, Steam isn't running,
// or init throws, `client` stays null, the bridge is never exposed, and the
// renderer falls back to local play. The desktop build always runs.
//
// API notes for steamworks.js@0.4.0 (verified from its client.d.ts):
//   - steamworks.init(appId) returns the client and starts its own callback
//     loop (runCallbacks @30Hz); we only additionally poll for P2P packets.
//   - There is NO lobby-chat API and NO EventEmitter (.on). Messaging goes over
//     networking.sendP2PPacket(steamId64, sendType, Buffer) + readP2PPacket().
//   - Steam events arrive via client.callback.register(SteamCallback.X, cb).
//   - LobbyType: Private=0, FriendsOnly=1, Public=2, Invisible=3.
//   - networking.SendType.Reliable = 2.

const { ipcMain } = require("electron");

let steamworks = null;
try {
  steamworks = require("steamworks.js");
} catch {
  steamworks = null; // dependency not installed → Steam features disabled
}

const LOBBY_FRIENDS_ONLY = 1; // steamworks matchmaking.LobbyType.FriendsOnly
const LOBBY_PUBLIC = 2; // matchmaking.LobbyType.Public
const SEND_RELIABLE = 2; // networking.SendType.Reliable

/** @type {any} */ let client = null;
/** @type {any} */ let currentLobby = null;
let sender = null; // renderer webContents to emit inbound messages/members to
let pumpTimer = null;
let preInited = false;
let ipcRegistered = false;
const callbackHandles = [];

function emit(channel, payload) {
  if (sender && !sender.isDestroyed()) sender.send(channel, payload);
}

function appIdFromEnv() {
  const raw = process.env.STEAM_APPID || process.env.SteamAppId;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 480; // 480 = Spacewar test app
}

/**
 * Initialize Steam + overlay. MUST run before app 'ready' because
 * electronEnableSteamOverlay appends GPU command-line switches that only take
 * effect pre-ready. Returns true on success. Safe to call when Steam is absent.
 */
function preInit() {
  if (preInited) return !!client;
  preInited = true;
  if (!steamworks) return false;
  try {
    client = steamworks.init(appIdFromEnv());
  } catch {
    client = null;
    return false;
  }
  try {
    steamworks.electronEnableSteamOverlay();
  } catch {
    /* overlay optional */
  }
  registerCallbacks();
  pumpTimer = setInterval(pump, 50);
  return true;
}

function registerCallbacks() {
  const CB = steamworks.SteamCallback;
  const reg = (type, handler) => {
    try {
      callbackHandles.push(client.callback.register(type, handler));
    } catch {
      /* this callback type may be unavailable — non-fatal */
    }
  };
  // Accept incoming P2P sessions so packets from peers are delivered.
  reg(CB.P2PSessionRequest, (data) => {
    try {
      client.networking.acceptP2PSession(data.remote);
    } catch {
      /* ignore */
    }
  });
  // Lobby membership changed (join/leave/disconnect) → refresh member list.
  reg(CB.LobbyChatUpdate, emitMembers);
  reg(CB.LobbyDataUpdate, emitMembers);
  // A friend chose "Join game" from the Steam overlay/friends list.
  reg(CB.GameLobbyJoinRequested, (data) => {
    void joinLobby(String(data.lobby_steam_id));
  });
}

/** Poll for inbound P2P packets and forward their JSON text to the renderer. */
function pump() {
  if (!client) return;
  try {
    const net = client.networking;
    let size;
    while ((size = net.isP2PPacketAvailable()) > 0) {
      const pkt = net.readP2PPacket(size);
      if (pkt && pkt.data) emit("steam:message", Buffer.from(pkt.data).toString("utf8"));
    }
  } catch {
    /* transient read error — ignore this tick */
  }
}

/** Raw lobby members as PlayerSteamId objects (steamId64 is a bigint). */
function rawMembers() {
  try {
    return currentLobby?.getMembers?.() ?? [];
  } catch {
    return [];
  }
}

/** Members for the renderer: {id, name}. steamworks.js@0.4.0 exposes a name
 * only for the local player, so remote names fall back to the id; the app-level
 * protocol carries real display names in its hello/lobby messages. */
function members() {
  let myId = "";
  let myName = "Player";
  try {
    myId = String(client.localplayer.getSteamId().steamId64);
    myName = client.localplayer.getName();
  } catch {
    /* ignore */
  }
  return rawMembers().map((m) => {
    const id = String(m.steamId64);
    return { id, name: id === myId ? myName : id };
  });
}

function emitMembers() {
  emit("steam:members", members());
}

async function hostLobby({ maxMembers, friendsOnly }) {
  if (!client) throw new Error("Steam not initialized");
  currentLobby = await client.matchmaking.createLobby(
    friendsOnly ? LOBBY_FRIENDS_ONLY : LOBBY_PUBLIC,
    maxMembers || 4,
  );
  emitMembers();
  return String(currentLobby.id);
}

async function joinLobby(lobbyId) {
  if (!client) throw new Error("Steam not initialized");
  currentLobby = await client.matchmaking.joinLobby(BigInt(lobbyId));
  emit("steam:joined", String(lobbyId));
  emitMembers();
}

/** Broadcast a JSON string to every other lobby member over reliable P2P. */
function send(json) {
  if (!client || !currentLobby) return;
  const buf = Buffer.from(json, "utf8");
  let myId = "";
  try {
    myId = String(client.localplayer.getSteamId().steamId64);
  } catch {
    /* ignore */
  }
  for (const m of rawMembers()) {
    if (String(m.steamId64) === myId) continue;
    try {
      client.networking.sendP2PPacket(m.steamId64, SEND_RELIABLE, buf);
    } catch {
      /* peer unreachable this tick */
    }
  }
}

function leave() {
  try {
    currentLobby?.leave?.();
  } catch {
    /* ignore */
  }
  currentLobby = null;
  emitMembers();
}

function invite() {
  try {
    currentLobby?.openInviteDialog?.();
  } catch {
    /* overlay may be disabled */
  }
}

function identity() {
  try {
    return {
      id: String(client.localplayer.getSteamId().steamId64),
      name: client.localplayer.getName(),
    };
  } catch {
    return { id: "", name: "Player" };
  }
}

/** Set the renderer to emit inbound messages/members to. Call after the window
 * is created. */
function attach(webContents) {
  sender = webContents;
}

/** Register IPC handlers. Idempotent — the window may be recreated (macOS). */
function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  // Synchronous check used by the preload script at page-load time.
  ipcMain.on("steam:available-sync", (e) => {
    e.returnValue = !!client;
  });
  ipcMain.handle("steam:available", () => !!client);
  ipcMain.handle("steam:identity", () => identity());
  ipcMain.handle("steam:host", (_e, opts) => hostLobby(opts));
  ipcMain.handle("steam:join", (_e, lobbyId) => joinLobby(lobbyId));
  ipcMain.handle("steam:invite", () => invite());
  ipcMain.handle("steam:leave", () => leave());
  ipcMain.on("steam:send", (_e, json) => send(json));
  // Periodic membership refresh as a safety net.
  setInterval(() => {
    if (currentLobby) emitMembers();
  }, 3000);
}

function dispose() {
  if (pumpTimer) clearInterval(pumpTimer);
  pumpTimer = null;
  for (const h of callbackHandles) {
    try {
      h.disconnect();
    } catch {
      /* ignore */
    }
  }
  callbackHandles.length = 0;
  leave();
}

module.exports = {
  preInit,
  attach,
  registerIpc,
  dispose,
  isAvailable: () => !!client,
};
