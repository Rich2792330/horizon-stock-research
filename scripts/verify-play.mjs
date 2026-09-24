import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);
const before = await page.locator("body").innerText();
if (!/Run a fresh look/i.test(before)) errors.push("no play button on home");
await page.screenshot({ path: "/workspace/screenshots/play-before.png" });

await page.getByRole("button", { name: /run a fresh look/i }).click();
await page.waitForTimeout(2500);
const after = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/play-after.png" });

const m = after.match(/(\d[\d,]*)\s*\/\s*1,000/);
const n = m ? Number(m[1].replace(/,/g, "")) : -1;
if (/Last look/i.test(after) && n === 1000) errors.push("play still shows last look 1000/1000");
if (!/Still checking|Fresh look|Looking now/i.test(after) && n === 1000) {
  errors.push(`play did not restart n=${n}`);
}

await page.goto("http://127.0.0.1:8080/scan", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(2000);
const scan = await page.locator("body").innerText();
if (!/Run a fresh look|Looking now/i.test(scan)) errors.push("scan page missing play");

console.log({ n, afterHead: after.split("\n").slice(8, 22).join(" | ") });
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
