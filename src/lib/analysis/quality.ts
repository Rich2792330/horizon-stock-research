import type { Fundamentals } from "./market-data";
import type { QualityBundle } from "./types";

export function buildQualityFromFund(fund: Fundamentals): QualityBundle {
  const notes: string[] = [];
  let accrualsProxy: number | null = null;
  if (fund.ni != null && fund.ocf != null && Math.abs(fund.ni) > 0) {
    accrualsProxy = (fund.ni - fund.ocf) / Math.abs(fund.ni);
    if (accrualsProxy > 0.5) notes.push("High accruals vs OCF — accounting quality flag");
    else if (accrualsProxy < 0) notes.push("OCF exceeds NI — cash conversion supportive");
    else notes.push(`Accruals proxy ${(accrualsProxy * 100).toFixed(0)}% of |NI|`);
  } else {
    notes.push("OCF/NI incomplete for accruals proxy");
  }
  let rdIntensity: number | null = null;
  if (fund.rdExpense != null && fund.ni != null && Math.abs(fund.ni) > 0) {
    rdIntensity = fund.rdExpense / Math.abs(fund.ni);
  }
  if (fund.rdExpense != null) notes.push(`R&D reported`);
  if (fund.capex != null) notes.push(`CapEx reported`);
  return {
    ocf: fund.ocf,
    ni: fund.ni,
    accrualsProxy,
    rdExpense: fund.rdExpense,
    capex: fund.capex,
    rdIntensity,
    notes,
  };
}
