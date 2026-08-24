// Developer panel — clearly separated from ordinary play. Only rendered when
// dev mode is enabled (Settings toggle or ?dev=1).

import { useState } from "react";
import type { FC } from "react";
import type { GameState } from "../engine/types";
import { devTools, serializeGame, deserializeGame } from "../engine/game";
import { RESOURCES } from "../engine/data/resources";
import { CARDS } from "../engine/data/cards";

export const DevPanel: FC<{
  game: GameState;
  onChange: (next: GameState) => void;
  onError: (message: string) => void;
}> = ({ game, onChange, onError }) => {
  const [playerId, setPlayerId] = useState(game.players[0].id);
  const [resource, setResource] = useState(RESOURCES[0].id);
  const [cardType, setCardType] = useState(CARDS[0].id);
  const [json, setJson] = useState("");
  const [showLadders, setShowLadders] = useState(false);

  const guard = (fn: () => GameState) => {
    try {
      onChange(fn());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel dev-panel" aria-label="Developer tools">
      <h2>Developer Tools</h2>
      <div className="panel-body dev-grid">
        <p className="tiny" style={{ margin: 0 }}>
          Debug helpers — actions here bypass normal play and are marked [dev]
          in the log. Seed: <code>{game.seed}</code>
        </p>
        <div className="row">
          <label htmlFor="dev-player">Player</label>
          <select
            id="dev-player"
            value={playerId}
            onChange={(e) => setPlayerId(e.currentTarget.value)}
          >
            {game.players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sm"
            onClick={() => guard(() => devTools.addCash(game, playerId, 20))}
          >
            +$20
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() => guard(() => devTools.addCash(game, playerId, 100))}
          >
            +$100
          </button>
        </div>
        <div className="row">
          <select
            aria-label="Resource to add"
            value={resource}
            onChange={(e) => setResource(e.currentTarget.value)}
          >
            {RESOURCES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              guard(() => devTools.addResource(game, playerId, resource, 1))
            }
          >
            +1
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              guard(() => devTools.addResource(game, playerId, resource, 5))
            }
          >
            +5
          </button>
        </div>
        <div className="row">
          <select
            aria-label="Card to grant"
            value={cardType}
            onChange={(e) => setCardType(e.currentTarget.value)}
          >
            {CARDS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              guard(() => devTools.grantCard(game, playerId, cardType))
            }
          >
            Grant card
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() => guard(() => devTools.advanceRound(game))}
          >
            Advance round
          </button>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn-sm"
            onClick={() => setJson(serializeGame(game))}
          >
            Export state → JSON
          </button>
          <button
            type="button"
            className="btn-sm"
            onClick={() =>
              guard(() => {
                const next = deserializeGame(json);
                return next;
              })
            }
          >
            Import JSON → state
          </button>
          <button
            type="button"
            className="btn-sm"
            aria-pressed={showLadders ? "true" : "false"}
            onClick={() => setShowLadders(!showLadders)}
          >
            {showLadders ? "Hide" : "Show"} market ladders
          </button>
        </div>
        <textarea
          className="dev-json"
          aria-label="Game state JSON"
          value={json}
          onChange={(e) => setJson(e.currentTarget.value)}
          placeholder="Exported game-state JSON appears here; paste valid JSON and press Import."
        />
        {showLadders ? (
          <table style={{ fontSize: "0.68rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>resource</th>
                <th>stock</th>
                <th style={{ textAlign: "left" }}>ladder (low → high)</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td style={{ textAlign: "center" }}>{game.market[r.id]}</td>
                  <td>
                    <code>{r.priceLadder.join(" ")}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
};
