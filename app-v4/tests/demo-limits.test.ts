import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDemoGate, recordDemoSend, visitorSpentToday, addKeyedSpend, AGENT_SPEND_KEY } from "../lib/server/demo-limits";
import { applyCounterReset, COUNTER_RESET, spentToday, utcDay, type AgentState } from "../lib/server/state";
import { resolveVisitor, signVisitor, verifyVisitor, VISITOR_COOKIE, newVisitorId } from "../lib/server/visitor";
import { assessSend, toPolicy } from "../lib/policy";
import { demoStoredPolicy } from "../lib/server/policy";
import { parseNear } from "../lib/units";

const SECRET = "test-secret-not-real";
const NOW = new Date("2026-11-13T15:00:00Z");

function empty(): AgentState {
  return { killed: false, spentDay: "", spentYocto: "0", allowlist: [], rules: [], logs: [], rates: {}, visitorSpend: {}, counterReset: COUNTER_RESET, updatedAt: NOW.toISOString() };
}

function req(cookie?: string): Request {
  return new Request("https://vibe.test/api/demo/send", { headers: cookie ? { cookie } : {} });
}

test("visitor cookie: valid signature round-trips, forged or tampered values are rejected", () => {
  const id = newVisitorId();
  const value = signVisitor(id, SECRET);
  assert.equal(verifyVisitor(value, SECRET), id);
  assert.equal(verifyVisitor(value, "other-secret"), null);
  assert.equal(verifyVisitor(`${id}x.${value.split(".")[1]}`, SECRET), null);
  assert.equal(verifyVisitor(id, SECRET), null);
  assert.equal(verifyVisitor(`${value}.extra`, SECRET), null);
  assert.equal(verifyVisitor("", SECRET), null);
});

test("no cookie: falls back to the IP and issues a signed httpOnly cookie", () => {
  const visitor = resolveVisitor(req(), "1.2.3.4", SECRET);
  assert.equal(visitor.fromCookie, false);
  assert.match(visitor.key, /^ip:/);
  assert.ok(visitor.setCookie);
  assert.match(visitor.setCookie!, new RegExp(`^${VISITOR_COOKIE}=`));
  assert.match(visitor.setCookie!, /HttpOnly/);
  assert.match(visitor.setCookie!, /Secure/);
  assert.match(visitor.setCookie!, /SameSite=Lax/);
  // The issued cookie identifies the visitor on the next request.
  const cookie = visitor.setCookie!.split(";")[0];
  const next = resolveVisitor(req(cookie), "1.2.3.4", SECRET);
  assert.equal(next.fromCookie, true);
  assert.match(next.key, /^v:/);
  assert.equal(next.setCookie, undefined);
});

test("two visitors behind the same IP get separate keys but share the network key", () => {
  const a = resolveVisitor(req(`${VISITOR_COOKIE}=${signVisitor(newVisitorId(), SECRET)}`), "9.9.9.9", SECRET);
  const b = resolveVisitor(req(`theme=dark; ${VISITOR_COOKIE}=${signVisitor(newVisitorId(), SECRET)}`), "9.9.9.9", SECRET);
  assert.notEqual(a.key, b.key);
  assert.equal(a.ipKey, b.ipKey);
});

test("a forged cookie is treated as no cookie", () => {
  const visitor = resolveVisitor(req(`${VISITOR_COOKIE}=${newVisitorId()}.forgedsignature`), "1.2.3.4", SECRET);
  assert.equal(visitor.fromCookie, false);
  assert.match(visitor.key, /^ip:/);
});

