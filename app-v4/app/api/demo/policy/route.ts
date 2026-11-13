import { isValidAccountId, normalizeAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { formatNear } from "@/lib/units";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { demoStoredPolicy } from "@/lib/server/policy";
import { pushLog, updateState } from "@/lib/server/state";
import { visitorSpentToday } from "@/lib/server/demo-limits";
import { resolveVisitor, visitorSecret, withVisitorCookie } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { killed?: unknown; allow?: unknown; remove?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  try {
    const secrets = getDemoSecrets();
    if (typeof body.allow === "string" && !isValidAccountId(resolveAccountInput(body.allow, NETWORK_ID))) {
      return Response.json({ error: "That allowlist entry is not a valid NEAR account id." }, { status: 400 });
    }
    const state = await updateState((current) => {
      let state = current;
      if (typeof body.killed === "boolean") {
        state = { ...state, killed: body.killed };
        state = pushLog(state, {
          action: "info",
          reason: body.killed
            ? "Kill switch turned on. Demo sends and the agent are stopped."
            : "Kill switch turned off. Demo sends and the agent may run again.",
        });
      }
      const allowlist = state.allowlist.length ? [...state.allowlist] : [secrets.recipientId];
      if (typeof body.allow === "string") {
        const id = resolveAccountInput(body.allow, NETWORK_ID);
        if (!allowlist.includes(id)) allowlist.push(id);
        state = { ...state, allowlist };
      }
      if (typeof body.remove === "string") {
        const id = normalizeAccountId(body.remove);
        state = { ...state, allowlist: allowlist.filter((item) => item !== id && item !== secrets.recipientId) };
      }
      return state;
    });
    const policy = demoStoredPolicy(secrets.recipientId, state.killed, state.allowlist.length ? state.allowlist : [secrets.recipientId]);
    const visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    return withVisitorCookie(Response.json({
      policy,
      killed: state.killed,
      spentTodayNear: formatNear(visitorSpentToday(state, visitor.key)),
    }), visitor);
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 400 });
  }
}
