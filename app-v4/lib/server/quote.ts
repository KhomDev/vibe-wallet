import { QUOTE_ASSETS, QUOTE_ONLY_LABEL, type QuoteSymbol } from "../assets";
import { INTENTS_API_URL } from "../config";
import { formatUnits, parseUnits } from "../units";
import type { QuoteView } from "../client";

export async function dryIntentsQuote(input: {
  accountId: string;
  amountNear: string;
  toSymbol: "USDC" | "USDT" | "ETH";
}): Promise<QuoteView> {
  const destination = QUOTE_ASSETS[input.toSymbol as QuoteSymbol];
  const amount = parseUnits(input.amountNear, 24);
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const response = await fetch(`${INTENTS_API_URL.replace(/\/$/, "")}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: QUOTE_ASSETS.NEAR.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount: amount.toString(),
      recipient: input.accountId,
      recipientType: "INTENTS",
      refundTo: input.accountId,
      refundType: "INTENTS",
      deadline,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(String(payload?.message || payload?.error || `Intents quote failed (${response.status}).`));
  }
  const quote = payload.quote ?? {};
  const amountOut = BigInt(quote.amountOut ?? "0");
  const minAmountOut = BigInt(quote.minAmountOut ?? "0");
  return {
    dry: true,
    label: QUOTE_ONLY_LABEL,
    originSymbol: "NEAR",
    destinationSymbol: destination.symbol,
    amountInFormatted: String(quote.amountInFormatted ?? input.amountNear),
    amountOutFormatted: String(quote.amountOutFormatted ?? formatUnits(amountOut, destination.decimals)),
    minAmountOutFormatted: formatUnits(minAmountOut, destination.decimals),
    amountInUsd: String(quote.amountInUsd ?? ""),
    amountOutUsd: String(quote.amountOutUsd ?? ""),
    timeEstimate: Number(quote.timeEstimate ?? 0),
  };
}

export async function nearUsdPrice(): Promise<number> {
  try {
    const response = await fetch("https://1click.chaindefuser.com/v0/tokens", { signal: AbortSignal.timeout(10_000) });
    const tokens = await response.json() as { assetId?: string; price?: number }[];
    const near = tokens.find((token) => token.assetId === "nep141:wrap.near");
    if (typeof near?.price === "number" && near.price > 0) return near.price;
  } catch {
    // fall through
  }
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=near&vs_currencies=usd", {
    signal: AbortSignal.timeout(10_000),
  });
  const json = await response.json() as { near?: { usd?: number } };
  const price = json.near?.usd;
  if (typeof price !== "number" || price <= 0) throw new Error("Could not read the NEAR market price.");
  return price;
}
