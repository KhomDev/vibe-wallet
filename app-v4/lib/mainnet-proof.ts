/** Real mainnet transactions: the signer send (13 Nov 2026) and the latest executed Intents swap (14 Nov 2026). */
export const MAINNET_PROOF = {
  account: "hlpok1lad.tg",
  send: {
    label: "0.01 NEAR transfer via the wallet signer (policy: allowlist-only, 0.05 NEAR per tx cap)",
    hash: "A4yAYiZCYoS5QD5m6bq8bchBcBYZdVP7eZbMCkEcEXyu",
  },
  swapWrap: {
    label: "Wrap 0.03 NEAR to wNEAR for the Intents deposit",
    hash: "3jTvJQ3HdQiv7E7FwqK73XuNQucLv1n9qMjvnrvfLKKQ",
  },
  swapDeposit: {
    label: "Executed NEAR Intents swap (1Click), 14 Nov: 0.03 NEAR to 0.09625 USDC, status SUCCESS",
    hash: "FycVpzvC4whBX41S6zBAxuQeVsFjxgcXxrdDio6frUg",
  },
  swapSettlement: {
    label: "USDC delivered to the wallet on NEAR (destination tx)",
    hash: "5dPep7P6Z2vZCr2RQxoEeGQykBnNs2KgEGm7SkYfPR9c",
  },
} as const;

export function mainnetTxUrl(hash: string): string {
  return `https://nearblocks.io/txns/${hash}`;
}
