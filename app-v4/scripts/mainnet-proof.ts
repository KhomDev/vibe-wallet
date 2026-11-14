/**
 * Mainnet proof for Vibe Wallet.
 *
 * Runs two tiny, real mainnet actions through the app's own code:
 *   1. A NEAR transfer via lib/near/signer.ts executeTransfer (same policy
 *      checks, confirm flag, and full-access key check as the wallet).
 *   2. An executed NEAR Intents swap (NEAR -> USDC) via lib/server/intents-swap.ts.
 *
 * This moves real NEAR. It refuses to run without --broadcast; for a check that signs nothing, use
 * scripts/mainnet-check.ts.
 *
 * Usage (keys come from the environment and are never printed):
 *   NEAR_NETWORK=mainnet MAINNET_ACCOUNT_ID=... MAINNET_PRIVATE_KEY=ed25519:... \
 *   PROOF_RECIPIENT=... npx tsx scripts/mainnet-proof.ts --broadcast [--skip-swap]
 */
process.env.NEAR_NETWORK = "mainnet";

async function main() {
  if (!process.argv.includes("--broadcast")) {
    throw new Error("This script sends real mainnet NEAR. Re-run with --broadcast, or use scripts/mainnet-check.ts for a check that signs nothing.");
  }
  const skipSwap = process.argv.includes("--skip-swap");
  const { NETWORK_ID, explorerTxUrl } = await import("../lib/config");
  const { publicKeyOf, readBalance } = await import("../lib/near/read");
  const { executeTransfer } = await import("../lib/near/signer");
  const { executeIntentsSwap } = await import("../lib/server/intents-swap");
  const { defaultStoredPolicy, toPolicy } = await import("../lib/policy");
  const { parseNear } = await import("../lib/units");

  if (NETWORK_ID !== "mainnet") throw new Error("Refusing to run: network is not mainnet.");
  const accountId = String(process.env.MAINNET_ACCOUNT_ID || "").trim();
  const secret = String(process.env.MAINNET_PRIVATE_KEY || "").trim();
  const recipient = String(process.env.PROOF_RECIPIENT || "").trim();
  const sendNear = process.env.PROOF_SEND_NEAR || "0.01";
  const swapNear = process.env.PROOF_SWAP_NEAR || "0.03";
  if (!accountId || !secret || !recipient) throw new Error("Set MAINNET_ACCOUNT_ID, MAINNET_PRIVATE_KEY and PROOF_RECIPIENT.");

  const before = await readBalance(accountId);
  console.log(`account ${accountId} on ${NETWORK_ID}, available ${before?.availableNear} NEAR`);

  // Tight mainnet guardrails: 0.05 NEAR per tx, 0.2 NEAR per day, allowlist only.
  const policy = toPolicy({ ...defaultStoredPolicy(), perTxNear: "0.05", dailyNear: "0.2", thresholdNear: "0.05", allowlist: [recipient], allowlistOnly: true });
  const send = await executeTransfer({
    accountId,
    fullSecret: secret,
    expectedPublicKey: publicKeyOf(secret),
    recipient,
    amountYocto: parseNear(sendNear),
    policy,
    spentTodayYocto: 0n,
    userConfirmed: true,
    confirmationPhrase: null,
  });
  console.log(`SEND ${sendNear} NEAR -> ${recipient}: ${explorerTxUrl(send.hash)}${send.reconciled ? " (confirmed by hash lookup after a send timeout)" : ""}`);
  if (skipSwap) return;

  const swap = await executeIntentsSwap({
    accountId,
    secretKey: secret,
    amountNear: swapNear,
    toSymbol: "USDC",
    userConfirmed: true,
    maxNear: "0.05",
    onStep: (s) => console.log(`  ${s}`),
  });
  if (swap.wrapTx) console.log(`WRAP: ${explorerTxUrl(swap.wrapTx)}`);
  console.log(`SWAP DEPOSIT: ${explorerTxUrl(swap.depositTx)}`);
  console.log(`SWAP STATUS: ${swap.status}`);
  console.log(`SWAP DETAILS: ${JSON.stringify(swap.settlement)}`);
  const after = await readBalance(accountId);
  console.log(`available after ${after?.availableNear} NEAR`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
