import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const errors = [];

async function shot(path, file, w = 390, h = 844) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on("pageerror", (e) => logs.push("pageerror " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("console " + m.text());
  });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:8080${path}`, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2000);
  const text = await page.locator("body").innerText();
  await page.screenshot({ path: `/workspace/screenshots/${file}.png`, fullPage: true });
  const loadMs = Date.now() - t0;
  if (logs.length) errors.push(`${path} ${logs.slice(0, 5).join(" | ")}`);
  await page.close();
  return { text, loadMs, logs };
}

const home = await shot("/", "dbg-home");
const scan = await shot("/scan", "dbg-scan");
const actions = await shot("/actions", "dbg-actions");
const back = await shot("/backtest", "dbg-backtest");
const guide = await shot("/guide", "dbg-guide");
const desk = await shot("/", "dbg-home-desk", 1280, 800);

function flags(name, t) {
  const f = [];
  if (/Something broke|Page not found|Application error/i.test(t)) f.push("crash");
  if (!t.trim()) f.push("blank");
  return f.length ? `${name}:${f.join(",")}` : null;
}

for (const [n, t] of [
  ["home", home.text],
  ["scan", scan.text],
  ["actions", actions.text],
  ["back", back.text],
  ["guide", guide.text],
]) {
  const x = flags(n, t);
  if (x) errors.push(x);
}

for (const t of ["NVDA", "AAPL", "MSFT", "QQQ", "AMZN"]) {
  if (!home.text.includes(t)) errors.push("listed missing " + t);
}
if (!/%\s*sure/.test(home.text)) errors.push("home missing % sure");
if (!/Next month/.test(home.text)) errors.push("home missing next month");
if (!/Run a fresh look/.test(home.text)) errors.push("home missing play");

const rise = home.text.split(/70%\+\s*sure next month/i)[1]?.split(/Also scored|What this look/i)[0] ?? "";
const sitInLead = /^\s*[A-Z0-9.].{0,80}Next month\s+Sit out/im.test(rise);
if (sitInLead) errors.push("70% list has sit-out next month");

console.log("--- HOME ---");
console.log(home.text.split("\n").slice(0, 55).join("\n"));
console.log("--- ACTIONS head ---");
console.log(actions.text.split("\n").slice(0, 20).join("\n"));
console.log("--- BACK head ---");
console.log(back.text.split("\n").slice(0, 20).join("\n"));
console.log("loadMs", { home: home.loadMs, scan: scan.loadMs, actions: actions.loadMs });
console.log("ERRORS", errors.length ? errors.join("\n") : "none");
await browser.close();
