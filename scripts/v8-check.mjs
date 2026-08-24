// v8 UI check: Records panel moved under the Resource Market (left column),
// equilibrium marker on market rows, facilities list always shown (disabled
// when staging), and staging a card removes it from the tableau count.
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
await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("V8-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// --- 1. Records panel is in the LEFT column, under the Resource Market.
const leftCol = page.locator(".col").first();
const hasMarket =
  (await leftCol.locator('section[aria-label="Resource market"]').count()) > 0;
const hasRecords =
  (await leftCol.locator('section[aria-label="Record trackers"]').count()) > 0;
if (!hasMarket || !hasRecords)
  errors.push(
    `records not under market in left column (market=${hasMarket}, records=${hasRecords})`,
  );
// Records should show per-player chips now.
const chipCount = await page.locator(".tracker-chip").count();
if (chipCount === 0) errors.push("no per-player tracker chips rendered");

// --- 2. Equilibrium marker present on market rows.
const eqCount = await page.locator(".eq-mark").count();
if (eqCount === 0) errors.push("no equilibrium markers on market rows");

// --- 3. Facilities list is shown in the (empty) Sequence Assembly.
await page.waitForSelector(".seq-facilities-block");

// --- 4. Grant Mixer + Furnace; stage them; tableau count drops.
const grantSel = page.locator('select[aria-label="Card to grant"]');
await page.locator("#dev-player").selectOption({ index: 0 });
for (const c of ["mixer", "furnace"]) {
  await grantSel.selectOption(c);
  await page.getByRole("button", { name: "Grant card" }).click();
}
const tableauHeader = () =>
  page.locator('section[aria-label="Your tableau"] h2 .tiny').textContent();
const before = await tableauHeader();
// Stage the Mixer via its "Add to sequence" button.
const mixerCard = page
  .locator(".tableau-card-wrap")
  .filter({ has: page.locator(".card-name", { hasText: "Mixer" }) })
  .first();
await mixerCard.getByRole("button", { name: /Add to sequence/ }).click();
await page.waitForSelector(".seq-slot");
const after = await tableauHeader();
if (!/\(\+1 staged\)/.test(after || ""))
  errors.push(`tableau header should note staged card: "${after}"`);
if (before === after)
  errors.push("tableau header did not change after staging");

// --- 5. Facilities list still shown while staging, but chips disabled.
const chipsWhileStaging = await page.locator(".facility-chip").count();
if (chipsWhileStaging === 0)
  errors.push("facilities list hidden while staging (should stay visible)");
const anyEnabled = await page
  .locator(".facility-chip:not([disabled])")
  .count();
if (anyEnabled !== 0)
  errors.push("facility chips should be disabled while staging");

await page.screenshot({ path: "/tmp/ui-shots/v8.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v8 UI OK");
