// Deterministic seeded RNG.
// xmur3 hashes an arbitrary seed string into a 32-bit state; mulberry32 is a
// small, fast, well-distributed PRNG whose entire state is one 32-bit integer,
// which makes it trivially serializable inside GameState.

/** Hash a seed string to a 32-bit unsigned integer. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Advance the RNG state once. Returns [nextState, float in [0, 1)]. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const nextState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [nextState, value];
}

/** Integer in [0, maxExclusive). */
export function nextInt(state: number, maxExclusive: number): [number, number] {
  const [s, v] = nextRandom(state);
  return [s, Math.floor(v * maxExclusive)];
}

/** Fisher–Yates shuffle, returning the new RNG state and a new array. */
export function shuffle<T>(state: number, items: readonly T[]): [number, T[]] {
  const arr = items.slice();
  let s = state;
  for (let i = arr.length - 1; i > 0; i--) {
    let j: number;
    [s, j] = nextInt(s, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return [s, arr];
}

/** Random default seed for the setup screen (uses Math.random by design). */
export function randomSeedString(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
