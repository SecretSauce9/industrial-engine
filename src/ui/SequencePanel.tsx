// Sequence Assembly area (v3): drag cards from the tableau (or use each
// card's "Add to sequence" button) to form an ordered sequence. When the
// order matches a known facility, its name appears with the recipes it can
// run. Activation uses every card in the sequence (combo rules apply).

import type { FC } from "react";
import type { GameState, PlayerState } from "../engine/types";
import { canActivate, availableFacilities } from "../engine/game";
import { getCard } from "../engine/data/cards";
import { RECIPES } from "../engine/data/recipes";
import {
  sequenceKey,
  sequenceName,
  sequenceIcon,
} from "../engine/data/sequences";
import { RecipeIO } from "./CardView";
import type { FocusTarget } from "./focus";

export const SequencePanel: FC<{
  game: GameState;
  player: PlayerState;
  interactive: boolean;
  selection: string[];
  onAdd: (instanceId: string) => void;
  onRemove: (instanceId: string) => void;
  onClear: () => void;
  onLoad: (cardInstanceIds: string[]) => void;
  onActivate: (recipeId: string, cardInstanceIds: string[]) => void;
  onFocus?: (target: FocusTarget) => void;
}> = ({
  game,
  player,
  interactive,
  selection,
  onAdd,
  onRemove,
  onClear,
  onLoad,
  onActivate,
  onFocus,
}) => {
  const facilities = availableFacilities(game, player.id);
  const instances = selection
    .map((id) => player.cards.find((c) => c.instanceId === id))
    .filter((c) => c !== undefined);
  const key = sequenceKey(instances.map((c) => c!.cardTypeId));
  const recipes =
    instances.length > 0
      ? RECIPES.filter((r) => {
          if (sequenceKey(r.requiredCardTypes) !== key) return false;
          if (r.requiredCardTypes.length > 1) return true;
          // A lone standalone card may run here only if it is non-production
          // (production cards produce inline on the tableau) (v5).
          return getCard(r.requiredCardTypes[0]).category !== "production";
        })
      : [];
  // Multi-card facilities have a registered name; a lone standalone card
  // simply shows its own name when it has a runnable recipe here.
  const facility =
    instances.length > 0
      ? (sequenceName(key) ??
        (instances.length === 1 && recipes.length > 0
          ? getCard(instances[0]!.cardTypeId).name
          : undefined))
      : undefined;

  return (
    <section className="panel" aria-label="Sequence assembly">
      <h2>
        Sequence Assembly
        <span className="tiny">
          drag cards here (or use “Add to sequence”) — order matters
        </span>
      </h2>
      <div
        className="panel-body seq-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/plain");
          if (id && interactive) onAdd(id);
        }}
      >
        {instances.length === 0 ? (
          <p className="muted" style={{ margin: "0 0 8px" }}>
            Drag cards here (or use “Add to sequence”) to build a facility —
            order matters — or tap an available facility below to load it. Each
            card can join up to 3 different sequences per turn.
          </p>
        ) : (
          <>
            <div className="seq-slots" role="list" aria-label="Sequence order">
              {instances.map((inst, i) => (
                <span
                  key={inst!.instanceId}
                  className="seq-slot"
                  role="listitem"
                >
                  <span className="tiny">{i + 1}.</span>{" "}
                  {getCard(inst!.cardTypeId).name}
                  <button
                    type="button"
                    className="btn-sm"
                    aria-label={`Remove ${getCard(inst!.cardTypeId).name} from the sequence`}
                    onClick={() => onRemove(inst!.instanceId)}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button type="button" className="btn-sm" onClick={onClear}>
                Clear all
              </button>
            </div>
            {facility ? (
              <p className="seq-facility" aria-live="polite">
                ={" "}
                {sequenceIcon(key) ? (
                  <span aria-hidden="true">{sequenceIcon(key)} </span>
                ) : null}
                {sequenceName(key) && onFocus ? (
                  <button
                    type="button"
                    className="link-btn"
                    title="Read about this facility"
                    onClick={() => onFocus({ kind: "facility", id: key })}
                  >
                    <strong>{facility}</strong>
                  </button>
                ) : (
                  <strong>{facility}</strong>
                )}
              </p>
            ) : (
              <p className="tiny" aria-live="polite">
                No facility matches this order
                {instances.length > 1
                  ? " — try rearranging or different cards"
                  : " yet — add more cards"}
                .
              </p>
            )}
            {recipes.map((r) => {
              const verdict = canActivate(
                game,
                player.id,
                r.id,
                instances.map((c) => c!.instanceId),
              );
              const enabled = interactive && verdict.ok;
              return (
                <div
                  key={r.id}
                  className={`recipe-row ${enabled ? "" : "disabled"}`}
                >
                  <RecipeIO recipeId={r.id} />
                  <button
                    type="button"
                    className="btn-sm btn-primary"
                    disabled={!enabled}
                    title={enabled ? `Activate: ${r.name}` : verdict.reason}
                    aria-label={`Activate ${r.name}${enabled ? "" : ` (unavailable: ${verdict.reason ?? ""})`}`}
                    onClick={() =>
                      onActivate(
                        r.id,
                        instances.map((c) => c!.instanceId),
                      )
                    }
                  >
                    Activate
                  </button>
                </div>
              );
            })}
          </>
        )}

        {/* Facilities list — always shown; loading is disabled while the
            sequence area already holds cards (v8). */}
        <div className="seq-facilities-block">
          <div className="inv-group-title">Facilities you can build now</div>
          {facilities.length > 0 ? (
            <div
              className="facility-chips"
              role="group"
              aria-label="Facilities you can build now"
            >
              {facilities.map((f) => {
                const disabled = !interactive || instances.length > 0;
                return (
                  <button
                    key={f.key}
                    type="button"
                    className="facility-chip"
                    disabled={disabled}
                    title={
                      instances.length > 0
                        ? "Clear the sequence area to load a facility"
                        : `Load ${f.name} (${f.cardInstanceIds.length} card${
                            f.cardInstanceIds.length === 1 ? "" : "s"
                          })`
                    }
                    onClick={() => {
                      onLoad(f.cardInstanceIds);
                      onFocus?.({ kind: "facility", id: f.key });
                    }}
                  >
                    <span className="facility-icon" aria-hidden="true">
                      {f.icon}
                    </span>
                    <span className="facility-label">{f.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="tiny" style={{ margin: 0 }}>
              None available yet — buy and combine component cards (Grinder,
              Mixer, Furnace, Cracker…).
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
