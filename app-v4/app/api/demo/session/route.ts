import { explorerAccountUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { readBalance } from "@/lib/near/read";
import { formatNear } from "@/lib/units";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { visitorSpentToday } from "@/lib/server/demo-limits";
import { resolveVisitor, visitorSecret, withVisitorCookie } from "@/lib/server/visitor";
import { demoStoredPolicy } from "@/lib/server/policy";
import { loadState } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return session(request);
}

export async function POST(request: Request): Promise<Response> {
  return session(request);
}

// Opening the demo issues the visitor cookie, so later sends count against this visitor.
async function session(request: Request): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    const visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    const state = await loadState();
    const balance = await readBalance(secrets.accountId);
    const policy = demoStoredPolicy(secrets.recipientId, state.killed, state.allowlist.length ? state.allowlist : [secrets.recipientId]);
    return withVisitorCookie(Response.json({
      mode: "demo",
      network: "testnet",
      accountId: secrets.accountId,
      publicKey: secrets.publicKey || null,
      recipientId: secrets.recipientId,
      explorerUrl: explorerAccountUrl(secrets.accountId),
      recipientExplorerUrl: explorerAccountUrl(secrets.recipientId),
      availableNear: balance?.availableNear ?? "0",
      policy,
      spentTodayNear: formatNear(visitorSpentToday(state, visitor.key)),
      killed: state.killed,
      note: "This is a shared testnet demo account. The private key stays on the server and is never sent to the browser. Sends are capped per visitor, rate-limited, and allowlisted.",
    }), visitor);
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 500 });
  }
}
