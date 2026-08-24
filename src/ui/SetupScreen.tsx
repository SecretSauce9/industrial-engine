// New-game setup: players (human/AI mix up to 4), difficulty, seed, rounds.

import { useState } from "react";
import type { FC } from "react";
import type { GameModifiers, GameSettings, PlayerSetup } from "../engine/types";
import { GAME_CONFIG } from "../engine/data/config";
import { CLASSES } from "../engine/data/classes";
import { randomSeedString } from "../engine/rng";
import type { Multiplayer } from "../net/useMultiplayer";
import type { HostConfig } from "../net/session";
import type { Seat } from "../net/protocol";

const DEFAULT_PLAYERS: PlayerSetup[] = [
  { name: "Player 1", isAi: false },
  { name: "Rusty (AI)", isAi: true, aiDifficulty: "normal" },
];

const MODIFIER_OPTIONS: {
  key: keyof GameModifiers;
  label: string;
  description: string;
}[] = [
  {
    key: "knifeFight",
    label: "Knife fight",
    description:
      "One fewer copy of Grinder, Cracker, Mixer, and Forming Machine in the deck.",
  },
  {
    key: "randomResources",
    label: "Random resources",
    description: "Each market equilibrium is shifted randomly by up to ±2.",
  },
  {
    key: "viscousMarkets",
    label: "Viscous markets",
    description: "Markets may drift at most 1 toward equilibrium per round.",
  },
  {
    key: "cyclicalEconomy",
    label: "Cyclical economy",
    description:
      "Drift lags a round behind, reacting to the previous round's stocks.",
  },
];

