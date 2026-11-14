import { isValidAccountId } from "@/lib/account-id";
import { IS_MAINNET } from "@/lib/config";
import { clientIp } from "@/lib/server/env";
import { json } from "@/lib/server/http";
import { fetchSwapStatus } from "@/lib/server/intents-api";
import { hit, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status of a swap by its deposit address: PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED. */
export async function GET(request: Request): Promise<Response> {
  if (!IS_MAINNET) return json({ error: "Executed swaps run on mainnet only." }, { status: 400 });
  const limited = hit(`intents-status:${clientIp(request)}`, [{ max: 60, windowMs: 60_000 }]);
  if (!limited.ok) return tooMany(limited.retryAfterSec);
  const depositAddress = new URL(request.url).searchParams.get("depositAddress") || "";
  if (!isValidAccountId(depositAddress)) return json({ error: "Send a deposit address." }, { status: 400 });
  try {
    const status = await fetchSwapStatus(depositAddress);
    return json({ status: status.status ?? "UNKNOWN", swapDetails: status.swapDetails ?? null, updatedAt: status.updatedAt ?? null });
  } catch {
    return json({ status: "UNKNOWN" }, { status: 502 });
  }
}
