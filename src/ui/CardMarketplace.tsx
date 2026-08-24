// Shared face-up card marketplace (6 slots; new cards enter top-left).

import type { FC } from "react";
import type { GameState, PlayerState } from "../engine/types";
import { getCard } from "../engine/data/cards";
import { getRecipe } from "../engine/data/recipes";
import { SEQUENCES } from "../engine/data/sequences";
import { CardFrame, RecipeIO } from "./CardView";
import type { FocusTarget } from "./focus";

export interface SellDrag {
  instanceId: string;
  name: string;
  sellable: boolean;
  refund: number;
}

export const CardMarketplace: FC<{
  game: GameState;
  player: PlayerState;
  interactive: boolean;
  onBuyCard: (slot: number) => void;
  onSellCard?: (instanceId: string) => void;
  /** A card currently being dragged from the tableau (for the sell hint). */
  sellDrag?: SellDrag | null;
  onFocus?: (target: FocusTarget) => void;
}> = ({
  game,
  player,
  interactive,
  onBuyCard,
  onSellCard,
  sellDrag,
  onFocus,
}) => {
  return (
    <section
      className={`panel ${sellDrag ? "sell-target" : ""}`}
      aria-label="Card marketplace"
      onDragOver={(e) => {
        if (!sellDrag || !onSellCard) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = sellDrag.sellable ? "move" : "none";
      }}
      onDrop={(e) => {
        if (!onSellCard) return;
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        if (id && interactive) onSellCard(id);
      }}
    >
      <h2>
        Card Marketplace
        <span className="tiny">
          {game.deck.length} cards left · new cards enter top-left
        </span>
      </h2>
      {sellDrag ? (
        <div
          className={`sell-hint ${sellDrag.sellable ? "" : "sell-hint-blocked"}`}
          aria-live="polite"
        >
          {sellDrag.sellable
            ? `Drop to sell ${sellDrag.name} back to the deck for $${sellDrag.refund}`
            : `${sellDrag.name} can’t be sold (starter or borrowed card)`}
        </div>
      ) : null}
      <div className="panel-body">
        <div className="marketplace-grid">
          {game.cardMarket.map((cardTypeId, slot) => {
            if (cardTypeId === null) {
              return (
                <article key={slot} className="card" aria-label="Empty slot">
                  <p className="muted" style={{ margin: "auto" }}>
                    Deck exhausted
                  </p>
                </article>
              );
            }
            const def = getCard(cardTypeId);
            const affordable = player.cash >= def.cost;
            const singleRecipes = def.recipeIds.filter(
              (rid) => getRecipe(rid).requiredCardTypes.length === 1,
            );
            const seqNames = SEQUENCES.filter(
              (s) => s.cards.length > 1 && s.cards.includes(cardTypeId),
            ).map((s) => s.name);
            return (
              <CardFrame
                key={`${slot}-${cardTypeId}`}
                cardTypeId={cardTypeId}
                onFocus={onFocus}
                footer={
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!interactive || !affordable}
                    aria-label={`Buy ${def.name} for ${def.cost} credits${affordable ? "" : " (cannot afford)"}`}
                    title={
                      affordable
                        ? `Buy ${def.name} — it can activate immediately`
                        : `Costs $${def.cost}, you have $${player.cash}`
                    }
                    onClick={() => onBuyCard(slot)}
                  >
                    Buy for ${def.cost}
                  </button>
                }
              >
                {singleRecipes.map((rid) => (
                  <div key={rid} className="recipe-row">
                    <RecipeIO recipeId={rid} />
                  </div>
                ))}
                {seqNames.length > 0 ? (
                  <p
                    className="tiny"
                    style={{ margin: "2px 0" }}
                    title={seqNames.join(" · ")}
                  >
                    🔧 Sequence component: {seqNames.join(" · ")}
                  </p>
                ) : null}
              </CardFrame>
            );
          })}
        </div>
      </div>
    </section>
  );
};
