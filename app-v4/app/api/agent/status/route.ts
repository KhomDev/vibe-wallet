import { formatNear } from "@/lib/units";
import { ownedRules, visibleLogs } from "@/lib/server/agent";
import { visitorSpentToday } from "@/lib/server/demo-limits";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json } from "@/lib/server/http";
import { visitorPolicy } from "@/lib/server/policy";
import { loadState } from "@/lib/server/state";
import { resolveVisitor, visitorSecret } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's own agent rules and log. Other visitors' rules and recipients are not shown. */
export async function GET(request: Request): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    const visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    if (!visitor.fromCookie) return json({ error: "Open the demo first (Try a demo account) to see the agent." }, { status: 401 });
    const state = await loadState();
    const policy = visitorPolicy(state, secrets.recipientId, visitor.key);
    return json({
      killed: policy.killed,
      globalKilled: policy.globalKilled,
      stopped: policy.stopped,
      spentTodayNear: formatNear(visitorSpentToday(state, visitor.key)),
      rules: ownedRules(state, visitor.key),
      logs: visibleLogs(state, visitor.key),
      updatedAt: state.updatedAt,
    });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
