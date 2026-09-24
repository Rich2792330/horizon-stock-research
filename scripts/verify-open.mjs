import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const logs = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}\n${e.stack || ""}`));
page.on("requestfailed", (r) => logs.push(`[FAIL] ${r.method()} ${r.url()} ${r.failure()?.errorText}`));

const t0 = Date.now();
let navErr = null;
try {
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
} catch (e) {
  navErr = String(e);
}
const tDom = Date.now() - t0;
await page.waitForTimeout(2500);
const tDone = Date.now() - t0;
const body = await page.locator("body").innerText().catch((e) => `BODY_ERR ${e}`);
const html = await page.content();
await page.screenshot({ path: "/workspace/screenshots/open-home.png", fullPage: false });
await page.screenshot({ path: "/workspace/screenshots/open-home-full.png", fullPage: true });

const visible = {
  title: await page.locator("h1").first().innerText().catch(() => "NO_H1"),
  hasYourList: /Your list/.test(body),
  hasError: /error occurred|Something went wrong|Not Found|Could not open/i.test(body),
  bodyLen: body.length,
  htmlLen: html.length,
  tDom,
  tDone,
  navErr,
};

writeFileSync("/workspace/screenshots/open-home-logs.txt", logs.join("\n") + "\n\nBODY\n" + String(body).slice(0, 4000));
console.log(JSON.stringify(visible, null, 2));
console.log("--- LOGS ---");
console.log(logs.filter((l) => /error|fail|PAGEERROR|warn/i.test(l)).slice(0, 40).join("\n") || "(no error logs)");
console.log("--- BODY HEAD ---");
console.log(String(body).slice(0, 800));
await browser.close();
if (navErr || visible.hasError || !visible.hasYourList) process.exit(1);
