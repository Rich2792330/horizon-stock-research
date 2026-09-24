import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });

function snap(text) {
  const m = text.match(/(\d[\d,]*)\s*\/\s*1,000/);
  return {
    n: m ? Number(m[1].replace(/,/g, "")) : -1,
    finished: /FINISHED/i.test(text) && /1,000\s*\/\s*1,000/.test(text),
    names: /(AVGO|NVDA|AAPL|MSFT|TSM|ASML|JPM|UNH)/.test(text),
    sure: /%\s*sure/.test(text),
    head: text.split("\n").slice(8, 22).join(" | "),
  };
}

async function load() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1500);
  const t = await page.locator("body").innerText();
  const s = snap(t);
  await page.close();
  return s;
}

const a = await load();
const b = await load();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1500);
const b2 = snap(await page.locator("body").innerText());
await page.screenshot({ path: "/workspace/screenshots/reload-2.png" });
await page.waitForTimeout(6000);
const c = snap(await page.locator("body").innerText());
await page.screenshot({ path: "/workspace/screenshots/reload-3.png" });

const errors = [];
if (a.finished) errors.push("visit 1 instantly finished 1000");
if (!a.names || !a.sure) errors.push("visit 1 missing names/% sure");
if (b.finished) errors.push("visit 2 instantly finished 1000");
if (!b.names) errors.push("visit 2 missing names");
if (!(c.n > b2.n || c.n >= 12)) errors.push(`did not advance b2=${b2.n} c=${c.n}`);

console.log({ a, b, b2, c });
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
