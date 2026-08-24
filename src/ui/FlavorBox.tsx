// Flavor-text box: a small "field guide" that describes whatever the player
// last clicked — a market resource, a card, or a facility — in the register of
// Vaclav Smil's "How the World Really Works".

import type { FC, ReactNode } from "react";
import { getResource } from "../engine/data/resources";
import { getCard } from "../engine/data/cards";
import { SEQUENCE_MAP } from "../engine/data/sequences";
import { ResourceIcon } from "./icons";
import type { FocusTarget } from "./focus";

const CATEGORY_EMOJI: Record<string, string> = {
  production: "⛏️",
  energy: "⚡",
  materials: "🛠️",
  agrifood: "🌾",
  manufacturing: "🏭",
};

function resolve(focus: FocusTarget): {
  kind: string;
  name: string;
  flavor: string;
  icon: ReactNode;
} | null {
  try {
    if (focus.kind === "resource") {
      const r = getResource(focus.id);
      return {
        kind: r.category,
        name: r.name,
        flavor: r.flavor,
        icon: <ResourceIcon id={r.id} size={20} />,
      };
    }
    if (focus.kind === "card") {
      const c = getCard(focus.id);
      return {
        kind: `${c.category} card`,
        name: c.name,
        flavor: c.flavor,
        icon: (
          <span className="flavor-emoji">{CATEGORY_EMOJI[c.category]}</span>
        ),
      };
    }
    const s = SEQUENCE_MAP[focus.id];
    if (!s) return null;
    return {
      kind: "facility",
      name: s.name,
      flavor: s.flavor,
      icon: <span className="flavor-emoji">{s.icon}</span>,
    };
  } catch {
    return null;
  }
}

export const FlavorBox: FC<{ focus: FocusTarget | null }> = ({ focus }) => {
  const data = focus ? resolve(focus) : null;
  return (
    <section className="panel flavor-box" aria-label="Field guide">
      <h2>
        Field Guide
        <span className="tiny">click a resource, card, or facility</span>
      </h2>
      <div className="panel-body">
        {data ? (
          <div aria-live="polite">
            <div className="flavor-head">
              {data.icon}
              <strong>{data.name}</strong>
              <span className="flavor-kind">{data.kind}</span>
            </div>
            <p className="flavor-text">{data.flavor}</p>
          </div>
        ) : (
          <p className="muted flavor-text">
            Every resource, card, and facility has a story about the materials
            and energy behind it. Click one to read it here.
          </p>
        )}
      </div>
    </section>
  );
};
