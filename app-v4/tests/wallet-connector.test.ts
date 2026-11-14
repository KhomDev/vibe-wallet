import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { formatTokenAmount, readPolicyWallet } from "../lib/near/policy-wallet";
import { selectorNetwork } from "../lib/near/wallet-connector";
import { walletTransfer } from "../lib/near/wallet-send";
import { SendError } from "../lib/near/broadcast";
import { defaultStoredPolicy, toPolicy } from "../lib/policy";
import { parseNear } from "../lib/units";
import { installRpcStub } from "./helpers/rpc-stub";

let stub: ReturnType<typeof installRpcStub>;
before(() => {
  stub = installRpcStub({ known: ["alice.testnet", "bob.testnet"] });
});
after(() => stub.restore());

test("the wallet selector uses the FastNEAR RPC, not the deprecated near.org endpoints", () => {
  const network = selectorNetwork();
  assert.equal(network.networkId, "testnet");
  assert.match(network.nodeUrl, /fastnear/);
});

test("a send the policy blocks never reaches the wallet", async () => {
  const policy = toPolicy({ ...defaultStoredPolicy(), allowlist: ["bob.testnet"] });
  const attempt = (overrides: Partial<Parameters<typeof walletTransfer>[0]>) => walletTransfer({
    accountId: "alice.testnet",
    recipient: "bob.testnet",
    amountYocto: parseNear("0.1"),
    policy,
    spentTodayYocto: 0n,
    userConfirmed: true,
    confirmationPhrase: null,
    ...overrides,
  });
  const isRefusal = (err: unknown) => err instanceof SendError && !err.broadcast && err.outcome === "not-sent";
  await assert.rejects(attempt({ policy: { ...policy, killed: true } }), isRefusal);
  await assert.rejects(attempt({ amountYocto: parseNear("3") }), isRefusal, "over the per-send cap");
  await assert.rejects(attempt({ spentTodayYocto: parseNear("4.95") }), isRefusal, "over the daily cap");
  await assert.rejects(attempt({ recipient: "carol.testnet" }), isRefusal, "unknown recipient that does not exist");
  await assert.rejects(attempt({ amountYocto: parseNear("1") }), isRefusal, "needs the phrase at the threshold");
  await assert.rejects(attempt({ userConfirmed: false }), isRefusal);
  assert.equal(stub.sent.length, 0);
});

test("the TriagePay policy wallet is read with view calls and mapped field by field", async () => {
  const calls: string[] = [];
  const view = await readPolicyWallet("tp-wallet.example.near", "tp-agent.example.near", async <T,>(contract: string, method: string, args: Record<string, unknown>) => {
    calls.push(`${contract}.${method}(${JSON.stringify(args)})`);
    if (method === "get_config") return { owner: "owner.near", paused: false, tokens: ["wrap.near"] } as T;
    if (method === "get_agent") return { per_call_max: "1000000", daily_max: "4000000", payees: ["gateway.near"], active: true, spent_in_window: "0", remaining: "4000000" } as T;
    return { approval_threshold: "500000", review_unknown_payees: false, pending_count: 0, max_pending: 8 } as T;
  });
  assert.deepEqual(calls, [
    "tp-wallet.example.near.get_config({})",
    "tp-wallet.example.near.get_agent({\"agent_id\":\"tp-agent.example.near\"})",
    "tp-wallet.example.near.get_review_policy({})",
  ]);
  assert.equal(view.owner, "owner.near");
  assert.equal(view.agent?.perCallMax, "1000000");
  assert.deepEqual(view.agent?.payees, ["gateway.near"]);
  assert.equal(view.review?.maxPending, 8);
  assert.equal(formatTokenAmount("1000000", 24), "0.000000000000000001", "tiny caps are not shown as 0");
});
