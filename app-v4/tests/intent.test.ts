import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptModelIntent, parseIntent, sanitizeIntent } from "../lib/intent";

test("local parser understands balances, sends, swaps, history and help", () => {
  assert.deepEqual(parseIntent("What's my balance?"), { type: "get_balance" });
  assert.deepEqual(parseIntent("how much NEAR do I have"), { type: "get_balance" });
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
  assert.equal(parseIntent("help").type, "help");
  assert.equal(parseIntent("show safety").type, "show_safety");
});

test("local parser understands agent rules and kill switch", () => {
  assert.equal(parseIntent("stop").type, "stop");
  assert.equal(parseIntent("resume sending").type, "resume");
  assert.deepEqual(parseIntent("allow carol.testnet"), { type: "allow", recipient: "carol.testnet" });
  const limits = parseIntent("set daily limit to 3");
  assert.equal(limits.type, "set_limit");
  if (limits.type === "set_limit") assert.equal(limits.dailyNear, "3");
  const scheduled = parseIntent("Send 0.15 NEAR to bob.testnet every Friday");
  assert.deepEqual(scheduled, {
    type: "schedule_send",
    amountNear: "0.15",
    recipient: "bob.testnet",
    cadence: "weekly_friday",
  });
  const daily = parseIntent("send 0.1 NEAR to bob.testnet every day");
  assert.equal(daily.type, "schedule_send");
  if (daily.type === "schedule_send") assert.equal(daily.cadence, "daily");
  const price = parseIntent("If NEAR drops below $10000, swap 0.1 NEAR to USDC");
  assert.deepEqual(price, { type: "price_rule", belowUsd: 10000, amountNear: "0.1", toSymbol: "USDC" });
  assert.equal(parseIntent("Run the agent").type, "run_agent");
  assert.equal(parseIntent("show the agent").type, "agent_status");
});

test("local parser rejects a recipient that is not an account id", () => {
  const intent = parseIntent("send 1 NEAR to ed25519:not-an-account");
  assert.equal(intent.type, "unknown");
});

test("sanitizeIntent accepts valid model JSON and drops unusable shapes", () => {
  assert.deepEqual(sanitizeIntent({ type: "get_balance" }), { type: "get_balance" });
  assert.deepEqual(sanitizeIntent({ type: "send", recipient: "bob.testnet", amountNear: "0.1" }), {
    type: "send",
    recipient: "bob.testnet",
    amountNear: "0.1",
  });
  assert.equal(sanitizeIntent({ type: "send", recipient: "not valid", amountNear: "0.1" }), null);
  assert.equal(sanitizeIntent({ type: "nope" }), null);
  assert.equal(sanitizeIntent(null), null);
});

test("acceptModelIntent falls back to the local parser if the model invents a recipient", () => {
  const invented = acceptModelIntent("what's my balance?", {
    type: "send",
    recipient: "attacker.testnet",
    amountNear: "1",
  });
  assert.equal(invented.type, "get_balance");

  const honest = acceptModelIntent("send 0.1 NEAR to bob.testnet", {
    type: "send",
    recipient: "bob.testnet",
    amountNear: "0.1",
  });
  assert.deepEqual(honest, { type: "send", recipient: "bob.testnet", amountNear: "0.1" });
});

test("implicit 64-character account ids parse as send recipients", () => {
  const recipient = "a94ddd8e89eddfaa4a5c6ed25e809cd73265256e391e04c5bc59b6d83bfa055a";
  const intent = parseIntent(`send 0.1 NEAR to ${recipient}`);
  assert.deepEqual(intent, { type: "send", amountNear: "0.1", recipient });
});
