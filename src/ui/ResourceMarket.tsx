// Dynamic resource market (v3): supply track with rebate-colored pips,
// per-market roads, live buy/sell prices, multi-unit quote previews.

import { useMemo, useState } from "react";
import type { FC } from "react";
import type { GameState, PlayerState } from "../engine/types";
import { RESOURCES } from "../engine/data/resources";
import { calculateMarketQuote } from "../engine/market";
import { unitBuyPrice, unitSellPrice } from "../engine/market";
import { marketMakerRemaining } from "../engine/game";
import { GAME_CONFIG } from "../engine/data/config";
import { ResourceIcon } from "./icons";
import type { FocusTarget } from "./focus";

/** Expand a rebate queue into per-unit owner seat numbers (queue order). */
function rebateOwners(game: GameState, resourceId: string): number[] {
  const queue = game.rebates[resourceId] ?? [];
  const owners: number[] = [];
  for (const entry of queue) {
    const seat = game.players.findIndex((p) => p.id === entry.playerId);
    for (let i = 0; i < entry.units && owners.length < 24; i++)
      owners.push(seat);
  }
  return owners;
}

export const ResourceMarket: FC<{
  game: GameState;
  player: PlayerState;
  interactive: boolean;
  onBuy: (resourceId: string, qty: number) => void;
  onSell: (resourceId: string, qty: number) => void;
  onBuildRoad: (resourceId: string) => void;
  onFocus?: (target: FocusTarget) => void;
}> = ({ game, player, interactive, onBuy, onSell, onBuildRoad, onFocus }) => {
  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  const selectedDef = RESOURCES.find((r) => r.id === selected) ?? null;
  const stock = selectedDef ? game.market[selectedDef.id] : 0;

  const buyQuote = useMemo(
    () =>
      selectedDef
        ? calculateMarketQuote(selectedDef.id, "buy", qty, stock)
        : null,
    [selectedDef, qty, stock],
  );
  const sellQuote = useMemo(
    () =>
      selectedDef
        ? calculateMarketQuote(selectedDef.id, "sell", qty, stock)
        : null,
    [selectedDef, qty, stock],
  );
  const owned = selectedDef ? (player.resources[selectedDef.id] ?? 0) : 0;
  const needsPackaging = selectedDef
    ? GAME_CONFIG.packagedGoods.includes(selectedDef.id)
    : false;
  const packagingOwned = player.resources.packaging ?? 0;
  const hasRoad = selectedDef
    ? player.marketRoads.includes(selectedDef.id)
    : false;
  const canBuy =
    interactive &&
    buyQuote !== null &&
    buyQuote.units === qty &&
    buyQuote.total <= player.cash;
  const canSell =
    interactive &&
    sellQuote !== null &&
    sellQuote.units === qty &&
    owned >= qty &&
    (!needsPackaging || packagingOwned >= qty);

  return (
    <section className="panel" aria-label="Resource market">
      <h2>
        Resource Market
        <span className="tiny">click a row to trade · 🛣 = your road</span>
      </h2>
      <div
        className="panel-body"
        style={{ maxHeight: "52vh", overflowY: "auto" }}
      >
        {(["raw", "intermediate", "finished"] as const).map((cat) => (
          <div key={cat}>
            <div className="inv-group-title">{cat}</div>
            {RESOURCES.filter((r) => r.category === cat).map((r) => {
              const s = game.market[r.id];
              const buy = unitBuyPrice(r.id, s);
              const sell = unitSellPrice(r.id, s);
              const scarce = s <= 3;
              const owners = rebateOwners(game, r.id);
              const myPending = (game.rebates[r.id] ?? [])
                .filter((e) => e.playerId === player.id)
                .reduce((sum, e) => sum + e.units, 0);
              const roadHere = player.marketRoads.includes(r.id);
              return (
                <div
                  key={r.id}
                  className={`market-row ${selected === r.id ? "selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${r.name}: stock ${s} of ${r.capacity}, buy ${buy ?? "unavailable"}, sell ${sell ?? "market full"}${roadHere ? ", you have a road here" : ""}${owners.length > 0 ? `, ${owners.length} pending spread rebates` : ""}`}
                  title={
                    owners.length > 0
                      ? `${owners.length} pending spread rebate${owners.length === 1 ? "" : "s"} (colored pips)${myPending > 0 ? ` — ${myPending} yours` : ""}`
                      : undefined
                  }
                  onClick={() => {
                    setSelected(r.id === selected ? null : r.id);
                    setQty(1);
                    onFocus?.({ kind: "resource", id: r.id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(r.id === selected ? null : r.id);
                      setQty(1);
                      onFocus?.({ kind: "resource", id: r.id });
                    }
                  }}
                >
                  <ResourceIcon id={r.id} size={17} />
                  <div className="market-name">
                    <span className="n">
                      {r.name}
                      {roadHere ? (
                        <span title="Your market road"> 🛣</span>
                      ) : null}
                      {scarce ? (
                        <strong title="scarce supply"> ⚠</strong>
                      ) : null}
                    </span>
                    <div className="supply-track" aria-hidden="true">
                      {Array.from({ length: r.capacity }, (_, i) => {
                        const filled = i < s;
                        // Pips nearest the "next purchase" end carry rebates.
                        const distFromRight = s - 1 - i;
                        const ownerSeat =
                          filled &&
                          distFromRight >= 0 &&
                          distFromRight < owners.length
                            ? owners[distFromRight]
                            : -1;
                        return (
                          <span
                            key={i}
                            className={`supply-cell ${filled ? "filled" : ""} ${scarce ? "low" : ""} ${ownerSeat >= 0 ? `pip-p${ownerSeat + 1}` : ""}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="market-prices">
                    <div className="stock-label">
                      {s}/{r.capacity}
                      <span
                        className="eq-mark"
                        title={`Market maker target (equilibrium): ${
                          game.marketConfig?.equilibrium[r.id] ?? r.equilibrium
                        }. Stock drifts toward this each round.`}
                      >
                        {" "}
                        ⌂{game.marketConfig?.equilibrium[r.id] ?? r.equilibrium}
                      </span>
                      {(() => {
                        const rem = marketMakerRemaining(game, r.id);
                        if (rem === 0) return null;
                        return (
                          <span
                            className={`mm-arrow ${rem > 0 ? "mm-up" : "mm-down"}`}
                            title={`Market maker: ${rem > 0 ? "+" : ""}${rem} more unit${Math.abs(rem) === 1 ? "" : "s"} arriving over the remaining turns this round`}
                          >
                            {rem > 0 ? `▲${rem}` : `▼${Math.abs(rem)}`}
                          </span>
                        );
                      })()}
                    </div>
                    <div>
                      <span className="price-buy" title="buy one unit">
                        B {buy ?? "—"}
                      </span>{" "}
                      <span className="price-sell" title="sell one unit">
                        S {sell ?? "—"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {selectedDef ? (
        <div className="trade-bar">
          <ResourceIcon id={selectedDef.id} size={16} />
          <strong>{selectedDef.name}</strong>
          <span className="muted">you own {owned}</span>
          <label className="sr-only" htmlFor="trade-qty">
            Quantity
          </label>
          <input
            id="trade-qty"
            type="number"
            min={1}
            max={12}
            value={qty}
            onChange={(e) =>
              setQty(
                Math.max(
                  1,
                  Math.min(12, Math.floor(Number(e.currentTarget.value) || 1)),
                ),
              )
            }
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!canBuy}
            title={
              buyQuote && buyQuote.units < qty
                ? `Only ${buyQuote.units} available`
                : buyQuote && buyQuote.total > player.cash
                  ? "Not enough cash"
                  : `Buy ${qty} for $${buyQuote?.total ?? 0} total`
            }
            onClick={() => selectedDef && onBuy(selectedDef.id, qty)}
          >
            Buy {qty} for{" "}
            <span className="trade-total">${buyQuote?.total ?? 0}</span>
          </button>
          <button
            type="button"
            disabled={!canSell}
            title={
              owned < qty
                ? `You only own ${owned}`
                : needsPackaging && packagingOwned < qty
                  ? `Selling this costs 1 packaging per unit (you have ${packagingOwned})`
                  : sellQuote && sellQuote.units < qty
                    ? "Market cannot absorb that many"
                    : `Sell ${qty} for $${sellQuote?.total ?? 0} total${needsPackaging ? ` (uses ${qty} packaging)` : ""}${hasRoad ? " — earns spread rebates when others buy" : ""}`
            }
            onClick={() => selectedDef && onSell(selectedDef.id, qty)}
          >
            Sell {qty} for{" "}
            <span className="trade-total">${sellQuote?.total ?? 0}</span>
            {needsPackaging ? <span className="tiny"> +{qty}📦</span> : null}
          </button>
          {hasRoad ? (
            <span
              className="tiny"
              title="Sales here queue $1-per-unit rebates, paid when other players buy"
            >
              🛣 road built — sales earn spread rebates
            </span>
          ) : (
            <button
              type="button"
              className="btn-sm"
              disabled={
                !interactive ||
                (player.resources.asphalt ?? 0) < GAME_CONFIG.roadCost
              }
              title={
                (player.resources.asphalt ?? 0) >= GAME_CONFIG.roadCost
                  ? "Sell directly to other players: you are paid the sell price now and rebated the $1 spread whenever another player buys this resource (up to the amount you sold)"
                  : `Needs ${GAME_CONFIG.roadCost} asphalt`
              }
              onClick={() => selectedDef && onBuildRoad(selectedDef.id)}
            >
              🛣 Build market road ({GAME_CONFIG.roadCost}{" "}
              <ResourceIcon id="asphalt" />)
            </button>
          )}
          {needsPackaging ? (
            <span
              className="tiny"
              title="Packaging is consumed from your warehouse when selling"
            >
              selling uses 1 packaging per unit
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
