import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
const btn = page.getByRole("button", { name: /run a fresh look/i });
if (await btn.count()) await btn.click();
let text = "";
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(2500);
  text = await page.locator("body").innerText();
  if (/70%\+\s*sure next month/i.test(text) && /Next month[\s\S]{0,80}Rise/i.test(text)) break;
}
await page.screenshot({ path: "/workspace/screenshots/next-month-70.png", fullPage: true });
const block = (text.split(/70%\+\s*sure next month/i)[1] ?? "").split(/Also scored|What this look|On screen/i)[0] ?? "";
const firstCall = block.match(/Next month\s+(Rise|Sit out|Fall)/i);
const sures = [...block.matchAll(/(\d{2,3})\s*%\s*sure/gi)].map((m) => Number(m[1]));
const errors = [];
if (!/Rise/i.test(block)) errors.push("no next-month Rise in 70% list: " + block.slice(0, 300));
if (/Next month\s+Sit out/i.test(block.split("3 months")[0] ?? "")) {
  errors.push("70% list still leading with sit out");
}
const under = sures.filter((n, i) => i % 3 === 0 && n < 70); // rough
console.log({ firstCall, sures: sures.slice(0, 8), head: block.slice(0, 500) });
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