export const SetupScreen: FC<{
  hasSave: boolean;
  onContinue: () => void;
  onStart: (settings: GameSettings) => void;
  mp: Multiplayer;
}> = ({ hasSave, onContinue, onStart, mp }) => {
  const [players, setPlayers] = useState<PlayerSetup[]>(DEFAULT_PLAYERS);
  const [seed, setSeed] = useState(randomSeedString());
  const [rounds, setRounds] = useState(GAME_CONFIG.defaultRounds);
  const [modifiers, setModifiers] = useState<GameModifiers>({
    knifeFight: false,
    randomResources: false,
    viscousMarkets: false,
    cyclicalEconomy: false,
  });
  const [joinName, setJoinName] = useState("Player 2");

  /** Turn the current roster/options into a lobby the host opens. Human seats
   * become open slots other players claim; AI seats are host-driven. */
  const buildHostConfig = (): HostConfig => {
    const seats: Omit<Seat, "index" | "ownerId">[] = players.map((p) => ({
      name: p.name,
      kind: p.isAi ? "ai" : "human",
      aiDifficulty: p.isAi ? (p.aiDifficulty ?? "normal") : undefined,
      classId: p.classId ?? "none",
    }));
    return {
      seed: seed.trim() || randomSeedString(),
      maxRounds: rounds,
      modifiers,
      aiClassAffinity: true,
      seats,
      hostName: players.find((p) => !p.isAi)?.name || "Host",
    };
  };

  const update = (i: number, patch: Partial<PlayerSetup>) => {
    setPlayers((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };

  return (
    <div className="setup-wrap">
      <h1 className="setup-title">Industrial Engine</h1>
      <p className="setup-sub">
        Buy production. Transform resources. Trade the swings. Earn prestige.
      </p>

      {hasSave ? (
        <button type="button" className="btn-primary" onClick={onContinue}>
          ▶ Continue saved game
        </button>
      ) : null}

      <section className="panel">
        <h2>Players ({players.length})</h2>
        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {players.map((p, i) => (
            <div className="player-row" key={i}>
              <span className="seat-num">{i + 1}</span>
              <input
                type="text"
                aria-label={`Player ${i + 1} name`}
                value={p.name}
                onChange={(e) => update(i, { name: e.currentTarget.value })}
              />
              <select
                aria-label={`Player ${i + 1} type`}
                value={p.isAi ? `ai-${p.aiDifficulty ?? "normal"}` : "human"}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v === "human")
                    update(i, { isAi: false, aiDifficulty: undefined });
                  else
                    update(i, {
                      isAi: true,
                      aiDifficulty:
                        v === "ai-easy"
                          ? "easy"
                          : v === "ai-hard"
                            ? "hard"
                            : "normal",
                    });
                }}
              >
                <option value="human">Human</option>
                <option value="ai-easy">AI — Easy</option>
                <option value="ai-normal">AI — Normal</option>
                <option value="ai-hard">AI — Hard</option>
              </select>
              <select
                aria-label={`Player ${i + 1} class`}
                value={p.classId ?? "none"}
                title={
                  CLASSES.find((c) => c.id === (p.classId ?? "none"))
                    ?.description
                }
                onChange={(e) =>
                  update(i, {
                    classId: e.currentTarget.value as PlayerSetup["classId"],
                  })
                }
              >
                {CLASSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-sm btn-danger"
                disabled={players.length <= GAME_CONFIG.minPlayers}
                aria-label={`Remove player ${i + 1}`}
                onClick={() => setPlayers((ps) => ps.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          {players.some((p) => p.classId && p.classId !== "none") ? (
            <p className="tiny" style={{ margin: 0 }}>
              {CLASSES.find(
                (c) =>
                  c.id ===
                  players.find((p) => p.classId && p.classId !== "none")
                    ?.classId,
              )?.description
                ? "Hover a class to read its bonuses and drawbacks."
                : null}
            </p>
          ) : null}
          <button
            type="button"
            disabled={players.length >= GAME_CONFIG.maxPlayers}
            onClick={() =>
              setPlayers((ps) => [
                ...ps,
                {
                  name: `Player ${ps.length + 1}`,
                  isAi: true,
                  aiDifficulty: "normal",
                },
              ])
            }
          >
            + Add player
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Game options</h2>
        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div className="setup-row">
            <label htmlFor="seed-input">Seed (for reproducible games)</label>
            <input
              id="seed-input"
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.currentTarget.value)}
            />
            <button
              type="button"
              className="btn-sm"
              onClick={() => setSeed(randomSeedString())}
            >
              ↻ Random
            </button>
          </div>
          <div className="setup-row">
            <label htmlFor="rounds-input">Rounds</label>
            <input
              id="rounds-input"
              type="number"
              min={GAME_CONFIG.minRounds}
              max={GAME_CONFIG.maxRounds}
              value={rounds}
              onChange={(e) =>
                setRounds(
                  Math.max(
                    GAME_CONFIG.minRounds,
                    Math.min(
                      GAME_CONFIG.maxRounds,
                      Math.floor(
                        Number(e.currentTarget.value) ||
                          GAME_CONFIG.defaultRounds,
                      ),
                    ),
                  ),
                )
              }
            />
            <span className="tiny">default {GAME_CONFIG.defaultRounds}</span>
          </div>
          <p className="tiny" style={{ margin: 0 }}>
            Turn order is randomized from the seed. Starting cash compensates
            seating: ${GAME_CONFIG.startingCash.join(" / ")}.
          </p>
        </div>
      </section>

      <section className="panel">
        <h2>
          Modifiers
          <span className="tiny">optional — pick any combination</span>
        </h2>
        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {MODIFIER_OPTIONS.map((m) => (
            <label key={m.key} className="modifier-row">
              <input
                type="checkbox"
                checked={modifiers[m.key]}
                aria-label={m.label}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setModifiers((mods) => ({ ...mods, [m.key]: checked }));
                }}
              />
              <span>
                <b>{m.label}</b>
                <span className="tiny" style={{ display: "block" }}>
                  {m.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <button
        type="button"
        className="btn-primary"
        style={{ fontSize: "1.05rem", padding: "10px" }}
        onClick={() =>
          onStart({
            seed: seed.trim() || randomSeedString(),
            maxRounds: rounds,
            players,
            modifiers,
          })
        }
      >
        Start new game
      </button>

      <section className="panel">
        <h2>
          🌐 Play online
          <span className="tiny">
            {mp.steam ? "Steam lobby" : "local test — open a 2nd browser tab"}
          </span>
        </h2>
        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <p className="tiny" style={{ margin: 0 }}>
            Host uses the roster and options above (human seats become open slots
            others join; AI seats are driven by the host).
            {mp.steam
              ? " Invite friends from the lobby via the Steam overlay."
              : " To test without Steam, host here, then open this page in a second browser tab and Join."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() =>
                mp.steam
                  ? void mp.hostSteam(buildHostConfig())
                  : mp.hostLocal(buildHostConfig())
              }
            >
              ⚑ Host online game
            </button>
          </div>
          <div className="setup-row">
            <label htmlFor="join-name">Join as</label>
            <input
              id="join-name"
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.currentTarget.value)}
            />
            <button
              type="button"
              className="btn-sm"
              onClick={() =>
                mp.steam
                  ? void mp.joinSteam(joinName.trim() || "Player", "")
                  : mp.joinLocal(joinName.trim() || "Player")
              }
            >
              Join game
            </button>
          </div>
          {mp.steam ? (
            <p className="tiny" style={{ margin: 0 }}>
              On Steam you normally join by accepting a friend's invite from the
              overlay; the button above joins the lobby you were last invited to.
            </p>
          ) : null}
          {mp.error ? (
            <div className="toast error" style={{ position: "static" }}>
              {mp.error}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
};
