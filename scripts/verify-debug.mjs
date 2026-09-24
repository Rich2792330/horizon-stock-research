import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const errors = [];
const html = await fetch("http://127.0.0.1:8080/").then((r) => r.text());
if (html.length > 450_000) errors.push(`home HTML too big: ${html.length}`);
console.log("html bytes", html.length);

const browser = await chromium.launch({ args: ["--no-sandbox"] });

async function checkPage(path, file, titleBit) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push(m.text());
  });
  await page.goto(`http://127.0.0.1:8080${path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2000);
  const t1 = await page.locator("body").innerText();
  await page.screenshot({ path: `/workspace/screenshots/${file}.png` });
  await page.waitForTimeout(1500);
  const t2 = await page.locator("body").innerText();
  if (titleBit && !t1.includes(titleBit) && !t2.includes(titleBit)) {
    errors.push(`${path} missing ${titleBit}`);
  }
  if (logs.length) errors.push(`${path} errors: ${logs.slice(0, 4).join(" | ")}`);
  await page.close();
  return t2;
}

const home = await checkPage("/", "debug-home", "Your list");
if (!/70%\+\s*sure to rise|Waiting for a 70%/i.test(home) && !/70%/.test(home)) {
  errors.push("home missing 70% section");
}

// Parse 70% block: after heading until "Also scored" / "What this look"
const rise = home.split("70%+ sure to rise")[1]?.split(/Also scored|What this look|On screen while/)[0] ?? "";
const firstSures = [...rise.matchAll(/(\d{2,3})\s*%\s*sure/gi)].map((m) => Number(m[1]));
const under = firstSures.filter((n) => n < 70);
if (under.length) errors.push(`70% list shows under 70: ${under.join(",")}`);
const tickers = [...rise.matchAll(/\n([A-Z]{1,5}(?:\.[A-Z]{1,2})?)\n/g)].map((m) => m[1]);
if (tickers.length > 12) errors.push(`70% list too long: ${tickers.length}`);
console.log("70% tickers", tickers.slice(0, 12), "sures", firstSures.slice(0, 15));

for (const t of ["NVDA", "AAPL", "MSFT", "QQQ"]) {
  if (!home.includes(t)) errors.push(`listed missing ${t}`);
}
if (!/%\s*sure/.test(home)) errors.push("no % sure on home");
if (!/3 months/.test(home)) errors.push("no 3 month outlook");

const scan = await checkPage("/scan", "debug-scan", "Find likely risers");
const actions = await checkPage("/actions", "debug-actions", "Buy");
const back = await checkPage("/backtest", "debug-backtest", "Past");
const guide = await checkPage("/guide", "debug-guide", "How it works");

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(1200);
const a = (await page.locator("body").innerText()).includes("Your list");
await page.waitForTimeout(2000);
const b = (await page.locator("body").innerText()).includes("Your list");
if (!a || !b) errors.push("flicker lost Your list");
await page.close();

console.log("--- HOME HEAD ---");
console.log(home.split("\n").slice(6, 40).join("\n"));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
