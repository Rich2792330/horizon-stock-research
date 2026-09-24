import { analyzeTicker } from "../src/lib/analysis/framework";
import { toHit, clearedRise70 } from "../src/lib/analysis/scan";

for (const t of ["ASML", "SMH", "MSFT"]) {
  const r = await analyzeTicker(t, { light: true });
  const hit = toHit(r);
  const h1 = r.horizons.find((h) => h.horizon === "1m");
  console.log(t, {
    d: h1?.direction,
    c: h1?.confidence,
    a: h1?.abstain,
    exp: h1?.expectedReturn,
    cleared: hit ? clearedRise70(hit) : 0,
  });
}
