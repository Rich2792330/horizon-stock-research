import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });

let found = false;
let last = "";
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2500);
  last = await page.locator("body").innerText();
  if (/70%\+\s*sure to rise/i.test(last) && /%\s*sure/.test(last) && /(AVGO|ASML|NVDA|SMH|GOOG|AAPL|JPM)/.test(last)) {
    const block = last.split("70%+")[1]?.slice(0, 500) ?? "";
    const percents = [...block.matchAll(/(\d{2,3})\s*%\s*sure/gi)].map((m) => Number(m[1]));
    const under = percents.filter((n) => n < 70);
    if (under.length === 0 && percents.some((n) => n >= 70)) {
      found = true;
      break;
    }
  }
}
await page.screenshot({ path: "/workspace/screenshots/risers-70.png" });
console.log("found", found);
console.log(last.split("\n").slice(8, 36).join("\n"));
await browser.close();
if (!found) process.exit(1);
