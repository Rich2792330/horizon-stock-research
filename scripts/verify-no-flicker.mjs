import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

mkdirSync("/workspace/screenshots", { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];

await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(400);
const early = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/no-flicker-early.png" });

await page.waitForTimeout(3500);
const late = await page.locator("body").innerText();
await page.screenshot({ path: "/workspace/screenshots/no-flicker-late.png" });

const bad = /Checking all 21 names|Updating on this same screen|nothing under 70|flips to a second/i;
if (bad.test(early)) errors.push("early has old flicker copy");
if (bad.test(late)) errors.push("late has old flicker copy");
if (!early.includes("Your list") || !late.includes("Your list")) errors.push("missing Your list");
if (!early.includes("Top risers") || !late.includes("Top risers")) errors.push("missing Top risers");
if (early.includes("nothing under")) errors.push("early still says nothing under");
if (late.includes("nothing under")) errors.push("late still says nothing under");
if (!/70% sure or higher/.test(late)) errors.push("late missing 70% sure or higher");

console.log("--- EARLY ---");
console.log(early.slice(0, 700));
console.log("--- LATE ---");
console.log(late.slice(0, 700));
console.log("--- ERRORS ---");
console.log(errors.length ? errors.join("\n") : "none");
await browser.close();
if (errors.length) process.exit(1);
