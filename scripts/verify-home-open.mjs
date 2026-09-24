import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];

async function open(name, url, shot) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!res || res.status() >= 400) errors.push(`${name} HTTP ${res?.status()}`);
  await page.waitForTimeout(2500);
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes("Checking all 21 names and 70%+ risers now"),
      { timeout: 40000 },
    );
  } catch {
    errors.push(`${name} still on the checking banner after 40s`);
  }
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  if (/error occurred|Could not open|Could not scan|Scan failed|Could not check the list/i.test(body)) {
    errors.push(`${name} error banner:\n${body.slice(0, 500)}`);
  }
  await page.screenshot({ path: shot, fullPage: true });
  await page.close();
  return body;
}

const home = await open("home", "http://127.0.0.1:8080/", "/workspace/screenshots/verify-home-open.png");
const scan = await open("scan", "http://127.0.0.1:8080/scan", "/workspace/screenshots/verify-scan-open.png");

const homeNeed = ["NVDA", "Apple", "70%"];
for (const t of homeNeed) {
  if (!home.includes(t)) errors.push(`home missing ${t}`);
}
if (!home.includes("Bull tape") && !home.includes("Bear tape") && !home.includes("Choppy")) {
  errors.push("home missing market weather banner");
}
if (!home.includes("Sit out") && !home.includes("Rise") && !home.includes("1-month")) {
  errors.push("home missing 1-month outlooks");
}
if (!scan.includes("70%")) errors.push("scan missing 70% copy");
if (/Find likely risers[\s\S]*Searching/.test(home) && home.includes("href")) {
  /* ignore */
}

console.log("--- HOME ---");
console.log(home.slice(0, 1600));
console.log("--- SCAN ---");
console.log(scan.slice(0, 900));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
