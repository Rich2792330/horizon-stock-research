import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

mkdirSync("/workspace/screenshots", { recursive: true });

const BASE = "http://127.0.0.1:8080";
const EXPECTED_TICKERS = [
  "QQQ",
  "RCL",
  "SMH",
  "NVDA",
  "TSM",
  "MSFT",
  "ASML",
  "AMAT",
  "KLAC",
  "MU",
  "TSLA",
  "AAPL",
  "AMZN",
  "AVGO",
  "GOOG",
  "IAU",
  "SLV",
];
const COMPANY = {
  QQQ: "Invesco QQQ Trust",
  RCL: "Royal Caribbean",
  SMH: "VanEck Semiconductor",
  NVDA: "NVIDIA",
  TSM: "Taiwan Semiconductor",
  MSFT: "Microsoft",
  ASML: "ASML",
  AMAT: "Applied Materials",
  KLAC: "KLA",
  MU: "Micron",
  TSLA: "Tesla",
  AAPL: "Apple",
  AMZN: "Amazon",
  AVGO: "Broadcom",
  GOOG: "Alphabet",
  IAU: "iShares Gold",
  SLV: "iShares Silver",
};

const report = {
  startedAt: new Date().toISOString(),
  htmlSize: null,
  consoleErrors: [],
  pageErrors: [],
  consoleAll: [],
  navigations: [],
  flicker: {},
  scanCounter: {},
  frozen: {},
  topRisers: {},
  listedStocks: {},
  routes: {},
  screenshots: [],
  bugs: [],
  works: [],
};

function hash(s) {
  return createHash("sha1").update(s || "").digest("hex").slice(0, 12);
}

function attachLogs(page, bucket) {
  page.on("console", (msg) => {
    const rec = { type: msg.type(), text: msg.text(), loc: bucket };
    report.consoleAll.push(rec);
    if (msg.type() === "error") report.consoleErrors.push(rec);
  });
  page.on("pageerror", (err) => {
    report.pageErrors.push({
      loc: bucket,
      message: String(err?.message || err),
      stack: String(err?.stack || "").slice(0, 500),
    });
  });
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (/favicon|hot-update|__vite/.test(url)) return;
    report.consoleAll.push({
      type: "requestfailed",
      text: `${req.failure()?.errorText || "fail"} ${req.method()} ${url}`,
      loc: bucket,
    });
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      report.navigations.push({ loc: bucket, url: frame.url(), at: new Date().toISOString() });
    }
  });
}

async function safeEval(page, fn, arg, fallback) {
  for (let i = 0; i < 4; i++) {
    try {
      if (page.isClosed()) return fallback;
      return await page.evaluate(fn, arg);
    } catch (e) {
      const msg = String(e?.message || e);
      if (/Execution context was destroyed|Target closed|Session closed/i.test(msg)) {
        await page.waitForTimeout(400);
        continue;
      }
      throw e;
    }
  }
  return fallback;
}

async function safeShot(page, path, fullPage = false) {
  try {
    if (page.isClosed()) return false;
    await page.screenshot({ path, fullPage, timeout: 15000 });
    report.screenshots.push(path);
    return true;
  } catch (e) {
    report.consoleAll.push({ type: "screenshot-fail", text: `${path}: ${e.message}`, loc: "qa" });
    return false;
  }
}

const LAYOUT_FN = () => {
  const body = document.body;
  const h1 = document.querySelector("h1");
  const aside = document.querySelector("aside");
  const mobileHeader = document.querySelector("header");
  const titles = [...document.querySelectorAll("h1, h2")].map((el) => (el.textContent || "").trim());
  const phoneOutlook = document.querySelector(".md\\:hidden");
  const deskOutlook = document.querySelector(".md\\:grid");
  const text = (body?.innerText || "").replace(/\s+/g, " ").trim();
  const progress = (body?.innerText || "").match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  const csAside = aside ? getComputedStyle(aside).display : "none";
  const csHeader = mobileHeader ? getComputedStyle(mobileHeader).display : "none";
  return {
    title: document.title,
    h1: (h1?.innerText || "").trim(),
    titles,
    asideDisplay: csAside,
    headerDisplay: csHeader,
    phoneOutlookDisplay: phoneOutlook ? getComputedStyle(phoneOutlook).display : null,
    deskOutlookDisplay: deskOutlook ? getComputedStyle(deskOutlook).display : null,
    textLen: text.length,
    textHead: text.slice(0, 500),
    textHash: text.slice(0, 2500),
    htmlLen: document.documentElement.outerHTML.length,
    progress: progress ? { scanned: progress[1], total: progress[2] } : null,
    readyState: document.readyState,
    vw: window.innerWidth,
    vh: window.innerHeight,
    href: location.href,
  };
};

