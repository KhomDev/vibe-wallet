import type { StoredPolicy } from "./policy";

export type AllowlistEntry = {
  accountId: string;
  /** Short label for long implicit ids. */
  display: string;
  /** Per-recipient cap. There are no per-recipient overrides yet, so this is the per-send cap. */
  perSendNear: string;
  sendText: string;
};

export type AllowlistView = {
  entries: AllowlistEntry[];
  perTxNear: string;
  dailyNear: string;
  thresholdNear: string;
  allowlistOnly: boolean;
  killed: boolean;
  emptyHelp: string | null;
};

export const ALLOWLIST_SEND_AMOUNT = "0.1";

export function shortAccount(accountId: string): string {
  return /^[0-9a-f]{64}$/.test(accountId) ? `${accountId.slice(0, 8)}…${accountId.slice(-6)}` : accountId;
}

export function allowlistView(policy: StoredPolicy): AllowlistView {
  const unique = [...new Set(policy.allowlist.map((id) => id.trim()).filter(Boolean))];
  const entries = unique.map((accountId) => ({
    accountId,
    display: shortAccount(accountId),
    perSendNear: policy.perTxNear,
    sendText: `Send ${ALLOWLIST_SEND_AMOUNT} NEAR to ${accountId}`,
  }));
  return {
    entries,
    perTxNear: policy.perTxNear,
    dailyNear: policy.dailyNear,
    thresholdNear: policy.thresholdNear,
    allowlistOnly: policy.allowlistOnly,
    killed: policy.killed,
    emptyHelp: entries.length
      ? null
      : `No accounts yet. Say "allow name.testnet", or open the Wallet tab, find Safety, type an account under Allowlist, and tap Allow.${policy.allowlistOnly ? " Allowlist-only is on, so every send is blocked until you add one." : ""}`,
  };
}
