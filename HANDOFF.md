# Horizon — continue this app in a new Grok Build chat

Paste the block below as the **first message** in a new Grok conversation (Grok Build / app preview). This chat’s live preview and code stay here; a new chat starts a fresh app unless you give it this brief.

---

Rebuild and keep running **Horizon**, a phone-friendly stock-research web app. Dark editorial UI. Opens already working in the live preview. Do not leave a scaffold.

## What it does

- **Analyze (home) auto-runs on every open** — no tap. Checks this default list of 21 names, strongest next-month rise calls first:
  QQQ, RCL, SMH, NVDA, TSM, MSFT, ASML, AMAT, KLAC, MU, SK Hynix (`000660.KS`), TSLA, SpaceX (`SPCX`), AAPL, AMZN, AVGO, GOOG, IAU, SLV, PLTM, FTNT.
- Next to every ticker: **company name** and **industry**.
- For each name, show **1-month, 3-month, and 6-month** outlooks, each with:
  - Rise / Fall / Even
  - expected % move (e.g. `+6.3% expected up`)
  - confidence (e.g. `54% sure`)
- Phone: three full lines under the name. Wider screen: three labeled cards.
- Extra button only: **Find likely risers** — scan hundreds of liquid names, keep 70%+ next-month rise calls, real % not a flat 70, name + industry, sorted by sure% then expected move.
- **Buy or sell**: Add / Wait / Reduce on the same 21 names, with the same 1/3/6 outlooks.
- **Past tests**: 1-month walk-forward on those names, including 2020, 2022, and last 12 months. Report hit rate only from prices knowable on that date.
- **Market weather banner** at the top of results: **Bull tape / Bear tape / Choppy**.
  - Bull: market above its 200-day average, fear not rising, credit not weakening.
  - Bear: stricter than “below 200-day” so it does not stick (also below 50-day, weak 21-day, stress).
  - When Bear: **do not offer 1-month rise calls**. Show who is holding up, who is breaking down, and what would flip back to bullish.
- **How it works** page in plain English.

## Accuracy rules (do not undo)

- Point-in-time prices only for tests. No future data.
- 1-month **rise call** is tape/direction, not the quant “own this?” rank. Quant rank (momentum, value, quality, low vol) is separate, z-scored **within industry groups**.
- Tape veto: sit out 1-month rise if the market is not up, VIX elevated or rising, junk bonds sliding, or expected move smaller than costs.
- Printed confidence is **calibrated** toward how often similar rise calls actually rose (listed-name 10y walk-forward was about 66% of 38 calls; sat out 2022; last 12 months ~78% of 9). Do not hardcode 70 on every hit.
- News / X / BlackRock / calendar can **block** a call; they must not manufacture a 70% rise.
- Keep home auto-run, the default 21 names, and iPhone-reliable taps (full-page links, not finicky in-app clicks).

## Stack

TanStack Start (Vite + React 19), dark UI, PWA, server functions for Yahoo-style prices + the analysis. Preview must stay up.

## First job in the new chat

1. Recreate Horizon so Analyze auto-runs the 21 names and shows 1/3/6 month expected move + sure% immediately.
2. Then wait for my next change. Do not “improve” layout or add extra buttons unless I ask.
