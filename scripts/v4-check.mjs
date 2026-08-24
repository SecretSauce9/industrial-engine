// v4 UI check: undo, viewer + borrow, turbine toggle, market-maker arrows.
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
await page.locator("#seed-input").fill("V4-UI");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");

// Market maker arrows visible (raw markets open above equilibrium).
await page.waitForSelector(".mm-arrow");

// Undo: buy a resource, then undo it.
await page.locator(".market-row").first().click();
const cashBefore = await page.locator(".header-stat >> nth=1").textContent();
await page.getByRole("button", { name: /^Buy 1 for/ }).click();
await page.getByRole("button", { name: /Undo/ }).click();
const cashAfter = await page.locator(".header-stat >> nth=1").textContent();
if (cashBefore !== cashAfter)
  errors.push(`undo failed: ${cashBefore} vs ${cashAfter}`);

// Viewer + borrow: give P2 a grinder via dev panel, road + borrow.
const grantSel = page.locator('select[aria-label="Card to grant"]');
const devPlayer = page.locator("#dev-player");
await devPlayer.selectOption({ index: 1 }); // player 2
await grantSel.selectOption("grinder");
await page.getByRole("button", { name: "Grant card" }).click();
// Open P2's board.
await page.locator(".player-row-btn").nth(1).click();
await page.waitForSelector("text=Viewing");
await page.getByRole("button", { name: /Build road \(1 asphalt\)/ }).click();
await page.getByRole("button", { name: /Borrow for \$2/ }).first().click();
await page.getByRole("button", { name: "← Back to my board" }).click();
await page.waitForSelector(".card.borrowed");
await page.screenshot({ path: "/tmp/ui-shots/13-borrowed.png", fullPage: false });

// Turbine toggle: grant a turbine to P1 and flip its mode.
await devPlayer.selectOption({ index: 0 });
await grantSel.selectOption("turbine_generator");
await page.getByRole("button", { name: "Grant card" }).click();
await page.getByRole("button", { name: /Grid start/ }).click();
await page.waitForSelector("text=Black start");
await page.screenshot({ path: "/tmp/ui-shots/14-turbine.png" });

await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("v4 UI OK");
