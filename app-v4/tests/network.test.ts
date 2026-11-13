import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RPC, NETWORK_ID, explorerTxUrl, historyUrl, resolveNetwork } from "../lib/config";
import { MAINNET_PROOF, mainnetTxUrl } from "../lib/mainnet-proof";
import { executeIntentsSwap } from "../lib/server/intents-swap";

test("testnet is the default network and only an explicit 'mainnet' switches", () => {
  assert.equal(resolveNetwork(undefined), "testnet");
  assert.equal(resolveNetwork(""), "testnet");
  assert.equal(resolveNetwork("main"), "testnet");
  assert.equal(resolveNetwork(" MAINNET "), "mainnet");
  assert.equal(NETWORK_ID, "testnet");
});

test("explorer and indexer URLs follow the network", () => {
  assert.equal(explorerTxUrl("abc", "testnet"), "https://testnet.nearblocks.io/txns/abc");
  assert.equal(explorerTxUrl("abc", "mainnet"), "https://nearblocks.io/txns/abc");
  assert.match(historyUrl("a.near", "mainnet"), /^https:\/\/api\.nearblocks\.io\//);
  assert.match(DEFAULT_RPC.mainnet, /^https:\/\//);
});

test("Intents execution refuses to run on testnet", async () => {
  await assert.rejects(
    executeIntentsSwap({ accountId: "a.testnet", secretKey: "ed25519:x", amountNear: "0.01", toSymbol: "USDC", userConfirmed: true, maxNear: "0.05" }),
    /mainnet-only/,
  );
});

test("mainnet proof links point at mainnet nearblocks", () => {
  for (const tx of [MAINNET_PROOF.send, MAINNET_PROOF.swapDeposit, MAINNET_PROOF.swapSettlement]) {
    assert.match(mainnetTxUrl(tx.hash), /^https:\/\/nearblocks\.io\/txns\/[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  }
});
