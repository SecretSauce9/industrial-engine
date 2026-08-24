// v9 UI check: class picker in setup, class badge + net-worth delta arrow on
// the Players panel, and the equilibrium/records still present.
import { chromium } from "playwright";
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox"],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));
const URL = process.env.IE_URL || "http://localhost:3000/?dev=1";
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

// --- 1. Class picker present with all 9 classes.
await page.waitForSelector('select[aria-label="Player 1 class"]');
const classOpts = await page
  .locator('select[aria-label="Player 1 class"] option')
  .count();
if (classOpts !== 9) errors.push(`expected 9 class options, got ${classOpts}`);
// Give Player 1 the Trader class (8 asphalt, distinctive).
await page.locator('select[aria-label="Player 1 class"]').selectOption("trader");
await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("V9-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// --- 2. Class badge shows on the Players panel.
const badges = await page.locator(".class-badge").allTextContents();
if (!badges.some((b) => /Trader/i.test(b)))
  errors.push(`class badge missing; got ${badges.join(", ")}`);

// --- 3. Net-worth delta arrows are present (one per player).
const deltas = await page.locator(".nw-delta").count();
if (deltas < 2) errors.push(`expected net-worth deltas, got ${deltas}`);

// --- 4. Records still in the left column; equilibrium markers present.
if ((await page.locator('section[aria-label="Record trackers"]').count()) === 0)
  errors.push("records panel missing");
if ((await page.locator(".eq-mark").count()) === 0)
  errors.push("equilibrium markers missing");

// --- 5. After ending a turn, the delta updates (end via dev advance round or
// just play: end the human turn by clicking End Turn twice through AI is heavy;
// instead check the delta element reflects a number after a round advances).
await page.getByRole("button", { name: "End Turn ▶" }).click();
await page.waitForTimeout(400);
// A net-worth delta should now show a signed value for at least one player.
const anyNumber = await page
  .locator(".nw-delta")
  .evaluateAll((els) => els.some((e) => /\d/.test(e.textContent || "")));
if (!anyNumber)
  errors.push("no net-worth delta value appeared after a turn ended");

await page.screenshot({ path: "/tmp/ui-shots/v9.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v9 UI OK");
