// In-game rules and searchable recipe reference (v3 rules).

import { useMemo, useState } from "react";
import type { FC } from "react";
import { RECIPES } from "../engine/data/recipes";
import { getCard } from "../engine/data/cards";
import { SEQUENCES, sequenceKey, sequenceName } from "../engine/data/sequences";
import { GAME_CONFIG } from "../engine/data/config";
import { RecipeIO } from "./CardView";

export const RulesModal: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return RECIPES;
    return RECIPES.filter((r) => {
      const cards = r.requiredCardTypes.map((t) => getCard(t).name).join(" ");
      const facility = sequenceName(sequenceKey(r.requiredCardTypes)) ?? "";
      const resources = [
        ...Object.keys(r.inputs),
        ...Object.keys(r.requires ?? {}),
        ...Object.keys(r.outputs),
      ].join(" ");
      return `${r.name} ${cards} ${facility} ${resources} ${r.id}`
        .toLowerCase()
        .includes(q);
    });
  }, [search]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="modal-head">
          <h2 id="rules-title">Rules &amp; Recipe Reference</h2>
          <span className="header-spacer" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules"
            autoFocus
          >
            ✕ Close
          </button>
        </div>
        <div className="modal-body">
          <h3>Goal</h3>
          <p>
            Build the most valuable industrial engine in{" "}
            {GAME_CONFIG.defaultRounds} rounds. Final score ={" "}
            <strong>prestige + floor(net worth / 10)</strong>, where net worth =
            cash + current sell value of your warehouse + half the printed cost
            of your cards. Prestige is earned permanently when you{" "}
            <em>produce</em> a finished product — selling it never removes
            prestige.
          </p>

          <h3>Your turn</h3>
          <p>
            In any order, any number of times: buy/sell resources, buy
            marketplace cards, build market roads, and activate cards or
            sequences. All resources flow through your{" "}
            <strong>warehouse</strong> — inputs are drawn from it and outputs
            land in it automatically. You start each turn with 0 activations and
            pay{" "}
            <strong>
              1 food per {GAME_CONFIG.activationsPerFood} activations
            </strong>{" "}
            (due on the 1st, 4th, 7th…). Ending your turn pays{" "}
            <strong>
              ${GAME_CONFIG.income.base} income — doubled to $
              {GAME_CONFIG.income.noActivationBonus} with no activations
            </strong>
            . Every player starts with a Construction card, 5 electricity, 5
            fuel, 5 food, and 1 asphalt.
          </p>

          <h3>Sequences &amp; the combo system</h3>
          <p>
            Most transformations are performed by <strong>sequences</strong> of
            component cards (Grinder, Mixer, Furnace, Cracker…) assembled in the
            Sequence Assembly area — drag cards there or use “Add to sequence”.{" "}
            <strong>Order matters</strong>: Mixer→Furnace is the Blast/Glass
            Furnace, while Furnace→Mixer is the Concrete Batch Plant. Activating
            a sequence uses every card in it, but the{" "}
            <strong>combo system</strong> lets each card work up to{" "}
            {GAME_CONFIG.maxUsesPerTurn} times per turn as long as each use is a{" "}
            <em>different</em> sequence. Cards not replaced by sequences
            (production cards, Ranch, Solar Panels, Turbine/Generator,
            Slaughterhouse, Pasteurizer, Steam Reformer, Construction) activate
            on their own, once per turn.
          </p>
          <table>
            <thead>
              <tr>
                <th>Sequence (in order)</th>
                <th>Facility</th>
              </tr>
            </thead>
            <tbody>
              {SEQUENCES.map((s) => (
                <tr key={s.key}>
                  <td>{s.cards.map((c) => getCard(c).name).join(" → ")}</td>
                  <td>{s.name}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Activation costs</h3>
          <p>
            Every sequence activation costs <strong>1 electricity</strong> (all
            sequences are machinery). Standalone cards cost by their tag:
            production cards are Vehicles (⛽ 1 fuel), other standalone cards
            are Machinery (⚡ 1 electricity), and the Ranch and Solar Panels are
            untagged (free). Energy and food come from your warehouse.
          </p>

          <h3>Market roads &amp; spread rebates</h3>
          <p>
            For {GAME_CONFIG.roadCost} asphalt you can build a{" "}
            <strong>road to any single resource market</strong> — conceptually,
            selling directly to the other players. You are still paid the
            (lower) sell price up front, but you are{" "}
            <strong>rebated the $1 spread</strong> whenever another player buys
            that resource, up to the number of units you sold. If several
            road-owners sold, purchases credit them in the order they sold
            (FIFO). Pending rebates are shown as <strong>colored pips</strong>{" "}
            on the supply track, in each seller's player color. Your own
            purchases never trigger your own rebates.
          </p>

          <h3>Non-consuming requirements</h3>
          <p>
            Some recipes <em>require</em> livestock without consuming it (shown
            as ⊙): the Pasteurizer (3), Weave Wool (3), and Ranch manure
            processing (3). A given quantity of livestock can back only{" "}
            <strong>one</strong> such activation per turn.
          </p>

          <h3>Farms</h3>
          <p>
            Harvest Crops yields the Farm's current output (starting at 2,{" "}
            <strong>maximum {GAME_CONFIG.farmMaxHarvest}</strong>) and then
            lowers it by 1, to a minimum of 0. Fertilization consumes 1
            fertilizer to raise that Farm's output by 2, capped at{" "}
            {GAME_CONFIG.farmMaxHarvest} — fertilizer has no effect beyond the
            cap (and is blocked there). Composting turns 2 agriculture into 1
            fertilizer.
          </p>

          <h3>Market rules</h3>
          <p>
            Every resource has a 12-slot ascending price ladder. Buying one unit
            costs the price at slot <code>capacity − stock</code>; selling pays
            one slot lower <em>minus the 1-credit spread</em>. Multi-unit trades
            are priced one unit at a time and totals are always shown first. The{" "}
            <strong>turn-clocked market maker</strong> snaps every market
            elastically toward its equilibrium: each round's adjustment is
            frozen up front and dealt out in equal shares at the start of every
            player's turn (the ▲/▼ arrows on each row show what is still to
            come), so every player faces a comparable market before acting. No
            market ever starts a turn completely full or empty — the market
            maker nudges it by 1, counted against the same adjustment. Selling{" "}
            <strong>
              pharmaceuticals, electronics, or clothing costs 1 packaging per
              unit
            </strong>{" "}
            (producing them doesn't).
          </p>

          <h3>Free cards for top-tier production</h3>
          <p>
            Producing <strong>machinery</strong> grants a free machinery-tagged
            card of your choice from the deck; producing{" "}
            <strong>vehicles</strong> grants a free vehicles-tagged (production)
            card — and you keep the resource.
          </p>

          <h3>Card marketplace</h3>
          <p>
            Six face-up cards. Buying one shifts the rest right and a fresh card
            enters top-left. On any turn where you buy no card, the bottom-right
            card returns to the bottom of the deck and a fresh card enters
            top-left.
          </p>

          <h3>Scoring &amp; tiebreaks</h3>
          <p>
            Ranking: highest final score, then prestige, then net worth, then
            most finished resources held; a full tie is a shared victory.
            Prestige: clothing 4, electronics 5, pharmaceuticals 6, buildings 8
            (Construction), machinery 10, vehicles 14.
          </p>

          <h3>Recipe reference</h3>
          <p>
            <label htmlFor="recipe-search">Search recipes: </label>
            <input
              id="recipe-search"
              type="text"
              placeholder="e.g. steel, Refinery, livestock…"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </p>
          <table>
            <thead>
              <tr>
                <th>Sequence / Card</th>
                <th>Recipe</th>
                <th>Transformation</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const facility = sequenceName(sequenceKey(r.requiredCardTypes));
                return (
                  <tr key={r.id}>
                    <td>
                      {r.requiredCardTypes
                        .map((t) => getCard(t).name)
                        .join(" → ")}
                      {facility ? (
                        <div className="tiny">= {facility}</div>
                      ) : null}
                    </td>
                    <td>
                      {r.name}
                      {r.note ? <div className="tiny">{r.note}</div> : null}
                    </td>
                    <td>
                      <RecipeIO recipeId={r.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? <p>No recipes match “{search}”.</p> : null}
        </div>
      </div>
    </div>
  );
};
