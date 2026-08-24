// Industrial Engine — Electron main process
//
// Wraps the fully self-contained web build (app/index.html) in a desktop
// window that Steam can launch. Designed for an offline, single-player,
// hot-seat game: no network, no external navigation, saves persist to the
// per-user Electron profile (localStorage under app.getPath('userData')).
//
// Steam notes:
//   - The Steam overlay (Shift+Tab) hooks into launched processes that use
//     hardware-accelerated rendering. We keep the GPU enabled (do NOT pass
//     --disable-gpu) so the overlay can attach when the game is started
//     through Steam.
//   - steam_appid.txt (next to the executable, or the project root in dev)
//     lets the Steam client associate this process with your app during
//     testing before the depot is live.

const { app, BrowserWindow, Menu, shell, screen } = require("electron");
const path = require("node:path");
const steam = require("./steam.cjs");

// Initialize Steam + overlay BEFORE app 'ready'. The overlay enables itself by
// appending GPU command-line switches, which only take effect pre-ready. Safe
// no-op when Steam/steamworks.js is unavailable (falls back to local play).
try {
  steam.preInit();
} catch {
  /* Steam unavailable — the game runs single-player/local as normal */
}

// Match the game's dark background so there is no white flash on launch.
const BACKGROUND = "#131a22";

// Only allow a single running instance — standard for a Steam title so that
// launching from the library twice focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = Math.min(1600, Math.max(1024, workAreaSize.width - 80));
  const height = Math.min(1000, Math.max(720, workAreaSize.height - 80));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: BACKGROUND,
    show: false, // reveal once ready to avoid a flash of unstyled/empty window
    autoHideMenuBar: true,
    title: "Industrial Engine",
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // The renderer is a trusted, bundled local file with no remote content.
      webSecurity: true,
    },
  });

  // Hide the application menu entirely (autoHideMenuBar still allows Alt to
  // reveal it); a board game does not need Electron's default Edit/View menu.
  Menu.setApplicationMenu(null);

  // Wire the Steam bridge to this window before the page loads, so the preload's
  // synchronous availability check resolves correctly and multiplayer is
  // offered only when Steam is actually running. Safe no-op without Steam.
  try {
    steam.attach(mainWindow.webContents);
    steam.registerIpc();
  } catch {
    /* Steam unavailable — the game runs single-player/local as normal */
  }

  mainWindow.loadFile(path.join(__dirname, "..", "app", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Headless smoke test (IE_SMOKE=1): confirm the renderer loads and report
  // Steam availability, then quit. Used to verify the packaged app boots; no
  // effect on a normal launch.
  if (process.env.IE_SMOKE) {
    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[smoke] renderer loaded:", mainWindow?.webContents.getURL());
      console.log("[smoke] steam available:", steam.isAvailable());
      setTimeout(() => app.quit(), 1200);
    });
    mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
      console.log("[smoke] LOAD FAILED:", code, desc);
      app.quit();
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Keyboard: F11 / Alt+Enter toggle fullscreen (standard desktop-game bindings).
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isF11 = input.key === "F11";
    const isAltEnter = input.alt && (input.key === "Enter" || input.key === "Return");
    if (isF11 || isAltEnter) {
      event.preventDefault();
      mainWindow?.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // Security: block in-window navigation away from the bundled app and route
  // any external links (e.g. an "about" URL) to the user's real browser.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

/** Resolve a packaged icon if present; otherwise let Electron use its default. */
function resolveIcon() {
  const ico = path.join(__dirname, "..", "build", "icon.ico");
  const png = path.join(__dirname, "..", "build", "icon.png");
  try {
    const fs = require("node:fs");
    if (process.platform === "win32" && fs.existsSync(ico)) return ico;
    if (fs.existsSync(png)) return png;
  } catch {
    /* fall through to default icon */
  }
  return undefined;
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  try {
    steam.dispose();
  } catch {
    /* ignore */
  }
});

app.on("window-all-closed", () => {
  // Quit on all platforms; the game has no background/menubar mode.
  app.quit();
});
