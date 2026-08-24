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
// Load via file:// exactly as the user would by double-clicking.
await page.goto("file:///home/claude/industrial-engine-standalone.html");
await page.getByRole("button", { name: "Start new game" }).click();
await page.waitForSelector(".game-layout");
// One quick interaction + reload to confirm localStorage save works on file://
await page.reload();
const cont = await page
  .getByRole("button", { name: /Continue saved game/ })
  .count();
if (cont !== 1) errors.push("save/continue did not survive reload on file://");
await browser.close();
if (errors.length) {
  console.error("FAILED:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("Standalone file works via file:// including saves");
