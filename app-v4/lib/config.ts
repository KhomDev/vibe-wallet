export const NETWORK_ID = "testnet";

export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://test.rpc.fastnear.com";

export const FAUCET_URL = "https://helper.testnet.near.org/account";

export const INTENTS_API_URL =
  process.env.INTENTS_API_URL || "https://1click.chaindefuser.com/v0";

export const NEAR_AI_BASE_URL =
  process.env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1";

// GLM-5.3-Flash is cheap, ready on NEAR AI Cloud, and fast enough for voice.
// It is a reasoning model; the intent route sets max_tokens and also parses
// reasoning_content so content is not dropped when the model thinks first.
export const NEAR_AI_MODEL = process.env.NEAR_AI_MODEL || "z-ai/glm-5.3-flash";

export const SCOPED_CONTRACT_ID = "wrap.testnet";

export const SCOPED_METHODS = ["ft_balance_of", "storage_balance_of"] as const;

export const SCOPED_CALL_METHOD = "storage_balance_of";

export const SCOPED_ALLOWANCE_NEAR = "0.05";

export const DEFAULT_STORED_POLICY = {
  perTxNear: "2",
  dailyNear: "5",
  thresholdNear: "0.5",
  confirmPhrase: "confirm send",
  allowlist: [] as string[],
  allowlistOnly: false,
  killed: false,
};

export function explorerTxUrl(hash: string): string {
  return `https://testnet.nearblocks.io/txns/${hash}`;
}

export function explorerAccountUrl(accountId: string): string {
  return `https://testnet.nearblocks.io/address/${accountId}`;
}

export function historyUrl(accountId: string): string {
  return `https://api-testnet.nearblocks.io/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=15`;
}
