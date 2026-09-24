import { create } from "zustand";
import type { ActionReviewReport } from "@/lib/analysis/action-review";
import type { BacktestReport } from "@/lib/analysis/backtest";
import { LISTED_STOCKS } from "@/lib/analysis/listed";
import type { RiserScanReport } from "@/lib/analysis/scan";
import type { AnalysisReport } from "@/lib/analysis/types";
import { parseTickers } from "@/lib/utils";

export type AppView = "analyze" | "scan" | "actions" | "backtest" | "guide";

interface AppState {
  tickers: string[];
  rawInput: string;
  report: AnalysisReport | null;
  scan: RiserScanReport | null;
  actions: ActionReviewReport | null;
  backtest: BacktestReport | null;
  error: string | null;
  loadingAnalyze: boolean;
  loadingScan: boolean;
  loadingActions: boolean;
  loadingBacktest: boolean;
  /** When true, Scan screen starts the 70%+ riser scan on mount */
  pendingScanStart: boolean;
  scanProgress: { checked: number; total: number } | null;

  setRawInput: (v: string) => void;
  setTickers: (t: string[]) => void;
  addTicker: (t: string) => void;
  removeTicker: (t: string) => void;
  clearTickers: () => void;
  mergeInputToTickers: () => string[];
  setError: (e: string | null) => void;
  setReport: (r: AnalysisReport | null) => void;
  setScan: (r: RiserScanReport | null) => void;
  setActions: (r: ActionReviewReport | null) => void;
  setBacktest: (r: BacktestReport | null) => void;
  setLoadingAnalyze: (v: boolean) => void;
  setLoadingScan: (v: boolean) => void;
  setLoadingActions: (v: boolean) => void;
  setLoadingBacktest: (v: boolean) => void;
  setPendingScanStart: (v: boolean) => void;
  setScanProgress: (v: { checked: number; total: number } | null) => void;
  clearResults: () => void;
  isBusy: () => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  tickers: [],
  rawInput: "",
  report: null,
  scan: null,
  actions: null,
  backtest: null,
  error: null,
  loadingAnalyze: false,
  loadingScan: false,
  loadingActions: false,
  loadingBacktest: false,
  pendingScanStart: false,
  scanProgress: null,

  setRawInput: (v) => set({ rawInput: v }),
  setTickers: (t) => set({ tickers: t }),
  addTicker: (t) => {
    const next = parseTickers([...get().tickers, t].join(" "));
    set({ tickers: next });
  },
  removeTicker: (t) =>
    set({ tickers: get().tickers.filter((x) => x !== t) }),
  clearTickers: () =>
    set({
      tickers: [],
      rawInput: "",
      report: null,
      scan: null,
      actions: null,
      backtest: null,
      error: null,
    }),
  mergeInputToTickers: () => {
    const next = parseTickers(
      [...get().tickers, ...parseTickers(get().rawInput)].join(" "),
    );
    set({ tickers: next, rawInput: "" });
    return next;
  },
  setError: (e) => set({ error: e }),
  setReport: (r) => set({ report: r }),
  setScan: (r) => set({ scan: r }),
  setActions: (r) => set({ actions: r }),
  setBacktest: (r) => set({ backtest: r }),
  setLoadingAnalyze: (v) => set({ loadingAnalyze: v }),
  setLoadingScan: (v) => set({ loadingScan: v }),
  setLoadingActions: (v) => set({ loadingActions: v }),
  setLoadingBacktest: (v) => set({ loadingBacktest: v }),
  setPendingScanStart: (v) => set({ pendingScanStart: v }),
  setScanProgress: (v) => set({ scanProgress: v }),
  clearResults: () =>
    set({ report: null, scan: null, actions: null, backtest: null }),
  isBusy: () => {
    const s = get();
    return (
      s.loadingAnalyze ||
      s.loadingScan ||
      s.loadingActions ||
      s.loadingBacktest
    );
  },
}));

export const QUICK_PICKS = [...LISTED_STOCKS];
