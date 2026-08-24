// v6 UI check: facility quick-load chips, click-to-load, and the flavor box
// (Field Guide) updating for resources, cards, and facilities.
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
await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("V6-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// Grant Mixer + Furnace so multi-card facilities become available.
const grantSel = page.locator('select[aria-label="Card to grant"]');
await page.locator("#dev-player").selectOption({ index: 0 });
for (const c of ["mixer", "furnace"]) {
  await grantSel.selectOption(c);
  await page.getByRole("button", { name: "Grant card" }).click();
}

// --- 1. Facility quick-load chips appear in the empty Sequence Assembly.
await page.waitForSelector(".facility-chip");
const chipNames = await page
  .locator(".facility-chip .facility-label")
  .allTextContents();
if (!chipNames.includes("Blast / Glass Furnace"))
  errors.push(`missing Blast/Glass Furnace chip; got ${chipNames.join(", ")}`);
if (!chipNames.includes("Concrete Batch Plant"))
  errors.push(`missing Concrete Batch Plant chip; got ${chipNames.join(", ")}`);

// --- 2. Clicking a chip loads that sequence + shows its facility name.
await page
  .locator(".facility-chip")
  .filter({ hasText: "Blast / Glass Furnace" })
  .click();
await page.waitForSelector(".seq-slots");
const slotCount = await page.locator(".seq-slot").count();
if (slotCount !== 2) errors.push(`expected 2 loaded slots, got ${slotCount}`);
const facilityText = await page.locator(".seq-facility").textContent();
if (!/Blast \/ Glass Furnace/.test(facilityText ?? ""))
  errors.push(`loaded facility label wrong: ${facilityText}`);

// --- 3. The Field Guide shows the facility flavor after quick-load.
const guideName = await page
  .locator(".flavor-box .flavor-head strong")
  .textContent();
if (guideName !== "Blast / Glass Furnace")
  errors.push(`field guide not showing facility: ${guideName}`);
const guideText = await page.locator(".flavor-box .flavor-text").textContent();
if (!guideText || guideText.length < 20)
  errors.push(`facility flavor text missing: ${guideText}`);

// --- 4. Clicking a market resource updates the Field Guide.
await page
  .locator(".market-row")
  .filter({ hasText: "Concrete" })
  .first()
  .click();
const resName = await page
  .locator(".flavor-box .flavor-head strong")
  .textContent();
if (resName !== "Concrete")
  errors.push(`field guide not showing resource: ${resName}`);

// --- 5. Clicking a card name updates the Field Guide.
await page
  .locator(".card-name .link-btn")
  .filter({ hasText: "Furnace" })
  .first()
  .click();
const cardName = await page
  .locator(".flavor-box .flavor-head strong")
  .textContent();
if (cardName !== "Furnace")
  errors.push(`field guide not showing card: ${cardName}`);

await page.screenshot({ path: "/tmp/ui-shots/v6-guide.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v6 UI OK");
