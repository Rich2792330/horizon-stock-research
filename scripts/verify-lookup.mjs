import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
await page.waitForTimeout(2000);
let text = await page.locator("body").innerText();
if (!/Look up a ticker/i.test(text)) errors.push("no lookup box");
if (!/Check/i.test(text)) errors.push("no Check button");
if (/Finished\. Ran the full model on 1000/i.test(text) && /Last look Sep 19/i.test(text) === false) {
  // stale cache should have started a new run OR labeled the date
}
const checking = /Checking\s+\d/.test(text);
const lastLook = /Last look/i.test(text);
if (!checking && !lastLook) errors.push("scan status unclear: " + text.slice(0, 400));

await page.locator("#lookup").fill("META");
await page.getByRole("button", { name: /^check$/i }).click();
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(1500);
  text = await page.locator("body").innerText();
  if (/META/.test(text) && /Next month|1m /.test(text) && !/Checking the symbol/i.test(text)) break;
}
await page.screenshot({ path: "/workspace/screenshots/lookup-meta.png", fullPage: true });
if (!/\bMETA\b/.test(text)) errors.push("META lookup did not show");
if (!/\bNVDA\b/.test(text) || !/\bAAPL\b/.test(text)) errors.push("default 21 missing after lookup");

console.log("---");
console.log(text.split("\n").slice(3, 40).join("\n"));
console.log("ERR", errors.length ? errors.join(" | ") : "none");
await browser.close();
if (errors.length) process.exit(1);
