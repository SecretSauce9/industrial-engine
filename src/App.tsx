// Top-level app: screen routing, persistence, AI turn driving, toasts.
// All rule decisions live in src/engine; this file only orchestrates.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FC } from "react";
import type { GameSettings, GameState } from "./engine/types";
import {
  activateMultiCardRecipe,
  addToSequencer,
  borrowCard,
  buildMarketRoad,
  buildPlayerRoad,
  buyCard,
  buyResource,
  claimCardGrant,
  clearSequencer,
  createGame,
  deserializeGame,
  endTurn,
  loadFacility,
  removeFromSequencer,
  sellCard,
  sellResource,
  serializeGame,
  setTurbineMode,
} from "./engine/game";
import { runAiTurn, stepAiTurn } from "./engine/ai";
import { getCard } from "./engine/data/cards";
import { GAME_CONFIG } from "./engine/data/config";
import type { SellDrag } from "./ui/CardMarketplace";
import { SetupScreen } from "./ui/SetupScreen";
import { GameOver } from "./ui/GameOver";
import { PlayerTableau } from "./ui/PlayerTableau";
import { SequencePanel } from "./ui/SequencePanel";
import { ResourceMarket } from "./ui/ResourceMarket";
import { CardMarketplace } from "./ui/CardMarketplace";
import { ActionLog, Inventory, PlayersOverview } from "./ui/Sidebar";
import { FlavorBox } from "./ui/FlavorBox";
import { Trackers } from "./ui/Trackers";
import type { FocusTarget } from "./ui/focus";
import { RulesModal } from "./ui/RulesModal";
import { Tutorial } from "./ui/Tutorial";
import { GrantModal } from "./ui/GrantModal";
import { PlayerViewer } from "./ui/PlayerViewer";
import { DevPanel } from "./ui/DevPanel";
import { MultiplayerLobby } from "./ui/MultiplayerLobby";
import { useMultiplayer } from "./net/useMultiplayer";
import { randomSeedString } from "./engine/rng";
import type { LobbyState } from "./net/protocol";

interface Toast {
  id: number;
  kind: "error" | "info";
  message: string;
}

function loadSavedGame(): GameState | null {
  try {
    const raw = localStorage.getItem(GAME_CONFIG.storage.save);
    if (!raw) return null;
    return deserializeGame(raw);
  } catch {
    return null;
  }
}

/** Build engine GameSettings from a multiplayer lobby snapshot. Seat order,
 * names, classes and settings carry straight through; createGame re-shuffles
 * turn order from the seed on every client identically. */
function lobbyToSettings(lobby: LobbyState): GameSettings {
  return {
    seed: lobby.seed || randomSeedString(),
    maxRounds: lobby.maxRounds,
    players: lobby.seats.map((s) => ({
      name: s.name,
      isAi: s.kind === "ai",
      aiDifficulty: s.kind === "ai" ? (s.aiDifficulty ?? "normal") : undefined,
      classId: s.classId,
    })),
    modifiers: lobby.modifiers,
    aiClassAffinity: lobby.aiClassAffinity,
  };
}

interface UiSettings {
  devMode: boolean;
  aiStepMode: boolean;
}

function loadSettings(): UiSettings {
  const fromUrl =
    typeof location !== "undefined" && location.search.includes("dev=1");
  try {
    const raw = localStorage.getItem(GAME_CONFIG.storage.settings);
    const parsed = raw ? (JSON.parse(raw) as Partial<UiSettings>) : {};
    return {
      devMode: fromUrl || parsed.devMode === true,
      aiStepMode: parsed.aiStepMode === true,
    };
  } catch {
    return { devMode: fromUrl, aiStepMode: false };
  }
}

