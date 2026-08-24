// The active player's owned cards (v3). Standalone recipes activate directly;
// sequence components are dragged (or clicked) into the Sequence Assembly
// area. All legality questions are answered by the engine.

import { useMemo, useState } from "react";
import type { FC } from "react";
import type { ActivationOption, GameState, PlayerState } from "../engine/types";
import { getAvailableActivations } from "../engine/game";
import { getCard } from "../engine/data/cards";
import { getRecipe } from "../engine/data/recipes";
import { SEQUENCES } from "../engine/data/sequences";
import { GAME_CONFIG } from "../engine/data/config";
import { CardFrame, RecipeIO } from "./CardView";
import type { FocusTarget } from "./focus";

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "production", label: "Production" },
  { id: "energy", label: "Energy" },
  { id: "materials", label: "Materials" },
  { id: "agrifood", label: "Agriculture & Food" },
  { id: "manufacturing", label: "Manufacturing" },
];

export const PlayerTableau: FC<{
  game: GameState;
  player: PlayerState;
  interactive: boolean;
  selection: string[];
  onActivate: (recipeId: string, cardInstanceIds: string[]) => void;
  onAddToSequence: (instanceId: string) => void;
  onSetTurbineMode: (instanceId: string, mode: "grid" | "black") => void;
  onFocus?: (target: FocusTarget) => void;
  /** Drag lifecycle so the marketplace can show a "drop to sell" hint. */
  onCardDragStart?: (instanceId: string) => void;
  onCardDragEnd?: () => void;
}> = ({
  game,
  player,
  interactive,
  selection,
  onActivate,
  onAddToSequence,
  onSetTurbineMode,
  onFocus,
  onCardDragStart,
  onCardDragEnd,
}) => {
  const [filter, setFilter] = useState("all");

  const options = useMemo(
    () => getAvailableActivations(game, player.id),
    [game, player.id],
  );
  const optionFor = (
    instanceId: string,
    recipeId: string,
  ): ActivationOption | undefined =>
    options.find(
      (o) => o.recipeId === recipeId && o.cardInstanceIds[0] === instanceId,
    );

  const cards = player.cards.filter(
    (c) => filter === "all" || getCard(c.cardTypeId).category === filter,
  );

  /** Multi-card sequences this card type participates in (names for hints). */
  const sequencesFor = (cardTypeId: string): string[] =>
    SEQUENCES.filter(
      (s) => s.cards.length > 1 && s.cards.includes(cardTypeId),
    ).map((s) => s.name);

  const staged = game.turn.sequencer;
  const heldCards = player.cards.filter(
    (c) => !c.borrowedFrom && !staged.includes(c.instanceId),
  ).length;
  return (
    <section className="panel" aria-label="Your tableau">
      <h2>
        {player.name}&rsquo;s Tableau
        <span className="tiny">
          {heldCards}/{GAME_CONFIG.tableauCardLimit} cards
          {staged.length > 0 ? ` (+${staged.length} staged)` : ""} · drag a card
          to the marketplace to sell it · activations this turn:{" "}
          {game.turn.activations}
          {game.turn.activations % GAME_CONFIG.activationsPerFood === 0
            ? " · next costs 1 food"
            : ""}
        </span>
      </h2>
      <div className="panel-body">
        <div
          className="filter-bar"
          role="group"
          aria-label="Filter cards by category"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn-sm"
              aria-pressed={filter === f.id ? "true" : "false"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {cards.length === 0 ? (
          <p className="muted">
            {player.cards.length === 0
              ? "No cards yet. Buy production cards from the marketplace to start your engine."
              : "No cards match this filter."}
          </p>
        ) : (
          <div className="tableau-grid">
            {cards.map((inst) => {
              const def = getCard(inst.cardTypeId);
              const singleRecipes = def.recipeIds.filter(
                (rid) => getRecipe(rid).requiredCardTypes.length === 1,
              );
              const seqNames = sequencesFor(inst.cardTypeId);
              // Non-production cards that can activate on their own may also be
              // run through the Sequence Assembly area (v5).
              const standaloneSequenceable =
                def.category !== "production" && singleRecipes.length > 0;
              const canSequence = seqNames.length > 0 || standaloneSequenceable;
              const inSelection = selection.includes(inst.instanceId);
              return (
                <div
                  key={inst.instanceId}
                  className="tableau-card-wrap"
                  data-instance={inst.instanceId}
                  draggable={interactive && !inSelection}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", inst.instanceId);
                    e.dataTransfer.effectAllowed = "copyMove";
                    onCardDragStart?.(inst.instanceId);
                  }}
                  onDragEnd={() => onCardDragEnd?.()}
                  style={inSelection ? { opacity: 0.5 } : undefined}
                >
                  <CardFrame
                    cardTypeId={inst.cardTypeId}
                    instance={inst}
                    onFocus={onFocus}
                  >
                    {singleRecipes.map((rid) => {
                      const recipe = getRecipe(rid);
                      const opt = optionFor(inst.instanceId, rid);
                      const canGo = interactive && !!opt && opt.affordable;
                      const reason = !opt
                        ? "No uses left this turn"
                        : (opt.reason ?? "Unavailable");
                      return (
                        <div
                          key={rid}
                          className={`recipe-row ${canGo ? "" : "disabled"}`}
                        >
                          <RecipeIO recipeId={rid} />
                          <button
                            type="button"
                            className="btn-sm btn-primary"
                            disabled={!canGo}
                            title={canGo ? `Activate: ${recipe.name}` : reason}
                            aria-label={`Activate ${recipe.name} on ${def.name}${canGo ? "" : ` (unavailable: ${reason})`}`}
                            onClick={() =>
                              opt && onActivate(rid, opt.cardInstanceIds)
                            }
                          >
                            Activate
                          </button>
                        </div>
                      );
                    })}
                    {inst.cardTypeId === "turbine_generator" ? (
                      <div className="transfer-row">
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={!interactive}
                          aria-pressed={
                            (inst.energyMode ?? "grid") === "black"
                              ? "true"
                              : "false"
                          }
                          title="Grid start burns 1 electricity; black start burns 1 fuel instead"
                          onClick={() =>
                            onSetTurbineMode(
                              inst.instanceId,
                              (inst.energyMode ?? "grid") === "black"
                                ? "grid"
                                : "black",
                            )
                          }
                        >
                          {(inst.energyMode ?? "grid") === "black"
                            ? "⛽ Black start (fuel)"
                            : "⚡ Grid start (electricity)"}
                        </button>
                      </div>
                    ) : null}
                    {canSequence ? (
                      <div className="transfer-row">
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={!interactive || inSelection}
                          title={
                            inSelection
                              ? "Already in the sequence being assembled"
                              : seqNames.length > 0
                                ? `Add to the sequence area (drag also works). Forms: ${seqNames.join(", ")}`
                                : "Add to the sequence area (drag also works) to run this card on its own"
                          }
                          onClick={() => onAddToSequence(inst.instanceId)}
                        >
                          🔧 Add to sequence
                        </button>
                        {seqNames.length > 0 ? (
                          <span className="tiny" title={seqNames.join(", ")}>
                            {seqNames.length} combo
                            {seqNames.length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="tiny">standalone</span>
                        )}
                      </div>
                    ) : null}
                  </CardFrame>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