test("one visitor using their 2 NEAR daily limit does not block another visitor", () => {
  const policy = toPolicy(demoStoredPolicy("bob.testnet", false, ["bob.testnet"]));
  const facts = (spent: bigint) => ({ recipient: "bob.testnet", amountYocto: parseNear("0.1"), feeYocto: 1n, availableYocto: parseNear("50"), spentTodayYocto: spent, accountExists: true });
  let state = empty();
  for (let i = 0; i < 7; i += 1) state = recordDemoSend(state, "v:a", "net:x", parseNear("0.3"), NOW);
  assert.equal(visitorSpentToday(state, "v:a", NOW), parseNear("2.1"));
  const a = assessSend(policy, facts(visitorSpentToday(state, "v:a", NOW)));
  const b = assessSend(policy, facts(visitorSpentToday(state, "v:b", NOW)));
  assert.match(a.blockReason ?? "", /daily limit/);
  assert.ok(!b.blockReason);
  assert.equal(spentToday(state, NOW), parseNear("2.1"));
});

test("the global safety cap blocks everyone once the demo account sent 20 NEAR today", () => {
  let state = empty();
  state = { ...state, spentDay: utcDay(NOW), spentYocto: parseNear("19.95").toString() };
  const blocked = checkDemoGate(state, "v:new", "net:new", parseNear("0.1"), NOW);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 403);
    assert.match(blocked.reason, /20 NEAR safety cap/);
  }
  assert.equal(checkDemoGate(state, "v:new", "net:new", parseNear("0.05"), NOW).ok, true);
});

test("hourly rate limit is per visitor; a looser per-network ceiling still applies", () => {
  let state = empty();
  for (let i = 0; i < 8; i += 1) state = recordDemoSend(state, "v:a", "net:x", 1n, NOW);
  const a = checkDemoGate(state, "v:a", "net:x", 1n, NOW);
  assert.equal(a.ok, false);
  if (!a.ok) assert.equal(a.status, 429);
  assert.equal(checkDemoGate(state, "v:b", "net:x", 1n, NOW).ok, true);
  for (let i = 0; i < 22; i += 1) state = recordDemoSend(state, `v:c${i}`, "net:x", 1n, NOW);
  const net = checkDemoGate(state, "v:fresh", "net:x", 1n, NOW);
  assert.equal(net.ok, false);
  if (!net.ok) assert.match(net.reason, /network/);
  assert.equal(checkDemoGate(state, "v:fresh", "net:other", 1n, NOW).ok, true);
});

test("counters from earlier days are dropped and do not count", () => {
  let state = recordDemoSend(empty(), "v:a", "net:x", parseNear("2"), new Date("2026-11-12T22:00:00Z"));
  assert.equal(visitorSpentToday(state, "v:a", NOW), 0n);
  state = recordDemoSend(state, "v:b", "net:y", 1n, NOW);
  assert.equal(state.visitorSpend["v:a"], undefined);
  assert.equal(state.rates["v:a"], undefined);
});

test("the scheduled agent has its own budget and still counts toward the global total", () => {
  let state = recordDemoSend(empty(), "v:a", "net:x", parseNear("1.5"), NOW);
  state = addKeyedSpend(state, AGENT_SPEND_KEY, parseNear("0.1"), NOW);
  assert.equal(visitorSpentToday(state, AGENT_SPEND_KEY, NOW), parseNear("0.1"));
  assert.equal(spentToday(state, NOW), parseNear("1.6"));
});

test("the one-time counter reset clears today's spend and rate buckets but keeps settings", () => {
  const old = { ...empty(), counterReset: undefined, spentDay: utcDay(NOW), spentYocto: parseNear("2").toString(), allowlist: ["bob.testnet"], killed: false, rates: { "x": { hourKey: "h", hourCount: 8, dayKey: utcDay(NOW), dayCount: 8 } } };
  const reset = applyCounterReset(old);
  assert.equal(reset.spentYocto, "0");
  assert.deepEqual(reset.rates, {});
  assert.deepEqual(reset.allowlist, ["bob.testnet"]);
  assert.equal(reset.counterReset, COUNTER_RESET);
  // Already reset: unchanged.
  const again = applyCounterReset({ ...reset, spentYocto: "5" });
  assert.equal(again.spentYocto, "5");
});
