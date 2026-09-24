import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
const play = page.getByRole("button", { name: /run a fresh look/i });
if (await play.count()) await play.click();
let text = "";
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2500);
  text = await page.locator("body").innerText();
  const rise = text.split(/70%\+\s*sure next month/i)[1]?.split(/Also scored/i)[0] ?? "";
  if (/Rocket Lab|10x Genomics|Twist Bioscience|Monolithic|Paycom|Lam Research/i.test(rise)) break;
}
await page.screenshot({ path: "/workspace/screenshots/dbg-named.png", fullPage: true });
const rise = text.split(/70%\+\s*sure next month/i)[1]?.split(/Also scored/i)[0] ?? "";
const tickerOnly = [...rise.matchAll(/^([A-Z]{2,5})\nNext month/gm)].map((m) => m[1]);
console.log("ticker-only (no name)", tickerOnly);
console.log(rise.slice(0, 900));
const actions = await browser.newPage({ viewport: { width: 390, height: 844 } });
await actions.goto("http://127.0.0.1:8080/actions", { waitUntil: "domcontentloaded", timeout: 20000 });
await actions.waitForTimeout(4000);
const at = await actions.locator("body").innerText();
console.log("--- ACTIONS ---");
console.log(at.split("\n").slice(4, 25).join("\n"));
await actions.close();
await browser.close();
if (tickerOnly.length > 4) process.exit(1);
