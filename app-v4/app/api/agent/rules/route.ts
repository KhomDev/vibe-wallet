import { isValidAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID } from "@/lib/config";
import { toPolicy } from "@/lib/policy";
import { parseNear } from "@/lib/units";
import { AGENT_RULES_PER_VISITOR, AGENT_RULES_TOTAL } from "@/lib/server/agent-keys";
import { ownedRules, visibleLogs } from "@/lib/server/agent";
import { checkAndBump } from "@/lib/server/demo-limits";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json, readJsonBody } from "@/lib/server/http";
import { visitorPolicy } from "@/lib/server/policy";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";
import { AbortTransaction, pushLog, transact, type AgentRule } from "@/lib/server/state";
import { resolveVisitor, visitorSecret } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  type?: unknown;
  amountNear?: unknown;
  recipient?: unknown;
  cadence?: unknown;
  belowUsd?: unknown;
  toSymbol?: unknown;
  deleteId?: unknown;
};

/**
 * Agent rules belong to the demo visitor who created them (signed cookie). A visitor can list,
 * add and delete only their own rules, a scheduled payment can only go to a recipient on that
 * visitor's allowlist, and every payment the rule makes counts against that visitor's limits.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<Body>(request);
  if (!body) return json({ error: "Send a JSON body." }, { status: 400 });
  try {
    const secrets = getDemoSecrets();
    const visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    if (!visitor.fromCookie) return json({ error: "Open the demo first (Try a demo account) to use the agent." }, { status: 401 });
    const allowed = hit(`rules:${visitor.key}`, ROUTE_LIMITS.control);
    if (!allowed.ok) return tooMany(allowed.retryAfterSec);

    if (typeof body.deleteId === "string") {
      const id = body.deleteId;
      const { state } = await transact((current) => {
        const rule = current.rules.find((item) => item.id === id);
        if (!rule || rule.owner !== visitor.key) return { state: current, result: undefined };
        return {
          state: pushLog({ ...current, rules: current.rules.filter((item) => item.id !== id) }, { action: "info", owner: visitor.key, ruleId: id, reason: "Removed an agent rule." }),
          result: undefined,
        };
      });
      return json({ rules: ownedRules(state, visitor.key), logs: visibleLogs(state, visitor.key) });
    }

    const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
    const amountYocto = parseNear(amountNear);
    if (amountYocto <= 0n) return json({ error: "Enter an amount greater than zero." }, { status: 400 });

    let rule: AgentRule;
    if (body.type === "schedule_send") {
      const cadence = body.cadence === "daily" ? "daily" : "weekly_friday";
      const recipient = typeof body.recipient === "string" && body.recipient.trim()
        ? resolveAccountInput(body.recipient, NETWORK_ID)
        : secrets.recipientId;
      if (!isValidAccountId(recipient)) return json({ error: "That recipient is not a valid NEAR account id." }, { status: 400 });
      rule = { id: crypto.randomUUID(), type: "schedule_send", createdAt: new Date().toISOString(), enabled: true, amountNear, recipient, cadence, owner: visitor.key, ownerNet: visitor.ipKey };
    } else if (body.type === "price_rule") {
      const belowUsd = typeof body.belowUsd === "number" ? body.belowUsd : Number(body.belowUsd);
      if (!Number.isFinite(belowUsd) || belowUsd <= 0 || belowUsd > 1_000_000) return json({ error: "Enter a positive USD threshold." }, { status: 400 });
      const toSymbol = body.toSymbol === "USDT" ? "USDT" : "USDC";
      rule = { id: crypto.randomUUID(), type: "price_rule", createdAt: new Date().toISOString(), enabled: true, amountNear, belowUsd, toSymbol, owner: visitor.key, ownerNet: visitor.ipKey };
    } else {
      return json({ error: "Unknown rule type." }, { status: 400 });
    }

    const { state } = await transact((current) => {
      const policy = toPolicy(visitorPolicy(current, secrets.recipientId, visitor.key));
      if (rule.type === "schedule_send") {
        if (!policy.allowlist.includes(rule.recipient!)) throw new AbortTransaction("Scheduled payments can only go to someone on your allowlist. Add them first.", 403);
        if (amountYocto > policy.perTxYocto) throw new AbortTransaction("That is above the demo's 0.3 NEAR per-send limit.", 403);
      }
      if (ownedRules(current, visitor.key).length >= AGENT_RULES_PER_VISITOR) throw new AbortTransaction(`You can have at most ${AGENT_RULES_PER_VISITOR} agent rules in the demo. Remove one first.`, 403);
      if (current.rules.length >= AGENT_RULES_TOTAL) throw new AbortTransaction("The demo agent is full right now. Try again later.", 429);
      const rate = checkAndBump(current, `rules:${visitor.key}`, 20);
      if (!rate.ok) throw new AbortTransaction("Too many rule changes this hour. Try again later.", 429);
      const reason = rule.type === "schedule_send"
        ? `Added a ${rule.cadence === "daily" ? "daily" : "Friday"} send of ${rule.amountNear} NEAR to ${rule.recipient}.`
        : `Added a price rule: if NEAR drops below $${rule.belowUsd}, quote a swap of ${rule.amountNear} NEAR to ${rule.toSymbol}. Quote only.`;
      return { state: pushLog({ ...rate.state, rules: [...rate.state.rules, rule] }, { action: "info", owner: visitor.key, ruleId: rule.id, reason }), result: undefined };
    });
    return json({ rule, rules: ownedRules(state, visitor.key) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
