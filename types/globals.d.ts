// Minimal Node/Bun globals for the CLI scripts (@types/node is not
// installable in this sandbox).

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};

// Minimal node:fs surface used by the CLI scripts.
declare module "node:fs" {
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, encoding: string): string;
}
