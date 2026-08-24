// A brief, friendly onboarding tutorial — the five ideas a new player needs to
// start playing. The exhaustive rules live in RulesModal; this is the quick
// tour. Shown automatically on first visit and reopenable from the header.

import { useState } from "react";
import type { FC, ReactNode } from "react";
import { GAME_CONFIG } from "../engine/data/config";

interface Step {
  title: string;
  body: ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Industrial Engine",
    body: (
      <>
        <p>
          You are building an <strong>industrial economy</strong> over{" "}
          {GAME_CONFIG.defaultRounds} rounds. Buy raw materials, refine them up
          a chain of production, and sell the results for profit — or be the
          first to make a finished good and claim its <strong>prestige</strong>.
        </p>
        <p>
          This tour takes about a minute. You can reopen it any time from the{" "}
          <strong>🎓 Tutorial</strong> button, and the full rules live under{" "}
          <strong>📖 Rules</strong>.
        </p>
      </>
    ),
  },
  {
    title: "1 · How you win",
    body: (
      <>
        <p>
          Your score is <strong>prestige + net worth ÷ 10</strong>. Net worth is
          your cash, the sell value of everything in your warehouse, and half
          the printed cost of your cards.
        </p>
        <p>
          Roughly: <strong>1 prestige ≈ 10 net worth ≈ 1 point</strong>.
          Prestige is permanent — you keep it even after selling the good that
          earned it.
        </p>
      </>
    ),
  },
  {
    title: "2 · Produce with cards & sequences",
    body: (
      <>
        <p>
          Everything flows through your <strong>warehouse</strong>. Cards turn
          resources into more valuable ones. Some cards act alone; most combine
          into <strong>sequences</strong> — drag them into the Sequence Assembly
          area (or press “Add to sequence”).
        </p>
        <p>
          <strong>Order matters</strong>: Mixer → Furnace makes glass, while
          Furnace → Mixer batches concrete. Each card can work up to{" "}
          {GAME_CONFIG.maxUsesPerTurn} times a turn as long as each use is a
          different sequence.
        </p>
      </>
    ),
  },
  {
    title: "3 · Buy low, sell high",
    body: (
      <>
        <p>
          Every resource has a price ladder that{" "}
          <strong>moves as you trade</strong>: buying drives a price up, selling
          drives it down. Dumping ten of the same good crashes its price, so{" "}
          <strong>spread your sales</strong> across markets.
        </p>
        <p>
          Selling is a drag onto the market (its price shows on hover). For{" "}
          {GAME_CONFIG.roadCost} asphalt you can build a{" "}
          <strong>market road</strong> and earn a rebate whenever a rival buys
          that resource.
        </p>
      </>
    ),
  },
  {
    title: "4 · Race for prestige",
    body: (
      <>
        <p>
          Only the <strong>first</strong> player to produce each finished good —
          clothing, electronics, pharmaceuticals, buildings, machinery, vehicles
          — earns its prestige. Later producers get the goods but no prestige,
          so timing a push up the chain is the heart of the game.
        </p>
      </>
    ),
  },
  {
    title: "5 · Taking your turn",
    body: (
      <>
        <p>
          On your turn, in any order: buy and sell resources, buy cards, build
          roads, and activate as much as you can afford. You owe{" "}
          <strong>
            1 food per {GAME_CONFIG.activationsPerFood} activations
          </strong>
          .
        </p>
        <p>
          Then <strong>End Turn</strong> to collect ${GAME_CONFIG.income.base}{" "}
          income — doubled to ${GAME_CONFIG.income.noActivationBonus} if you sat
          out entirely. That’s it — dive in, and check the log if you lose track
          of what happened.
        </p>
      </>
    ),
  },
];

export const Tutorial: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal tutorial-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "ArrowRight" && !last) setI(i + 1);
          if (e.key === "ArrowLeft" && i > 0) setI(i - 1);
        }}
      >
        <div className="modal-head">
          <h2 id="tutorial-title">{step.title}</h2>
          <span className="header-spacer" />
          <button type="button" onClick={onClose} aria-label="Close tutorial">
            ✕ Skip
          </button>
        </div>
        <div className="modal-body tutorial-body">{step.body}</div>
        <div className="tutorial-foot">
          <div className="tutorial-dots" aria-hidden="true">
            {STEPS.map((_, n) => (
              <span key={n} className={n === i ? "dot dot-on" : "dot"} />
            ))}
          </div>
          <span className="header-spacer" />
          <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}>
            ◀ Back
          </button>
          {last ? (
            <button type="button" className="btn-primary" onClick={onClose}>
              Got it ▶
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setI(i + 1)}
              autoFocus
            >
              Next ▶
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
