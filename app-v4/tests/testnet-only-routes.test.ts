import { test } from "node:test";
import assert from "node:assert/strict";
import { isTestnetOnlyRoute } from "../lib/request-guard";

test("demo, agent and cron routes are testnet-only; wallet and swap routes are not", () => {
  for (const p of ["/api/demo/session", "/api/demo/send", "/api/demo/policy", "/api/agent/run", "/api/agent/rules", "/api/agent/status", "/api/cron/agent"]) {
    assert.equal(isTestnetOnlyRoute(p), true, p);
  }
  for (const p of ["/api/intents/quote", "/api/intents/submit", "/api/intents/status", "/api/intent", "/api/quote", "/api/transcribe", "/api/demographics", "/"]) {
    assert.equal(isTestnetOnlyRoute(p), false, p);
  }
});
