# Releasing Industrial Engine on Steam

Steam ships **native desktop executables**, not web pages. This repo now wraps
the self-contained web build in an [Electron](https://www.electronjs.org/)
desktop shell so it can be packaged into a Windows `.exe` (plus optional
macOS/Linux builds) and uploaded to a Steam depot.

The game itself is unchanged — the Electron window loads the same bundled
`app/index.html` the browser build produces. Everything runs offline and saves
locally, which suits Steam's requirement that a game be fully playable without
the Steam client attached.

---

## What was added

| Path | Purpose |
| --- | --- |
| `electron/main.cjs` | Desktop window: single-instance lock, fullscreen (F11 / Alt+Enter), dark background, external-link hardening, Steam-overlay-friendly (GPU left on). |
| `electron/preload.cjs` | Minimal isolated bridge exposing `window.desktop` (no Node in the renderer). |
| `scripts/build-electron-app.ts` | Bundles `app/` directly from `src/` via Bun. Run via `bun run build:app`. |
| `steam_appid.txt` | Lets the Steam client associate the running process with your app during testing. Contains `480` (Spacewar test app) — **replace with your real App ID**. |
| `build/icon.svg` | Source art for the app icon. Convert to raster icons before shipping (below). |
| `package.json` → `build` block | electron-builder configuration and the `dist:*` scripts. |

The web toolchain (`bun run dev`, `test`, `build`, balance/simulate scripts) is
untouched.

---

## Prerequisites

Two runtimes:

- **Bun** (https://bun.sh) — the project's bundler/dev-server/test-runner and the
  app-bundle build (`build:app`).
- **Node.js 18+** (https://nodejs.org) — **electron-builder requires Node**; it
  does not run under Bun (Bun's node-compat trips on electron-builder's
  internals). You only need Node for the packaging step.
- To sign the executable (recommended for Steam so SmartScreen/AV don't flag it),
  a code-signing certificate. Unsigned builds still run.

> Verified in this repo: Bun 1.3.14 + Node 24 LTS. `bun install` pulls
> everything (electron, electron-builder, **steamworks.js@0.4.0**, react).

```bash
bun install          # installs all deps
```

## Try it locally (no packaging)

```bash
bun run desktop      # bundles src → app/, then launches the Electron window
```

Fastest way to confirm the game renders and goes fullscreen in the desktop
shell. **Verified booting**: the Electron window loads the bundle and, with
Steam not running, cleanly falls back to local play.

## Build the Steam-ready package

```bash
bun run dist:steam   # → release/win-unpacked/  (unpacked build for a Steam depot)
```

**Verified**: this produces `release/win-unpacked/` containing
`Industrial Engine.exe`, `app.asar` (the game), `app.asar.unpacked/` with the
steamworks.js native binding + `steam_api64.dll`, and `steam_appid.txt` beside
the exe. The packaged exe boots and loads the game from the asar.

**This folder is what you upload as your Steam depot content.** Steam runs its
own install/update on top of it, so the unpacked (`--dir`) target — not an
installer — is the right thing to ship to Steam.

> **Windows note:** electron-builder extracts `winCodeSign`, which contains
> macOS symlinks; on Windows that needs symlink privilege. If you hit
> `Cannot create symbolic link … A required privilege is not held`, enable
> **Developer Mode** (Settings → Privacy & security → For developers) or run the
> build from an elevated shell. For an unsigned `--dir` build the error is
> non-fatal and the package still completes.

Other targets (not needed for Steam, useful for direct/itch.io distribution):

```bash
bun run dist:win     # unpacked + an NSIS .exe installer, in release/
bun run dist:mac     # macOS .app (must be run on macOS)
bun run dist:linux   # Linux unpacked build
```

---

## App icon (do before shipping)

electron-builder auto-detects `build/icon.ico` (Windows) and `build/icon.png`
(≥512×512, macOS/Linux) if present; without them it uses Electron's default
icon and the build still succeeds. Generate them from `build/icon.svg`:

- Quick path: open `build/icon.svg` in any converter (e.g. an online SVG→PNG /
  SVG→ICO tool, or Inkscape / ImageMagick) and export:
  - `build/icon.png` at 512×512 (or 1024×1024)
  - `build/icon.ico` containing 256/128/64/48/32/16 px
- With ImageMagick installed: `magick build/icon.svg -resize 512x512 build/icon.png`
  then `magick build/icon.svg -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico`

No config change is needed — just drop the files in `build/`.

---

## Wiring up your Steam App ID

1. In Steamworks, create your app and note its **App ID** (a number).
2. Replace the contents of `steam_appid.txt` with that number (digits only, no
   trailing text). It is copied next to the packaged executable so the Steam
   client can attach the overlay during local testing.
3. Configure your **depot** in Steamworks to use `release/win-unpacked/` as its
   content root, set the **launch option** to `Industrial Engine.exe`, and
   upload with `steamcmd` / the Steam SDK's `ContentBuilder`.

## Steam Overlay

The in-game overlay (Shift+Tab) attaches automatically when the game is
**launched through Steam**, because the Electron window keeps hardware-
accelerated rendering enabled (we never pass `--disable-gpu`). No extra code is
required for the overlay itself. If it fails to appear, verify the game is
started from the Steam library (not the raw `.exe`) and that the overlay is
enabled in Steam settings.

---

## Online multiplayer (friends + Steam lobbies)

Industrial Engine now has **online multiplayer** for the Steam release. Because
the game is strictly turn-based and its entire state (including RNG) serializes
to a string, the netcode is a **full-state relay**: the client whose turn it is
runs the engine locally and broadcasts the resulting serialized state; every
other client replaces its state with the broadcast. Desync is impossible.

**Architecture** (all additive — the local hot-seat game is unchanged):

| Layer | File |
| --- | --- |
| Wire protocol (messages, seats) | `src/net/protocol.ts` |
| Transport interface + Steam + local impls | `src/net/transport.ts` |
| Session (seat assignment, driver election, relay) | `src/net/session.ts` |
| React binding | `src/net/useMultiplayer.ts` |
| Lobby UI | `src/ui/MultiplayerLobby.tsx` |
| App integration (broadcast/apply, turn gating) | `src/App.tsx` |
| Steam lobby + messaging (main process) | `electron/steam.cjs` |

- **Host-authoritative per turn.** The lobby host owns setup, drives AI/dropped
  seats, and seeds the game. On your turn your client is authoritative for your
  own moves — the standard, zero-server model for a turn-based friends game.
  (Host-validated action replay for anti-cheat is a clean future upgrade of the
  same relay.)
- **No servers, no accounts, no hosting cost.** Steam lobbies + Steam's relay
  carry everything; friends join via the overlay invite.

### Test it right now — no Steam needed

The transport falls back to a `BroadcastChannel` between browser tabs when Steam
isn't present, so you can exercise the **entire** multiplayer flow locally:

```bash
bun run dev                 # open the printed URL
```

1. In the setup screen, under **🌐 Play online**, set both seats to **Human**
   (so there's an open seat), then click **Host online game**.
2. Open the same URL in a **second browser tab**, type a name, click **Join
   game** — it appears in the host's lobby and claims the open seat.
3. Host clicks **Start game**. Each tab can only act on its own turn; watch the
   board and action log stay in sync across tabs.

This validates the netcode, lobby, seat assignment, turn gating, and chat
independently of Steam.

### Getting multiplayer into the *desktop* build

`bun run build:app` bundles `app/` **directly from `src/`** (via Bun, with
relative asset paths that load under `file://`), so the desktop/Steam build
always includes the latest source — multiplayer and all. No hand-maintained
standalone to regenerate. `desktop` and every `dist:*` script run `build:app`
first, so the packaged app is always current.

### Steam binding — validated against steamworks.js@0.4.0

`electron/steam.cjs` binds `steamworks.js` (declared **optional**; `bun install`
won't fail if a native build can't be fetched). It is fully guarded: if Steam or
the module is absent, the bridge isn't exposed and the game falls back to local
play.

The bindings were rewritten and validated against the installed
**steamworks.js@0.4.0** API surface:

- Messaging uses **reliable P2P** (`networking.sendP2PPacket`/`readP2PPacket` +
  `acceptP2PSession`) — 0.4.0 has no lobby-chat API.
- Events use `client.callback.register(SteamCallback.X, …)` (there is no
  EventEmitter): `P2PSessionRequest`, `LobbyChatUpdate`, `GameLobbyJoinRequested`.
- `matchmaking.createLobby(FriendsOnly=1, max)` / `joinLobby(bigint)`;
  `Lobby.openInviteDialog()`; `localplayer` for identity. Overlay is enabled
  **before app ready** (its GPU switches require that).

Still requires a **live Steam client + a second account** to exercise the actual
lobby/relay end-to-end (the local `BroadcastChannel` transport is what was
verified in-repo). Remote members show a Steam-ID placeholder in the transport
layer, but the lobby/seat UI uses the real names carried in the app protocol.

---

## Not included yet

Deliberately **not** wired up (all can be layered on without changing packaging
or the multiplayer transport):

- **Achievements** — needs the Steamworks SDK bound in (e.g.
  [`steamworks.js`](https://github.com/ceifa/steamworks.js)) and achievement IDs
  defined in Steamworks, plus calls from the game when a finished good is first
  produced, a game is won, etc.
- **Steam Cloud saves** — the game currently saves to the Electron profile's
  `localStorage` (persists locally across launches). Cloud sync means either
  mapping Steam Auto-Cloud to that profile directory, or moving saves to files
  and registering them with the Cloud API.
- **Rich presence / stats / leaderboards.**

All of these can be layered on later without changing the packaging setup — the
`window.desktop` bridge in `preload.cjs` is the intended seam for exposing
Steamworks calls to the game UI.

## Steamworks store/legal checklist (outside this repo)

Steam approval also requires, in the Steamworks partner site: store page assets
(capsule images, screenshots, trailer optional), a completed content survey,
your bank/tax info, the $100 app fee paid, and a build that passes Steam's
review. This repo covers the **technical build**; those are account/store steps.
