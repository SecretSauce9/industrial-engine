// Viewing another player's board (v4): full information (there is none
// hidden), plus building a road to them and borrowing their cards for a turn.

import type { FC } from "react";
import type { GameState, PlayerState } from "../engine/types";
import { getCard } from "../engine/data/cards";
import { getRecipe } from "../engine/data/recipes";
import { GAME_CONFIG } from "../engine/data/config";
import { CardFrame, RecipeIO } from "./CardView";
import { Inventory } from "./Sidebar";
import type { FocusTarget } from "./focus";

export const PlayerViewer: FC<{
  game: GameState;
  viewer: PlayerState;
  target: PlayerState;
  interactive: boolean;
  onBuildPlayerRoad: (targetId: string) => void;
  onBorrow: (ownerId: string, instanceId: string) => void;
  onClose: () => void;
  onFocus?: (target: FocusTarget) => void;
}> = ({
  game,
  viewer,
  target,
  interactive,
  onBuildPlayerRoad,
  onBorrow,
  onClose,
  onFocus,
}) => {
  void game;
  const hasRoad = viewer.playerRoads.includes(target.id);
  const seat = game.players.findIndex((p) => p.id === target.id);
  return (
    <section
      className="panel viewer-panel"
      aria-label={`Viewing ${target.name}`}
    >
      <h2>
        <span className={`player-dot pip-p${seat + 1}`} aria-hidden="true" />
        Viewing {target.name}&rsquo;s board
        <span className="tiny">
          ${target.cash} · ★{target.prestige} · roads:{" "}
          {target.marketRoads.length + target.playerRoads.length}
        </span>
        <span className="header-spacer" />
        {hasRoad ? (
          <span className="tiny" title="You have a road to this player">
            🛣 connected
          </span>
        ) : (
          <button
            type="button"
            className="btn-sm"
            disabled={
              !interactive ||
              (viewer.resources.asphalt ?? 0) < GAME_CONFIG.roadCost
            }
            title={
              (viewer.resources.asphalt ?? 0) >= GAME_CONFIG.roadCost
                ? "A road to this player lets you borrow their cards"
                : `Needs ${GAME_CONFIG.roadCost} asphalt`
            }
            onClick={() => onBuildPlayerRoad(target.id)}
          >
            🛣 Build road ({GAME_CONFIG.roadCost} asphalt)
          </button>
        )}
        <button type="button" className="btn-sm" onClick={onClose}>
          ← Back to my board
        </button>
      </h2>
      <div className="panel-body">
        <div className="tableau-grid">
          {target.cards.map((inst) => {
            const def = getCard(inst.cardTypeId);
            const canBorrow =
              interactive &&
              hasRoad &&
              !inst.borrowedFrom &&
              viewer.cash >= GAME_CONFIG.borrowCost;
            return (
              <CardFrame
                key={inst.instanceId}
                cardTypeId={inst.cardTypeId}
                instance={inst}
                onFocus={onFocus}
              >
                {def.recipeIds
                  .filter(
                    (rid) => getRecipe(rid).requiredCardTypes.length === 1,
                  )
                  .map((rid) => (
                    <div key={rid} className="recipe-row disabled">
                      <RecipeIO recipeId={rid} />
                    </div>
                  ))}
                <div className="transfer-row">
                  <button
                    type="button"
                    className="btn-sm btn-primary"
                    disabled={!canBorrow}
                    title={
                      !hasRoad
                        ? "Build a road to this player first"
                        : inst.borrowedFrom
                          ? "Borrowed cards cannot be borrowed onward"
                          : viewer.cash < GAME_CONFIG.borrowCost
                            ? `Borrowing costs $${GAME_CONFIG.borrowCost}`
                            : `Pay ${target.name} $${GAME_CONFIG.borrowCost}: a copy joins your tableau for this turn (1 activation)`
                    }
                    onClick={() => onBorrow(target.id, inst.instanceId)}
                  >
                    🤝 Borrow for ${GAME_CONFIG.borrowCost}
                  </button>
                </div>
              </CardFrame>
            );
          })}
          {target.cards.length === 0 ? (
            <p className="muted">No cards.</p>
          ) : null}
        </div>
        <div style={{ marginTop: 10 }}>
          <Inventory player={target} />
        </div>
      </div>
    </section>
  );
};
