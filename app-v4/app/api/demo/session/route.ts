import { NETWORK_ID, explorerAccountUrl } from "@/lib/config";
import { readBalance } from "@/lib/near/read";
import { formatNear } from "@/lib/units";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { demoLimits, publicLimits, visitorSpentToday } from "@/lib/server/demo-limits";
import { errorResponse, json } from "@/lib/server/http";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";
import { visitorPolicy } from "@/lib/server/policy";
import { loadState } from "@/lib/server/state";
import { identifyVisitor, resolveVisitor, visitorSecret, withVisitorCookie } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only: never mints an id. */
export async function GET(request: Request): Promise<Response> {
  return session(request, false);
}

/** Opening the demo (POST) issues the visitor cookie, within the per-network mint limit. */
export async function POST(request: Request): Promise<Response> {
  return session(request, true);
}

async function session(request: Request, mint: boolean): Promise<Response> {
  try {
    const ip = clientIp(request);
    const allowed = hit(`session:${ip}`, ROUTE_LIMITS.control);
    if (!allowed.ok) return tooMany(allowed.retryAfterSec);
    const secrets = getDemoSecrets();
    const secret = visitorSecret(secrets.cronSecret || secrets.secretKey);
    const visitor = mint
      ? await identifyVisitor(request, ip, secret, demoLimits().mintsPerNetworkPerDay)
      : { ...resolveVisitor(request, ip, secret), minted: false, mintLimited: false };
    const [state, balance] = await Promise.all([loadState(), readBalance(secrets.accountId)]);
    const policy = visitorPolicy(state, secrets.recipientId, visitor.key);
    return withVisitorCookie(json({
      mode: "demo",
      network: NETWORK_ID,
      accountId: secrets.accountId,
      publicKey: secrets.publicKey || null,
      recipientId: secrets.recipientId,
      explorerUrl: explorerAccountUrl(secrets.accountId),
      recipientExplorerUrl: explorerAccountUrl(secrets.recipientId),
      availableNear: balance?.availableNear ?? "0",
      policy,
      spentTodayNear: formatNear(visitorSpentToday(state, visitor.key)),
      killed: policy.killed,
      globalKilled: policy.globalKilled,
      stopped: policy.stopped,
      identified: visitor.fromCookie || visitor.minted,
      limits: publicLimits(),
      note: visitor.mintLimited
        ? "This network opened many demo sessions today, so this one shares the network's limits."
        : "This is a shared testnet demo account. The private key stays on the server and is never sent to the browser. Sends are allowlisted, capped per visitor and per network, rate-limited, and reserved before signing.",
    }), visitor);
  } catch (err) {
    return errorResponse(err, 500);
  }
}