export const App: FC = () => {
  const [game, setGame] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<"setup" | "game">("setup");
  const [hasSave, setHasSave] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Show the brief tutorial automatically on a player's first ever visit.
  useEffect(() => {
    try {
      if (!localStorage.getItem(GAME_CONFIG.storage.tutorialSeen)) {
        setShowTutorial(true);
      }
    } catch {
      /* storage unavailable — just skip the auto-open */
    }
  }, []);

  const closeTutorial = useCallback(() => {
    setShowTutorial(false);
    try {
      localStorage.setItem(GAME_CONFIG.storage.tutorialSeen, "1");
    } catch {
      /* ignore */
    }
  }, []);
  const [settings, setSettings] = useState<UiSettings>(loadSettings);
  const [aiThinking, setAiThinking] = useState(false);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [sellDrag, setSellDrag] = useState<SellDrag | null>(null);
  const [viewPlayerId, setViewPlayerId] = useState<string | null>(null);
  /** Undo history for non-random actions (cleared on card buys and turns). */
  const [history, setHistory] = useState<GameState[]>([]);
  const toastId = useRef(0);

  // Online multiplayer session (null unless hosting/joined). The last state we
  // synced (serialized) — used to avoid echoing network-applied states back out.
  const mp = useMultiplayer();
  const lastSyncRef = useRef<string>("");

  useEffect(() => {
    setHasSave(loadSavedGame() !== null);
  }, []);

  // Autosave on every state change (local games only — an online game must not
  // clobber the local single-player save slot).
  useEffect(() => {
    if (!game || mp.session) return;
    try {
      localStorage.setItem(GAME_CONFIG.storage.save, serializeGame(game));
      setHasSave(true);
    } catch {
      /* storage full/unavailable: play continues unsaved */
    }
  }, [game, mp.session]);

  useEffect(() => {
    try {
      localStorage.setItem(
        GAME_CONFIG.storage.settings,
        JSON.stringify(settings),
      );
    } catch {
      /* ignore */
    }
  }, [settings]);

  // Reset viewer and undo history on turn changes. (The Sequence Assembly
  // staging lives in engine turn state and clears itself each turn.)
  const activeKey = game ? `${game.round}:${game.activePlayerIndex}` : "";
  useEffect(() => {
    setViewPlayerId(null);
    setHistory([]);
  }, [activeKey]);

  const pushToast = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, kind, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  /** Run an engine action; on rule violation show a toast, keep state.
   * Non-random actions are undoable; buying a card reveals a deck card, so
   * it is not (and it clears the history so undo can't cross the reveal). */
  const act = useCallback(
    (fn: (g: GameState) => GameState, opts: { undoable?: boolean } = {}) => {
      const undoable = opts.undoable !== false;
      setGame((g) => {
        if (!g) return g;
        try {
          const next = fn(g);
          if (undoable && !g.players[g.activePlayerIndex].isAi) {
            setHistory((h) => [...h.slice(-19), g]);
          } else {
            setHistory([]);
          }
          return next;
        } catch (e) {
          pushToast("error", e instanceof Error ? e.message : String(e));
          return g;
        }
      });
    },
    [pushToast],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setGame(prev);
      return h.slice(0, -1);
    });
  }, []);

  // Drive AI turns. Online, only the host runs AI (and broadcasts the result);
  // every other client just receives the resulting states.
  useEffect(() => {
    if (!game || game.status !== "active" || screen !== "game") return;
    if (mp.session && !mp.session.isHost) return;
    const p = game.players[game.activePlayerIndex];
    if (!p.isAi) {
      setAiThinking(false);
      return;
    }
    setAiThinking(true);
    const delay = settings.aiStepMode ? 650 : 450;
    const timer = setTimeout(() => {
      setGame((g) => {
        if (!g || g.status !== "active") return g;
        const cur = g.players[g.activePlayerIndex];
        if (!cur.isAi) return g;
        try {
          if (settings.aiStepMode) {
            return stepAiTurn(g).state;
          }
          return runAiTurn(g).state;
        } catch (e) {
          pushToast(
            "error",
            `AI error: ${e instanceof Error ? e.message : String(e)}`,
          );
          return endTurn(g, cur.id);
        }
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [game, screen, settings.aiStepMode, pushToast, mp.session]);

  // --- Online multiplayer wiring -----------------------------------------
  // Apply full-state broadcasts from whichever client is driving the turn.
  useEffect(() => {
    const s = mp.session;
    if (!s) return;
    return s.onState(({ state }) => {
      try {
        const g = deserializeGame(state);
        // Mark this as already-synced so our own re-serialization doesn't
        // bounce it back out as a "new" local change.
        lastSyncRef.current = serializeGame(g);
        setGame(g);
        setScreen("game");
      } catch {
        pushToast("error", "Failed to sync game state from the host.");
      }
    });
  }, [mp.session, pushToast]);

  // Broadcast any locally-produced state change to peers. Only the active
  // seat's owner (or the host, for AI/dropped seats) has interactive controls,
  // so any change that didn't come from the network was ours to make.
  useEffect(() => {
    const s = mp.session;
    if (!game || !s || mp.lobby?.phase !== "playing") return;
    const str = serializeGame(game);
    if (str === lastSyncRef.current) return;
    lastSyncRef.current = str;
    s.broadcastState(str);
  }, [game, mp.session, mp.lobby?.phase]);

  // Host builds the game as soon as the lobby enters the playing phase; the
  // broadcast effect above then ships the initial state to every client.
  useEffect(() => {
    const s = mp.session;
    if (!s || !s.isHost || mp.lobby?.phase !== "playing" || game) return;
    try {
      setGame(createGame(lobbyToSettings(mp.lobby)));
      setScreen("game");
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : String(e));
    }
  }, [mp.session, mp.lobby, game, pushToast]);

  const startGame = (gs: GameSettings) => {
    try {
      const g = createGame(gs);
      setGame(g);
      setScreen("game");
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const continueGame = () => {
    const g = loadSavedGame();
    if (!g) {
      pushToast("error", "No valid saved game found.");
      setHasSave(false);
      return;
    }
    setGame(g);
    setScreen("game");
  };

  const newGame = () => {
    if (mp.session) mp.leave();
    localStorage.removeItem(GAME_CONFIG.storage.save);
    setHasSave(false);
    setGame(null);
    setScreen("setup");
  };

  // Online lobby (pre-game) takes over the whole screen. For a joiner we wait
  // for the host's real snapshot (hostId set) so we don't flash an empty lobby.
  if (
    mp.lobby &&
    mp.lobby.phase === "lobby" &&
    (mp.session?.isHost || !!mp.lobby.hostId)
  ) {
    return (
      <>
        <MultiplayerLobby mp={mp} />
        <ToastRegion toasts={toasts} />
      </>
    );
  }
  // Joined a session but the host's lobby snapshot hasn't arrived yet.
  if (mp.session && mp.lobby?.phase !== "playing" && !mp.lobby?.hostId) {
    return (
      <>
        <div className="setup-wrap">
          <h1 className="setup-title">Connecting…</h1>
          <p className="setup-sub">Joining the lobby…</p>
          <button type="button" className="btn-danger" onClick={mp.leave}>
            Cancel
          </button>
        </div>
        <ToastRegion toasts={toasts} />
      </>
    );
  }
  // Game is starting online but this client hasn't synced the first state yet.
  if (mp.session && mp.lobby?.phase === "playing" && !game) {
    return (
      <>
        <div className="setup-wrap">
          <h1 className="setup-title">Starting…</h1>
          <p className="setup-sub">Syncing the game from the host…</p>
        </div>
        <ToastRegion toasts={toasts} />
      </>
    );
  }

  if ((screen === "setup" || !game) && !mp.session) {
    return (
      <>
        <SetupScreen
          hasSave={hasSave}
          onContinue={continueGame}
          onStart={startGame}
          mp={mp}
        />
        {showTutorial ? <Tutorial onClose={closeTutorial} /> : null}
        <ToastRegion toasts={toasts} />
      </>
    );
  }

  // All `!game` cases are handled by the guards above (setup / online lobby /
  // connecting / starting); this narrows `game` to non-null for the game UI.
  if (!game) {
    return <ToastRegion toasts={toasts} />;
  }

  if (game.status === "finished") {
    return (
      <>
        <GameOver game={game} onNewGame={newGame} />
        <ToastRegion toasts={toasts} />
      </>
    );
  }

  const active = game.players[game.activePlayerIndex];
  // Online: you may only act on your own seat's turn (the host also drives AI
  // and dropped seats). Local play: always interactive on a human's turn.
  const myTurnOnline = !mp.session || mp.session.amDriver(active.name);
  const interactive = !active.isAi && !aiThinking && myTurnOnline;
  const pendingGrant = game.pendingGrants.find((g) => g.playerId === active.id);

  const stage = (instanceId: string) =>
    act((g) => addToSequencer(g, active.id, instanceId), { undoable: false });

  return (
    <>
      <header className="app-header">
        <h1 className="app-title">Industrial Engine</h1>
        <div className="header-stat">
          <span className="label">Round</span>
          <span className="value">
            {game.round}/{game.maxRounds}
          </span>
        </div>
        <div className="active-player-chip">
          {active.name}
          {active.isAi ? (
            <span className="ai-badge">AI {aiThinking ? "…thinking" : ""}</span>
          ) : null}
        </div>
        <div className="header-stat">
          <span className="label">Cash</span>
          <span className="value">${active.cash}</span>
        </div>
        <div className="header-stat">
          <span className="label">Prestige</span>
          <span className="value">★{active.prestige}</span>
        </div>
        <div
          className="header-stat"
          title={
            game.turn.activations % GAME_CONFIG.activationsPerFood === 0
              ? "Activations this turn — the next one costs 1 food"
              : "Activations this turn (1 food per 3)"
          }
        >
          <span className="label">Acts</span>
          <span className="value">
            {game.turn.activations}
            {game.turn.activations % GAME_CONFIG.activationsPerFood === 0
              ? "🍞"
              : ""}
          </span>
        </div>
        <span className="header-spacer" />
        <button
          type="button"
          disabled={!interactive || history.length === 0}
          title={
            history.length > 0
              ? "Undo your last action (card purchases cannot be undone)"
              : "Nothing to undo"
          }
          onClick={undo}
        >
          ↶ Undo
        </button>
        <button type="button" onClick={() => setShowTutorial(true)}>
          🎓 Tutorial
        </button>
        <button type="button" onClick={() => setShowRules(true)}>
          📖 Rules
        </button>
        <SettingsMenu
          settings={settings}
          onChange={setSettings}
          onQuit={newGame}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={!interactive}
          onClick={() => act((g) => endTurn(g, active.id))}
        >
          End Turn ▶
        </button>
      </header>

      <main className="game-layout">
        <div className="col">
          <ResourceMarket
            game={game}
            player={active}
            interactive={interactive}
            onBuy={(rid, qty) =>
              act((g) => buyResource(g, active.id, rid, qty))
            }
            onSell={(rid, qty) =>
              act((g) => sellResource(g, active.id, rid, qty))
            }
            onBuildRoad={(rid) =>
              act((g) => buildMarketRoad(g, active.id, rid))
            }
            onFocus={setFocus}
          />
          <Trackers game={game} />
        </div>
        <div className="col">
          {viewPlayerId && viewPlayerId !== active.id ? (
            <PlayerViewer
              game={game}
              viewer={active}
              target={game.players.find((p) => p.id === viewPlayerId)!}
              interactive={interactive}
              onBuildPlayerRoad={(tid) =>
                act((g) => buildPlayerRoad(g, active.id, tid))
              }
              onBorrow={(ownerId, instId) =>
                act((g) => borrowCard(g, active.id, ownerId, instId))
              }
              onClose={() => setViewPlayerId(null)}
              onFocus={setFocus}
            />
          ) : null}
          <SequencePanel
            game={game}
            player={active}
            interactive={interactive}
            selection={game.turn.sequencer}
            onAdd={stage}
            onRemove={(id) =>
              act((g) => removeFromSequencer(g, active.id, id), {
                undoable: false,
              })
            }
            onClear={() =>
              act((g) => clearSequencer(g, active.id), { undoable: false })
            }
            onLoad={(ids) =>
              act((g) => loadFacility(g, active.id, ids), { undoable: false })
            }
            onActivate={(recipeId, ids) =>
              act((g) => activateMultiCardRecipe(g, active.id, recipeId, ids))
            }
            onFocus={setFocus}
          />
          <PlayerTableau
            game={game}
            player={active}
            interactive={interactive}
            selection={game.turn.sequencer}
            onActivate={(recipeId, ids) =>
              act((g) => activateMultiCardRecipe(g, active.id, recipeId, ids))
            }
            onAddToSequence={stage}
            onSetTurbineMode={(instId, mode) =>
              act((g) => setTurbineMode(g, active.id, instId, mode))
            }
            onFocus={setFocus}
            onCardDragStart={(instId) => {
              const inst = active.cards.find((c) => c.instanceId === instId);
              if (!inst) return;
              const def = getCard(inst.cardTypeId);
              setSellDrag({
                instanceId: instId,
                name: def.name,
                sellable:
                  !inst.borrowedFrom &&
                  !GAME_CONFIG.starterCards.includes(inst.cardTypeId),
                refund: Math.ceil(def.cost / 2),
              });
            }}
            onCardDragEnd={() => setSellDrag(null)}
          />
          <CardMarketplace
            game={game}
            player={active}
            interactive={interactive}
            onBuyCard={(slot) =>
              act((g) => buyCard(g, active.id, slot), { undoable: false })
            }
            onSellCard={(instId) => {
              act((g) => sellCard(g, active.id, instId));
              setSellDrag(null);
            }}
            sellDrag={sellDrag}
            onFocus={setFocus}
          />
          {settings.devMode ? (
            <DevPanel
              game={game}
              onChange={(g) => setGame(g)}
              onError={(m) => pushToast("error", m)}
            />
          ) : null}
        </div>
        <div className="col col-right">
          <PlayersOverview
            game={game}
            onViewPlayer={(pid) =>
              setViewPlayerId(pid === active.id ? null : pid)
            }
          />
          <FlavorBox focus={focus} />
          <Inventory player={active} />
          <ActionLog game={game} />
        </div>
      </main>

      {pendingGrant && interactive ? (
        <GrantModal
          game={game}
          grant={pendingGrant}
          onClaim={(cardTypeId) =>
            act((g) => claimCardGrant(g, active.id, cardTypeId))
          }
        />
      ) : null}
      {showRules ? <RulesModal onClose={() => setShowRules(false)} /> : null}
      {showTutorial ? <Tutorial onClose={closeTutorial} /> : null}
      <ToastRegion toasts={toasts} />
    </>
  );
};

const ToastRegion: FC<{ toasts: Toast[] }> = ({ toasts }) => (
  <div className="toast-region" role="status" aria-live="assertive">
    {toasts.map((t) => (
      <div key={t.id} className={`toast ${t.kind}`}>
        {t.message}
      </div>
    ))}
  </div>
);

const SettingsMenu: FC<{
  settings: UiSettings;
  onChange: (s: UiSettings) => void;
  onQuit: () => void;
}> = ({ settings, onChange, onQuit }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        ⚙ Settings
      </button>
      {open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            className="modal"
            style={{ maxWidth: 460 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          >
            <div className="modal-head">
              <h2 id="settings-title">Settings</h2>
              <span className="header-spacer" />
              <button type="button" onClick={() => setOpen(false)} autoFocus>
                ✕ Close
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={settings.aiStepMode}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      aiStepMode: e.currentTarget.checked,
                    })
                  }
                />
                Show AI turns step by step (slower, easier to follow)
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={settings.devMode}
                  onChange={(e) =>
                    onChange({ ...settings, devMode: e.currentTarget.checked })
                  }
                />
                Developer tools panel (debugging &amp; balance work)
              </label>
              <p className="tiny">
                The game autosaves to your browser after every action. “Quit to
                setup” deletes the current save.
              </p>
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  setOpen(false);
                  onQuit();
                }}
              >
                Quit to setup (deletes save)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
