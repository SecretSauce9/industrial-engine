// v5 UI check: player seat colors, rebate-pip color CSS, equal-size tableau
// cards, and standalone cards in the Sequence Assembly area.
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
await page.locator("#seed-input").fill("V5-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// --- 1. Player seat colors are actually painted (the v5.1 bug was missing CSS).
const transparent = "rgba(0, 0, 0, 0)";
const dot1 = await page
  .locator(".player-dot.pip-p1")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor);
const dot2 = await page
  .locator(".player-dot.pip-p2")
  .first()
  .evaluate((el) => getComputedStyle(el).backgroundColor);
if (dot1 === transparent || dot2 === transparent)
  errors.push(`player dots uncolored: p1=${dot1} p2=${dot2}`);
if (dot1 === dot2) errors.push(`player dot colors not distinct: ${dot1}`);
const borderLeft1 = await page
  .locator(".player-row-btn.seat-p1")
  .first()
  .evaluate((el) => getComputedStyle(el).borderLeftColor);
if (borderLeft1 === transparent)
  errors.push(`seat-p1 row has no colored left edge`);

// --- 2. The rebate-pip color rule resolves for a filled supply cell.
const pipColor = await page.evaluate(() => {
  const el = document.createElement("span");
  el.className = "supply-cell filled pip-p2";
  document.body.appendChild(el);
  const c = getComputedStyle(el).backgroundColor;
  el.remove();
  return c;
});
if (pipColor === "rgba(0, 0, 0, 0)" || pipColor === "transparent")
  errors.push(`rebate pip (pip-p2) has no background color: ${pipColor}`);

// --- 3. Standalone card (Solar Panels) can enter Sequence Assembly.
const grantSel = page.locator('select[aria-label="Card to grant"]');
await page.locator("#dev-player").selectOption({ index: 0 });
await grantSel.selectOption("solar_panels");
await page.getByRole("button", { name: "Grant card" }).click();
// The solar card should now offer "Add to sequence" (a standalone non-prod card).
const solarCard = page
  .locator(".card")
  .filter({ has: page.locator(".card-name", { hasText: "Solar Panels" }) });
await solarCard.getByRole("button", { name: /Add to sequence/ }).click();
await page.waitForSelector(".seq-facility");
const facilityText = await page.locator(".seq-facility").first().textContent();
if (!/Solar Panels/.test(facilityText ?? ""))
  errors.push(`sequence facility label wrong: ${facilityText}`);
// An Activate button should be available in the sequence area.
const seqActivate = page
  .locator(".seq-dropzone")
  .getByRole("button", { name: "Activate" });
if ((await seqActivate.count()) === 0)
  errors.push("no Activate button for standalone card in sequence area");

// --- 4. Equal-size tableau cards: the draggable wrapper is a flex grid item.
await grantSel.selectOption("grinder");
await page.getByRole("button", { name: "Grant card" }).click();
await grantSel.selectOption("mixer");
await page.getByRole("button", { name: "Grant card" }).click();
const wrapDisplay = await page
  .locator(".tableau-card-wrap")
  .first()
  .evaluate((el) => getComputedStyle(el).display);
if (wrapDisplay !== "flex")
  errors.push(`tableau card wrapper is not flex: ${wrapDisplay}`);
// Cards sharing a row should have equal height (stretch), no empty gaps.
const heights = await page
  .locator(".tableau-card-wrap")
  .evaluateAll((els) =>
    els.map((e) => ({
      top: Math.round(e.getBoundingClientRect().top),
      h: Math.round(e.getBoundingClientRect().height),
      cardH: Math.round(
        e.querySelector(".card")?.getBoundingClientRect().height ?? 0,
      ),
    })),
  );
const rows = new Map();
for (const c of heights) {
  if (!rows.has(c.top)) rows.set(c.top, []);
  rows.get(c.top).push(c);
}
for (const [top, cs] of rows) {
  if (cs.length < 2) continue;
  const hs = cs.map((c) => c.h);
  if (Math.max(...hs) - Math.min(...hs) > 1)
    errors.push(`row @${top}: card wrappers unequal height ${hs.join(",")}`);
  // The inner .card should fill its wrapper (no empty space below it).
  for (const c of cs)
    if (c.h - c.cardH > 1)
      errors.push(`card does not fill wrapper: wrap ${c.h} vs card ${c.cardH}`);
}

await page.screenshot({ path: "/tmp/ui-shots/v5-tableau.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v5 UI OK");
