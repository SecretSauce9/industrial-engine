// Shared card renderer for tableau and marketplace (v3: tags, combo uses,
// sequence-component badges, non-consumed requirements).

import type { FC, ReactNode } from "react";
import type { CardInstance } from "../engine/types";
import { getCard } from "../engine/data/cards";
import { getRecipe } from "../engine/data/recipes";
import { GAME_CONFIG } from "../engine/data/config";
import { ResourceChip, ResourceIcon } from "./icons";
import type { FocusTarget } from "./focus";

export const RecipeIO: FC<{ recipeId: string }> = ({ recipeId }) => {
  const recipe = getRecipe(recipeId);
  const inputs = Object.entries(recipe.inputs).filter(([, n]) => (n ?? 0) > 0);
  const requires = Object.entries(recipe.requires ?? {}).filter(
    ([, n]) => (n ?? 0) > 0,
  );
  const outputs = Object.entries(recipe.outputs).filter(
    ([, n]) => (n ?? 0) > 0,
  );
  return (
    <span className="recipe-io" title={recipe.note}>
      {inputs.length === 0 && requires.length === 0 ? (
        <span className="tiny">no input</span>
      ) : null}
      {inputs.map(([rid, n]) => (
        <ResourceChip key={rid} id={rid} qty={n} />
      ))}
      {requires.map(([rid, n]) => (
        <span
          key={`req-${rid}`}
          className="io-chip require-chip"
          title={`Requires ${n} ${rid} — NOT consumed. A given quantity backs only one such activation per turn.`}
        >
          ⊙{n}
          <ResourceIcon id={rid} />
          <span aria-hidden="true">{shortName(rid)}</span>
          <span className="sr-only">{rid} required but not consumed</span>
        </span>
      ))}
      <span className="recipe-arrow" aria-hidden="true">
        →
      </span>
      <span className="sr-only">produces</span>
      {recipe.special === "fertilize" ? (
        <span
          className="io-chip prestige-chip"
          title={`Raises this Farm's harvest output by 2, up to the maximum of ${GAME_CONFIG.farmMaxHarvest}`}
        >
          harvest +2 (max {GAME_CONFIG.farmMaxHarvest})
        </span>
      ) : null}
      {outputs.map(([rid, n]) => (
        <ResourceChip key={rid} id={rid} qty={n} />
      ))}
      {recipe.special === "harvest" ? (
        <span className="tiny" title={recipe.note}>
          (yield −1/harvest)
        </span>
      ) : null}
      {recipe.prestige ? (
        <span
          className="io-chip prestige-chip"
          title={`${recipe.prestige} prestige`}
        >
          ★{recipe.prestige}
        </span>
      ) : null}
    </span>
  );
};

function shortName(rid: string): string {
  const cap = rid.charAt(0).toUpperCase() + rid.slice(1);
  return cap.length > 9 ? `${cap.slice(0, 8)}…` : cap;
}

/** Is this card a sequence component (participates in multi-card recipes)? */
export function isSequenceComponent(cardTypeId: string): boolean {
  const def = getCard(cardTypeId);
  return def.recipeIds.some(
    (rid) => getRecipe(rid).requiredCardTypes.length > 1,
  );
}

export const CardFrame: FC<{
  cardTypeId: string;
  instance?: CardInstance;
  children?: ReactNode;
  footer?: ReactNode;
  onFocus?: (target: FocusTarget) => void;
}> = ({ cardTypeId, instance, children, footer, onFocus }) => {
  const def = getCard(cardTypeId);
  const component = isSequenceComponent(cardTypeId);
  const maxUses = instance?.borrowedFrom
    ? GAME_CONFIG.borrowedMaxUses
    : component
      ? GAME_CONFIG.maxUsesPerTurn
      : 1;
  const used = instance ? instance.usedSequences.length : 0;
  const exhausted = instance ? used >= maxUses : false;
  return (
    <article
      className={`card ${instance ? (exhausted ? "used" : "ready") : ""} ${instance?.borrowedFrom ? "borrowed" : ""}`}
      aria-label={`${def.name}${instance ? `, ${maxUses - used} of ${maxUses} uses left this turn` : ""}`}
    >
      <div className="card-head">
        <span className="card-name">
          {instance?.borrowedFrom ? (
            <span
              className="borrowed-badge"
              title="Borrowed for this turn (1 activation); returns at end of turn"
            >
              🤝
            </span>
          ) : null}
          {onFocus ? (
            <button
              type="button"
              className="link-btn"
              title={`Read about ${def.name}`}
              onClick={() => onFocus({ kind: "card", id: cardTypeId })}
            >
              {def.name}
            </button>
          ) : (
            def.name
          )}
          {instance?.harvestOutput !== undefined ? (
            <span className="tiny" title="Current Harvest Crops yield (max 3)">
              {" "}
              (yield {instance.harvestOutput})
            </span>
          ) : null}
        </span>
        <span className={`card-cat cat-${def.category}`}>{def.category}</span>
        {def.tag ? (
          <span
            className={`card-tag tag-${def.tag}`}
            title={
              def.tag === "machinery"
                ? "Machinery: activations cost 1 electricity"
                : "Vehicles: activations cost 1 fuel"
            }
          >
            {def.tag === "machinery" ? "⚡M" : "⛽V"}
          </span>
        ) : (
          <span
            className="card-tag tag-none"
            title="Untagged: no activation energy cost"
          >
            ∅
          </span>
        )}
        {instance && component ? (
          <span
            className="card-tag tag-uses"
            title={`Combo uses left this turn (each must be a different sequence)`}
          >
            {maxUses - used}/{maxUses}
          </span>
        ) : null}
        <span className="card-cost" title="printed cost">
          ${def.cost}
        </span>
      </div>
      {children}
      {footer}
    </article>
  );
};
