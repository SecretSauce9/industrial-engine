// In-game record trackers (v7/v8): live standings for the six end-of-game
// awards, each worth 2 prestige to the holder (ties to whoever reached it
// first). Shows every player's value so the count is transparent.

import type { FC } from "react";
import type { GameState } from "../engine/types";
import { recordStandings } from "../engine/game";

export const Trackers: FC<{ game: GameState }> = ({ game }) => {
  const standings = recordStandings(game);

  return (
    <section className="panel" aria-label="Record trackers">
      <h2>
        Records<span className="tiny">+2 prestige each at game end</span>
      </h2>
      <div className="panel-body">
        <ul className="tracker-list">
          {standings.map((rec) => {
            const cutoff =
              rec.min !== undefined
                ? `min ${rec.min}`
                : rec.max !== undefined
                  ? `max ${rec.max}`
                  : "";
            const holderQualifies = rec.holderId !== null;
            return (
              <li key={rec.key} className="tracker-row">
                <div className="tracker-head">
                  <b>{rec.label}</b>
                  <span className="tiny">
                    {rec.kind === "min" ? "fewest" : "most"} · {cutoff}
                  </span>
                </div>
                <div className="tracker-sub tiny">{rec.description}</div>
                <div className="tracker-values">
                  {rec.players.map((p) => {
                    const isHolder = holderQualifies && p.id === rec.holderId;
                    return (
                      <span
                        key={p.id}
                        className={`tracker-chip ${isHolder ? "leading" : ""} ${
                          p.qualifies ? "" : "unqualified"
                        }`}
                        title={
                          isHolder
                            ? `${p.name} currently holds this record`
                            : p.qualifies
                              ? `${p.name}`
                              : `${p.name} — below the cutoff`
                        }
                      >
                        {isHolder ? "🏆 " : ""}
                        {p.name}: <b>{p.value}</b>
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};
