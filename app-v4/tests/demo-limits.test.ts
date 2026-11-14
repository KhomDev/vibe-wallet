import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDemoGate, releaseDemoSpend, reserveDemoSpend, visitorSpentToday, type SpendRequest } from "../lib/server/demo-limits";
import { AbortTransaction, applyCounterReset, COUNTER_RESET, MemoryStore, normalize, setStateStore, spentToday, STATE_VERSION, transact, utcDay, type AgentState } from "../lib/server/state";
import { resolveVisitor, signVisitor, verifyVisitor, VISITOR_COOKIE, newVisitorId } from "../lib/server/visitor";
import { assessSend, toPolicy } from "../lib/policy";
import { demoStoredPolicy, visitorPolicy } from "../lib/server/policy";
import { parseNear } from "../lib/units";

const SECRET = "test-secret-not-real";
const NOW = new Date("2026-11-13T15:00:00Z");

function empty(): AgentState {
  return { version: STATE_VERSION, killed: false, spentDay: "", spentYocto: "0", allowlist: [], rules: [], logs: [], rates: {}, visitorSpend: {}, visitors: {}, mints: {}, usedTokens: {}, counterReset: COUNTER_RESET, updatedAt: NOW.toISOString() };
}

function req(cookie?: string): Request {
  return new Request("https://vibe.test/api/demo/send", { headers: cookie ? { cookie } : {} });
}

function spend(visitorKey: string, ipKey: string | null, amountNear: string, dailyNear = "2"): SpendRequest {
  return { visitorKey, ipKey, amountYocto: parseNear(amountNear), feeYocto: 0n, visitorDailyYocto: parseNear(dailyNear) };
}

function reserve(state: AgentState, request: SpendRequest, now = NOW): AgentState {
  return reserveDemoSpend(state, request, now).state;
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

test("no cookie: resolveVisitor counts against the network and mints nothing", () => {
  const visitor = resolveVisitor(req(), "1.2.3.4", SECRET);
  assert.equal(visitor.fromCookie, false);
  assert.match(visitor.key, /^ip:/);
  assert.equal(visitor.setCookie, undefined, "only the session route mints an id, within the network's limit");
  const cookie = `${VISITOR_COOKIE}=${signVisitor(newVisitorId(), SECRET)}`;
  const next = resolveVisitor(req(cookie), "1.2.3.4", SECRET);
  assert.equal(next.fromCookie, true);
  assert.match(next.key, /^v:/);
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
  let state = empty();
  for (let i = 0; i < 6; i += 1) state = reserve(state, spend("v:a", "net:x", "0.3"), NOW);
  assert.equal(visitorSpentToday(state, "v:a", NOW), parseNear("1.8"));
  assert.throws(() => reserve(state, spend("v:a", "net:x", "0.3")), (err: unknown) => err instanceof AbortTransaction && /daily limit/.test(err.message));
  assert.doesNotThrow(() => reserve(state, spend("v:b", "net:x", "0.3")));
  const policy = toPolicy(demoStoredPolicy("bob.testnet", false, ["bob.testnet"]));
  const b = assessSend(policy, { recipient: "bob.testnet", amountYocto: parseNear("0.1"), feeYocto: 1n, availableYocto: parseNear("50"), spentTodayYocto: visitorSpentToday(state, "v:b", NOW), accountExists: true });
  assert.ok(!b.blockReason);
});

test("the per-network NEAR budget bounds one actor with many visitor ids", () => {
  let state = empty();
  let sent = 0n;
  for (let i = 0; i < 40; i += 1) {
    try {
      state = reserve(state, spend(`v:minted-${i}`, "net:attacker", "0.3"));
      sent += parseNear("0.3");
    } catch (err) {
      assert.ok(err instanceof AbortTransaction);
    }
  }
  assert.ok(sent <= parseNear("3"), `one network spent ${sent} yocto`);
  assert.doesNotThrow(() => reserve(state, spend("v:judge", "net:judge", "0.3")), "another network is unaffected");
});

test("the global safety cap counts amount plus fee and blocks everyone once it is reached", () => {
  let state = empty();
  state = { ...state, spentDay: utcDay(NOW), spentYocto: parseNear("19.95").toString() };
  const blocked = checkDemoGate(state, spend("v:new", "net:new", "0.1"), NOW);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.status, 403);
    assert.match(blocked.reason, /20 NEAR safety cap/);
  }
  assert.equal(checkDemoGate(state, spend("v:new", "net:new", "0.05"), NOW).ok, true);
  assert.equal(checkDemoGate(state, { ...spend("v:new", "net:new", "0.05"), feeYocto: parseNear("0.01") }, NOW).ok, false, "the fee counts toward the global cap");
});

test("hourly rate limit is per visitor; the per-network ceiling still applies", () => {
  let state = empty();
  for (let i = 0; i < 8; i += 1) state = reserve(state, spend("v:a", "net:x", "0.000001"), NOW);
  const a = checkDemoGate(state, spend("v:a", "net:x", "0.000001"), NOW);
  assert.equal(a.ok, false);
  if (!a.ok) assert.equal(a.status, 429);
  assert.equal(checkDemoGate(state, spend("v:b", "net:x", "0.000001"), NOW).ok, true);
  for (let i = 0; i < 7; i += 1) state = reserve(state, spend(`v:c${i}`, "net:x", "0.000001"), NOW);
  const net = checkDemoGate(state, spend("v:fresh", "net:x", "0.000001"), NOW);
  assert.equal(net.ok, false);
  if (!net.ok) assert.match(net.reason, /network/);
  assert.equal(checkDemoGate(state, spend("v:fresh", "net:other", "0.000001"), NOW).ok, true);
});

