// Right-hand column: players overview (with rebate pip colors), warehouse
// inventory, and the action history log.

import { useState } from "react";
import type { FC } from "react";
import type { GameState, PlayerState } from "../engine/types";
import { RESOURCES } from "../engine/data/resources";
import { CLASS_MAP } from "../engine/data/classes";
import { ResourceIcon } from "./icons";

export const PlayersOverview: FC<{
  game: GameState;
  onViewPlayer?: (playerId: string) => void;
}> = ({ game, onViewPlayer }) => (
  <section className="panel" aria-label="Players">
    <h2>
      Players<span className="tiny">Δ net worth · click to view a board</span>
    </h2>
    <div
      className="panel-body"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {game.players.map((p, i) => {
        const isActive =
          i === game.activePlayerIndex && game.status === "active";
        const d = p.netWorthDelta;
        const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "–";
        const cls = CLASS_MAP[p.classId];
        return (
          <div className="player-line" key={p.id}>
            <span
              className={`nw-delta ${d > 0 ? "up" : d < 0 ? "down" : "flat"}`}
              title={`Net worth ${d >= 0 ? "up" : "down"} ${Math.abs(d)} over ${p.name}'s last turn`}
            >
              {arrow}
              {d !== 0 ? Math.abs(d) : ""}
            </span>
            <button
              type="button"
              className={`inv-token player-row-btn seat-p${i + 1}`}
              aria-current={isActive ? "true" : undefined}
              title={`View ${p.name}'s board, cards, and warehouse`}
              onClick={() => onViewPlayer?.(p.id)}
            >
              <span
                className={`player-dot pip-p${i + 1}`}
                title={`${p.name}'s color (market rebate pips)`}
                aria-hidden="true"
              />
              <b>{p.name}</b>
              {p.isAi ? (
                <span className="ai-badge">AI {p.aiDifficulty}</span>
              ) : null}
              {cls && p.classId !== "none" ? (
                <span className="class-badge" title={cls.description}>
                  {cls.name}
                </span>
              ) : null}
              <span className="muted">${p.cash}</span>
              <span className="muted" title="prestige">
                ★{p.prestige}
              </span>
              <span className="tiny">{p.cards.length} cards</span>
              <span className="tiny" title="market roads">
                🛣{p.marketRoads.length}
              </span>
              {isActive ? <span className="tiny">← active</span> : null}
            </button>
          </div>
        );
      })}
    </div>
  </section>
);

export const Inventory: FC<{ player: PlayerState }> = ({ player }) => {
  const [hideZero, setHideZero] = useState(true);
  return (
    <section className="panel" aria-label="Warehouse inventory">
      <h2>
        {player.name}&rsquo;s Warehouse
        <span className="header-spacer" />
        <label
          className="tiny"
          style={{ display: "flex", gap: 4, alignItems: "center" }}
        >
          <input
            type="checkbox"
            checked={hideZero}
            onChange={(e) => setHideZero(e.currentTarget.checked)}
          />
          hide zero
        </label>
      </h2>
      <div className="panel-body">
        {(["raw", "intermediate", "finished"] as const).map((cat) => {
          const rows = RESOURCES.filter(
            (r) =>
              r.category === cat &&
              (!hideZero || (player.resources[r.id] ?? 0) > 0),
          );
          return (
            <div key={cat}>
              <div className="inv-group-title">{cat}</div>
              {rows.length === 0 ? (
                <p className="tiny" style={{ margin: "2px 0 6px" }}>
                  none
                </p>
              ) : (
                <div className="inv-grid">
                  {rows.map((r) => (
                    <span
                      key={r.id}
                      className={`inv-token ${(player.resources[r.id] ?? 0) === 0 ? "zero" : ""}`}
                    >
                      <ResourceIcon id={r.id} />
                      {r.name}
                      <b>{player.resources[r.id] ?? 0}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const ActionLog: FC<{ game: GameState }> = ({ game }) => (
  <section className="panel" aria-label="Action history">
    <h2>Action History</h2>
    <ul className="log-list" aria-live="polite">
      {[...game.log].reverse().map((entry) => (
        <li key={entry.seq} className={`t-${entry.type}`}>
          <span className="tiny">R{entry.round}</span> {entry.message}
        </li>
      ))}
    </ul>
  </section>
);
