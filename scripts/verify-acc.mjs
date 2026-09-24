import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
let text = "";
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(2500);
  text = await page.locator("body").innerText();
  if (/ASML|KLAC|SMH|STX/.test(text) && /71%|70%|72%|73%/.test(text)) break;
}
await page.screenshot({ path: "/workspace/screenshots/acc-home.png", fullPage: true });
const bad = [];
if (/SOXL/.test(text.split("Your 21")[0] ?? text) && /70%\+/.test(text)) {
  const rise = text.split(/70%\+ next month/i)[1]?.split(/Results|Your 21|NVDA/)[0] ?? "";
  if (/\bSOXL\b/.test(rise)) bad.push("SOXL in 70% list");
  if (/\bQBTS\b/.test(rise)) bad.push("QBTS in 70% list");
  if (/000660/.test(rise)) bad.push("Hynix 1m in 70% list");
}
if (!/NVDA/.test(text) || !/AAPL/.test(text)) bad.push("missing listed");
console.log(text.split("\n").slice(4, 45).join("\n"));
console.log(bad.length ? bad.join("\n") : "none");
await browser.close();
if (bad.length) process.exit(1);
