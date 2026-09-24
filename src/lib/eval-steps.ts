export const EVAL_GROUPS: Array<{ title: string; steps: string[] }> = [
  {
    title: "Gather facts",
    steps: [
      "Get the stock’s recent prices and volume.",
      "Check whether the overall market is up or down (and how scared it is).",
      "Read company filings: sales, profit, cash, debt.",
      "Skim news headlines.",
      "Check investor chatter on StockTwits, Reddit, and X.",
      "Check useful psychology only: fear, crowding, chase, credit stress.",
      "Look up earnings, Fed meetings, and CPI inflation dates.",
      "Compare the stock to its closest rivals (who is taking the money).",
      "Read BlackRock, Blackstone, and key-people headlines (Jensen Huang, Elon Musk, and the like).",
    ],
  },
  {
    title: "Score like a ranking model",
    steps: [
      "Momentum: last ~20 trading days minus last ~60 days (short-term vs medium-term).",
      "Value: cheaper P/E or P/B scores higher.",
      "Quality: profitable, reasonably stable earnings, lower debt, higher ROE.",
      "Low volatility: calmer, lower-beta names score higher (this is “sleep well,” not “will go up”).",
      "Other: earnings growth, dividend, insider filings, and whether it trades enough to get in and out.",
    ],
  },
  {
    title: "Turn scores into a call",
    steps: [
      "When several names are checked together, each ranking factor is z-scored vs its own group (semis with semis, metals with metals), then weighted. That rank is “own this?” — it does not push the next-month rise call.",
      "A 1-month rise needs all of: the market up, fear not high or rising, junk bonds not sliding, this name leading its own group (semis vs semis), beating the market, a US listing vs this tape, and an expected move bigger than trading costs. Otherwise it sits out.",
      "News, X chatter, calendar, and rivals can block a rise call. They cannot manufacture a 70% rise on their own.",
      "The printed percent is shrunk toward how often similar rise calls actually rose in history — so it is not a stamp.",
      "Build a 3-month and 6-month outlook too. Those care more about value and quality. Keep “how jumpy is it?” separate from “up or down.”",
    ],
  },
];

export const EVAL_STEPS = EVAL_GROUPS.flatMap((g) => g.steps);

export const QUANT_WEIGHT_LINES = [
  "Momentum 28% (chart had 30% — slightly less so we do not only chase what already ran).",
  "Value 22% (chart had 25%).",
  "Quality 25% (same as the chart).",
  "Low volatility 15% (same as the chart).",
  "Other 10% (chart had 5% — raised because growth, dividend, insiders, and liquidity are real).",
] as const;
