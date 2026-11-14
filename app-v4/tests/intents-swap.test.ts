import assert from "node:assert/strict";
import { test } from "node:test";
import { QUOTE_ASSETS } from "../lib/assets";
import { buildSwapTransactions, readSwapChainState, STORAGE_DEPOSIT_YOCTO, verifyLiveQuote, type LiveQuote } from "../lib/intents-swap-client";
import { assessSwap, defaultStoredPolicy, toPolicy } from "../lib/policy";
import { liveQuoteRequest } from "../lib/server/intents-api";
import { parseIntent } from "../lib/intent";
import { parseNear } from "../lib/units";
import { POST as quotePost } from "../app/api/intents/quote/route";

const ACCOUNT = "alice.near";
const DEPOSIT = "a".repeat(64);
const NOW = Date.parse("2026-11-14T12:00:00Z");

function quote(overrides: Partial<LiveQuote> = {}): LiveQuote {
  return {
    depositAddress: DEPOSIT,
    amountIn: parseNear("0.03").toString(),
    amountInFormatted: "0.03",
    amountOut: "102707",
    amountOutFormatted: "0.102707",
    minAmountOut: "101680",
    minAmountOutFormatted: "0.10168",
    deadline: new Date(NOW + 20 * 60 * 1000).toISOString(),
    timeEstimate: 20,
    originAsset: QUOTE_ASSETS.NEAR.assetId,
    destinationAsset: QUOTE_ASSETS.USDC.assetId,
    recipient: ACCOUNT,
    refundTo: ACCOUNT,
    toSymbol: "USDC",
    ...overrides,
  };
}

const expected = { accountId: ACCOUNT, amountYocto: parseNear("0.03"), toSymbol: "USDC" as const };

test("the executable quote request delivers to and refunds the user's own account", () => {
  const request = liveQuoteRequest({ accountId: ACCOUNT, amountYocto: parseNear("0.03"), toSymbol: "USDC", now: NOW });
  assert.equal(request.dry, false);
  assert.equal(request.recipient, ACCOUNT);
  assert.equal(request.refundTo, ACCOUNT);
  assert.equal(request.originAsset, "nep141:wrap.near");
  assert.equal(request.amount, parseNear("0.03").toString());
});

test("a live quote is accepted only if it matches what the user asked for", () => {
  assert.deepEqual(verifyLiveQuote(quote(), expected, NOW), []);
  assert.ok(verifyLiveQuote(quote({ amountIn: parseNear("3").toString() }), expected, NOW).length > 0, "different amount");
  assert.ok(verifyLiveQuote(quote({ recipient: "mallory.near" }), expected, NOW).some((p) => /different account/.test(p)));
  assert.ok(verifyLiveQuote(quote({ refundTo: "mallory.near" }), expected, NOW).some((p) => /refund/.test(p)));
  assert.ok(verifyLiveQuote(quote({ destinationAsset: QUOTE_ASSETS.USDT.assetId }), expected, NOW).length > 0, "different token");
  assert.ok(verifyLiveQuote(quote({ depositAddress: "" }), expected, NOW).length > 0, "no deposit address");
  assert.ok(verifyLiveQuote(quote({ depositAddress: ACCOUNT }), expected, NOW).length > 0, "deposit to self");
  assert.ok(verifyLiveQuote(quote({ deadline: new Date(NOW + 30_000).toISOString() }), expected, NOW).length > 0, "expiring");
  assert.ok(verifyLiveQuote(quote({ amountOut: "0" }), expected, NOW).length > 0, "nothing out");
});

