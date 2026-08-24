// Free-card grant chooser (v3): shown when the active human player has a
// pending grant from producing machinery or vehicles.

import type { FC } from "react";
import type { CardGrant, GameState } from "../engine/types";
import { CARDS } from "../engine/data/cards";
import { CardFrame, RecipeIO } from "./CardView";
import { getRecipe } from "../engine/data/recipes";

export const GrantModal: FC<{
  game: GameState;
  grant: CardGrant;
  onClaim: (cardTypeId: string | null) => void;
}> = ({ game, grant, onClaim }) => {
  const deckCounts = new Map<string, number>();
  for (const id of game.deck) deckCounts.set(id, (deckCounts.get(id) ?? 0) + 1);
  const choices = CARDS.filter(
    (c) => c.tag === grant.tag && (deckCounts.get(c.id) ?? 0) > 0,
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grant-title"
      >
        <div className="modal-head">
          <h2 id="grant-title">
            🎁 Free {grant.tag === "machinery" ? "Machinery" : "Vehicles"} Card
          </h2>
          <span className="header-spacer" />
          <button type="button" onClick={() => onClaim(null)}>
            Skip (no card)
          </button>
        </div>
        <div className="modal-body">
          <p>
            Producing {grant.tag === "machinery" ? "machinery" : "vehicles"}{" "}
            earned you a free card from the deck — you keep the resource too.
            Choose one:
          </p>
          {choices.length === 0 ? (
            <p className="muted">
              No {grant.tag}-tagged cards remain in the deck. Skip to continue.
            </p>
          ) : (
            <div className="marketplace-grid">
              {choices.map((c) => (
                <CardFrame
                  key={c.id}
                  cardTypeId={c.id}
                  footer={
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => onClaim(c.id)}
                      autoFocus={c.id === choices[0].id}
                    >
                      Take {c.name} (×{deckCounts.get(c.id)} in deck)
                    </button>
                  }
                >
                  {c.recipeIds
                    .filter(
                      (rid) => getRecipe(rid).requiredCardTypes.length === 1,
                    )
                    .map((rid) => (
                      <div key={rid} className="recipe-row">
                        <RecipeIO recipeId={rid} />
                      </div>
                    ))}
                </CardFrame>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
