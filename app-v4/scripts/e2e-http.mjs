// Local end-to-end check of the remediated build against NEAR testnet, over HTTP.
// Usage: node scripts/e2e-http.mjs http://127.0.0.1:43123 <demo-recipient> <out.json>
// Needs a running build with a testnet demo account (DEMO_NEAR_* env or VIBE_SECRETS_DIR). It sends
// two real 0.01 NEAR testnet transfers from that account to the demo recipient.
import { writeFileSync } from "node:fs";

const [base, recipient, outPath] = process.argv.slice(2);
const origin = new URL(base).origin;
const results = [];
let cookie = "";

async function call(path, { method = "POST", body, headers = {}, raw } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(raw ? {} : { "content-type": "application/json" }),
      origin,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await response.json(); } catch { /* not json */ }
  return { status: response.status, json, headers: response.headers };
}

function record(step, ok, detail) {
  results.push({ step, ok, ...detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}${detail?.note ? ` - ${detail.note}` : ""}`);
}

// Headers on the page.
const page = await fetch(`${base}/?app=1`);
const csp = page.headers.get("content-security-policy") || "";
record("page: CSP frame-ancestors 'none' and X-Frame-Options DENY", csp.includes("frame-ancestors 'none'") && page.headers.get("x-frame-options") === "DENY", { note: page.headers.get("x-frame-options") });

// Session mints a cookie.
const session = await call("/api/demo/session");
record("session: visitor cookie minted, network reported", session.status === 200 && Boolean(cookie) && session.json?.network === "testnet", { note: `${session.json?.accountId} -> ${session.json?.recipientId}, available ${session.json?.availableNear}` });
record("session: no-store cache header", (session.headers.get("cache-control") || "").includes("no-store"), { note: session.headers.get("cache-control") });

// CSRF and content-type guards (middleware).
const cross = await fetch(`${base}/api/demo/policy`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie }, body: "{}" });
record("csrf: cross-origin POST rejected", cross.status === 403, { note: String(cross.status) });
const plain = await fetch(`${base}/api/demo/send`, { method: "POST", headers: { "content-type": "text/plain", origin, cookie }, body: JSON.stringify({ recipient, amountNear: "0.01", preview: true }) });
record("csrf: text/plain body rejected", plain.status === 415, { note: String(plain.status) });

// Send without a token is refused; with the preview token it goes on chain.
const noToken = await call("/api/demo/send", { body: { recipient, amountNear: "0.01" } });
record("send: no confirmation token -> 409", noToken.status === 409, { note: noToken.json?.error });
const preview = await call("/api/demo/send", { body: { recipient, amountNear: "0.01", preview: true } });
record("preview: allowlisted 0.01 needs no phrase and returns a token", preview.status === 200 && preview.json?.check?.needsPhrase === false && typeof preview.json?.confirmToken === "string", { note: preview.json?.check?.blockReason ?? "ok" });
const sent = await call("/api/demo/send", { body: { recipient, amountNear: "0.01", confirmToken: preview.json?.confirmToken } });
record("send: real testnet transfer", sent.status === 200 && typeof sent.json?.hash === "string", { note: sent.json?.hash ?? sent.json?.error, hash: sent.json?.hash, explorerUrl: sent.json?.explorerUrl });
const replay = await call("/api/demo/send", { body: { recipient, amountNear: "0.01", confirmToken: preview.json?.confirmToken } });
record("send: token replay -> 409", replay.status === 409, { note: replay.json?.error });

// Threshold is live: 0.2 to the allowlisted friend needs the phrase.
const high = await call("/api/demo/send", { body: { recipient, amountNear: "0.2", preview: true } });
record("threshold: 0.2 to an allowlisted contact needs the phrase", high.json?.check?.needsPhrase === true, { note: (high.json?.check?.phraseReasons || []).join(" ") });

// Allowlist changes need the phrase.
const allowNoPhrase = await call("/api/demo/policy", { body: { allow: "testnet" } });
record("policy: allow without phrase -> 403", allowNoPhrase.status === 403, { note: allowNoPhrase.json?.error });

// Stop switch is per visitor and resume needs the phrase.
const stop = await call("/api/demo/policy", { body: { killed: true } });
record("policy: visitor stop", stop.status === 200 && stop.json?.stopped === true && stop.json?.globalKilled === false, {});
const stoppedPreview = await call("/api/demo/send", { body: { recipient, amountNear: "0.01", preview: true } });
record("stop: preview blocked while stopped", Boolean(stoppedPreview.json?.check?.blockReason), { note: stoppedPreview.json?.check?.blockReason });
const resumeNo = await call("/api/demo/policy", { body: { killed: false } });
record("policy: resume without phrase -> 403", resumeNo.status === 403, {});
const resume = await call("/api/demo/policy", { body: { killed: false, phrase: "confirm send" } });
record("policy: resume with phrase", resume.status === 200 && resume.json?.stopped === false, {});

// Agent: own rule, real scheduled payment, a second run does not pay again.
const rule = await call("/api/agent/rules", { body: { type: "schedule_send", amountNear: "0.01", cadence: "daily" } });
record("agent: rule created for this visitor", rule.status === 200 && rule.json?.rule?.recipient === recipient, { note: rule.json?.error });
const [runA, runB] = await Promise.all([call("/api/agent/run"), call("/api/agent/run")]);
const ran = (runA.json?.ran ?? 0) + (runB.json?.ran ?? 0);
const transferLog = [...(runA.json?.logs || []), ...(runB.json?.logs || [])].find((log) => log.action === "transfer");
record("agent: two concurrent runs pay the rule exactly once", ran === 1 && Boolean(transferLog?.hash), { note: `ran=${ran}`, hash: transferLog?.hash, explorerUrl: transferLog?.explorerUrl });
const status = await call("/api/agent/status", { method: "GET" });
record("agent: status shows only this visitor's rules", status.status === 200 && status.json?.rules?.length === 1, {});
const anonStatus = await fetch(`${base}/api/agent/status`);
record("agent: anonymous status -> 401", anonStatus.status === 401, {});
if (rule.json?.rule?.id) await call("/api/agent/rules", { body: { deleteId: rule.json.rule.id } });

const failed = results.filter((item) => !item.ok).length;
writeFileSync(outPath, JSON.stringify({ base, recipient, at: new Date().toISOString(), failed, results }, null, 2));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