test("the swap is exactly: optional registrations, wrap the shortfall, register the deposit address, transfer the quoted amount", () => {
  const fresh = buildSwapTransactions(quote(), ACCOUNT, { wrappedYocto: 0n, userOnWrap: false, userOnDestination: false });
  assert.equal(fresh.transactions.length, 2);
  assert.equal(fresh.transactions[0].receiverId, QUOTE_ASSETS.USDC.assetId.replace("nep141:", ""));
  const wrap = fresh.transactions[1];
  assert.equal(wrap.receiverId, "wrap.near");
  const methods = wrap.actions.map((action) => action.type === "FunctionCall" ? action.params.methodName : action.type);
  assert.deepEqual(methods, ["storage_deposit", "near_deposit", "storage_deposit", "ft_transfer"]);
  const transfer = wrap.actions[3];
  assert.ok(transfer.type === "FunctionCall");
  if (transfer.type === "FunctionCall") {
    assert.deepEqual(transfer.params.args, { receiver_id: DEPOSIT, amount: parseNear("0.03").toString(), memo: "vibe-wallet intents swap" });
    assert.equal(transfer.params.deposit, "1");
  }
  assert.equal(fresh.attachedYocto, parseNear("0.03") + STORAGE_DEPOSIT_YOCTO * 3n + 1n);

  const ready = buildSwapTransactions(quote(), ACCOUNT, { wrappedYocto: parseNear("0.05"), userOnWrap: true, userOnDestination: true });
  assert.equal(ready.transactions.length, 1);
  assert.deepEqual(ready.transactions[0].actions.map((action) => action.type === "FunctionCall" ? action.params.methodName : action.type), ["storage_deposit", "ft_transfer"]);

  const partial = buildSwapTransactions(quote(), ACCOUNT, { wrappedYocto: parseNear("0.01"), userOnWrap: true, userOnDestination: true });
  const wrapCall = partial.transactions[0].actions.find((action) => action.type === "FunctionCall" && action.params.methodName === "near_deposit");
  assert.ok(wrapCall && wrapCall.type === "FunctionCall" && wrapCall.params.deposit === parseNear("0.02").toString(), "only the shortfall is wrapped");
});

test("chain state is read with view calls only", async () => {
  const calls: string[] = [];
  const state = await readSwapChainState(async <T,>(contract: string, method: string) => {
    calls.push(`${contract}.${method}`);
    if (method === "ft_balance_of") return "\"5000\"" as T;
    return (contract === "wrap.near" ? { total: "1" } : null) as T;
  }, ACCOUNT, QUOTE_ASSETS.USDC.assetId);
  assert.equal(state.wrappedYocto, 5000n);
  assert.equal(state.userOnWrap, true);
  assert.equal(state.userOnDestination, false);
  assert.ok(calls.every((call) => /ft_balance_of|storage_balance_of/.test(call)));
});

test("the swap policy: limits apply, the phrase is always required, the kill switch stops it", () => {
  const policy = toPolicy(defaultStoredPolicy());
  const facts = { amountYocto: parseNear("0.03"), extraYocto: STORAGE_DEPOSIT_YOCTO * 3n, feeYocto: parseNear("0.001"), availableYocto: parseNear("2"), spentTodayYocto: 0n, maxSwapYocto: parseNear("1") };
  const ok = assessSwap(policy, facts);
  assert.equal(ok.ok, true);
  assert.equal(ok.needsPhrase, true);
  assert.match(assessSwap({ ...policy, killed: true }, facts).blockReason ?? "", /kill switch/i);
  assert.match(assessSwap(policy, { ...facts, amountYocto: parseNear("1.5") }).blockReason ?? "", /capped/);
  assert.match(assessSwap({ ...policy, perTxYocto: parseNear("0.01") }, facts).blockReason ?? "", /per-transaction/);
  assert.match(assessSwap(policy, { ...facts, spentTodayYocto: parseNear("4.99") }).blockReason ?? "", /daily/);
  assert.match(assessSwap(policy, { ...facts, availableYocto: parseNear("0.03") }).blockReason ?? "", /balance/);
});

test("the executable-quote route refuses on a testnet build", async () => {
  const response = await quotePost(new Request("http://localhost/api/intents/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: ACCOUNT, amountNear: "0.03", toSymbol: "USDC" }),
  }));
  assert.equal(response.status, 400);
  assert.match(String(((await response.json()) as { error?: string }).error), /mainnet only/);
});

test("on-chain limits have their own intent", () => {
  assert.deepEqual(parseIntent("show on-chain limits"), { type: "onchain_limits" });
  assert.deepEqual(parseIntent("what does the TriagePay contract allow"), { type: "onchain_limits" });
  assert.equal(parseIntent("show my limits").type, "show_safety");
});
