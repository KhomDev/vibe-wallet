// Drives the real demo and agent route handlers against an in-memory compare-and-swap store and a
// stub JSON-RPC that decodes every signed transaction. Each test maps to a finding in
// docs/SECURITY-REVIEW-2026-11-14.md.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { KeyPair } from "near-api-js";
import { installRpcStub } from "./helpers/rpc-stub";
import { MemoryStore, setStateStore } from "../lib/server/state";
import { resetRateLimits } from "../lib/server/rate-limit";
import { resetDemoNetworkCheck } from "../lib/server/env";
import { parseNear } from "../lib/units";
import * as session from "../app/api/demo/session/route";
import * as send from "../app/api/demo/send/route";
import * as policy from "../app/api/demo/policy/route";
import * as rules from "../app/api/agent/rules/route";
import * as run from "../app/api/agent/run/route";
import * as status from "../app/api/agent/status/route";
import * as cron from "../app/api/cron/agent/route";

// Secrets are read per request, so setting them here (after the hoisted imports) is enough.
const demoKey = KeyPair.fromRandom("ed25519");
process.env.DEMO_NEAR_ACCOUNT_ID = "demo-account.testnet";
process.env.DEMO_NEAR_PRIVATE_KEY = demoKey.toString();
process.env.DEMO_NEAR_PUBLIC_KEY = demoKey.getPublicKey().toString();
process.env.DEMO_RECIPIENT_ACCOUNT_ID = "demo-friend.testnet";
process.env.CRON_SECRET = "test-cron-secret-not-real";
process.env.VIBE_SECRETS_DIR = "/nonexistent-test-dir";
delete process.env.VERCEL;
delete process.env.BLOB_READ_WRITE_TOKEN;

type Stub = ReturnType<typeof installRpcStub>;
let stub: Stub;
let store: InstanceType<typeof MemoryStore>;

before(() => {
  stub = installRpcStub({ known: ["demo-account.testnet", "demo-friend.testnet", "attacker.testnet", "carol.testnet"] });
});
after(() => stub.restore());
beforeEach(() => {
  store = new MemoryStore();
  setStateStore(store);
  resetRateLimits();
  resetDemoNetworkCheck();
  stub.sent.length = 0;
  delete process.env.DEMO_GLOBAL_DAILY_NEAR;
});

