import { analyzeTickers } from "../src/lib/analysis/framework";

const r = await analyzeTickers(["NVDA", "AAPL", "TSLA", "AMAT", "MU", "SMH"]);
for (const x of r.results) {
  const h = x.horizons.find((z) => z.horizon === "1m");
  console.log({
    ticker: x.ticker,
    error: x.error,
    dir: h?.direction,
    conf: h?.confidence,
    abstain: h?.abstain,
    exp: h?.expectedReturn,
    driver: h?.drivers?.[0],
  });
}
console.log("tape", r.tape?.label, r.tape?.reasons);
