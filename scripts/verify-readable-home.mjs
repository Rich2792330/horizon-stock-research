import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);
const body = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/readable-home.png", fullPage: false });
await page.screenshot({ path: "/workspace/screenshots/readable-home-full.png", fullPage: true });

const errors = [];
if (!body.includes("Top risers")) errors.push("missing Top risers");
if (!body.includes("Bull tape") && !body.includes("Bear tape") && !body.includes("Choppy")) {
  errors.push("missing tape");
}
if (!body.includes("paused") && !body.includes("Paused")) errors.push("missing 1-month pause copy");
if (!body.includes("Next month")) errors.push("missing Next month label");
if (!body.includes("3 months")) errors.push("missing 3 months label");
if (/Sit out · \+/.test(body)) errors.push("still showing Sit out with a plus percent");
if (/error occurred|Could not open/i.test(body)) errors.push("error banner");
if (!body.includes("NVDA")) errors.push("missing NVDA");
if (body.includes("Quant rank")) errors.push("quant rank still on the main list");

console.log(body.slice(0, 1800));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
