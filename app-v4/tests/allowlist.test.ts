import assert from "node:assert/strict";
import { test } from "node:test";
import { allowlistView, shortAccount } from "../lib/allowlist";
import { INTENT_SYSTEM_PROMPT, parseIntent, sanitizeIntent } from "../lib/intent";
import { defaultStoredPolicy } from "../lib/policy";

test("allowlist questions parse to show_allowlist", () => {
  for (const phrase of [
    "Who can I send to?",
    "who can i pay",
    "Show my allowlist",
    "list allow list entries",
    "list allow list",
    "allow list",
    "My contacts",
    "show contacts",
    "allowed recipients",
    "What's in my allowlist?",
    "view the allow list",
  ]) {
    assert.deepEqual(parseIntent(phrase), { type: "show_allowlist" }, phrase);
  }
});

test("adding an account and safety questions keep their own intents", () => {
  assert.deepEqual(parseIntent("allow bob.testnet"), { type: "allow", recipient: "bob.testnet" });
  assert.deepEqual(parseIntent("show my limits"), { type: "show_safety" });
  assert.equal(parseIntent("Send 0.1 NEAR to bob.testnet").type, "send");
});

test("the model may return show_allowlist and the prompt documents it", () => {
  assert.deepEqual(sanitizeIntent({ type: "show_allowlist" }), { type: "show_allowlist" });
  assert.match(INTENT_SYSTEM_PROMPT, /"type":"show_allowlist"/);
});

test("allowlist view lists entries with limits and a prefilled send", () => {
  const view = allowlistView({ ...defaultStoredPolicy(), perTxNear: "0.3", dailyNear: "2", allowlist: ["bob.testnet", "bob.testnet", "a".repeat(64)], allowlistOnly: true });
  assert.equal(view.entries.length, 2);
  assert.equal(view.entries[0].sendText, "Send 0.1 NEAR to bob.testnet");
  assert.equal(view.entries[0].perSendNear, "0.3");
  assert.equal(view.dailyNear, "2");
  assert.equal(view.entries[1].display, shortAccount("a".repeat(64)));
  assert.equal(view.emptyHelp, null);
});

test("empty allowlist explains how to add an account", () => {
  const view = allowlistView({ ...defaultStoredPolicy(), allowlist: [], allowlistOnly: true });
  assert.equal(view.entries.length, 0);
  assert.match(view.emptyHelp ?? "", /allow name\.testnet/);
  assert.match(view.emptyHelp ?? "", /blocked/);
});
