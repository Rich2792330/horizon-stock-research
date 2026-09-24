import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

function count(text) {
  const m = text.match(/(\d[\d,]*)\s*\/\s*1,000/);
  return m ? Number(m[1].replace(/,/g, "")) : -1;
}

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForTimeout(5000);
const t1 = await page.locator("body").innerText();
const n1 = count(t1);
await page.screenshot({ path: "/workspace/screenshots/scan-move-1.png" });

await page.waitForTimeout(8000);
const t2 = await page.locator("body").innerText();
const n2 = count(t2);
await page.screenshot({ path: "/workspace/screenshots/scan-move-2.png" });

const errors = [];
if (n1 < 0) errors.push("no counter");
if (!(n2 > n1 || /Finished/i.test(t2) || n2 === 1000)) {
  errors.push(`stuck t1=${n1} t2=${n2}`);
}

console.log({ n1, n2, finished: /Finished/i.test(t2) });
console.log("--- t1 ---\n", t1.split("\n").slice(8, 20).join("\n"));
console.log("--- t2 ---\n", t2.split("\n").slice(8, 22).join("\n"));
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
