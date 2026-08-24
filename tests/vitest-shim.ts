// Vitest API shim.
//
// The sandbox used to build this project cannot reach the npm registry, so
// Vitest itself cannot be installed. Tests are written against the Vitest API
// and this module (aliased to "vitest" via tsconfig `paths`, which Bun honors
// at runtime) re-exports Bun's Jest-compatible test runner.
//
// To switch to real Vitest later: `npm i -D vitest`, delete the `paths` entry
// in tsconfig.json, and run `vitest` — no test-file changes required.
export { describe, it, test, expect, beforeEach, afterEach } from "bun:test";
