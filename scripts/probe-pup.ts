import { prefetchMacro } from "../src/lib/analysis/market-data";
import { trainOutlook } from "../src/lib/analysis/predict";
import { fetchChart } from "../src/lib/analysis/market-data";

const names = ["AVGO", "NVDA", "AAPL", "MSFT", "ASML", "JPM", "UNH", "COST", "META", "GOOG", "AMZN", "TSLA", "SMH", "QQQ"];
const macro = await prefetchMacro("2y");
console.log("spy21", macro.spy ? "yes" : "no");
for (const t of names) {
  const bar = await fetchChart(t, "2y");
  if (!bar) {
    console.log(t, "no bar");
    continue;
  }
  const p1 = trainOutlook(bar, macro.spy, macro.tnx, 21);
  const p3 = trainOutlook(bar, macro.spy, macro.tnx, 63);
  const p6 = trainOutlook(bar, macro.spy, macro.tnx, 126);
  console.log(
    t,
    "1m",
    p1.used && `${(p1.pUp * 100).toFixed(0)}% exp=${(p1.expectedReturn * 100).toFixed(1)}`,
    "3m",
    p3.used && `${(p3.pUp * 100).toFixed(0)}% exp=${(p3.expectedReturn * 100).toFixed(1)}`,
    "6m",
    p6.used && `${(p6.pUp * 100).toFixed(0)}% exp=${(p6.expectedReturn * 100).toFixed(1)}`,
  );
}
