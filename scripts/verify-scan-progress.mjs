import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(3000);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-progress-early.png" });

await page.waitForTimeout(12000);
const later = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/scan-progress-later.png" });

for (const [label, text] of [["early", early], ["later", later]]) {
  if (!/still checking|finished|starting/i.test(text)) errors.push(`${label} missing status`);
  if (!/\d[\d,]*\s*\/\s*\d/.test(text)) errors.push(`${label} missing N / total`);
  if (/nothing under/i.test(text)) errors.push(`${label} still says nothing under`);
}

const totals = [...later.matchAll(/\/\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
const total = Math.max(0, ...totals);
if (total < 900) errors.push(`universe too small: ${total}`);

console.log("--- EARLY HEAD ---");
console.log(early.split("\n").slice(0, 22).join("\n"));
console.log("--- LATER HEAD ---");
console.log(later.split("\n").slice(0, 22).join("\n"));
console.log("total parsed", total);
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
