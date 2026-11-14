import { isValidAccountId, normalizeAccountId } from "@/lib/account-id";
import { QUOTE_ASSETS, type QuoteSymbol } from "@/lib/assets";
import { IS_MAINNET, SWAP_MAX_NEAR } from "@/lib/config";
import { clientIp } from "@/lib/server/env";
import { errorResponse, json, readJsonBody } from "@/lib/server/http";
import { fetchLiveQuote, parseSwapAmount } from "@/lib/server/intents-api";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Executable NEAR Intents quote (dry: false) for the swap confirm card. Mainnet builds only: on
 * testnet, Intents has no execution and the app shows dry quotes. The quote delivers to, and
 * refunds, the requesting account; the browser verifies that before anything is signed. This route
 * signs nothing and holds no key.
 */
export async function POST(request: Request): Promise<Response> {
  if (!IS_MAINNET) {
    return json({ error: "Executed swaps run on mainnet only. This deployment is testnet, so swaps are quotes." }, { status: 400 });
  }
  const limited = hit(`live-quote:${clientIp(request)}`, ROUTE_LIMITS.quote);
  if (!limited.ok) return tooMany(limited.retryAfterSec);
  const body = await readJsonBody<{ accountId?: unknown; amountNear?: unknown; toSymbol?: unknown }>(request);
  if (!body) return json({ error: "Send a JSON body." }, { status: 400 });
  try {
    const accountId = typeof body.accountId === "string" ? normalizeAccountId(body.accountId) : "";
    if (!isValidAccountId(accountId)) return json({ error: "A valid NEAR account id is required." }, { status: 400 });
    const toSymbol = typeof body.toSymbol === "string" ? body.toSymbol.toUpperCase() : "";
    if (!(toSymbol in QUOTE_ASSETS) || toSymbol === "NEAR") return json({ error: "Choose USDT, USDC, or ETH." }, { status: 400 });
    const amountYocto = parseSwapAmount(body.amountNear, process.env.SWAP_MAX_NEAR || SWAP_MAX_NEAR);
    const quote = await fetchLiveQuote({ accountId, amountYocto, toSymbol: toSymbol as QuoteSymbol });
    return json({ quote });
  } catch (err) {
    return errorResponse(err, 502);
  }
}
