// v3 UI check: sequence assembly, market roads, rebate pips.
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
await page.goto("http://localhost:3000/?dev=1", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
// 2 humans for a stable turn.
await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("SEQ-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// Dev-grant a mixer and furnace to player 1 and give sand.
const grantSelect = page.locator('select[aria-label="Card to grant"]');
await grantSelect.selectOption("mixer");
await page.getByRole("button", { name: "Grant card" }).click();
await grantSelect.selectOption("furnace");
await page.getByRole("button", { name: "Grant card" }).click();
const resSelect = page.locator('select[aria-label="Resource to add"]');
await resSelect.selectOption("sand");
await page.getByRole("button", { name: "+1", exact: true }).click();

// Assemble the sequence via the click path (drag also supported).
await page
  .locator('button:enabled:has-text("Add to sequence")')
  .first()
  .click();
await page
  .locator('button:enabled:has-text("Add to sequence")')
  .first()
  .click();
await page.waitForSelector("text=Blast / Glass Furnace");
await page.screenshot({
  path: "/tmp/ui-shots/11-sequence.png",
  fullPage: false,
});

// Activate Melt Glass from the panel.
await page
  .locator(".seq-dropzone .recipe-row", { hasText: "Glass" })
  .getByRole("button", { name: /Activate/ })
  .click();
// Glass appears in the warehouse panel.
await page.waitForSelector(
  'section[aria-label="Warehouse inventory"] >> text=Glass',
);

// Market road + rebate pips: sell glass with a road.
await page.locator(".market-row", { hasText: "Glass" }).first().click();
await page.getByRole("button", { name: /Build market road/ }).click();
await page.getByRole("button", { name: /^Sell 1 for/ }).click();
await page.waitForSelector(".supply-cell.pip-p1, .supply-cell.pip-p2");
await page.screenshot({ path: "/tmp/ui-shots/12-rebate-pips.png" });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Sequence + market-road UI OK");
