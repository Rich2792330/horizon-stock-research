import { analyzeTicker } from "../src/lib/analysis/framework";
import { toHit, clearedRise70 } from "../src/lib/analysis/scan";

for (const t of ["ASML", "KLAC", "SMH", "NVDA", "MSFT", "MRNA", "SOXL", "TEAM", "000660.KS", "LUNR", "QBTS", "STX", "MU"]) {
  const r = await analyzeTicker(t, { light: true });
  const hit = toHit(r);
  const h1 = r.horizons.find((h) => h.horizon === "1m");
  const h3 = r.horizons.find((h) => h.horizon === "3m");
  console.log(t, {
    d: h1?.direction,
    c: h1?.confidence,
    a: h1?.abstain,
    exp: h1?.expectedReturn,
    h3: h3?.direction,
    h3c: h3?.confidence,
    q: hit ? clearedRise70(hit) : 0,
    why: h1?.abstainReason ?? h1?.drivers?.[0],
  });
}
