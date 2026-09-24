import { getRiserScan, peekRiserScan } from "../src/lib/analysis/scan-cache.server";

const first = await getRiserScan();
console.log("first", {
  done: first.done,
  scanned: first.scanned,
  n: first.universeSize,
  note: first.notes[0],
  pool: first.pool?.length,
});
await new Promise((r) => setTimeout(r, 6000));
const peek = peekRiserScan();
console.log("6s", {
  done: peek?.done,
  scanned: peek?.scanned,
  note: peek?.notes?.[0],
  pool: peek?.pool?.length,
});
await new Promise((r) => setTimeout(r, 6000));
const peek2 = peekRiserScan();
console.log("12s", {
  done: peek2?.done,
  scanned: peek2?.scanned,
  note: peek2?.notes?.[0],
  pool: peek2?.pool?.length,
});
