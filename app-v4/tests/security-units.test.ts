// Unit checks for the 2026-11-14 remediation. IDs refer to docs/SECURITY-REVIEW-2026-11-14.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkApiRequest } from "../lib/request-guard";
import { canonicalIp, clientIp, authorizedCron } from "../lib/server/env";
import { issueConfirmToken, verifyConfirmToken } from "../lib/server/confirm-token";
import { assertNoSecret, looksLikeSecret, publicError } from "../lib/errors";
import { decryptSecret, encryptSecret, passphraseProblem, vaultContext, V2_ITERATIONS } from "../lib/vault";
import { normalizePhrase, phraseMatches, toPolicy, defaultStoredPolicy, validPhrase } from "../lib/policy";
import { isValidAccountId, normalizeAccountId, resolveAccountInput } from "../lib/account-id";
import { acceptModelIntent, mentionsAccount, mentionsAmount, parseIntent } from "../lib/intent";
import { isAffirmative, isNegative } from "../lib/handsfree";
import { hit, resetRateLimits } from "../lib/server/rate-limit";
import { loosens } from "../components/SafetyPanel";

const post = (overrides: Partial<Parameters<typeof checkApiRequest>[0]>) => checkApiRequest({
  method: "POST",
  pathname: "/api/demo/send",
  host: "vibe-wallet-flame.vercel.app",
  origin: "https://vibe-wallet-flame.vercel.app",
  secFetchSite: "same-origin",
  contentType: "application/json",
  ...overrides,
});

test("VW-WEB-03: cross-site and non-JSON state-changing requests are rejected", () => {
  assert.equal(post({}).ok, true);
  assert.equal(post({ secFetchSite: "cross-site" }).ok, false);
  assert.equal(post({ secFetchSite: "same-site" }).ok, false);
  assert.equal(post({ origin: "https://evil.example", secFetchSite: null }).ok, false);
  assert.equal(post({ origin: "null", secFetchSite: null }).ok, false);
  const plain = post({ contentType: "text/plain" });
  assert.equal(plain.ok, false);
  if (!plain.ok) assert.equal(plain.status, 415);
  assert.equal(post({ pathname: "/api/transcribe", contentType: "multipart/form-data; boundary=x" }).ok, true);
  assert.equal(post({ pathname: "/api/transcribe", contentType: "text/plain" }).ok, false);
  assert.equal(post({ method: "GET", origin: "https://evil.example" }).ok, true, "reads are not blocked");
  assert.equal(post({ pathname: "/api/cron/agent", origin: null, secFetchSite: null, contentType: null }).ok, true, "cron uses its bearer secret");
  assert.equal(post({ origin: null, secFetchSite: null }).ok, true, "non-browser clients without Origin are allowed (CSRF needs a browser)");
});

