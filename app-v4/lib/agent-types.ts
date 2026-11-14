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
  /** Visitor key of the demo visitor who created the rule. Its spend counts against them. */
  owner?: string;
  /** Network key of that visitor when the rule was created. */
  ownerNet?: string;
  /** Set while a tick is executing this rule, so a concurrent tick skips it. */
  leaseUntil?: string;
};

export type AgentLog = {
  id: string;
  at: string;
  ruleId?: string;
  /** Visitor key the entry belongs to, or "system" for operator and cron entries. */
  owner?: string;
  action: "transfer" | "quote" | "blocked" | "skipped" | "info";
  reason: string;
  hash?: string;
  explorerUrl?: string;
  quoteOnly?: boolean;
};
