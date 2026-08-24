// End-of-game breakdown screen.

import type { FC } from "react";
import type { GameState } from "../engine/types";
import { calculateScore } from "../engine/game";

export const GameOver: FC<{
  game: GameState;
  onNewGame: () => void;
}> = ({ game, onNewGame }) => {
  const scores = calculateScore(game);
  const winners = scores.filter((s) => s.rank === 1);
  return (
    <div className="setup-wrap" style={{ maxWidth: 960 }}>
      <h1 className="setup-title">Game Over</h1>
      <p className="setup-sub">
        {winners.length > 1
          ? `Shared victory: ${winners.map((w) => w.name).join(" & ")}!`
          : `${winners[0].name} wins with ${winners[0].finalScore} points!`}
      </p>
      <section className="panel">
        <h2>
          Final scoring — round {game.round} complete (seed {game.seed})
        </h2>
        <div className="panel-body" style={{ overflowX: "auto" }}>
          <table className="score-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Rank</th>
                <th title="Prestige earned from producing finished goods">
                  Prestige
                </th>
                <th>Cash</th>
                <th title="Current sequential sell value of all held resources">
                  Inventory value
                </th>
                <th title="floor(total printed card cost / 2)">Card value</th>
                <th>Net worth</th>
                <th title="floor(net worth / 10)">Economic score</th>
                <th>Final score</th>
                <th title="Tiebreaker: finished resources currently held">
                  Finished held
                </th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.playerId} className={s.rank === 1 ? "winner" : ""}>
                  <td>
                    {s.name}
                    {s.sharedVictory ? " (shared)" : ""}
                  </td>
                  <td>{s.rank}</td>
                  <td>★{s.prestige}</td>
                  <td>${s.cash}</td>
                  <td>${s.inventoryValue}</td>
                  <td>${s.cardValue}</td>
                  <td>${s.netWorth}</td>
                  <td>{s.economicScore}</td>
                  <td>
                    <strong>{s.finalScore}</strong>
                  </td>
                  <td>{s.finishedHeld}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny" style={{ marginBottom: 0 }}>
            Final score = prestige + floor(net worth / 10). Net worth = cash +
            inventory sell value + floor(card printed cost / 2). Ties break by
            prestige, then net worth, then finished resources held.
          </p>
        </div>
      </section>
      {game.records && game.records.length > 0 ? (
        <section className="panel">
          <h2>
            Records
            <span className="tiny">+2 prestige each (included above)</span>
          </h2>
          <div className="panel-body">
            <ul className="tracker-list">
              {game.records.map((rec) => {
                const holder = rec.winnerId
                  ? (game.players.find((p) => p.id === rec.winnerId)?.name ??
                    null)
                  : null;
                return (
                  <li key={rec.key} className="tracker-row">
                    <div className="tracker-head">
                      <b>{rec.label}</b>
                      <span className="tiny">{rec.description}</span>
                    </div>
                    <div className="tracker-leader">
                      {holder ? (
                        <>
                          <span className="tracker-name">🏆 {holder}</span>
                          <span className="tracker-value">{rec.value}</span>
                        </>
                      ) : (
                        <span className="muted tiny">
                          not awarded (nobody qualified)
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}
      <button type="button" className="btn-primary" onClick={onNewGame}>
        New game
      </button>
    </div>
  );
};