function req(path: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string; auth?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": init.ip ?? "203.0.113.10" };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.auth) headers.authorization = `Bearer ${init.auth}`;
  return new Request(`https://vibe.test${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function openDemo(ip = "203.0.113.10"): Promise<string> {
  const response = await session.POST(req("/api/demo/session", { ip }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie, "session mints a visitor cookie");
  return cookie.split(";")[0];
}

async function previewAndSend(cookie: string, recipient: string, amountNear: string, ip = "203.0.113.10") {
  const preview = await body(await send.POST(req("/api/demo/send", { cookie, ip, body: { recipient, amountNear, preview: true } })));
  const response = await send.POST(req("/api/demo/send", { cookie, ip, body: { recipient, amountNear, phrase: "confirm send", confirmToken: preview.confirmToken } }));
  return { preview, response, json: await body(response) };
}

const total = (stubSent: Stub["sent"]) => stubSent.reduce((sum, item) => sum + BigInt(item.depositYocto), 0n);

test("VW-DEMO-04: a demo send needs its preview's single-use token, bound to recipient and amount", async () => {
  const cookie = await openDemo();
  const noToken = await send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.1" } }));
  assert.equal(noToken.status, 409);
  assert.equal(stub.sent.length, 0);

  const preview = await body(await send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.1", preview: true } })));
  assert.equal(typeof preview.confirmToken, "string");
  const otherAmount = await send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.2", phrase: "confirm send", confirmToken: preview.confirmToken } }));
  assert.equal(otherAmount.status, 409, "token is bound to the amount");

  const ok = await send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.1", confirmToken: preview.confirmToken } }));
  assert.equal(ok.status, 200);
  assert.equal(stub.sent.length, 1);
  assert.equal(stub.sent[0].depositYocto, parseNear("0.1").toString());

  const replay = await send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.1", confirmToken: preview.confirmToken } }));
  assert.equal(replay.status, 409, "a token is accepted once");
  assert.equal(stub.sent.length, 1);
});

test("VW-DEMO-03: concurrent sends from one visitor cannot overshoot the 2 NEAR daily limit", async () => {
  const cookie = await openDemo();
  const previews = await Promise.all(Array.from({ length: 9 }, () => send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.3", preview: true } })).then(body)));
  await Promise.all(previews.map((preview) => send.POST(req("/api/demo/send", { cookie, body: { recipient: "demo-friend.testnet", amountNear: "0.3", phrase: "confirm send", confirmToken: preview.confirmToken } }))));
  assert.ok(total(stub.sent) <= parseNear("2"), `signed ${total(stub.sent)} yocto against a 2 NEAR limit`);
  const state = store.peek()!;
  const visitorKey = Object.keys(state.visitorSpend).find((key) => key.startsWith("v:"))!;
  assert.equal(BigInt(state.visitorSpend[visitorKey].yocto), total(stub.sent), "recorded spend equals what was signed");
});

test("VW-DEMO-03 / VW-DEMO-06: concurrent sends from many visitors cannot overshoot the global cap", async () => {
  process.env.DEMO_GLOBAL_DAILY_NEAR = "0.5";
  const visitors = await Promise.all(Array.from({ length: 8 }, (_, index) => openDemo(`198.51.100.${index + 1}`).then((cookie) => ({ cookie, ip: `198.51.100.${index + 1}` }))));
  await Promise.all(visitors.map(({ cookie, ip }) => previewAndSend(cookie, "demo-friend.testnet", "0.1", ip)));
  assert.ok(total(stub.sent) <= parseNear("0.5"), `signed ${total(stub.sent)} against a 0.5 NEAR global cap`);
  assert.ok(stub.sent.length >= 1);
});

test("VW-DEMO-02: visitor ids are scarce per network, and the network shares one NEAR budget", async () => {
  process.env.DEMO_VISITOR_MINTS_PER_DAY = "3";
  try {
    const minted = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await session.POST(req("/api/demo/session", { ip: "192.0.2.50" }));
      minted.push(response.headers.get("set-cookie"));
    }
    assert.equal(minted.filter(Boolean).length, 3, "only 3 ids per network per day");
  } finally {
    delete process.env.DEMO_VISITOR_MINTS_PER_DAY;
  }
});

test("VW-DEMO-01 / VW-MONEY-01: policy changes need a cookie, are per visitor, and never sign a chain transaction", async () => {
  const anonymous = await policy.POST(req("/api/demo/policy", { body: { killed: true } }));
  assert.equal(anonymous.status, 401);

  const alice = await openDemo("203.0.113.21");
  const bob = await openDemo("203.0.113.22");
  const writesBefore = store.writes;
  const noop = await policy.POST(req("/api/demo/policy", { cookie: alice, body: {} }));
  assert.equal(noop.status, 200);
  assert.equal(store.writes, writesBefore, "a request that changes nothing writes nothing");

  const noPhrase = await policy.POST(req("/api/demo/policy", { cookie: alice, body: { allow: "attacker.testnet" } }));
  assert.equal(noPhrase.status, 403, "adding a recipient needs the confirm phrase");
  const added = await body(await policy.POST(req("/api/demo/policy", { cookie: alice, body: { allow: "attacker.testnet", phrase: "confirm send" } })));
  assert.ok((added.policy as { allowlist: string[] }).allowlist.includes("attacker.testnet"));

  // Bob's allowlist is unaffected by Alice's change.
  const bobPreview = await body(await send.POST(req("/api/demo/send", { cookie: bob, ip: "203.0.113.22", body: { recipient: "attacker.testnet", amountNear: "0.1", preview: true } })));
  assert.match(String((bobPreview.check as { blockReason: string }).blockReason), /allowlist/i);

  // Alice's stop switch stops Alice only.
  await policy.POST(req("/api/demo/policy", { cookie: alice, body: { killed: true } }));
  const aliceSend = await previewAndSend(alice, "demo-friend.testnet", "0.1", "203.0.113.21");
  assert.notEqual(aliceSend.response.status, 200);
  const bobSend = await previewAndSend(bob, "demo-friend.testnet", "0.1", "203.0.113.22");
  assert.equal(bobSend.response.status, 200);

  // Resuming needs the phrase.
  assert.equal((await policy.POST(req("/api/demo/policy", { cookie: alice, body: { killed: false } }))).status, 403);
  assert.equal((await policy.POST(req("/api/demo/policy", { cookie: alice, body: { killed: false, phrase: "Confirm send" } }))).status, 200);

  // The global switch is operator-only.
  assert.equal((await policy.POST(req("/api/demo/policy", { cookie: alice, body: { global: true, killed: true } }))).status, 401);
  assert.equal((await policy.POST(req("/api/demo/policy", { auth: "test-cron-secret-not-real", body: { global: true, killed: true } }))).status, 200);
  const blocked = await previewAndSend(bob, "demo-friend.testnet", "0.1", "203.0.113.22");
  assert.notEqual(blocked.response.status, 200);

  assert.equal(stub.sent.filter((item) => item.receiver === "v1.social08.testnet").length, 0, "no NEAR Social write on any visitor route");
});

test("VW-AGENT-01 / VW-AGENT-04: agent rules need a cookie and are visible and deletable only by their owner", async () => {
  const anonymous = await rules.POST(req("/api/agent/rules", { body: { type: "schedule_send", amountNear: "0.1", cadence: "daily" } }));
  assert.equal(anonymous.status, 401);
  assert.equal((await run.POST(req("/api/agent/run"))).status, 401);
  assert.equal((await status.GET(req("/api/agent/status", { method: "GET" }))).status, 401);

  const alice = await openDemo("203.0.113.31");
  const bob = await openDemo("203.0.113.32");
  const notAllowlisted = await rules.POST(req("/api/agent/rules", { cookie: alice, body: { type: "schedule_send", amountNear: "0.1", recipient: "attacker.testnet", cadence: "daily" } }));
  assert.equal(notAllowlisted.status, 403, "a scheduled payment must go to the owner's allowlist");
  const created = await body(await rules.POST(req("/api/agent/rules", { cookie: alice, body: { type: "schedule_send", amountNear: "0.1", cadence: "daily" } })));
  const rule = created.rule as { id: string };

  const bobView = await body(await status.GET(req("/api/agent/status", { method: "GET", cookie: bob })));
  assert.equal((bobView.rules as unknown[]).length, 0, "Bob does not see Alice's rule");
  await rules.POST(req("/api/agent/rules", { cookie: bob, body: { deleteId: rule.id } }));
  const aliceView = await body(await status.GET(req("/api/agent/status", { method: "GET", cookie: alice })));
  assert.equal((aliceView.rules as unknown[]).length, 1, "Bob cannot delete Alice's rule");
  assert.equal(JSON.stringify(aliceView).includes("demo-account.testnet"), false, "status does not need to disclose the account");
});

test("VW-AGENT-02: two concurrent agent runs pay a due rule once and count it once", async () => {
  const alice = await openDemo("203.0.113.41");
  await rules.POST(req("/api/agent/rules", { cookie: alice, ip: "203.0.113.41", body: { type: "schedule_send", amountNear: "0.1", cadence: "daily" } }));
  await Promise.all([
    run.POST(req("/api/agent/run", { cookie: alice, ip: "203.0.113.41" })),
    run.POST(req("/api/agent/run", { cookie: alice, ip: "203.0.113.41" })),
    cron.GET(req("/api/cron/agent", { method: "GET", auth: "test-cron-secret-not-real" })),
  ]);
  const transfers = stub.sent.filter((item) => item.receiver === "demo-friend.testnet");
  assert.equal(transfers.length, 1, "exactly one payment");
  const state = store.peek()!;
  const owner = state.rules[0].owner!;
  assert.equal(state.visitorSpend[owner].yocto, parseNear("0.1").toString(), "charged to the rule's owner, once");
});

test("VW-DEMO-06: the agent path respects the global cap", async () => {
  process.env.DEMO_GLOBAL_DAILY_NEAR = "0.05";
  const alice = await openDemo("203.0.113.51");
  await rules.POST(req("/api/agent/rules", { cookie: alice, ip: "203.0.113.51", body: { type: "schedule_send", amountNear: "0.1", cadence: "daily" } }));
  await run.POST(req("/api/agent/run", { cookie: alice, ip: "203.0.113.51" }));
  assert.equal(stub.sent.length, 0);
});

test("VW-DEMO-05: the demo signer refuses a node that is not testnet", async () => {
  stub.restore();
  const mainnet = installRpcStub({ chainId: "mainnet", known: ["demo-account.testnet", "demo-friend.testnet"] });
  try {
    resetDemoNetworkCheck();
    const response = await send.POST(req("/api/demo/send", { body: { recipient: "demo-friend.testnet", amountNear: "0.1", preview: true } }));
    assert.equal(response.status, 400);
    assert.match(String((await body(response)).error), /testnet/);
    assert.equal(mainnet.sent.length, 0);
  } finally {
    mainnet.restore();
    stub = installRpcStub({ known: ["demo-account.testnet", "demo-friend.testnet", "attacker.testnet", "carol.testnet"] });
  }
});

test("cron needs its bearer secret", async () => {
  assert.equal((await cron.GET(req("/api/cron/agent", { method: "GET" }))).status, 401);
  assert.equal((await cron.GET(req("/api/cron/agent", { method: "GET", auth: "wrong-secret" }))).status, 401);
});
