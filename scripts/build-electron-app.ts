// Build the desktop renderer bundle into app/ directly from src/.
//
// The Electron shell (electron/main.cjs) loads app/index.html via file://. Bun
// bundles the same index.html the web build uses, emitting index.html plus
// hashed JS/CSS with RELATIVE (./) asset paths, which load correctly under
// file://. Building from src/ means the desktop/Steam app always includes the
// latest source (multiplayer and all) — no separate hand-inlined standalone.
//
// Usage:  bun run scripts/build-electron-app.ts   (or: bun run build:app)

import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Minimal typing for the Bun bundler API used here (avoids a @types/bun dep;
// this script is only ever run by Bun).
declare const Bun: {
  build(opts: {
    entrypoints: string[];
    outdir: string;
    minify?: boolean;
  }): Promise<{ success: boolean; logs: unknown[]; outputs: unknown[] }>;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "app");

// Clean so stale hashed chunks from previous builds don't linger in the package.
rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "index.html")],
  outdir,
  minify: true,
});

if (!result.success) {
  console.error("[build:app] Bundle failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`[build:app] Wrote ${result.outputs.length} files to ${outdir}`);
console.log("[build:app] Electron loads app/index.html as the renderer.");
