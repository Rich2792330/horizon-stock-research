import { getListedAnalysis } from "../src/lib/analysis/listed-cache.server";

const r = await getListedAnalysis({ fresh: true });
console.log("tape", r.tape?.label, "monthDown", r.tape?.monthDown);
console.log("reasons", r.tape?.reasons);
for (const x of r.results.slice(0, 8)) {
  const h1 = x.horizons.find((h) => h.horizon === "1m");
  const h3 = x.horizons.find((h) => h.horizon === "3m");
  const h6 = x.horizons.find((h) => h.horizon === "6m");
  console.log(
    x.ticker,
    "1m",
    h1?.abstain ? "Sit" : h1?.direction,
    h1?.expectedReturn,
    h1?.abstainReason?.slice(0, 60),
    "| 3m",
    h3?.abstain ? "Sit" : h3?.direction,
    h3?.expectedReturn,
    h3?.confidence,
    "| 6m",
    h6?.abstain ? "Sit" : h6?.direction,
    h6?.expectedReturn,
    h6?.confidence,
  );
}
