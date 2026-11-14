import { isValidAccountId } from "@/lib/account-id";
import { IS_MAINNET } from "@/lib/config";
import { clientIp } from "@/lib/server/env";
import { json, readJsonBody } from "@/lib/server/http";
import { submitDepositTx } from "@/lib/server/intents-api";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells 1Click which transaction paid the deposit address, so the swap starts sooner. Optional. */
export async function POST(request: Request): Promise<Response> {
  if (!IS_MAINNET) return json({ error: "Executed swaps run on mainnet only." }, { status: 400 });
  const limited = hit(`intents-submit:${clientIp(request)}`, ROUTE_LIMITS.quote);
  if (!limited.ok) return tooMany(limited.retryAfterSec);
  const body = await readJsonBody<{ txHash?: unknown; depositAddress?: unknown }>(request);
  const txHash = typeof body?.txHash === "string" ? body.txHash : "";
  const depositAddress = typeof body?.depositAddress === "string" ? body.depositAddress : "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash) || !isValidAccountId(depositAddress)) {
    return json({ error: "Send a transaction hash and a deposit address." }, { status: 400 });
  }
  try {
    await submitDepositTx({ txHash, depositAddress });
    return json({ ok: true });
  } catch {
    // 1Click also detects deposits by itself; a failed notification does not lose the swap.
    return json({ ok: false });
  }
}
