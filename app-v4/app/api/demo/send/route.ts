import { isValidAccountId, normalizeAccountId } from "@/lib/account-id";
import { explorerTxUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { toPolicy } from "@/lib/policy";
import { formatNear, parseNear } from "@/lib/units";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { demoStoredPolicy } from "@/lib/server/policy";
import { bumpRate, checkRate } from "@/lib/server/rate-limit";
import { addSpent, loadState, pushLog, spentToday, updateState } from "@/lib/server/state";
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
  try {
    const secrets = getDemoSecrets();
    const recipient = typeof body.recipient === "string" ? normalizeAccountId(body.recipient) : "";
    const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
    const phrase = typeof body.phrase === "string" ? body.phrase : "";
    if (!isValidAccountId(recipient)) return Response.json({ error: "That recipient is not a valid NEAR account id." }, { status: 400 });
    parseNear(amountNear);

    let state = await loadState();
    const policy = toPolicy(demoStoredPolicy(secrets.recipientId, state.killed, state.allowlist.length ? state.allowlist : [secrets.recipientId]));
    const preview = await previewSend({
      accountId: secrets.accountId,
      recipient,
      amountNear,
      policy,
      spentTodayYocto: spentToday(state),
    });

    if (body.preview === true) {
      return Response.json({
        preview: true,
        recipient,
        amountNear,
        feeNear: formatNear(preview.feeYocto, 8),
        balanceAfterNear: formatNear(preview.after),
        check: preview.check,
        availableNear: preview.balance.availableNear,
        confirmPhrase: policy.confirmPhrase,
      });
    }

    if (preview.check.blockReason) {
      return Response.json({ error: preview.check.blockReason, check: preview.check, blocked: true }, { status: 403 });
    }

    const rate = checkRate(state, clientIp(request), secrets.cronSecret || secrets.accountId);
    if (!rate.ok) return Response.json({ error: rate.reason, blocked: true }, { status: 429 });

    const result = await executeDemoTransfer({
      accountId: secrets.accountId,
      secretKey: secrets.secretKey,
      expectedPublicKey: secrets.publicKey || undefined,
      recipient,
      amountNear,
      policy,
      spentTodayYocto: spentToday(state),
      userConfirmed: true,
      confirmationPhrase: phrase,
    });
    await updateState((current) => {
      let next = bumpRate(addSpent(current, preview.amountYocto), rate.key);
      return pushLog(next, {
        action: "transfer",
        reason: `Demo send of ${amountNear} NEAR to ${recipient}, confirmed in the app.`,
        hash: result.hash,
        explorerUrl: explorerTxUrl(result.hash),
      });
    });
    const { readBalance } = await import("@/lib/near/read");
    const balance = await readBalance(secrets.accountId);
    return Response.json({
      hash: result.hash,
      feeNear: formatNear(result.feeYocto, 8),
      explorerUrl: explorerTxUrl(result.hash),
      recipient,
      amountNear,
      availableNear: balance?.availableNear ?? null,
    });
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 400 });
  }
}
