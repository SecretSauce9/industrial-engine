// Balance validation CLI: `npm run balance`
// Exits non-zero when any check fails.

import { validateBalance } from "../src/engine/validate";

const result = validateBalance();

console.log("=== Industrial Engine balance validation ===");
console.log(
  `resources: ${result.stats.resourceCount}, cards: ${result.stats.cardCount}, recipes: ${result.stats.recipeCount}`,
);
console.log(
  `median recipe input value: ${result.stats.medianInputValue}, median output value: ${result.stats.medianOutputValue}`,
);

if (result.warnings.length > 0) {
  console.log(`\n${result.warnings.length} warning(s):`);
  for (const w of result.warnings) console.log(`  ⚠ ${w}`);
}

if (result.errors.length > 0) {
  console.error(`\n${result.errors.length} error(s):`);
  for (const e of result.errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log("\nAll balance checks passed.");
