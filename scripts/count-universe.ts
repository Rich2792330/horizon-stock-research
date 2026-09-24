import { SCAN_UNIVERSE } from "../src/lib/analysis/scan-universe";
console.log("n", SCAN_UNIVERSE.length);
console.log("has FIX", SCAN_UNIVERSE.includes("FIX"));
console.log("has BIRK", SCAN_UNIVERSE.includes("BIRK"));
console.log("has STRL", SCAN_UNIVERSE.includes("STRL"));
console.log("tail", SCAN_UNIVERSE.slice(-15).join(","));
