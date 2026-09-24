import { getListedAnalysis } from "../src/lib/analysis/listed-cache.server";
import { getRiserScan } from "../src/lib/analysis/scan-cache.server";

const listed = await getListedAnalysis({ fresh: true });
const rise = listed.results.filter((r) => {
  const h = r.horizons.find((x) => x.horizon === "1m");
  return h && h.direction === "Increase" && !h.abstain && h.confidence >= 70;
});
console.log("listed", listed.results.length, "tape", listed.tape?.label, "70+", rise.map((r) => `${r.ticker}:${r.horizons.find((h) => h.horizon === "1m")?.confidence}`).join(","));

const scan = await getRiserScan();
console.log("scan starter hits", scan.hits.length, "scanned", scan.scanned, "done", scan.done);

const waited = await getRiserScan({ fresh: true });
console.log(
  "scan fresh hits",
  waited.hits.length,
  "scanned",
  waited.scanned,
  "done",
  waited.done,
  waited.hits.map((h) => `${h.ticker}:${h.confidence}`).join(", "),
);