test("a released reservation gives back exactly what it took", () => {
  const before = empty();
  const { state, reservation } = reserveDemoSpend(before, { ...spend("v:a", "net:x", "0.3"), feeYocto: 5n }, NOW);
  const released = releaseDemoSpend(state, reservation, NOW);
  assert.equal(visitorSpentToday(released, "v:a", NOW), 0n);
  assert.equal(visitorSpentToday(released, "net:x", NOW), 0n);
  assert.equal(spentToday(released, NOW), 0n);
  assert.equal(released.rates["v:a"].hourCount, 0);
});

test("counters from earlier days do not count", () => {
  const state = reserve(empty(), spend("v:a", "net:x", "2"), new Date("2026-11-12T22:00:00Z"));
  assert.equal(visitorSpentToday(state, "v:a", NOW), 0n);
  assert.equal(spentToday(state, NOW), 0n);
});

test("CAS: concurrent reservations against one store never exceed the limit", async () => {
  const store = new MemoryStore(empty());
  store.beforeWrite = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
  setStateStore(store);
  try {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => transact((current) => {
      const reserved = reserveDemoSpend(current, spend("v:a", "net:x", "0.3"));
      return { state: reserved.state, result: reserved.reservation };
    })));
    const ok = results.filter((result) => result.status === "fulfilled").length;
    assert.equal(ok, 6, "exactly six 0.3 NEAR reservations fit under 2 NEAR");
    assert.equal(visitorSpentToday(store.peek()!, "v:a"), parseNear("1.8"));
  } finally {
    setStateStore(null);
  }
});

test("per-visitor policy: own allowlist and own stop switch; the operator switch stops everyone", () => {
  let state = empty();
  state = { ...state, visitors: { "v:a": { allowlist: ["carol.testnet"], stopped: true, seen: utcDay(NOW) } } };
  const a = visitorPolicy(state, "friend.testnet", "v:a");
  const b = visitorPolicy(state, "friend.testnet", "v:b");
  assert.deepEqual(a.allowlist, ["friend.testnet", "carol.testnet"]);
  assert.deepEqual(b.allowlist, ["friend.testnet"]);
  assert.equal(a.killed, true);
  assert.equal(b.killed, false);
  assert.equal(visitorPolicy({ ...state, killed: true }, "friend.testnet", "v:b").killed, true);
});

test("the demo threshold is live: allowlisted 0.1 is slide-only, 0.2 and up needs the phrase", () => {
  const policy = toPolicy(demoStoredPolicy("bob.testnet", false, []));
  const facts = (amount: string) => ({ recipient: "bob.testnet", amountYocto: parseNear(amount), feeYocto: 1n, availableYocto: parseNear("50"), spentTodayYocto: 0n, accountExists: true });
  assert.equal(assessSend(policy, facts("0.1")).needsPhrase, false);
  assert.equal(assessSend(policy, facts("0.2")).needsPhrase, true);
  assert.equal(assessSend(policy, facts("0.3")).needsPhrase, true);
});

test("the one-time counter reset clears today's spend and rate buckets but keeps settings", () => {
  const old = { ...empty(), counterReset: undefined, spentDay: utcDay(NOW), spentYocto: parseNear("2").toString(), allowlist: ["bob.testnet"], killed: false, rates: { "x": { hourKey: "h", hourCount: 8, dayKey: utcDay(NOW), dayCount: 8 } } };
  const reset = applyCounterReset(old);
  assert.equal(reset.spentYocto, "0");
  assert.deepEqual(reset.rates, {});
  assert.deepEqual(reset.allowlist, ["bob.testnet"]);
  assert.equal(reset.counterReset, COUNTER_RESET);
  const again = applyCounterReset({ ...reset, spentYocto: "5" });
  assert.equal(again.spentYocto, "5");
});

test("v1 state migrates: unattributed rules and the shared allowlist are dropped", () => {
  const v1 = {
    killed: false,
    allowlist: ["attacker.testnet"],
    rules: [
      { id: "r1", type: "schedule_send", createdAt: NOW.toISOString(), enabled: true, amountNear: "0.3", recipient: "attacker.testnet", cadence: "daily" },
      { id: "r2", type: "schedule_send", createdAt: NOW.toISOString(), enabled: true, amountNear: "0.1", recipient: "bob.testnet", cadence: "daily", owner: "v:abc" },
    ],
    logs: [],
  };
  const state = normalize(v1);
  assert.equal(state.version, STATE_VERSION);
  assert.deepEqual(state.allowlist, []);
  assert.deepEqual(state.rules.map((rule) => rule.id), ["r2"]);
});

test("stored rules and logs are validated on read", () => {
  const state = normalize({
    version: STATE_VERSION,
    rules: [
      { id: "ok", type: "schedule_send", createdAt: "x", enabled: true, amountNear: "0.1", recipient: "bob.testnet", cadence: "daily", owner: "v:a" },
      { id: "bad-recipient", type: "schedule_send", createdAt: "x", enabled: true, amountNear: "0.1", recipient: "BOB<script>", cadence: "daily", owner: "v:a" },
      { id: "bad-amount", type: "schedule_send", createdAt: "x", enabled: true, amountNear: "1e9", recipient: "bob.testnet", cadence: "daily", owner: "v:a" },
      { id: "bad-type", type: "deploy", createdAt: "x", amountNear: "1", owner: "v:a" },
    ],
    logs: [
      { id: "l1", at: "x", action: "transfer", reason: "ok", explorerUrl: "javascript:alert(1)", hash: "not a hash!" },
      { id: "l2", at: "x", action: "explode", reason: "no" },
    ],
  });
  assert.deepEqual(state.rules.map((rule) => rule.id), ["ok"]);
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].explorerUrl, undefined);
  assert.equal(state.logs[0].hash, undefined);
});
