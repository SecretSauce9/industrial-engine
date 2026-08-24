// Preload — runs in an isolated context before the renderer loads.
//
// Exposes `window.desktop`. The renderer game is a self-contained web app that
// needs no Node APIs, so the surface is deliberately tiny:
//   - desktop.isDesktop / platform: presence detection for the UI.
//   - desktop.steam: the Steamworks bridge for multiplayer — ONLY attached when
//     Steam actually initialized in the main process, so the renderer's
//     `steamAvailable()` (which checks for window.desktop.steam) is accurate and
//     falls back to local play otherwise.
const { contextBridge, ipcRenderer } = require("electron");

// Synchronous so we can decide before the page's scripts run. Guarded: if the
// main process hasn't registered the handler (Steam module absent), treat as
// unavailable.
let steamReady = false;
try {
  steamReady = ipcRenderer.sendSync("steam:available-sync") === true;
} catch {
  steamReady = false;
}

/** The Steamworks bridge — shape matches SteamBridge in src/net/transport.ts. */
const steam = {
  getIdentity: () => ipcRenderer.invoke("steam:identity"),
  hostLobby: (opts) => ipcRenderer.invoke("steam:host", opts),
  joinLobby: (lobbyId) => ipcRenderer.invoke("steam:join", lobbyId),
  inviteToLobby: () => ipcRenderer.invoke("steam:invite"),
  leave: () => ipcRenderer.invoke("steam:leave"),
  send: (json) => ipcRenderer.send("steam:send", json),
  onMessage: (cb) => {
    const listener = (_e, json) => cb(json);
    ipcRenderer.on("steam:message", listener);
    return () => ipcRenderer.removeListener("steam:message", listener);
  },
  onMembers: (cb) => {
    const listener = (_e, members) => cb(members);
    ipcRenderer.on("steam:members", listener);
    return () => ipcRenderer.removeListener("steam:members", listener);
  },
};

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
  shellVersion: 1,
  // Only present when Steam is live, so the renderer detects it correctly.
  ...(steamReady ? { steam } : {}),
});