const EXTRACT_RISERS_FN = () => {
  const body = document.body?.innerText || "";
  const headings = [...document.querySelectorAll("h1, h2, h3, div, p")].filter((el) =>
    /Top risers/i.test((el.textContent || "").trim().slice(0, 40)),
  );
  let host = null;
  for (const h of headings) {
    let p = h;
    for (let i = 0; i < 10 && p; i++) {
      const t = p.innerText || "";
      if (t.includes("Top risers") && t.length > 80 && t.length < 100000) {
        host = p;
        break;
      }
      p = p.parentElement;
    }
    if (host) break;
  }
  const text = host ? host.innerText : body;
  let seventyBlock = "";
  const m = text.match(/70%\+\s*sure to rise[\s\S]*?(?=Also scored|On screen while it runs|What this look found|$)/i);
  seventyBlock = m ? m[0] : "";
  let alsoBlock = "";
  const m2 = text.match(/(Also scored|On screen while it runs|What this look found)[\s\S]{0,8000}/i);
  alsoBlock = m2 ? m2[0] : "";

  const parseEntries = (block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const entries = [];
    const tickerRe = /^([A-Z]{2,5}|[0-9]{5,6}\.[A-Z]{1,2})\b/;
    let cur = null;
    for (const line of lines) {
      if (
        /70%\+|sure to rise|Also scored|On screen|What this look|Only names at|Highest sure|Waiting for|Scoring names|Finished|Still checking|Starting|Running the|Next-month|Find likely/i.test(
          line,
        ) &&
        !tickerRe.test(line)
      ) {
        continue;
      }
      const tm = line.match(tickerRe);
      if (tm) {
        if (cur) entries.push(cur);
        cur = { ticker: tm[1], nameLine: line, lines: [line], sures: [], outlooks: [] };
        continue;
      }
      if (!cur) continue;
      cur.lines.push(line);
      const sure = line.match(/(\d{1,3})%\s*sure/gi);
      if (sure) {
        for (const s of sure) cur.sures.push(Number(s.match(/\d+/)[0]));
      }
      if (/Next month|3 months|6 months|Sit out|Rise|Fall|Even/i.test(line)) cur.outlooks.push(line);
    }
    if (cur) entries.push(cur);
    return entries;
  };

  const hits = parseEntries(seventyBlock);
  const also = parseEntries(alsoBlock);
  const progress = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/) || [];
  const statusLine = (text.match(/(Still checking|Finished|Starting)[^\n]*/i) || [""])[0];
  const desc = (text.match(/(Running the 1\/3\/6-month model[^\n]*|Finished ·[^\n]*)/i) || [""])[0];
  return {
    cardText: text.slice(0, 7000),
    seventyBlock: seventyBlock.slice(0, 5000),
    alsoHead: alsoBlock.slice(0, 500),
    hits,
    alsoTickers: also.map((e) => e.ticker),
    scanned: progress[1] ? Number(String(progress[1]).replace(/,/g, "")) : null,
    total: progress[2] ? Number(String(progress[2]).replace(/,/g, "")) : null,
    statusLine,
    desc,
  };
};

