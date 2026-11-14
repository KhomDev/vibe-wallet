import { isValidAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID, explorerTxUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { toPolicy } from "@/lib/policy";
import { formatNear, parseNear } from "@/lib/units";
import { issueConfirmToken, verifyConfirmToken } from "@/lib/server/confirm-token";
import { checkDemoGate, releaseDemoSpend, reserveDemoSpend, visitorSpentToday, type Reservation } from "@/lib/server/demo-limits";
import { assertDemoNetwork, clientIp, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json, readJsonBody } from "@/lib/server/http";
import { visitorPolicy } from "@/lib/server/policy";
import { AbortTransaction, assertDurableState, loadState, pushLog, transact } from "@/lib/server/state";
import { executeDemoTransfer, previewSend, SendError } from "@/lib/server/transfer";
import { resolveVisitor, visitorSecret } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { recipient?: unknown; amountNear?: unknown; phrase?: unknown; preview?: unknown; confirmToken?: unknown };

/**
 * Two steps. `preview: true` checks the send and returns a confirmation token bound to this
 * visitor, recipient and amount. The send itself needs that token, and reserves the spend in the
 * same compare-and-swap write that re-checks every limit, before anything is signed.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody<Body>(request);
  if (!body) return json({ error: "Send a JSON body." }, { status: 400 });
  try {
    assertDurableState();
    await assertDemoNetwork();
    const secrets = getDemoSecrets();
    const secret = visitorSecret(secrets.cronSecret || secrets.secretKey);
    const visitor = resolveVisitor(request, clientIp(request), secret);
    const recipient = typeof body.recipient === "string" ? resolveAccountInput(body.recipient, NETWORK_ID) : "";
    const amountNear = typeof body.amountNear === "string" ? body.amountNear.trim() : "";
    const phrase = typeof body.phrase === "string" ? body.phrase : "";
    if (!isValidAccountId(recipient)) return json({ error: "That recipient is not a valid NEAR account id." }, { status: 400 });
    const amountYocto = parseNear(amountNear);

    const state = await loadState();
    const stored = visitorPolicy(state, secrets.recipientId, visitor.key);
    const policy = toPolicy(stored);
    const preview = await previewSend({
      accountId: secrets.accountId,
      recipient,
      amountNear,
      policy,
      spentTodayYocto: visitorSpentToday(state, visitor.key),
    });
    const spend = {
      visitorKey: visitor.key,
      ipKey: visitor.ipKey,
      amountYocto,
      feeYocto: preview.feeYocto,
      visitorDailyYocto: policy.dailyYocto,
    };

    if (body.preview === true) {
      const gate = checkDemoGate(state, spend);
      const check = !gate.ok && !preview.check.blockReason ? { ...preview.check, ok: false, blockReason: gate.reason } : preview.check;
      const token = check.blockReason ? null : issueConfirmToken(secret, { visitorKey: visitor.key, recipient, amountYocto });
      return json({
        preview: true,
        recipient,
        amountNear,
        feeNear: formatNear(preview.feeYocto, 8),
        balanceAfterNear: formatNear(preview.after),
        check,
        availableNear: preview.balance.availableNear,
        confirmPhrase: policy.confirmPhrase,
        confirmToken: token?.token ?? null,
        confirmExpiresAt: token?.expiresAt ?? null,
      });
    }

    if (preview.check.blockReason) {
      return json({ error: preview.check.blockReason, check: preview.check, blocked: true }, { status: 403 });
    }
    const token = verifyConfirmToken(secret, body.confirmToken, { visitorKey: visitor.key, recipient, amountYocto });
    if (!token.ok) return json({ error: token.reason, blocked: true, needsPreview: true }, { status: 409 });

    // Reserve: re-check every limit and the kill switches against the state being written, and
    // spend the token, all in one conditional write.
    const { result: reservation } = await transact<Reservation>((current) => {
      if (current.usedTokens[token.nonce]) throw new AbortTransaction("This confirmation was already used. Review the send again.", 409);
      const live = toPolicy(visitorPolicy(current, secrets.recipientId, visitor.key));
      if (live.killed) throw new AbortTransaction("Sending is stopped. Resume sending first.", 403);
      if (!live.allowlist.includes(recipient)) throw new AbortTransaction("Allowlist-only is on, and this recipient is not on it.", 403);
      const reserved = reserveDemoSpend(current, { ...spend, visitorDailyYocto: live.dailyYocto });
      return {
        state: { ...reserved.state, usedTokens: { ...reserved.state.usedTokens, [token.nonce]: token.expiresAt } },
        result: reserved.reservation,
      };
    });

    let result;
    try {
      result = await executeDemoTransfer({
        accountId: secrets.accountId,
        secretKey: secrets.secretKey,
        expectedPublicKey: secrets.publicKey || undefined,
        recipient,
        amountNear,
        policy,
        spentTodayYocto: BigInt(reservation.spentBeforeYocto),
        userConfirmed: true,
        confirmationPhrase: phrase,
      });
    } catch (err) {
      const certainNoMove = !(err instanceof SendError) || !err.broadcast || err.outcome === "failed";
      await transact((current) => {
        const next = certainNoMove ? releaseDemoSpend(current, reservation) : current;
        return {
          state: pushLog(next, {
            action: certainNoMove ? "blocked" : "info",
            owner: visitor.key,
            reason: certainNoMove
              ? `Demo send of ${amountNear} NEAR to ${recipient} was not sent: ${publicError(err)}`
              : `Demo send of ${amountNear} NEAR to ${recipient} has an unknown outcome; its spend stays counted.`,
            hash: err instanceof SendError ? err.hash : undefined,
          }),
          result: undefined,
        };
      }).catch(() => undefined);
      const status = certainNoMove ? 400 : 502;
      return json({ error: publicError(err), blocked: certainNoMove, hash: err instanceof SendError ? err.hash ?? null : null }, { status });
    }

    await transact((current) => ({
      state: pushLog(current, {
        action: "transfer",
        owner: visitor.key,
        reason: `Demo send of ${amountNear} NEAR to ${recipient}, confirmed in the app.`,
        hash: result.hash,
        explorerUrl: explorerTxUrl(result.hash),
      }),
      result: undefined,
    })).catch(() => undefined);
    const { readBalance } = await import("@/lib/near/read");
    const balance = await readBalance(secrets.accountId).catch(() => null);
    return json({
      hash: result.hash,
      feeNear: formatNear(result.feeYocto, 8),
      explorerUrl: explorerTxUrl(result.hash),
      recipient,
      amountNear,
      availableNear: balance?.availableNear ?? null,
      reconciled: result.reconciled,
    });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
