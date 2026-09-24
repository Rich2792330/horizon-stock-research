import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(900);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-watch-early.png" });

if (/FINISHED/i.test(early) && /1,000\s*\/\s*1,000/.test(early)) {
  errors.push("first paint already says finished 1000/1000");
}
if (!/Still checking|Starting/i.test(early)) {
  errors.push("first paint is not still checking");
}

await page.waitForTimeout(6000);
const later = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-watch-later.png" });

const nums = [...later.matchAll(/(\d[\d,]*)\s*\/\s*([\d,]+)/g)].map((m) => ({
  a: Number(m[1].replace(/,/g, "")),
  b: Number(m[2].replace(/,/g, "")),
}));
const moved = nums.some((n) => n.b >= 900 && n.a > 0 && n.a < n.b);
const names = /Scored so far|Strongest from this look/i.test(later);
if (!moved && !/Still checking/i.test(later)) {
  errors.push(`progress did not move: ${JSON.stringify(nums)}`);
}
if (!names) errors.push("no scored names on screen");

console.log("--- EARLY ---");
console.log(early.split("\n").slice(0, 24).join("\n"));
console.log("--- LATER ---");
console.log(later.split("\n").slice(0, 32).join("\n"));
console.log("nums", nums);
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
