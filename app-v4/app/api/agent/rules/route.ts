import { isValidAccountId, normalizeAccountId } from "@/lib/account-id";
import { publicError } from "@/lib/errors";
import { parseNear } from "@/lib/units";
import { getDemoSecrets } from "@/lib/server/env";
import { loadState, pushLog, saveState, type AgentRule } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: {
    type?: unknown;
    amountNear?: unknown;
    recipient?: unknown;
    cadence?: unknown;
    belowUsd?: unknown;
    toSymbol?: unknown;
    deleteId?: unknown;
    enabled?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  try {
    const secrets = getDemoSecrets();
    let state = await loadState();
    if (typeof body.deleteId === "string") {
      state = { ...state, rules: state.rules.filter((rule) => rule.id !== body.deleteId) };
      state = pushLog(state, { action: "info", reason: `Removed agent rule ${body.deleteId}.` });
      state = await saveState(state);
      return Response.json({ rules: state.rules, logs: state.logs.slice(-40).reverse() });
    }

    const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
    parseNear(amountNear);
    if (state.rules.length >= 12) return Response.json({ error: "The demo agent already has 12 rules." }, { status: 400 });

    if (body.type === "schedule_send") {
      const cadence = body.cadence === "daily" ? "daily" : "weekly_friday";
      const recipient = typeof body.recipient === "string" && body.recipient.trim()
        ? normalizeAccountId(body.recipient)
        : secrets.recipientId;
      if (!isValidAccountId(recipient)) return Response.json({ error: "That recipient is not a valid NEAR account id." }, { status: 400 });
      const rule: AgentRule = {
        id: crypto.randomUUID(),
        type: "schedule_send",
        createdAt: new Date().toISOString(),
        enabled: body.enabled !== false,
        amountNear,
        recipient,
        cadence,
      };
      state = { ...state, rules: [...state.rules, rule] };
      state = pushLog(state, { action: "info", ruleId: rule.id, reason: `Added a ${cadence} send of ${amountNear} NEAR to ${recipient}.` });
      state = await saveState(state);
      return Response.json({ rule, rules: state.rules });
    }

    if (body.type === "price_rule") {
      const belowUsd = typeof body.belowUsd === "number" ? body.belowUsd : Number(body.belowUsd);
      if (!Number.isFinite(belowUsd) || belowUsd <= 0) return Response.json({ error: "Enter a positive USD threshold." }, { status: 400 });
      const toSymbol = body.toSymbol === "USDT" ? "USDT" : "USDC";
      const rule: AgentRule = {
        id: crypto.randomUUID(),
        type: "price_rule",
        createdAt: new Date().toISOString(),
        enabled: body.enabled !== false,
        amountNear,
        belowUsd,
        toSymbol,
      };
      state = { ...state, rules: [...state.rules, rule] };
      state = pushLog(state, {
        action: "info",
        ruleId: rule.id,
        reason: `Added a price rule: if NEAR drops below $${belowUsd}, quote a swap of ${amountNear} NEAR to ${toSymbol}. Quote only — Intents have no testnet execution.`,
      });
      state = await saveState(state);
      return Response.json({ rule, rules: state.rules });
    }

    return Response.json({ error: "Unknown rule type." }, { status: 400 });
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 400 });
  }
}
