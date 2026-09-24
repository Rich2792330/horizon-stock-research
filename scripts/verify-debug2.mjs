import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const logs = [];
page.on("pageerror", (e) => logs.push(e.message));

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 25000 });
await page.waitForTimeout(2500);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/debug-home-early.png", fullPage: true });

await page.waitForTimeout(8000);
const later = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/debug-home-later.png", fullPage: true });

function count(text) {
  const m = text.match(/(\d[\d,]*)\s*\/\s*1,000/);
  return m ? Number(m[1].replace(/,/g, "")) : -1;
}

function riseBlock(text) {
  const lower = text.replace(/\s+/g, " ");
  const i = lower.search(/70%\+\s*sure to rise/i);
  if (i < 0) return "";
  const rest = lower.slice(i);
  const j = rest.search(/Also scored|What this look|On screen while|Results/i);
  return rest.slice(0, j > 0 ? j : 2500);
}

function firstSures(block) {
  // each name: ticker ... first "% sure" is the lead horizon
  const parts = block.split(/(?=\b[A-Z]{1,5}\b)/);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^([A-Z]{2,5}(?:\.[A-Z]{1,2})?)\b[\s\S]*?(\d{2,3})\s*%\s*sure/i);
    if (m) out.push({ t: m[1], sure: Number(m[2]) });
  }
  return out;
}

const errors = [];
const n1 = count(early);
const n2 = count(later);
if (!(n2 > n1 || n2 >= 30 || /Finished/i.test(later))) errors.push(`scan not moving n1=${n1} n2=${n2}`);

const block = riseBlock(later);
const sures = firstSures(block);
const under = sures.filter((x) => x.sure < 70);
if (!sures.length) errors.push("no 70% names parsed: " + block.slice(0, 200));
if (under.length) errors.push("under 70 in list: " + JSON.stringify(under));
if (sures.length > 12) errors.push("too many 70% names " + sures.length);

for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "GOOG"]) {
  if (!later.includes(t)) errors.push("missing listed " + t);
}
if (!/3 months/.test(later) || !/6 months/.test(later)) errors.push("missing 3/6 month rows");
if (!/%\s*sure/.test(later)) errors.push("missing % sure");
if (logs.length) errors.push("pageerror " + logs.join("|"));

const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await desk.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await desk.waitForTimeout(1500);
await desk.screenshot({ path: "/workspace/screenshots/debug-home-desktop.png" });
await desk.close();

console.log({ n1, n2, sures, htmlLayout: later.includes("Your list") });
console.log("block", block.slice(0, 600));
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
