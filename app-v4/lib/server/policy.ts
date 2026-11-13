import type { StoredPolicy } from "../policy";

export const DEMO_POLICY_DEFAULTS: Omit<StoredPolicy, "allowlist" | "killed"> = {
  perTxNear: "0.3",
  dailyNear: "2",
  thresholdNear: "0.05",
  confirmPhrase: "confirm send",
  allowlistOnly: true,
};

export function demoStoredPolicy(recipientId: string, killed: boolean, allowlist: string[]): StoredPolicy {
  const allowed = allowlist.length ? allowlist : [recipientId];
  if (!allowed.includes(recipientId)) allowed.unshift(recipientId);
  return {
    ...DEMO_POLICY_DEFAULTS,
    allowlist: allowed,
    killed,
  };
}
