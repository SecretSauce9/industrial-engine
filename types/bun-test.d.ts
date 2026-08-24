// Type declarations for the bun:test module (bun-types is not installable in
// this sandbox). Covers the Jest/Vitest-compatible surface used by the tests.

declare module "bun:test" {
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toStrictEqual(expected: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toContain(item: unknown): void;
    toHaveLength(n: number): void;
    toThrow(expected?: string | RegExp | Error): void;
    toMatch(expected: string | RegExp): void;
    not: Matchers;
  }
  export function expect(value: unknown): Matchers;
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export const test: typeof it;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}