const EXTRACT_LISTED_FN = (expected) => {
  const body = document.body?.innerText || "";
  const idx = body.search(/\nResults\b/);
  const after = idx >= 0 ? body.slice(idx) : body;
  const chunk = after.slice(0, 30000);
  const tickerHits = {};
  for (const t of expected) {
    const re = new RegExp(`(?:^|\\n)\\s*${t}\\b([^\\n]*)\\n([^\\n]*)?`, "m");
    const m = chunk.match(re) || body.match(re);
    tickerHits[t] = {
      present: new RegExp(`\\b${t}\\b`).test(body),
      nearby: m ? m[0].replace(/\n/g, " | ").slice(0, 240) : null,
    };
  }
  const stocks = [];
  const lines = chunk.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const tm =
      line.match(/^([A-Z]{2,5}|[0-9]{5,6}\.[A-Z]{1,2})\s+(.+)$/) ||
      line.match(/^(SK Hynix|SpaceX)\s*(.*)$/);
    if (!tm) continue;
    const ticker = tm[1];
    if (["ETF", "USD", "HTTP", "JSON"].includes(ticker)) continue;
    const block = lines.slice(i, i + 16).map((l) => l.trim());
    const sures = [];
    const outlooks = [];
    for (const l of block) {
      const sm = l.match(/(\d{1,3})%\s*sure/gi);
      if (sm) for (const s of sm) sures.push(Number(s.match(/\d+/)[0]));
      if (/Next month|3 months|6 months|Sit out|Rise ·|Fall ·|Even ·|expected (up|down|flat)/i.test(l)) {
        outlooks.push(l);
      }
    }
    const industry = block[1] && !/Next month|\$|Results|Strongest|1-month|Rise|Fall|Sit out/i.test(block[1]) ? block[1] : null;
    stocks.push({ ticker, nameLine: line, industry, sures, outlooks, block: block.slice(0, 12) });
  }
  return {
    bodyHead: body.slice(0, 900),
    resultsHead: chunk.slice(0, 1800),
    tickerHits,
    stocks: stocks.slice(0, 40),
    stockCount: stocks.length,
    has1m: /Next month/i.test(chunk),
    has3m: /3 months/i.test(chunk),
    has6m: /6 months/i.test(chunk),
    hasExpected: /expected (up|down|flat)/i.test(chunk),
    hasSure: /%\s*sure/i.test(chunk),
    missingOutlooks: /Checking this name|No outlook/i.test(chunk),
    tape: (body.match(/Bull tape|Bear tape|Choppy[^\n]*/i) || [null])[0],
    extras: {
      SKHynix: /SK Hynix|000660/.test(body),
      SpaceX: /SpaceX|SPCX/.test(body),
      PLTM: /\bPLTM\b/.test(body),
      FTNT: /\bFTNT\b/.test(body),
    },
  };
};

