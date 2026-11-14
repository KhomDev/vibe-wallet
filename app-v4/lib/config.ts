export type NetworkId = "testnet" | "mainnet";

/**
 * Testnet is the default for the app and the shared demo. Mainnet is opt-in:
 * set NEXT_PUBLIC_NEAR_NETWORK=mainnet (or NEAR_NETWORK=mainnet for server
 * scripts such as scripts/mainnet-proof.ts). Anything else means testnet.
 */
export function resolveNetwork(raw: string | undefined): NetworkId {
  return String(raw || "").trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

export const NETWORK_ID: NetworkId = resolveNetwork(
  process.env.NEXT_PUBLIC_NEAR_NETWORK || process.env.NEAR_NETWORK,
);

export const IS_MAINNET = NETWORK_ID === "mainnet";

export const DEFAULT_RPC: Record<NetworkId, string> = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
};

export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL || DEFAULT_RPC[NETWORK_ID];

/** Human label for the network, used in UI copy ("NEAR mainnet" / "NEAR testnet"). */
export const NETWORK_LABEL = `NEAR ${NETWORK_ID}`;

/** An example account name for this network, for placeholders and suggestion chips. */
export const EXAMPLE_ACCOUNT = IS_MAINNET ? "bob.near" : "bob.testnet";

/**
 * Optional link to a free testnet build with the shared demo account. A mainnet build has no shared
 * demo (anonymous visitors never spend real NEAR), so it can point visitors here instead.
 */
export const TESTNET_DEMO_URL = (process.env.NEXT_PUBLIC_TESTNET_DEMO_URL || "").trim();

export const FAUCET_URL = "https://helper.testnet.near.org/account";

export const INTENTS_API_URL =
  process.env.INTENTS_API_URL || "https://1click.chaindefuser.com/v0";

export const NEAR_AI_BASE_URL =
  process.env.NEAR_AI_BASE_URL || "https://cloud-api.near.ai/v1";

// GLM-5.3-Flash is cheap, ready on NEAR AI Cloud, and fast enough for voice.
// It is a reasoning model; the intent route sets max_tokens and also parses
// reasoning_content so content is not dropped when the model thinks first.
export const NEAR_AI_MODEL = process.env.NEAR_AI_MODEL || "z-ai/glm-5.3-flash";

export const NEAR_AI_STT_MODEL = process.env.NEAR_AI_STT_MODEL || "openai/whisper-large-v3";

export const SCOPED_CONTRACT_ID = IS_MAINNET ? "wrap.near" : "wrap.testnet";

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

/**
 * TriagePay policy wallet whose limits are enforced on chain by its contract. The Wallet tab reads
 * it live (view calls only). Defaults: the TriagePay mainnet campaign wallet and the testnet review
 * wallet. See https://github.com/KhomDev/TriagePay.
 */
export const POLICY_WALLET_ID = process.env.NEXT_PUBLIC_POLICY_WALLET_ID
  || (IS_MAINNET ? "tp-wallet.hlpok1lad.tg" : "tpd-e947e7-wallet.testnet");
export const POLICY_AGENT_ID = process.env.NEXT_PUBLIC_POLICY_AGENT_ID
  || (IS_MAINNET ? "tp-agent2.hlpok1lad.tg" : "tpd-e947e7-agent.testnet");

/** Hard ceiling for one executed Intents swap, on top of the user's own per-send limit. */
export const SWAP_MAX_NEAR = process.env.NEXT_PUBLIC_SWAP_MAX_NEAR || "1";

export const WRAP_CONTRACT_ID = IS_MAINNET ? "wrap.near" : "wrap.testnet";

const EXPLORER: Record<NetworkId, string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

const INDEXER: Record<NetworkId, string> = {
  testnet: "https://api-testnet.nearblocks.io",
  mainnet: "https://api.nearblocks.io",
};

export function explorerTxUrl(hash: string, network: NetworkId = NETWORK_ID): string {
  return `${EXPLORER[network]}/txns/${hash}`;
}

export function explorerAccountUrl(accountId: string, network: NetworkId = NETWORK_ID): string {
  return `${EXPLORER[network]}/address/${accountId}`;
}

export function historyUrl(accountId: string, network: NetworkId = NETWORK_ID): string {
  return `${INDEXER[network]}/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=15`;
}
