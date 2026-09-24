import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(700);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/verify-no-flip-early.png", fullPage: false });

if (/Checking all 21 names and 70%\+ risers now/.test(early)) {
  errors.push("early still using the old full-page checking screen");
}
if (!early.includes("Top risers")) errors.push("early missing Top risers card");
if (!early.includes("NVDA")) errors.push("early missing NVDA skeleton");

await page.waitForTimeout(5000);
const late = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/verify-no-flip-late.png", fullPage: false });

if (/Checking all 21 names and 70%\+ risers now/.test(late)) {
  errors.push("late flipped back to the old checking screen");
}
if (!late.includes("Top risers")) errors.push("late missing Top risers card");
if (!late.includes("1-month")) errors.push("late missing 1-month outlooks");
if (/error occurred|Could not open|Scan failed/i.test(late)) errors.push("late error banner");

const earlyRisersAt = early.indexOf("Top risers");
const earlyNvda = early.indexOf("NVDA");
if (earlyRisersAt >= 0 && earlyNvda >= 0 && earlyRisersAt > earlyNvda) {
  errors.push("Top risers is not above the name list");
}

console.log("--- EARLY (700ms) ---");
console.log(early.slice(0, 900));
console.log("--- LATE (5.7s) ---");
console.log(late.slice(0, 1100));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");

await page.goto("http://127.0.0.1:8080/scan", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);
const scanBody = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/verify-scan-stable.png", fullPage: false });
if (/Scanning for 70%\+ next-month risers/.test(scanBody) && !scanBody.includes("Top risers")) {
  errors.push("scan page still flips to a separate searching screen");
}
if (!scanBody.includes("Top risers")) errors.push("scan page missing Top risers");

await browser.close();
if (errors.length) process.exit(1);
