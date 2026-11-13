import { formatNear } from "./units";

export type HistoryItem = {
  hash: string;
  signer: string;
  receiver: string;
  actions: string[];
  methods: string[];
  depositYocto: string | null;
  feeYocto: string | null;
  success: boolean | null;
  timestampMs: number | null;
  source: "indexer" | "local";
};

function nsToMs(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(BigInt(value) / 1_000_000n);
}

function actionLabel(action: string): string {
  return action.toLowerCase().replaceAll("_", " ");
}

export function mapIndexerTransactions(payload: unknown): HistoryItem[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const hash = typeof row.transaction_hash === "string" ? row.transaction_hash : "";
    if (!hash) return [];
    const rawActions = Array.isArray(row.actions) ? row.actions : [];
    const actions = rawActions.flatMap((action) => {
      if (!action || typeof action !== "object") return [];
      const name = (action as { action?: unknown }).action;
      return typeof name === "string" ? [name] : [];
    });
    const methods = rawActions.flatMap((action) => {
      if (!action || typeof action !== "object") return [];
      const method = (action as { method?: unknown }).method;
      return typeof method === "string" && method ? [method] : [];
    });
    const deposit = (row.actions_agg as { deposit?: unknown } | undefined)?.deposit;
    const fee = (row.outcomes_agg as { transaction_fee?: unknown } | undefined)?.transaction_fee;
    const status = (row.outcomes as { status?: unknown } | undefined)?.status;
    return [{
      hash,
      signer: String(row.signer_account_id ?? ""),
      receiver: String(row.receiver_account_id ?? ""),
      actions,
      methods,
      depositYocto: typeof deposit === "string" ? deposit : null,
      feeYocto: typeof fee === "string" ? fee : null,
      success: typeof status === "boolean" ? status : null,
      timestampMs: nsToMs(row.block_timestamp),
      source: "indexer" as const,
    }];
  });
}

export function mergeHistory(remote: HistoryItem[], local: HistoryItem[]): HistoryItem[] {
  const byHash = new Map<string, HistoryItem>();
  for (const item of [...local, ...remote]) {
    const existing = byHash.get(item.hash);
    if (!existing || (existing.source === "local" && item.source === "indexer")) {
      byHash.set(item.hash, item);
    }
  }
  return [...byHash.values()].sort((left, right) => (right.timestampMs ?? 0) - (left.timestampMs ?? 0));
}

export function explainTransaction(tx: HistoryItem, viewer: string): string {
  const when = tx.timestampMs ? new Date(tx.timestampMs).toLocaleString() : "an unknown time";
  const fee = tx.feeYocto ? ` The network fee was about ${formatNear(BigInt(tx.feeYocto), 8)} NEAR.` : "";
  const status = tx.success === null ? "The explorer did not mark success or failure." : tx.success ? "It succeeded." : "It failed.";
  const source = tx.source === "local" ? " This record is from the receipt signed in this browser; the explorer may take a moment to index it." : "";
  const deposit = tx.depositYocto && tx.depositYocto !== "0" ? `${formatNear(BigInt(tx.depositYocto))} NEAR` : null;
  const actions = tx.actions.map(actionLabel);

  if (tx.signer === viewer && tx.actions.includes("TRANSFER")) {
    return `On ${when}, you sent ${deposit ?? "NEAR"} to ${tx.receiver}. It was a native transfer, signed in the browser after confirmation.${fee} ${status}${source}`;
  }
  if (tx.receiver === viewer && tx.signer !== viewer && tx.actions.includes("TRANSFER")) {
    return `On ${when}, ${tx.signer} sent ${deposit ?? "NEAR"} to you.${fee} ${status}${source}`;
  }
  if (tx.signer === viewer && tx.actions.includes("ADD_KEY")) {
    return `On ${when}, you added an access key on your own account. Vibe Wallet uses this to register a function-call key that cannot transfer NEAR.${fee} ${status}${source}`;
  }
  if (tx.signer === viewer && tx.actions.includes("FUNCTION_CALL")) {
    const method = tx.methods[0] ?? "a contract method";
    return `On ${when}, your account called ${method} on ${tx.receiver}. The scoped key can pay gas for an allowed call, and this was not a native NEAR transfer.${fee} ${status}${source}`;
  }
  const created = tx.signer !== viewer && tx.actions.includes("CREATE_ACCOUNT")
    ? ` The testnet faucet created this account and funded it with ${deposit ?? "some NEAR"}.`
    : "";
  return `On ${when}, ${tx.signer || "an account"} submitted ${actions.join(", ") || "a transaction"} to ${tx.receiver || "another account"}.${created}${fee} ${status}${source}`;
}
