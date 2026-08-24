// Headless UI smoke test + screenshots (Playwright, chromium).
// Usage: node scripts/ui-check.mjs [baseUrl]
import { chromium } from "playwright";
import fs from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = "/tmp/ui-shots";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console] ${msg.text()}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

await page.goto(base, { waitUntil: "networkidle" });
await page.screenshot({ path: `${outDir}/01-setup.png`, fullPage: true });

// Make it a 2-human game for deterministic UI (switch player 2 to human).
await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("UI-TEST-SEED");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");
await page.screenshot({ path: `${outDir}/02-game.png`, fullPage: true });

// Buy a resource: select first market row, then buy.
await page.locator(".market-row").first().click();
await page.getByRole("button", { name: /^Buy \d+ for/ }).click();
await page.screenshot({ path: `${outDir}/03-after-buy.png` });

// Buy the first affordable marketplace card and activate if production.
const buyButtons = page.locator(".marketplace-grid button:enabled");
if ((await buyButtons.count()) > 0) {
  await buyButtons.first().click();
}
await page.screenshot({ path: `${outDir}/04-after-card.png`, fullPage: true });

// Activate first available recipe if any.
const activate = page.locator(".tableau-grid button:enabled", {
  hasText: "Activate",
});
if ((await activate.count()) > 0) {
  await activate.first().click();
}

// Open rules modal.
await page.getByRole("button", { name: /Rules/ }).click();
await page.waitForSelector(".modal");
await page.locator("#recipe-search").fill("steel");
await page.screenshot({ path: `${outDir}/05-rules.png` });
await page.getByRole("button", { name: /Close rules/ }).click();

// End turn; then check tablet width rendering.
await page.getByRole("button", { name: /End Turn/ }).click();
await page.screenshot({ path: `${outDir}/06-p2-turn.png` });

await page.setViewportSize({ width: 820, height: 1180 });
await page.screenshot({ path: `${outDir}/07-tablet.png`, fullPage: true });

// Reload: saved game should be restorable (Continue button present).
await page.setViewportSize({ width: 1440, height: 900 });
await page.reload({ waitUntil: "networkidle" });
const cont = await page
  .getByRole("button", { name: /Continue saved game/ })
  .count();
if (cont !== 1) errors.push("Continue-saved-game button missing after reload");
await page.getByRole("button", { name: /Continue saved game/ }).click();
await page.waitForSelector(".game-layout");
await page.screenshot({ path: `${outDir}/08-restored.png` });

await browser.close();
if (errors.length) {
  console.error("UI check FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("UI check passed; screenshots in " + outDir);
