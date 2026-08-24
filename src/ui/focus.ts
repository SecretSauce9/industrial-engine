// What the flavor-text box is currently describing. Set from clicks on a
// market resource, a card, or an assembled/available facility.

export type FocusTarget =
  | { kind: "resource"; id: string }
  | { kind: "card"; id: string }
  | { kind: "facility"; id: string }; // id = sequence key
