import { isValidAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID } from "@/lib/config";
import { explorerTxUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { toPolicy } from "@/lib/policy";
import { formatNear, parseNear } from "@/lib/units";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { demoStoredPolicy } from "@/lib/server/policy";
import { checkDemoGate, recordDemoSend, visitorSpentToday } from "@/lib/server/demo-limits";
import { loadState, pushLog, updateState } from "@/lib/server/state";
import { resolveVisitor, visitorSecret, withVisitorCookie } from "@/lib/server/visitor";
import { executeDemoTransfer, previewSend } from "@/lib/server/transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { recipient?: unknown; amountNear?: unknown; phrase?: unknown; preview?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a JSON body." }, { status: 400 });
  }
  let visitor: ReturnType<typeof resolveVisitor> | null = null;
  const reply = (data: unknown, init?: ResponseInit) => {
    const response = Response.json(data, init);
    return visitor ? withVisitorCookie(response, visitor) : response;
  };
  try {
    const secrets = getDemoSecrets();
    visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    const recipient = typeof body.recipient === "string" ? resolveAccountInput(body.recipient, NETWORK_ID) : "";
    const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
    const phrase = typeof body.phrase === "string" ? body.phrase : "";
    if (!isValidAccountId(recipient)) return reply({ error: "That recipient is not a valid NEAR account id." }, { status: 400 });
    parseNear(amountNear);

    const state = await loadState();
    const policy = toPolicy(demoStoredPolicy(secrets.recipientId, state.killed, state.allowlist.length ? state.allowlist : [secrets.recipientId]));
    const preview = await previewSend({
      accountId: secrets.accountId,
      recipient,
      amountNear,
      policy,
      // The 2 NEAR daily limit in the policy applies per visitor.
      spentTodayYocto: visitorSpentToday(state, visitor.key),
    });
    const gate = checkDemoGate(state, visitor.key, visitor.ipKey, preview.amountYocto);

    if (body.preview === true) {
      const check = !gate.ok && !preview.check.blockReason ? { ...preview.check, blockReason: gate.reason } : preview.check;
      return reply({
        preview: true,
        recipient,
        amountNear,
        feeNear: formatNear(preview.feeYocto, 8),
        balanceAfterNear: formatNear(preview.after),
        check,
        availableNear: preview.balance.availableNear,
        confirmPhrase: policy.confirmPhrase,
      });
    }

    if (preview.check.blockReason) {
      return reply({ error: preview.check.blockReason, check: preview.check, blocked: true }, { status: 403 });
    }
    if (!gate.ok) return reply({ error: gate.reason, blocked: true }, { status: gate.status });

    const result = await executeDemoTransfer({
      accountId: secrets.accountId,
      secretKey: secrets.secretKey,
      expectedPublicKey: secrets.publicKey || undefined,
      recipient,
      amountNear,
      policy,
      spentTodayYocto: visitorSpentToday(state, visitor.key),
      userConfirmed: true,
      confirmationPhrase: phrase,
    });
    await updateState((current) => {
      const next = recordDemoSend(current, visitor!.key, visitor!.ipKey, preview.amountYocto);
      return pushLog(next, {
        action: "transfer",
        reason: `Demo send of ${amountNear} NEAR to ${recipient}, confirmed in the app.`,
        hash: result.hash,
        explorerUrl: explorerTxUrl(result.hash),
      });
    });
    const { readBalance } = await import("@/lib/near/read");
    const balance = await readBalance(secrets.accountId);
    return reply({
      hash: result.hash,
      feeNear: formatNear(result.feeYocto, 8),
      explorerUrl: explorerTxUrl(result.hash),
      recipient,
      amountNear,
      availableNear: balance?.availableNear ?? null,
    });
  } catch (err) {
    return reply({ error: publicError(err) }, { status: 400 });
  }
}
