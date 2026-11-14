import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A demo send needs a confirmation token from its own preview. The token is an HMAC over
// (visitor, recipient, amount, expiry, nonce), so it cannot be forged, cannot be reused for a
// different recipient or amount, and cannot be obtained cross-site (a cross-origin page cannot read
// the preview response). Each nonce is accepted once: the send route records it in the same write
// that reserves the spend.
const TTL_MS = 5 * 60 * 1000;

function mac(secret: string, parts: string[]): string {
  return createHmac("sha256", `confirm-token:v1:${secret}`).update(parts.join("|")).digest("base64url").slice(0, 32);
}

export type TokenClaims = { visitorKey: string; recipient: string; amountYocto: bigint };

export function issueConfirmToken(secret: string, claims: TokenClaims, now = Date.now()): { token: string; expiresAt: number } {
  const expiresAt = now + TTL_MS;
  const nonce = randomBytes(12).toString("base64url");
  const sig = mac(secret, [claims.visitorKey, claims.recipient, claims.amountYocto.toString(), String(expiresAt), nonce]);
  return { token: `${expiresAt}.${nonce}.${sig}`, expiresAt };
}

export type TokenCheck = { ok: true; nonce: string; expiresAt: number } | { ok: false; reason: string };

export function verifyConfirmToken(secret: string, token: unknown, claims: TokenClaims, now = Date.now()): TokenCheck {
  if (typeof token !== "string" || token.length > 120) return { ok: false, reason: "This send has no confirmation from its preview. Review it again, then slide." };
  const [exp, nonce, sig, extra] = token.split(".");
  const expiresAt = Number(exp);
  if (!exp || !nonce || !sig || extra !== undefined || !Number.isSafeInteger(expiresAt) || !/^[A-Za-z0-9_-]{16}$/.test(nonce)) {
    return { ok: false, reason: "This send's confirmation is malformed. Review it again, then slide." };
  }
  const expected = Buffer.from(mac(secret, [claims.visitorKey, claims.recipient, claims.amountYocto.toString(), exp, nonce]));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "This confirmation does not match this recipient, amount or visitor. Review the send again." };
  }
  if (expiresAt <= now) return { ok: false, reason: "This confirmation expired. Review the send again, then slide." };
  return { ok: true, nonce, expiresAt };
}
