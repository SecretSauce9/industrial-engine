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
await page.goto("http://localhost:8081", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");
await page.screenshot({ path: "/tmp/ui-shots/10-dist.png" });
await browser.close();
if (errors.length) {
  console.error("DIST FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Production build renders clean");
