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
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
// Fresh state
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
// Make both players AI, 4 rounds, fixed seed.
await page
  .locator('select[aria-label="Player 1 type"]')
  .selectOption("ai-normal");
await page
  .locator('select[aria-label="Player 2 type"]')
  .selectOption("ai-easy");
await page.locator("#seed-input").fill("ENDGAME");
await page.locator("#rounds-input").fill("4");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");
// Wait for the AIs to play the whole game out.
await page.waitForSelector("text=Game Over", { timeout: 60000 });
await page.screenshot({
  path: "/tmp/ui-shots/09-gameover.png",
  fullPage: true,
});
await page.getByRole("button", { name: "New game" }).click();
await page.waitForSelector(".setup-wrap");
await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("End-game flow OK");