const EMPTY_RISERS = {
  cardText: "",
  seventyBlock: "",
  hits: [],
  alsoTickers: [],
  scanned: null,
  total: null,
  statusLine: "",
  desc: "",
};
const EMPTY_LISTED = {
  bodyHead: "",
  resultsHead: "",
  tickerHits: {},
  stocks: [],
  stockCount: 0,
  has1m: false,
  has3m: false,
  has6m: false,
  hasExpected: false,
  hasSure: false,
  missingOutlooks: false,
  tape: null,
  extras: {},
};
const EMPTY_LAYOUT = { h1: "", textLen: 0, textHead: "", textHash: "", asideDisplay: "?", headerDisplay: "?" };

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const htmlResp = await fetch(BASE + "/");
  const htmlBuf = Buffer.from(await htmlResp.arrayBuffer());
  report.htmlSize = {
    status: htmlResp.status,
    bytes: htmlBuf.length,
    kb: Math.round(htmlBuf.length / 1024),
    mb: +(htmlBuf.length / 1024 / 1024).toFixed(3),
    contentType: htmlResp.headers.get("content-type"),
  };

  // ---------- PHONE HOME ----------
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  attachLogs(phone, "phone-home");

  const tNav = Date.now();
  let navOk = true;
  let navErr = null;
  try {
    const resp = await phone.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
    report.frozen.navStatus = resp?.status() ?? 0;
    report.frozen.domContentLoadedMs = Date.now() - tNav;
  } catch (e) {
    navOk = false;
    navErr = String(e?.message || e);
    report.bugs.push(`Home navigation failed: ${navErr}`);
  }

  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 7; i++) {
    const snap = await safeEval(phone, LAYOUT_FN, undefined, { ...EMPTY_LAYOUT, error: "eval-fail" });
    snap.atMs = Date.now() - t0;
    snap.textHashShort = hash(snap.textHash || snap.textHead || "");
    samples.push(snap);
    if (i === 0) await safeShot(phone, "/workspace/screenshots/debug-home-phone-t0.png", false);
    if (i < 6) await phone.waitForTimeout(500);
  }
  await safeShot(phone, "/workspace/screenshots/debug-home-phone.png", false);
  await safeShot(phone, "/workspace/screenshots/debug-home-phone-full.png", true);

  const hashes = samples.map((s) => s.textHashShort);
  const uniqueHashes = [...new Set(hashes)];
  const layouts = samples.map((s) => ({
    atMs: s.atMs,
    h1: s.h1,
    aside: s.asideDisplay,
    header: s.headerDisplay,
    phoneOutlook: s.phoneOutlookDisplay,
    deskOutlook: s.deskOutlookDisplay,
    progress: s.progress,
    textLen: s.textLen,
    hash: s.textHashShort,
    titles: s.titles,
    href: s.href,
  }));
  const h1s = [...new Set(samples.map((s) => s.h1).filter(Boolean))];
  const asideFlips = new Set(samples.map((s) => s.asideDisplay)).size > 1;
  const headerFlips = new Set(samples.map((s) => s.headerDisplay)).size > 1;
  const outlookFlips =
    new Set(samples.map((s) => `${s.phoneOutlookDisplay}|${s.deskOutlookDisplay}`)).size > 1;
  const headingFlips = h1s.length > 1;
  const copyFlickerHints = samples.some((s) =>
    /Checking all 21 names|Updating on this same screen|nothing under 70|flips to a second/i.test(s.textHead || ""),
  );
  const textLenSwing =
    Math.max(...samples.map((s) => s.textLen || 0)) - Math.min(...samples.map((s) => s.textLen || 0));
  const navDuringFirst3s = report.navigations.filter((n) => n.loc === "phone-home").length;

  report.flicker = {
    sampled: layouts,
    uniqueTextHashes: uniqueHashes.length,
    hashes,
    uniqueH1: h1s,
    asideDisplayFlipped: asideFlips,
    headerDisplayFlipped: headerFlips,
    outlookLayoutFlipped: outlookFlips,
    headingFlipped: headingFlips,
    copyFlickerHints,
    textLenSwing,
    mainFrameNavigations: navDuringFirst3s,
    first3sUsable: Boolean(samples.at(-1)?.h1) && (samples.at(-1)?.textLen || 0) > 200,
    notes: [],
  };
  if (asideFlips || headerFlips || outlookFlips || headingFlips) {
    report.flicker.notes.push("Layout chrome changed during first 3s");
    report.bugs.push(
      `FLICKER: layout chrome changed in first 3s (aside=${asideFlips} header=${headerFlips} outlook=${outlookFlips} h1=${headingFlips} h1s=${JSON.stringify(h1s)})`,
    );
  }
  if (copyFlickerHints) report.bugs.push("FLICKER: old flicker copy appeared in first 3s");
  if (navDuringFirst3s > 1) {
    report.flicker.notes.push(`Main frame navigated ${navDuringFirst3s} times (reload/flicker)`);
    report.bugs.push(`FLICKER: home main frame navigated ${navDuringFirst3s} times in the session`);
  }
  if (!report.flicker.notes.length) {
    report.works.push("No two-layout flicker in first 3s on phone home (h1/aside/header/outlook display stable)");
  }

  let scrollOk = false;
  let clickOk = false;
  try {
    await phone.mouse.wheel(0, 600);
    await phone.waitForTimeout(250);
    const y = await safeEval(phone, () => window.scrollY, undefined, 0);
    scrollOk = y > 10;
    await phone.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
    const link = phone.locator("a, button").first();
    clickOk = await link.isEnabled().catch(() => false);
  } catch (e) {
    report.bugs.push(`Usability probe failed: ${e.message}`);
  }
  report.frozen.scrollOk = scrollOk;
  report.frozen.clickable = clickOk;
  report.frozen.navOk = navOk;
  report.frozen.navErr = navErr;

  const risers1 = await safeEval(phone, EXTRACT_RISERS_FN, undefined, EMPTY_RISERS);
  const listed1 = await safeEval(phone, EXTRACT_LISTED_FN, EXPECTED_TICKERS, EMPTY_LISTED);
  const scanAt3s = { scanned: risers1.scanned, total: risers1.total, status: risers1.statusLine, desc: risers1.desc };

  const scanWaitStart = Date.now();
  await phone.waitForTimeout(8000);
  const risers2 = await safeEval(phone, EXTRACT_RISERS_FN, undefined, EMPTY_RISERS);
  const listed2 = await safeEval(phone, EXTRACT_LISTED_FN, EXPECTED_TICKERS, EMPTY_LISTED);
  const scanAt11s = { scanned: risers2.scanned, total: risers2.total, status: risers2.statusLine, desc: risers2.desc };
  report.scanCounter = {
    waitedMs: Date.now() - scanWaitStart,
    at3s: scanAt3s,
    at11s: scanAt11s,
    advanced: (risers2.scanned ?? 0) > (risers1.scanned ?? 0),
    stuck:
      (risers2.scanned ?? 0) === (risers1.scanned ?? 0) && !/Finished/i.test(risers2.statusLine || risers2.desc || ""),
    finished: /Finished/i.test(risers2.statusLine || risers2.desc || ""),
  };
  await safeShot(phone, "/workspace/screenshots/debug-home-phone-after8s.png", false);

  const under70 = [];
  const hitSummaries = (risers2.hits || []).map((h) => {
    const bad = (h.sures || []).filter((n) => n < 70);
    if (bad.length) under70.push({ ticker: h.ticker, sures: h.sures, nameLine: h.nameLine });
    return { ticker: h.ticker, nameLine: h.nameLine, sures: h.sures, outlooks: h.outlooks, lines: h.lines };
  });
  report.topRisers = {
    visibleText: risers2.cardText,
    seventyBlock: risers2.seventyBlock,
    hits: hitSummaries,
    tickers: hitSummaries.map((h) => h.ticker),
    sureNumbers: hitSummaries.map((h) => ({ ticker: h.ticker, sures: h.sures })),
    under70Flagged: under70,
    alsoTickers: risers2.alsoTickers,
    progress: `${risers2.scanned} / ${risers2.total}`,
    status: risers2.statusLine,
    desc: risers2.desc,
  };
  if (under70.length) {
    report.bugs.push(
      `70%+ section contains % sure under 70: ${under70.map((u) => `${u.ticker} ${u.sures.join(",")}`).join("; ")}`,
    );
  } else if (hitSummaries.length) {
    report.works.push(
      `70%+ sure to rise lists ${hitSummaries.length} names; all shown % sure values are >= 70 (or sit-out)`,
    );
  } else {
    report.bugs.push("70%+ sure to rise section has no ticker entries (empty or not parsed)");
  }

  const listedFinal = listed2.stockCount >= listed1.stockCount ? listed2 : listed1;
  const missingExpected = EXPECTED_TICKERS.filter((t) => !listedFinal.tickerHits[t]?.present);
  const foundWithMeta = [];
  const missingMeta = [];
  for (const t of EXPECTED_TICKERS) {
    const row = (listedFinal.stocks || []).find((s) => s.ticker === t);
    const present = listedFinal.tickerHits[t]?.present;
    foundWithMeta.push({
      ticker: t,
      present,
      nearby: listedFinal.tickerHits[t]?.nearby,
      industry: row?.industry || null,
      outlooks: row?.outlooks || [],
      sures: row?.sures || [],
    });
    if (!present) missingMeta.push(`${t} missing from page`);
    else if (row && !row.industry) missingMeta.push(`${t} missing industry line`);
    else if (row && !(row.outlooks || []).length) missingMeta.push(`${t} missing 1/3/6 outlook lines`);
  }
  report.listedStocks = {
    tape: listedFinal.tape,
    stockCountParsed: listedFinal.stockCount,
    has1m: listedFinal.has1m,
    has3m: listedFinal.has3m,
    has6m: listedFinal.has6m,
    hasExpected: listedFinal.hasExpected,
    hasSure: listedFinal.hasSure,
    missingOutlooksCopy: listedFinal.missingOutlooks,
    missingExpected,
    extras: listedFinal.extras,
    rows: foundWithMeta,
    parsedBlocks: (listedFinal.stocks || []).slice(0, 25),
    resultsHead: listedFinal.resultsHead,
  };
  if (!missingExpected.length && listedFinal.has1m && listedFinal.has3m && listedFinal.has6m && listedFinal.hasSure) {
    report.works.push("All requested tickers appear with 1/3/6-month outlooks and % sure on home");
  }
  if (missingExpected.length) report.bugs.push(`Listed stocks missing from home: ${missingExpected.join(", ")}`);
  if (listedFinal.missingOutlooks) report.bugs.push("Some listed names still show 'Checking this name…' or 'No outlook'");
  if (missingMeta.length) report.bugs.push(`Listed-stock gaps: ${missingMeta.slice(0, 12).join("; ")}`);

  const phoneBody = await phone.locator("body").innerText().catch(() => "");
  writeFileSync("/workspace/screenshots/debug-home-phone-text.txt", phoneBody);
  await phone.close();

  // ---------- DESKTOP HOME ----------
  const desk = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  attachLogs(desk, "desktop-home");
  const tDesk = Date.now();
  await desk.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
  report.frozen.desktopDclMs = Date.now() - tDesk;
  const deskSamples = [];
  for (let i = 0; i < 5; i++) {
    const snap = await safeEval(desk, LAYOUT_FN, undefined, EMPTY_LAYOUT);
    deskSamples.push({
      atMs: i * 500,
      h1: snap.h1,
      aside: snap.asideDisplay,
      header: snap.headerDisplay,
      phoneOutlook: snap.phoneOutlookDisplay,
      deskOutlook: snap.deskOutlookDisplay,
      textLen: snap.textLen,
    });
    if (i < 4) await desk.waitForTimeout(500);
  }
  await safeShot(desk, "/workspace/screenshots/debug-home-desktop.png", false);
  await safeShot(desk, "/workspace/screenshots/debug-home-desktop-full.png", true);
  const deskRisers = await safeEval(desk, EXTRACT_RISERS_FN, undefined, EMPTY_RISERS);
  const deskListed = await safeEval(desk, EXTRACT_LISTED_FN, EXPECTED_TICKERS, EMPTY_LISTED);
  const deskBody = await desk.locator("body").innerText().catch(() => "");
  writeFileSync("/workspace/screenshots/debug-home-desktop-text.txt", deskBody);
  report.flicker.desktop = {
    samples: deskSamples,
    asideAlwaysFlex: deskSamples.every((s) => s.aside === "flex" || s.aside === "block"),
    headerHidden: deskSamples.every((s) => s.header === "none"),
    deskOutlookVisible: deskSamples.some((s) => s.deskOutlook === "grid"),
  };
  if (!report.flicker.desktop.asideAlwaysFlex) {
    report.bugs.push(`Desktop sidebar not stably visible: ${deskSamples.map((s) => s.aside).join(",")}`);
  } else {
    report.works.push("Desktop home shows sidebar (aside) stably");
  }
  report.topRisers.desktopHits = (deskRisers.hits || []).map((h) => ({
    ticker: h.ticker,
    sures: h.sures,
    nameLine: h.nameLine,
  }));
  report.listedStocks.desktopStockCount = deskListed.stockCount;
  await desk.close();

  // ---------- OTHER ROUTES (phone) ----------
  const routes = [
    { path: "/scan", name: "scan", expect: ["Find likely risers", "Top risers"] },
    { path: "/actions", name: "actions", expect: ["Add, wait, or reduce"] },
    { path: "/backtest", name: "backtest", expect: ["Would it have worked?"] },
    { path: "/guide", name: "guide", expect: ["How the app works"] },
  ];
  const rp = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  attachLogs(rp, "routes");
  for (const r of routes) {
    const rec = {
      path: r.path,
      status: null,
      ttfbMs: null,
      h1: null,
      emptyHints: [],
      errorsOnPage: [],
      missing: [],
      bodyHead: "",
      screenshot: null,
    };
    const t = Date.now();
    try {
      const resp = await rp.goto(BASE + r.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      rec.status = resp?.status() ?? 0;
      rec.ttfbMs = Date.now() - t;
      await rp.waitForTimeout(2200);
      const body = await rp.locator("body").innerText();
      rec.h1 = await rp.locator("h1").first().innerText().catch(() => null);
      rec.bodyHead = body.slice(0, 2000);
      rec.bodyLen = body.length;
      rec.missing = r.expect.filter((s) => !body.includes(s));
      if (/Scoring names now/i.test(body)) rec.emptyHints.push("Scoring names now…");
      if (/No name cleared/i.test(body)) rec.emptyHints.push("No name cleared 70%");
      if (/Waiting for a 70%/i.test(body)) rec.emptyHints.push("Waiting for a 70%+ rise call");
      if (/Review the list/i.test(body)) rec.emptyHints.push("Actions idle until Review the list is tapped (expected empty state)");
      if (/Would it have worked/i.test(body) && /leave empty|Optional/i.test(body)) {
        rec.emptyHints.push("Backtest idle until run (expected empty state)");
      }
      if (/error occurred|Something broke|Page not found|Application error/i.test(body)) {
        rec.errorsOnPage.push("error/notfound copy in body");
      }
      const shot = `/workspace/screenshots/debug-${r.name}-phone.png`;
      await safeShot(rp, shot, false);
      await safeShot(rp, `/workspace/screenshots/debug-${r.name}-phone-full.png`, true);
      rec.screenshot = shot;
      if (rec.status !== 200) report.bugs.push(`${r.path} HTTP ${rec.status}`);
      if (rec.missing.length) report.bugs.push(`${r.path} missing expected text: ${rec.missing.join(", ")}`);
      if (rec.errorsOnPage.length) report.bugs.push(`${r.path}: ${rec.errorsOnPage.join("; ")}`);
      if (!rec.missing.length && rec.status === 200) report.works.push(`${r.path} loaded (h1=${JSON.stringify(rec.h1)})`);
    } catch (e) {
      rec.errorsOnPage.push(String(e?.message || e));
      report.bugs.push(`${r.path} threw: ${e.message}`);
      await safeShot(rp, `/workspace/screenshots/debug-${r.name}-phone.png`, false);
    }
    report.routes[r.name] = rec;
  }
  await rp.close();

  const huge = report.htmlSize.bytes > 1_500_000;
  report.frozen.htmlBytes = report.htmlSize.bytes;
  report.frozen.htmlMB = report.htmlSize.mb;
  report.frozen.hugeHtml = huge;
  report.frozen.feltFrozen = !scrollOk || report.frozen.domContentLoadedMs > 8000 || !navOk;
  if (huge) {
    report.bugs.push(
      `Homepage HTML is very large: ${report.htmlSize.mb} MB (${report.htmlSize.bytes} bytes). This can freeze low-end phones.`,
    );
  }
  if (report.frozen.domContentLoadedMs > 8000) {
    report.bugs.push(`Home DCL slow: ${report.frozen.domContentLoadedMs}ms`);
  }
  if (scrollOk && clickOk && report.frozen.domContentLoadedMs < 8000) {
    report.works.push(
      `Home stayed usable after load (scroll=${scrollOk}, clickable=${clickOk}, DCL=${report.frozen.domContentLoadedMs}ms)`,
    );
  }
  if (report.scanCounter.stuck) {
    report.bugs.push(
      `Scan counter stuck at ${report.scanCounter.at3s.scanned} / ${report.scanCounter.at3s.total} after 8s wait (status: ${report.scanCounter.at11s.status})`,
    );
  } else if (report.scanCounter.advanced) {
    report.works.push(
      `Scan counter advanced ${report.scanCounter.at3s.scanned} → ${report.scanCounter.at11s.scanned} of ${report.scanCounter.at11s.total}`,
    );
  } else if (report.scanCounter.finished) {
    report.works.push(`Scan already finished at ${report.scanCounter.at11s.scanned} / ${report.scanCounter.at11s.total}`);
  }

  if (report.pageErrors.length) {
    report.bugs.push(
      `pageerror x${report.pageErrors.length}: ${report.pageErrors.map((e) => e.message).join(" | ")}`,
    );
  }
  const realConsole = report.consoleErrors.filter((e) => !/favicon/i.test(e.text || ""));
  if (realConsole.length) {
    report.bugs.push(
      `console.error x${realConsole.length}: ${realConsole
        .slice(0, 8)
        .map((e) => e.text.slice(0, 180))
        .join(" | ")}`,
    );
  } else {
    report.works.push("No pageerror / material console.error on tested pages");
  }
} catch (e) {
  report.bugs.push(`QA script crashed: ${e.message}`);
  console.error(e);
} finally {
  await browser.close().catch(() => null);
}

report.finishedAt = new Date().toISOString();
writeFileSync("/workspace/screenshots/horizon-qa-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
