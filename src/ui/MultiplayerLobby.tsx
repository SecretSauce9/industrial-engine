// Multiplayer lobby — shown while a session is in its "lobby" phase.
//
// Host sees an editable table (seats, seed, rounds, modifiers) plus Invite and
// Start. Guests see a read-only snapshot and wait for the host to start. Both
// see the connected members and a simple chat.

import { useState } from "react";
import type { FC } from "react";
import type { AiDifficulty, GameModifiers } from "../engine/types";
import { GAME_CONFIG } from "../engine/data/config";
import { CLASSES } from "../engine/data/classes";
import { randomSeedString } from "../engine/rng";
import type { Seat } from "../net/protocol";
import type { Multiplayer } from "../net/useMultiplayer";

type RosterSeat = Omit<Seat, "index" | "ownerId">;

const MODIFIER_LABELS: { key: keyof GameModifiers; label: string }[] = [
  { key: "knifeFight", label: "Knife fight" },
  { key: "randomResources", label: "Random resources" },
  { key: "viscousMarkets", label: "Viscous markets" },
  { key: "cyclicalEconomy", label: "Cyclical economy" },
];

export const MultiplayerLobby: FC<{ mp: Multiplayer }> = ({ mp }) => {
  const { session, lobby } = mp;
  const [chatText, setChatText] = useState("");

  const isHost = !!session?.isHost;
  const canStart = !!session?.canStart();

  if (!session || !lobby) return null;

  const patchSeats = (seats: RosterSeat[]) => session.updateConfig({ seats });
  const roster: RosterSeat[] = lobby.seats.map((s) => ({
    name: s.name,
    kind: s.kind,
    aiDifficulty: s.aiDifficulty,
    classId: s.classId,
  }));

  const seatValue = (s: RosterSeat) =>
    s.kind === "human" ? "human" : `ai-${s.aiDifficulty ?? "normal"}`;

  const setSeat = (i: number, patch: Partial<RosterSeat>) =>
    patchSeats(roster.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="setup-wrap">
      <h1 className="setup-title">Online game</h1>
      <p className="setup-sub">
        {mp.steam ? "Steam lobby" : "Local test lobby (same-machine tabs)"} —{" "}
        {isHost ? "you are the host" : "waiting for the host"}.
      </p>

      {mp.error ? (
        <div className="toast error" style={{ position: "static" }}>
          {mp.error}
        </div>
      ) : null}

      <section className="panel">
        <h2>Seats ({lobby.seats.length})</h2>
        <div
          className="panel-body"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {lobby.seats.map((seat, i) => {
            // seat.name is the protocol-level display name (real on both the
            // local and Steam transports); prefer it over transport member ids.
            const claimed = seat.ownerId ? seat.name : null;
            return (
              <div className="player-row" key={i}>
                <span className="seat-num">{i + 1}</span>
                <span className="mp-seat-owner">
                  {seat.kind === "human"
                    ? seat.ownerId === session.localId
                      ? `${claimed ?? seat.name} (you)`
                      : claimed
                        ? `🟢 ${claimed}`
                        : "… waiting for player"
                    : seat.name}
                </span>
                {isHost ? (
                  <>
                    <select
                      aria-label={`Seat ${i + 1} type`}
                      value={seatValue(roster[i])}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (v === "human")
                          setSeat(i, { kind: "human", aiDifficulty: undefined });
                        else
                          setSeat(i, {
                            kind: "ai",
                            aiDifficulty: v.replace("ai-", "") as AiDifficulty,
                          });
                      }}
                    >
                      <option value="human">Human</option>
                      <option value="ai-easy">AI — Easy</option>
                      <option value="ai-normal">AI — Normal</option>
                      <option value="ai-hard">AI — Hard</option>
                    </select>
                    <select
                      aria-label={`Seat ${i + 1} class`}
                      value={seat.classId ?? "none"}
                      onChange={(e) =>
                        setSeat(i, {
                          classId: e.currentTarget.value as Seat["classId"],
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
                      disabled={lobby.seats.length <= GAME_CONFIG.minPlayers}
                      aria-label={`Remove seat ${i + 1}`}
                      onClick={() => patchSeats(roster.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span className="tiny">
                    {seat.kind === "human" ? "Human" : `AI — ${seat.aiDifficulty}`}
                    {seat.classId && seat.classId !== "none"
                      ? ` · ${CLASSES.find((c) => c.id === seat.classId)?.name}`
                      : ""}
                  </span>
                )}
              </div>
            );
          })}
          {isHost ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={lobby.seats.length >= GAME_CONFIG.maxPlayers}
                onClick={() =>
                  patchSeats([
                    ...roster,
                    { name: "Open seat", kind: "human", classId: "none" },
                  ])
                }
              >
                + Human seat
              </button>
              <button
                type="button"
                disabled={lobby.seats.length >= GAME_CONFIG.maxPlayers}
                onClick={() =>
                  patchSeats([
                    ...roster,
                    {
                      name: `Rusty ${lobby.seats.length + 1} (AI)`,
                      kind: "ai",
                      aiDifficulty: "normal",
                      classId: "none",
                    },
                  ])
                }
              >
                + AI seat
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {isHost ? (
        <section className="panel">
          <h2>Game options</h2>
          <div
            className="panel-body"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div className="setup-row">
              <label htmlFor="mp-seed">Seed</label>
              <input
                id="mp-seed"
                type="text"
                value={lobby.seed}
                onChange={(e) => session.updateConfig({ seed: e.currentTarget.value })}
              />
              <button
                type="button"
                className="btn-sm"
                onClick={() => session.updateConfig({ seed: randomSeedString() })}
              >
                ↻ Random
              </button>
            </div>
            <div className="setup-row">
              <label htmlFor="mp-rounds">Rounds</label>
              <input
                id="mp-rounds"
                type="number"
                min={GAME_CONFIG.minRounds}
                max={GAME_CONFIG.maxRounds}
                value={lobby.maxRounds}
                onChange={(e) =>
                  session.updateConfig({
                    maxRounds: Math.max(
                      GAME_CONFIG.minRounds,
                      Math.min(
                        GAME_CONFIG.maxRounds,
                        Math.floor(
                          Number(e.currentTarget.value) || GAME_CONFIG.defaultRounds,
                        ),
                      ),
                    ),
                  })
                }
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {MODIFIER_LABELS.map((m) => (
                <label key={m.key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={lobby.modifiers[m.key]}
                    onChange={(e) =>
                      session.updateConfig({
                        modifiers: { ...lobby.modifiers, [m.key]: e.currentTarget.checked },
                      })
                    }
                  />
                  {m.label}
                </label>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>Game options</h2>
          <div className="panel-body">
            <p className="tiny" style={{ margin: 0 }}>
              Seed {lobby.seed || "—"} · {lobby.maxRounds} rounds ·{" "}
              {MODIFIER_LABELS.filter((m) => lobby.modifiers[m.key])
                .map((m) => m.label)
                .join(", ") || "no modifiers"}
            </p>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Players connected ({mp.members.length})</h2>
        <div className="panel-body">
          <ul className="mp-members">
            {mp.members.map((m) => (
              <li key={m.id}>
                {m.name}
                {m.id === lobby.hostId ? " · host" : ""}
                {m.id === session.localId ? " · you" : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <h2>Chat</h2>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="mp-chat-log">
            {mp.chat.length === 0 ? (
              <p className="tiny" style={{ margin: 0 }}>
                Say hello…
              </p>
            ) : (
              mp.chat.map((c, i) => (
                <div key={i}>
                  <b>{c.name}:</b> {c.text}
                </div>
              ))
            )}
          </div>
          <form
            style={{ display: "flex", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const t = chatText.trim();
              if (t) session.sendChat(t);
              setChatText("");
            }}
          >
            <input
              type="text"
              aria-label="Chat message"
              value={chatText}
              onChange={(e) => setChatText(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn-sm">
              Send
            </button>
          </form>
        </div>
      </section>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {isHost && mp.steam ? (
          <button type="button" onClick={mp.invite}>
            ✉ Invite friends (Steam)
          </button>
        ) : null}
        {isHost ? (
          <button
            type="button"
            className="btn-primary"
            style={{ fontSize: "1.05rem", padding: "10px 16px" }}
            disabled={!canStart}
            title={canStart ? "Start the game" : "Every human seat needs a connected player"}
            onClick={() => session.start()}
          >
            ▶ Start game
          </button>
        ) : (
          <span className="tiny" style={{ alignSelf: "center" }}>
            Waiting for the host to start…
          </span>
        )}
        <span className="header-spacer" />
        <button type="button" className="btn-danger" onClick={mp.leave}>
          Leave lobby
        </button>
      </div>
    </div>
  );
};