test("VW-DEMO-07: client IP comes from the platform header on Vercel and the right-most hop elsewhere", () => {
  const request = (headers: Record<string, string>) => new Request("https://x.test", { headers });
  const previous = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    assert.equal(clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })), "203.0.113.9");
    process.env.VERCEL = "1";
    assert.equal(clientIp(request({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" })), "198.51.100.4");
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
  assert.equal(canonicalIp("2001:db8:abcd:12:1:2:3:4"), "2001:0db8:abcd:0012::/64");
  assert.equal(canonicalIp("2001:db8:abcd:12::99"), "2001:0db8:abcd:0012::/64", "one /64 is one network");
  assert.equal(canonicalIp("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(canonicalIp("192.0.2.1:443"), "192.0.2.1");
  assert.equal(canonicalIp("not-an-ip"), "unknown");
});

test("cron secret comparison is exact", () => {
  const request = (auth: string) => new Request("https://x.test", { headers: { authorization: auth } });
  assert.equal(authorizedCron(request("Bearer s3cret-value"), "s3cret-value"), true);
  assert.equal(authorizedCron(request("Bearer s3cret-valu"), "s3cret-value"), false);
  assert.equal(authorizedCron(request("Bearer "), ""), false);
});

test("VW-DEMO-04: confirmation tokens are bound to visitor, recipient and amount, and expire", () => {
  const claims = { visitorKey: "v:a", recipient: "bob.testnet", amountYocto: 10n };
  const { token } = issueConfirmToken("k", claims, 1_000);
  assert.equal(verifyConfirmToken("k", token, claims, 2_000).ok, true);
  assert.equal(verifyConfirmToken("k", token, { ...claims, amountYocto: 11n }, 2_000).ok, false);
  assert.equal(verifyConfirmToken("k", token, { ...claims, recipient: "eve.testnet" }, 2_000).ok, false);
  assert.equal(verifyConfirmToken("k", token, { ...claims, visitorKey: "v:b" }, 2_000).ok, false);
  assert.equal(verifyConfirmToken("other", token, claims, 2_000).ok, false);
  assert.equal(verifyConfirmToken("k", token, claims, 1_000 + 5 * 60 * 1000 + 1).ok, false);
  assert.equal(verifyConfirmToken("k", undefined, claims, 2_000).ok, false);
});

test("VW-CRYPTO-03: bare base58 secrets and seed phrases are caught, implicit ids are not", () => {
  const bare = "3".repeat(10) + "AbCdEfGhJkLmNpQrStUvWxYz".repeat(3) + "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk";
  assert.equal(looksLikeSecret(`my key is ${bare}`), true);
  assert.equal(looksLikeSecret("ed25519:4H3qZr9fXyZ1yzQe2BvS7aPq8Lm"), true);
  assert.equal(looksLikeSecret("abandon ability able about above absent absorb abstract absurd abuse access accident"), true);
  assert.equal(looksLikeSecret("send 0.1 NEAR to a94ddd8e89eddfaa4a5c6ed25e809cd73265256e391e04c5bc59b6d83bfa055a"), false);
  assert.equal(looksLikeSecret("what's my balance?"), false);
  assert.throws(() => assertNoSecret(bare));
  assert.doesNotMatch(publicError(new Error(`bad ${bare}`)), new RegExp(bare));
});

test("VW-PW-06: vault v2 uses 600k PBKDF2 and AAD; v1 blobs still open", async () => {
  const context = vaultContext("alice.testnet", "ed25519:PUB", "full");
  const blob = await encryptSecret("ed25519:SECRET", "correct horse battery", context);
  assert.equal(blob.v, 2);
  assert.equal(blob.iter, V2_ITERATIONS);
  assert.equal(await decryptSecret(blob, "correct horse battery", context), "ed25519:SECRET");
  await assert.rejects(decryptSecret(blob, "correct horse battery", vaultContext("mallory.testnet", "ed25519:PUB", "full")), /passphrase/);
  await assert.rejects(decryptSecret(blob, "wrong passphrase!!", context), /passphrase/);

  // A v1 blob as the old code wrote it (120k iterations, no AAD).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode("old passphrase"), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 120_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("ed25519:OLD")));
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  assert.equal(await decryptSecret({ salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) }, "old passphrase", context), "ed25519:OLD");

  assert.match(passphraseProblem("short") ?? "", /12/);
  assert.equal(passphraseProblem("four random words here"), null);
});

test("VW-PW-01: non-Latin phrases survive normalization; all-punctuation phrases are rejected", () => {
  assert.equal(normalizePhrase("密码密码"), "密码密码");
  assert.equal(validPhrase("!!!!"), false);
  assert.throws(() => toPolicy({ ...defaultStoredPolicy(), confirmPhrase: "!!!!" }), /4 letters or digits/);
  const policy = toPolicy({ ...defaultStoredPolicy(), confirmPhrase: "密码密码" });
  assert.equal(phraseMatches(policy, "密码密码"), true);
  assert.equal(phraseMatches(policy, "!"), false);
  assert.equal(phraseMatches(policy, ""), false);
  assert.equal(phraseMatches(toPolicy(defaultStoredPolicy()), "Confirm, send!"), true);
});

test("VW-IV-04: account ids are ASCII-only; look-alikes and hidden characters are rejected", () => {
  assert.equal(isValidAccountId(normalizeAccountId("Kob.testnet")), false, "KELVIN SIGN is not lowercased into k");
  assert.equal(resolveAccountInput("Bob.Testnet"), "bob.testnet");
  assert.equal(parseIntent("send 0.1 NEAR to bo​b.testnet").type, "unknown");
  assert.equal(parseIntent("send 0.1 NEAR to bob‮.testnet").type, "unknown");
  assert.equal(parseIntent("send 0.1 NEAR to bób.testnet").type, "unknown");
  assert.equal(parseIntent("send 0.1 NEAR to Kob.testnet").type, "unknown");
});

test("VW-IV-03: the model's recipient must be a whole token the user said, and the amount must match", () => {
  assert.equal(mentionsAccount("send 0.1 to alice.evil.testnet", "alice.testnet"), false);
  assert.equal(mentionsAccount("send 0.1 to alice.testnet.", "alice.testnet"), true);
  assert.equal(mentionsAccount("send 0.1 to bob", "bob.testnet"), true);
  assert.equal(mentionsAmount("send 0.1 near to bob", "0.10"), true);
  assert.equal(mentionsAmount("send .5 near to bob", "0.5"), true);
  assert.equal(mentionsAmount("send point five near to bob", "0.5"), true);
  assert.equal(mentionsAmount("send 0.1 near to bob", "2"), false);

  const liedAmount = acceptModelIntent("send 0.1 NEAR to bob.testnet", { type: "send", recipient: "bob.testnet", amountNear: "2" });
  assert.deepEqual(liedAmount, { type: "send", amountNear: "0.1", recipient: "bob.testnet" }, "falls back to the local parse");
  const substring = acceptModelIntent("send 0.1 NEAR to alice.evil.testnet", { type: "send", recipient: "alice.testnet", amountNear: "0.1" });
  assert.equal(substring.type === "send" && substring.recipient, "alice.evil.testnet");
  const negated = acceptModelIntent("do not send 1 NEAR to bob.testnet", { type: "send", recipient: "bob.testnet", amountNear: "1" });
  assert.equal(negated.type, "unknown");
  const uncorroborated = acceptModelIntent("what's my balance?", { type: "stop" });
  assert.equal(uncorroborated.type, "get_balance");
});

test("VW-IV-06: negated stop and send phrases do not trigger", () => {
  assert.equal(parseIntent("never stop sending").type, "unknown");
  assert.equal(parseIntent("don't stop").type, "unknown");
  assert.equal(parseIntent("stop sending").type, "stop");
  assert.equal(parseIntent("don't send 1 NEAR to bob.testnet").type, "unknown");
});

test("VW-IV-01: voice yes is a whole-utterance answer, and negatives win", () => {
  for (const yes of ["yes", "Yes, do it.", "yep", "confirm", "send it", "yeah please"]) assert.equal(isAffirmative(yes), true, yes);
  for (const notYes of ["ok", "okay", "go", "go ahead then", "sure", "sure, not now", "yes but not now", "go to history", "absolutely", "yes wait", "hey vibe, go to history"]) {
    assert.equal(isAffirmative(notYes), false, notYes);
  }
  for (const no of ["no", "nah", "cancel", "wait", "sure, not now", "don't"]) assert.equal(isNegative(no), true, no);
});

test("VW-PW-02: loosening the policy is detected so it can require the phrase", () => {
  const base = defaultStoredPolicy();
  assert.equal(loosens(base, { ...base, perTxNear: "3" }), true);
  assert.equal(loosens(base, { ...base, thresholdNear: "1" }), true);
  assert.equal(loosens(base, { ...base, confirmPhrase: "new phrase" }), true);
  assert.equal(loosens({ ...base, allowlistOnly: true }, { ...base, allowlistOnly: false }), true);
  assert.equal(loosens(base, { ...base, perTxNear: "1", dailyNear: "2" }), false);
  assert.equal(loosens(base, { ...base, allowlistOnly: true }), false);
});

test("VW-WEB-02: the in-memory limiter throttles one client", () => {
  resetRateLimits();
  const limits = [{ max: 3, windowMs: 60_000 }];
  assert.equal(hit("k", limits, 1).ok, true);
  assert.equal(hit("k", limits, 2).ok, true);
  assert.equal(hit("k", limits, 3).ok, true);
  assert.equal(hit("k", limits, 4).ok, false);
  assert.equal(hit("other", limits, 4).ok, true);
  assert.equal(hit("k", limits, 60_002).ok, true, "the window slides");
});
