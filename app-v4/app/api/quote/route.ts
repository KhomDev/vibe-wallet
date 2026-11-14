import { QUOTE_ASSETS, QUOTE_ONLY_LABEL, type QuoteSymbol } from "@/lib/assets";
import { INTENTS_API_URL } from "@/lib/config";
import { isValidAccountId, normalizeAccountId } from "@/lib/account-id";
import { formatUnits, parseUnits } from "@/lib/units";
import { clientIp } from "@/lib/server/env";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const limited = hit(`quote:${clientIp(request)}`, ROUTE_LIMITS.quote);
  if (!limited.ok) return tooMany(limited.retryAfterSec);
  let body: { accountId?: unknown; amountNear?: unknown; toSymbol?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON quote request." }, { status: 400 });
  }

  const accountId = typeof body.accountId === "string" ? normalizeAccountId(body.accountId) : "";
  const toSymbol = typeof body.toSymbol === "string" ? body.toSymbol.toUpperCase() : "";
  const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
  if (!isValidAccountId(accountId)) {
    return Response.json({ error: "A valid NEAR account id is required for the quote refund address." }, { status: 400 });
  }
  if (!(toSymbol in QUOTE_ASSETS) || toSymbol === "NEAR") {
    return Response.json({ error: "Choose USDT, USDC, or ETH." }, { status: 400 });
  }
  let amount: bigint;
  try {
    amount = parseUnits(amountNear, 24);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Invalid amount." }, { status: 400 });
  }
  if (amount <= 0n || amount > parseUnits("1000", 24)) {
    return Response.json({ error: "Quote an amount greater than 0 and at most 1000 NEAR." }, { status: 400 });
  }

  const destination = QUOTE_ASSETS[toSymbol as QuoteSymbol];
  const deadline = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const quoteRequest = {
    dry: true,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: QUOTE_ASSETS.NEAR.assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: destination.assetId,
    amount: amount.toString(),
    recipient: accountId,
    recipientType: "INTENTS",
    refundTo: accountId,
    refundType: "INTENTS",
    deadline,
  };

  try {
    const response = await fetch(`${INTENTS_API_URL.replace(/\/$/, "")}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(quoteRequest),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Intents quote failed (${response.status}).`;
      return Response.json({ error: String(message) }, { status: 502 });
    }
    const quote = payload.quote ?? {};
    const amountOut = BigInt(quote.amountOut ?? "0");
    const minAmountOut = BigInt(quote.minAmountOut ?? "0");
    return Response.json({
      dry: true,
      label: QUOTE_ONLY_LABEL,
      originSymbol: "NEAR",
      destinationSymbol: destination.symbol,
      amountInFormatted: String(quote.amountInFormatted ?? amountNear),
      amountOutFormatted: String(quote.amountOutFormatted ?? formatUnits(amountOut, destination.decimals)),
      minAmountOutFormatted: formatUnits(minAmountOut, destination.decimals),
      amountInUsd: String(quote.amountInUsd ?? ""),
      amountOutUsd: String(quote.amountOutUsd ?? ""),
      timeEstimate: Number(quote.timeEstimate ?? 0),
      originAsset: QUOTE_ASSETS.NEAR.assetId,
      destinationAsset: destination.assetId,
    });
  } catch {
    return Response.json({ error: "The NEAR Intents quote service was unreachable." }, { status: 502 });
  }
}
