// v7 UI check: setup modifiers, record trackers panel, drag-to-sell hint on
// the marketplace, and the removal of the on-card Sell button.
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

// --- 1. Setup modifiers are present and selectable.
await page.waitForSelector(".modifier-row");
const modCount = await page.locator(".modifier-row input[type=checkbox]").count();
if (modCount !== 4) errors.push(`expected 4 modifiers, got ${modCount}`);
await page.locator('input[aria-label="Knife fight"]').click();
await page.locator('input[aria-label="Viscous markets"]').click();

await page.locator('select[aria-label="Player 2 type"]').selectOption("human");
await page.locator("#seed-input").fill("V7-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// --- 2. Record trackers panel renders with all six records.
await page.waitForSelector('section[aria-label="Record trackers"]');
const trackerCount = await page.locator(".tracker-row").count();
if (trackerCount !== 6)
  errors.push(`expected 6 record trackers, got ${trackerCount}`);
const trackerText = await page
  .locator('section[aria-label="Record trackers"]')
  .textContent();
for (const label of [
  "The Landlord",
  "The Road Baron",
  "The Combo",
  "Stillness",
  "The Rancher",
  "Vertical Integration",
]) {
  if (!trackerText.includes(label))
    errors.push(`trackers missing "${label}"`);
}

// --- 3. Grant a sellable card; the on-card Sell button is gone.
const grantSel = page.locator('select[aria-label="Card to grant"]');
await page.locator("#dev-player").selectOption({ index: 0 });
await grantSel.selectOption("grinder");
await page.getByRole("button", { name: "Grant card" }).click();
const sellButtons = await page
  .locator(".tableau-card-wrap")
  .getByRole("button", { name: /^Sell \$/ })
  .count();
if (sellButtons !== 0)
  errors.push(`on-card Sell button should be removed, found ${sellButtons}`);

// --- 4. Dragging a card shows the marketplace sell hint, and dropping sells it.
// (HTML5 drag events must be dispatched directly — Playwright's mouse API does
// not fire native dragstart/drop.)
const grinderCard = page
  .locator(".tableau-card-wrap")
  .filter({ has: page.locator(".card-name", { hasText: "Grinder" }) })
  .first();
await grinderCard.evaluate((el) => {
  el.dispatchEvent(
    new DragEvent("dragstart", {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer(),
    }),
  );
});
await page.waitForSelector(".sell-hint", { timeout: 2000 }).catch(() => {});
const hintText = (await page.locator(".sell-hint").first().textContent()) || "";
if (!/Drop to sell .*Grinder/.test(hintText))
  errors.push(`sell hint missing/incorrect: "${hintText}"`);

// Drop on the marketplace to actually sell (card leaves the tableau).
const cardsBefore = await page.locator(".tableau-card-wrap").count();
await page.locator('section[aria-label="Card marketplace"]').evaluate(
  (el, id) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", id);
    el.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
  },
  (await grinderCard.getAttribute("data-instance")) || "",
);
await page.waitForTimeout(250);
const cardsAfter = await page.locator(".tableau-card-wrap").count();
if (cardsAfter !== cardsBefore - 1)
  errors.push(
    `drop-to-sell did not remove the card (${cardsBefore} -> ${cardsAfter})`,
  );

await page.screenshot({ path: "/tmp/ui-shots/v7-trackers.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v7 UI OK");
