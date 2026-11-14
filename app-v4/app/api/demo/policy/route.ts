import { isValidAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID } from "@/lib/config";
import { phraseMatches, toPolicy } from "@/lib/policy";
import { formatNear } from "@/lib/units";
import { checkAndBump, visitorSpentToday } from "@/lib/server/demo-limits";
import { authorizedOperator, clientIp, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json, readJsonBody } from "@/lib/server/http";
import { visitorPolicy } from "@/lib/server/policy";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";
import { AbortTransaction, LIMITS, pushLog, transact, withVisitor } from "@/lib/server/state";
import { resolveVisitor, visitorSecret } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { killed?: unknown; allow?: unknown; remove?: unknown; phrase?: unknown; global?: unknown };

/**
 * A visitor changes only their own settings: their stop switch and their extra allowlist entries.
 * Turning sending back on and adding a recipient need the confirm phrase; stopping and removing do
 * not. The global kill switch needs the operator secret (`Authorization: Bearer <CRON_SECRET>`).
 * A request that changes nothing writes nothing and signs nothing.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<Body>(request);
  if (!body) return json({ error: "Send a JSON body." }, { status: 400 });
  try {
    const secrets = getDemoSecrets();
    const ip = clientIp(request);
    const secret = visitorSecret(secrets.cronSecret || secrets.secretKey);

    if (body.global === true) {
      if (!authorizedOperator(request, secrets.cronSecret)) return json({ error: "Only the operator can change the global kill switch." }, { status: 401 });
      if (typeof body.killed !== "boolean") return json({ error: "Send killed: true or false." }, { status: 400 });
      const killed = body.killed;
      const { state } = await transact((current) => ({
        state: current.killed === killed ? current : pushLog({ ...current, killed }, {
          action: "info",
          owner: "system",
          reason: killed ? "Operator turned the global kill switch on. All demo sends and agent rules are stopped." : "Operator turned the global kill switch off.",
        }),
        result: undefined,
      }));
      return json({ globalKilled: state.killed });
    }

    const visitor = resolveVisitor(request, ip, secret);
    if (!visitor.fromCookie) return json({ error: "Open the demo first (Try a demo account), then change its settings." }, { status: 401 });
    const allowed = hit(`policy:${visitor.key}`, ROUTE_LIMITS.control);
    if (!allowed.ok) return tooMany(allowed.retryAfterSec);

    const allow = typeof body.allow === "string" ? resolveAccountInput(body.allow, NETWORK_ID) : null;
    const remove = typeof body.remove === "string" ? resolveAccountInput(body.remove, NETWORK_ID) : null;
    if (allow !== null && !isValidAccountId(allow)) return json({ error: "That allowlist entry is not a valid NEAR account id." }, { status: 400 });
    const killed = typeof body.killed === "boolean" ? body.killed : null;
    const phrase = typeof body.phrase === "string" ? body.phrase : null;

    const { state } = await transact((current) => {
      const before = visitorPolicy(current, secrets.recipientId, visitor.key);
      const stored = toPolicy(before);
      let next = current;
      const wantsResume = killed === false && current.visitors[visitor.key]?.stopped === true;
      const wantsAllow = allow !== null && !before.allowlist.includes(allow);
      if ((wantsResume || wantsAllow) && !phraseMatches(stored, phrase)) {
        throw new AbortTransaction(wantsResume ? "Type the confirm phrase to turn sending back on." : "Type the confirm phrase to add someone to your allowlist.", 403);
      }
      const changes = (killed !== null && killed !== Boolean(current.visitors[visitor.key]?.stopped)) || wantsAllow
        || (remove !== null && Boolean(current.visitors[visitor.key]?.allowlist.includes(remove)));
      if (!changes) return { state: current, result: undefined };
      const rate = checkAndBump(current, `policy:${visitor.key}`, 30);
      if (!rate.ok) throw new AbortTransaction("Too many settings changes this hour. Try again later.", 429);
      next = rate.state;
      if (killed !== null) {
        next = withVisitor(next, visitor.key, (record) => ({ ...record, stopped: killed }));
        next = pushLog(next, {
          action: "info",
          owner: visitor.key,
          reason: killed ? "You stopped sending. Your demo sends and agent rules will not run." : "You turned sending back on.",
        });
      }
      if (wantsAllow) {
        const list = current.visitors[visitor.key]?.allowlist ?? [];
        if (list.length >= LIMITS.visitorAllowlist) throw new AbortTransaction(`Your demo allowlist is full (${LIMITS.visitorAllowlist} entries). Remove one first.`, 403);
        next = withVisitor(next, visitor.key, (record) => ({ ...record, allowlist: [...record.allowlist, allow!] }));
      }
      if (remove !== null && remove !== secrets.recipientId) {
        next = withVisitor(next, visitor.key, (record) => ({ ...record, allowlist: record.allowlist.filter((id) => id !== remove) }));
      }
      return { state: next, result: undefined };
    });
    const policy = visitorPolicy(state, secrets.recipientId, visitor.key);
    return json({
      policy,
      killed: policy.killed,
      globalKilled: policy.globalKilled,
      stopped: policy.stopped,
      spentTodayNear: formatNear(visitorSpentToday(state, visitor.key)),
    });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
