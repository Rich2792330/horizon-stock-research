import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(2500);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-real-early.png" });

const fakeInstant =
  /FINISHED/i.test(early) &&
  /1,000\s*\/\s*1,000/.test(early) &&
  !/Scored so far|Strongest from this look/i.test(early);
if (fakeInstant) errors.push("claimed 1000 finished instantly with no scored names");

await page.waitForTimeout(8000);
const later = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-real-later.png" });

const hasNames =
  /Scored so far|Strongest from this look/i.test(later) &&
  /(NVDA|TSM|AAPL|MSFT|SMH|QQQ)/.test(later);
const progress = /Still checking|Finished|running the 1\/3\/6-month model|Looking through/i.test(later);
if (!progress) errors.push("no progress copy");
if (!hasNames) errors.push("no scored names listed");

console.log("--- EARLY ---");
console.log(early.split("\n").slice(0, 28).join("\n"));
console.log("--- LATER ---");
console.log(later.split("\n").slice(0, 40).join("\n"));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
