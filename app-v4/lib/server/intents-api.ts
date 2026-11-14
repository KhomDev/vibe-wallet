import { QUOTE_ASSETS, type QuoteSymbol } from "../assets";
import { INTENTS_API_URL } from "../config";
import { formatUnits, parseUnits } from "../units";
import type { LiveQuote } from "../intents-swap-client";

function api(path: string): string {
  return `${INTENTS_API_URL.replace(/\/$/, "")}${path}`;
}

/** The exact request sent to 1Click for an executable quote. Exported for tests and the mainnet check. */
export function liveQuoteRequest(input: { accountId: string; amountYocto: bigint; toSymbol: QuoteSymbol; now?: number }) {
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: QUOTE_ASSETS.NEAR.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: QUOTE_ASSETS[input.toSymbol].assetId,
    amount: input.amountYocto.toString(),
    recipient: input.accountId,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.accountId,
    refundType: "ORIGIN_CHAIN",
    deadline: new Date((input.now ?? Date.now()) + 20 * 60 * 1000).toISOString(),
  };
}

/** Asks 1Click for an executable quote and maps it to the shape the client verifies. */
export async function fetchLiveQuote(input: { accountId: string; amountYocto: bigint; toSymbol: QuoteSymbol }): Promise<LiveQuote> {
  const request = liveQuoteRequest(input);
  const response = await fetch(api("/quote"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || payload?.error || `1Click quote failed (${response.status}).`));
  const quote = (payload?.quote ?? {}) as Record<string, unknown>;
  const echoed = (payload?.quoteRequest ?? request) as Record<string, unknown>;
  const destination = QUOTE_ASSETS[input.toSymbol];
  const amountOut = String(quote.amountOut ?? "0");
  const minAmountOut = String(quote.minAmountOut ?? "0");
  return {
    depositAddress: String(quote.depositAddress ?? ""),
    amountIn: String(quote.amountIn ?? ""),
    amountInFormatted: String(quote.amountInFormatted ?? formatUnits(input.amountYocto, 24)),
    amountOut,
    amountOutFormatted: String(quote.amountOutFormatted ?? formatUnits(BigInt(amountOut || "0"), destination.decimals)),
    minAmountOut,
    minAmountOutFormatted: formatUnits(BigInt(minAmountOut || "0"), destination.decimals),
    deadline: String(quote.deadline ?? echoed.deadline ?? ""),
    timeEstimate: Number(quote.timeEstimate ?? 0),
    originAsset: String(echoed.originAsset ?? ""),
    destinationAsset: String(echoed.destinationAsset ?? ""),
    recipient: String(echoed.recipient ?? ""),
    refundTo: String(echoed.refundTo ?? ""),
    toSymbol: input.toSymbol,
  };
}

export async function submitDepositTx(input: { txHash: string; depositAddress: string }): Promise<void> {
  await fetch(api("/deposit/submit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
}

export async function fetchSwapStatus(depositAddress: string): Promise<Record<string, unknown>> {
  const response = await fetch(api(`/status?depositAddress=${encodeURIComponent(depositAddress)}`), { signal: AbortSignal.timeout(20_000) });
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export function parseSwapAmount(raw: unknown, maxNear: string): bigint {
  const text = typeof raw === "string" ? raw.trim() : "";
  const amount = parseUnits(text, 24);
  if (amount <= 0n) throw new Error("Enter an amount greater than 0.");
  if (amount > parseUnits(maxNear, 24)) throw new Error(`Swaps from the app are capped at ${maxNear} NEAR.`);
  return amount;
}
