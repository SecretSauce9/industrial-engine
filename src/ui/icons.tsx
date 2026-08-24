// Inline SVG resource icons: distinct silhouettes, no external assets.
// Icons always appear NEXT TO text labels, never as the only identifier.

import type { FC } from "react";
import { getResource } from "../engine/data/resources";

const PATHS: Record<string, string> = {
  oil: "M8 1.5C8 1.5 3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 1.5 8 1.5Z",
  coal: "M8 2 13 5v5l-5 4-5-4V5Zm0 2.3L5.2 6v3.6L8 11.8l2.8-2.2V6Z",
  natgas:
    "M8 1.5c1 2.5 4 4.5 4 8a4 4 0 0 1-8 0c0-1.6.8-2.8 1.7-4 .3 1 .9 1.7 1.6 2 .1-2 .1-4 .7-6Z",
  agriculture:
    "M8 14V7M8 7C8 4 6 2.5 3 2.5 3 5.5 5 7 8 7Zm0 0c0-3 2-4.5 5-4.5 0 3-2 4.5-5 4.5Z",
  livestock:
    "M3 6c-1-1-1-3 0-3.5C4 2 5 3 5 3h6s1-1 2-0.5c1 .5 1 2.5 0 3.5l-1 6c0 1-1 2-2 2H6c-1 0-2-1-2-2Z",
  metal: "M4 3h8l2 4-6 7L2 7Zm2.2 1.6-1 2L8 11l2.8-4.4-1-2Z",
  wood: "M2 11h9v3H2Zm1.5-4.5h9v3h-9ZM5 2h9v3H5Z",
  sand: "M2 13c2 0 2.5-1.5 4.5-1.5S9 13 11 13s2.5-1.5 3-1.5V14H2Zm3-4a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z",
  plastic: "M6 2h4v2.5l2 1.5v8H4V6l2-1.5Zm1.5 2h1V3.5h-1Z",
  concrete: "M2 13 4 6h8l2 7Zm3-8.5h6v-2H5Z",
  glass: "M4 2h8c0 4-2 5-3 6v4.5l2 1.5H5l2-1.5V8C6 7 4 6 4 2Z",
  lumber: "M2 9h12v4H2Zm2-5h8v4H4Z",
  steel: "M2 11h12l-2 3H4Zm2.5-4h7l1.5 3H3Zm2-4h3L11 6H5Z",
  alloy: "M8 2l6 4-6 4-6-4Zm-4.5 7L8 12l4.5-3L14 10l-6 4-6-4Z",
  asphalt: "M2 12h12v2H2Zm1-4h10l1 3H2Zm4-5h2v4H7Z",
  fertilizer: "M5 2h6v3H5Zm-1 4h8l1 8H3Zm3.5 3h1v3h-1Z",
  chemicals:
    "M6 2h4v1L9 4v3l4 6c.5 1-.5 2-1.5 2h-7C3.5 15 2.5 14 3 13l4-6V4L6 3Z",
  food: "M3 3c3 0 5 2 5 5v5H6V8C6 5 5 4 3 4Zm10 0v11h-2v-5h-1V5c0-1 1-2 3-2Z",
  electricity: "M9 1 3 9h4l-1 6 6-8H8Z",
  fuel: "M4 2h6v12H4Zm1.5 2v3h3V4Zm7 2 1.5 1.5V13a1.5 1.5 0 0 1-3 0V9H10V6Z",
  textiles:
    "M2 4c2-1.5 4-1.5 6 0s4 1.5 6 0v3c-2 1.5-4 1.5-6 0S4 5.5 2 7Zm0 5c2-1.5 4-1.5 6 0s4 1.5 6 0v3c-2 1.5-4 1.5-6 0s-4-1.5-6 0Z",
  packaging:
    "M2 5 8 2l6 3v6l-6 3-6-3Zm6-.8L4.7 5.5 8 7l3.3-1.5ZM3.5 6.9v3.2L7 11.8V8.5Zm9 0L9 8.5v3.3l3.5-1.7Z",
  buildings: "M2 14V6l4 3V6l4 3V5l4 4v5Zm1-9V2h3v3Z",
  machinery:
    "M8 5.5A2.5 2.5 0 1 1 8 10.5 2.5 2.5 0 0 1 8 5.5ZM7 1h2l.3 1.8 1.6.7L12.5 2.4 14 3.9l-1.1 1.6.7 1.6L15.4 7.4v2l-1.8.3-.7 1.6 1.1 1.6-1.5 1.5-1.6-1.1-1.6.7L9 15.8H7l-.3-1.8-1.6-.7-1.6 1.1-1.5-1.5 1.1-1.6-.7-1.6L.6 9.4v-2l1.8-.3.7-1.6L2 3.9l1.5-1.5 1.6 1.1 1.6-.7Z",
  transportation:
    "M1 9h2l2-4h6l2 4h2v3h-1.5a1.75 1.75 0 0 1-3.5 0h-4a1.75 1.75 0 0 1-3.5 0H1Zm4.6-3-1 2h6.8l-1-2Z",
  electronics:
    "M5 5h6v6H5Zm2 2v2h2V7ZM7 1h2v3H7ZM7 12h2v3H7ZM1 7h3v2H1ZM12 7h3v2h-3Z",
  pharmaceuticals:
    "M5.5 1.5h5a2.5 2.5 0 0 1 0 5L8 9V6.5H5.5a2.5 2.5 0 0 1 0-5ZM4 9l4 4-2.5 1.5a2.6 2.6 0 0 1-3-4Z",
  clothing: "M5.5 2 8 3.5 10.5 2 14 4.5 12.5 7 11 6v8H5V6L3.5 7 2 4.5Z",
};

const CATEGORY_COLOR: Record<string, string> = {
  raw: "var(--raw)",
  intermediate: "var(--intermediate)",
  finished: "var(--finished)",
};

export const ResourceIcon: FC<{ id: string; size?: number }> = ({
  id,
  size = 14,
}) => {
  const def = getResource(id);
  const d = PATHS[id] ?? PATHS.metal;
  const stroke = id === "agriculture";
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      role="presentation"
      style={{ color: CATEGORY_COLOR[def.category] }}
    >
      {stroke ? (
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : (
        <path d={d} fill="currentColor" />
      )}
    </svg>
  );
};

/** Icon + label + optional quantity chip, used everywhere resources appear. */
export const ResourceChip: FC<{
  id: string;
  qty?: number;
  showName?: boolean;
}> = ({ id, qty, showName = false }) => {
  const def = getResource(id);
  return (
    <span className="io-chip" title={def.name}>
      {qty !== undefined ? <b>{qty}</b> : null}
      <ResourceIcon id={id} />
      {showName ? def.name : <span className="sr-only">{def.name}</span>}
      {!showName ? (
        <span aria-hidden="true">
          {def.name.length > 9 ? `${def.name.slice(0, 8)}…` : def.name}
        </span>
      ) : null}
    </span>
  );
};
