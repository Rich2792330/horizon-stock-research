import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
await page.waitForTimeout(1500);
const t1 = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/phone-home-1.png", fullPage: true });
await page.waitForTimeout(1500);
const t2 = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/phone-home-2.png", fullPage: true });

if (/Run a fresh look|Looking now/i.test(t1)) errors.push("play button still on home");
if (!t1.includes("NVDA") || !t1.includes("AAPL") || !t1.includes("MSFT")) errors.push("missing listed names");
if (!/70%\+|next month/i.test(t1)) errors.push("missing 70% section");
if (/Your list/.test(t1) !== /Your list/.test(t2)) errors.push("title flickered");
const n1 = (t1.match(/(\d[\d,]*)\s*\/\s*1,000/) || [])[1];
const n2 = (t2.match(/(\d[\d,]*)\s*\/\s*1,000/) || [])[1];
if (n1 === "0" && /Ready|1,000 \/ 1,000/.test(t1) === false && /RKLB|ASML|NVDA/.test(t1) && /Still checking|Checking 0/.test(t1)) {
  errors.push("reset to 0 while showing names");
}

await page.goto("http://127.0.0.1:8080/scan", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);
const ts = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/phone-scan.png", fullPage: true });
if (!ts.includes("NVDA")) errors.push("scan page missing listed 21");
if (/Run a fresh look/i.test(ts)) errors.push("play on scan");

console.log("--- HOME ---");
console.log(t1.split("\n").slice(0, 40).join("\n"));
console.log("n1", n1, "n2", n2);
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
