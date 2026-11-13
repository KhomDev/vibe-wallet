import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { explainTransaction, type HistoryItem } from "../lib/history";
import { parseIntent } from "../lib/intent";
import { assessSend, defaultStoredPolicy, phraseMatches, toPolicy } from "../lib/policy";
import { formatNear, parseNear } from "../lib/units";

test("local parser understands the demo phrases", () => {
  assert.deepEqual(parseIntent("What's my balance?"), { type: "get_balance" });
  assert.deepEqual(parseIntent("Send 0.5 NEAR to bob.testnet"), {
    type: "send",
    amountNear: "0.5",
    recipient: "bob.testnet",
  });
  assert.deepEqual(parseIntent("Swap 1 NEAR to USDT"), {
    type: "quote_swap",
    amountNear: "1",
    toSymbol: "USDT",
  });
  assert.equal(parseIntent("Explain my last transaction").type, "explain_last");
  assert.equal(parseIntent("Show my history").type, "history");
  assert.equal(parseIntent("stop").type, "stop");
  assert.equal(parseIntent("resume sending").type, "resume");
  assert.deepEqual(parseIntent("allow carol.testnet"), { type: "allow", recipient: "carol.testnet" });
  const limits = parseIntent("set daily limit to 3");
  assert.equal(limits.type, "set_limit");
  if (limits.type === "set_limit") assert.equal(limits.dailyNear, "3");
  const scheduled = parseIntent("Send 0.15 NEAR to bob.testnet every Friday");
  assert.deepEqual(scheduled, { type: "schedule_send", amountNear: "0.15", recipient: "bob.testnet", cadence: "weekly_friday" });
  const daily = parseIntent("send 0.1 NEAR to bob.testnet every day");
  assert.equal(daily.type, "schedule_send");
  if (daily.type === "schedule_send") assert.equal(daily.cadence, "daily");
  const price = parseIntent("If NEAR drops below $10000, swap 0.1 NEAR to USDC");
  assert.deepEqual(price, { type: "price_rule", belowUsd: 10000, amountNear: "0.1", toSymbol: "USDC" });
  assert.equal(parseIntent("Run the agent").type, "run_agent");
  assert.equal(parseIntent("show the agent").type, "agent_status");
});

test("parser rejects a recipient that is not an account id", () => {
  const intent = parseIntent("send 1 NEAR to ed25519:not-an-account");
  assert.equal(intent.type, "unknown");
});

test("units convert NEAR without floating point", () => {
  assert.equal(parseNear("0.5"), 500_000_000_000_000_000_000_000n);
  assert.equal(parseNear("1"), 1_000_000_000_000_000_000_000_000n);
  assert.equal(formatNear(parseNear("0.5")), "0.5");
  assert.equal(formatNear(44_636_512_500_000_000_000n, 8), "0.00004463");
});

test("policy blocks the kill switch, limits, and missing named accounts", () => {
  const policy = toPolicy(defaultStoredPolicy());
  const base = {
    recipient: "bob.testnet",
    amountYocto: parseNear("0.1"),
    feeYocto: parseNear("0.0001"),
    availableYocto: parseNear("10"),
    spentTodayYocto: 0n,
    accountExists: true,
  };
  assert.equal(assessSend({ ...policy, killed: true }, base).blockReason?.includes("kill switch"), true);
  assert.match(assessSend(policy, { ...base, amountYocto: parseNear("3") }).blockReason ?? "", /per-transaction/);
  assert.match(assessSend(policy, { ...base, spentTodayYocto: parseNear("4.95") }).blockReason ?? "", /daily/);
  assert.match(assessSend(policy, { ...base, accountExists: false }).blockReason ?? "", /does not exist/);
  const unknown = assessSend(policy, base);
  assert.equal(unknown.ok, true);
  assert.equal(unknown.needsPhrase, true);
  assert.match(unknown.warnings.join(" "), /allowlist/);
  const allowlisted = assessSend({ ...policy, allowlist: ["bob.testnet"] }, base);
  assert.equal(allowlisted.needsPhrase, false);
  const high = assessSend({ ...policy, allowlist: ["bob.testnet"] }, { ...base, amountYocto: parseNear("0.5") });
  assert.equal(high.needsPhrase, true);
  assert.equal(phraseMatches(policy, "Confirm send!"), true);
  assert.equal(phraseMatches(policy, "send it"), false);
});

test("explain a transfer in plain language", () => {
  const tx: HistoryItem = {
    hash: "abc",
    signer: "alice.testnet",
    receiver: "bob.testnet",
    actions: ["TRANSFER"],
    methods: [],
    depositYocto: parseNear("0.2").toString(),
    feeYocto: parseNear("0.00008").toString(),
    success: true,
    timestampMs: Date.UTC(2026, 10, 13, 0, 0, 0),
    source: "local",
  };
  const text = explainTransaction(tx, "alice.testnet");
  assert.match(text, /you sent 0\.2 NEAR to bob\.testnet/);
  assert.match(text, /succeeded/i);
});

test("server routes do not import the signer", () => {
  const intent = readFileSync(new URL("../app/api/intent/route.ts", import.meta.url), "utf8");
  const quote = readFileSync(new URL("../app/api/quote/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(intent, /near\/signer|near-api-js|NEAR_AI_API_KEY\s*=/);
  assert.match(intent, /process\.env\.NEAR_AI_API_KEY/);
  assert.match(quote, /dry:\s*true/);
  assert.doesNotMatch(quote, /body\.dry/);

  const root = new URL("../", import.meta.url);
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path);
    }
  }
  walk(new URL("app/api", root).pathname);
  walk(new URL("lib/server", root).pathname);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*near\/signer["']/, `import signer in ${file}`);
    assert.doesNotMatch(source, /console\.log\([^)]*(secretKey|private_key|DEMO_NEAR_PRIVATE_KEY)/i, file);
  }
});
