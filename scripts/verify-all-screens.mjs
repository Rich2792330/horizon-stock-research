import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const logs = [];
const errors = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => {
  if (m.type() === "error") logs.push(`[console.error] ${m.text()}`);
});
page.on("pageerror", (e) => {
  logs.push(`[PAGEERROR] ${e.message}`);
  errors.push(`pageerror: ${e.message}`);
});

async function open(path, name, mustInclude) {
  const t0 = Date.now();
  const res = await page.goto(`http://127.0.0.1:8080${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  const ttfb = Date.now() - t0;
  await page.waitForTimeout(1800);
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: `/workspace/screenshots/open-${name}.png` });
  const status = res?.status() ?? 0;
  const failBits = [];
  if (status !== 200) failBits.push(`status ${status}`);
  if (ttfb > 8000) failBits.push(`slow ${ttfb}ms`);
  if (/error occurred|Something broke|Page not found/i.test(body) && !mustInclude.some((s) => /not found/i.test(s))) {
    failBits.push("error/notfound copy");
  }
  if (!mustInclude.every((s) => body.includes(s))) {
    failBits.push(`missing ${mustInclude.filter((s) => !body.includes(s)).join(",")}`);
  }
  const h1 = await page.locator("h1").first().innerText().catch(() => "NO_H1");
  console.log(`${name}: status=${status} ttfb=${ttfb}ms h1=${JSON.stringify(h1)} fail=${failBits.join(";") || "none"}`);
  if (failBits.length) errors.push(`${name}: ${failBits.join("; ")}`);
  return { body, ttfb, status };
}

const home = await open("/", "home", ["Your list", "Top risers", "NVDA"]);
await open("/scan", "scan", ["Find likely risers"]);
await open("/actions", "actions", ["Buy or sell"]);
await open("/backtest", "backtest", ["Past tests"]);
await open("/guide", "guide", ["How it works"]);

// Re-open home to confirm it still works after other tabs
await open("/", "home-again", ["Your list", "SMH"]);

writeFileSync(
  "/workspace/screenshots/open-all-logs.txt",
  logs.join("\n") + "\n\nERRORS\n" + (errors.join("\n") || "none") + "\n\nHOME HEAD\n" + home.body.slice(0, 1500),
);
console.log("--- PAGE ERRORS ---");
console.log(logs.join("\n") || "(none)");
console.log("--- FAIL ---");
console.log(errors.join("\n") || "none");
await browser.close();
if (errors.length) process.exit(1);
