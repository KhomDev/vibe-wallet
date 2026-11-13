export const QUOTE_ASSETS = {
  NEAR: {
    symbol: "NEAR",
    assetId: "nep141:wrap.near",
    decimals: 24,
  },
  USDT: {
    symbol: "USDT",
    assetId: "nep141:usdt.tether-token.near",
    decimals: 6,
  },
  USDC: {
    symbol: "USDC",
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    decimals: 6,
  },
  ETH: {
    symbol: "ETH",
    assetId: "nep141:eth.bridge.near",
    decimals: 18,
  },
} as const;

export type QuoteSymbol = keyof Omit<typeof QUOTE_ASSETS, "NEAR">;

export const QUOTE_ONLY_LABEL =
  "QUOTE ONLY. NEAR Intents execution is mainnet-only. This is a dry quote: no deposit address was created and nothing was signed or sent.";
