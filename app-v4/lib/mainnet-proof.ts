/** Real mainnet transactions produced by scripts/mainnet-proof.ts on 13 Nov 2026. */
export const MAINNET_PROOF = {
  account: "hlpok1lad.tg",
  send: {
    label: "0.01 NEAR transfer via the wallet signer (policy: allowlist-only, 0.05 NEAR per tx cap)",
    hash: "A4yAYiZCYoS5QD5m6bq8bchBcBYZdVP7eZbMCkEcEXyu",
  },
  swapWrap: {
    label: "Wrap 0.03 NEAR to wNEAR for the Intents deposit",
    hash: "8w76GGqBDSchTfpqrT8W5cGxvmNtu7uSzN4AaiMwoAVE",
  },
  swapDeposit: {
    label: "Executed NEAR Intents swap (1Click): 0.03 NEAR to 0.106562 USDC, status SUCCESS",
    hash: "AbmBP4bSxeoSS3eNZ6zvZmgD3stsXK1JdhaQqgTCMZv2",
  },
  swapSettlement: {
    label: "USDC delivered to the wallet on NEAR (destination tx)",
    hash: "8ZSc3Uhnif6NB9emVHtqv7iXXJW6kvZio5u2aMwkJw5c",
  },
} as const;

export function mainnetTxUrl(hash: string): string {
  return `https://nearblocks.io/txns/${hash}`;
}
