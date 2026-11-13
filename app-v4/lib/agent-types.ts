export type AgentRule = {
  id: string;
  type: "schedule_send" | "price_rule";
  createdAt: string;
  enabled: boolean;
  amountNear: string;
  recipient?: string;
  cadence?: "weekly_friday" | "daily";
  belowUsd?: number;
  toSymbol?: "USDC" | "USDT";
  lastRunAt?: string;
  lastResult?: string;
};

export type AgentLog = {
  id: string;
  at: string;
  ruleId?: string;
  action: "transfer" | "quote" | "blocked" | "skipped" | "info";
  reason: string;
  hash?: string;
  explorerUrl?: string;
  quoteOnly?: boolean;
};
