import { test } from "node:test";
import assert from "node:assert/strict";
import { readTokenBalances, type TokenSpec } from "../lib/token-balances";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const TOKENS: TokenSpec[] = [
  { symbol: "USDC", subtitle: "USD Coin", contract: USDC, decimals: 6, mark: "usdc" },
  { symbol: "ETH", subtitle: "Ether", contract: "eth.bridge.near", decimals: 18, mark: "eth" },
];

test("wallet USDC keeps 6 decimals (the 0.09625 swap output is visible) and Intents balances are shown separately", async () => {
  const calls: string[] = [];
  const view = async (contractId: string, method: string, args: Record<string, unknown>) => {
    calls.push(`${contractId}.${method}`);
    if (method === "ft_balance_of") return contractId === USDC ? "709879" : "0";
    assert.deepEqual(args.token_ids, [`nep141:${USDC}`, "nep141:eth.bridge.near"]);
    return ["96250", "0"];
  };
  const rows = await readTokenBalances("hlpok1lad.tg", TOKENS, view, "intents.near");
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].wallet, "0.709879");
  assert.equal(rows[0].intents, "0.09625");
  assert.equal(rows[1].wallet, "0");
  assert.equal(rows[1].intents, null);
  assert.ok(calls.includes("intents.near.mt_batch_balance_of"));
});

test("a failed RPC read is an error, never a fake 0, and a transient failure is retried", async () => {
  let usdcTries = 0;
  const view = async (contractId: string, method: string) => {
    if (method !== "ft_balance_of") throw new Error("rate limited");
    if (contractId === USDC) {
      usdcTries += 1;
      if (usdcTries === 1) throw new Error("429");
      return "96250";
    }
    throw new Error("down");
  };
  const rows = await readTokenBalances("hlpok1lad.tg", TOKENS, view, "intents.near");
  assert.equal(rows[0].status, "ok");
  assert.equal(rows[0].wallet, "0.09625");
  assert.equal(rows[0].intents, null);
  assert.equal(rows[1].status, "error");
  assert.equal(rows[1].wallet, null);
});

test("no Intents read on testnet", async () => {
  const methods: string[] = [];
  await readTokenBalances("a.testnet", TOKENS, async (_c, m) => { methods.push(m); return "1"; }, null);
  assert.ok(!methods.includes("mt_batch_balance_of"));
});
