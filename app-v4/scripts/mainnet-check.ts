/**
 * Mainnet check of the 2026-11-14 logic, with no private key: nothing is signed or broadcast.
 *
 *   npx tsx scripts/mainnet-check.ts [account] [allowlisted-recipient] [out.json]
 *
 * Defaults to the account and recipient of the 13 Nov 2026 mainnet proof. Checks, against live
 * NEAR mainnet:
 *   1. the RPC really is mainnet (chain_id), and the shared-demo signer refuses to sign there;
 *   2. the wallet policy on the live balance: an allowlisted 0.01 NEAR send passes with the slide
 *      only, 0.05 needs the phrase (threshold), 0.06 is over the per-send cap, and an unknown
 *      recipient is refused;
 *   3. the account has a full-access key on chain (what executeTransfer verifies before signing);
 *   4. send reconciliation: the proof transactions are looked up by hash exactly as the signer
 *      does after a timeout, and are reported as landed;
 *   5. a NEAR Intents 1Click quote with dry: true (quote only, no deposit address, no trade).
 */
import { writeFileSync } from "node:fs";

process.env.NEAR_NETWORK = "mainnet";
delete process.env.NEXT_PUBLIC_NEAR_NETWORK;
delete process.env.NEXT_PUBLIC_NEAR_RPC_URL;

type Check = { step: string; ok: boolean; detail: string };

async function main() {
  const [accountArg, recipientArg, outPath] = process.argv.slice(2);
  const { NETWORK_ID, RPC_URL } = await import("../lib/config");
  const { MAINNET_PROOF } = await import("../lib/mainnet-proof");
  const { accountExists, estimateTransferFee, getProvider, listKeys, readBalance } = await import("../lib/near/read");
  const { assessSend, defaultStoredPolicy, toPolicy } = await import("../lib/policy");
  const { assertDemoNetwork } = await import("../lib/server/env");
  const { dryIntentsQuote } = await import("../lib/server/quote");
  const { formatNear, parseNear } = await import("../lib/units");
  const { JsonRpcProvider } = await import("near-api-js");

  const account = accountArg || MAINNET_PROOF.account;
  const recipient = recipientArg || "gateway.hlpok1lad.tg";
  const checks: Check[] = [];
  const check = (step: string, ok: boolean, detail: string) => {
    checks.push({ step, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
  };

  // 1. Network.
  const status = await getProvider().viewNodeStatus();
  check("RPC is NEAR mainnet", NETWORK_ID === "mainnet" && status.chain_id === "mainnet", `${RPC_URL} reports chain_id ${status.chain_id}, protocol ${status.protocol_version}`);
  let refused = "";
  try {
    await assertDemoNetwork();
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  check("shared-demo signer refuses mainnet", refused.length > 0, refused || "did not refuse");

  // 2. Policy on the live balance.
  const balance = await readBalance(account);
  const [recipientExists, feeYocto] = await Promise.all([accountExists(recipient), estimateTransferFee(false)]);
  check("account and recipient exist on mainnet", Boolean(balance) && recipientExists, `${account}: ${balance?.availableNear ?? "missing"} NEAR available; ${recipient}: ${recipientExists ? "exists" : "missing"}; fee estimate ${formatNear(feeYocto, 8)} NEAR`);
  const policy = toPolicy({ ...defaultStoredPolicy(), perTxNear: "0.05", dailyNear: "0.2", thresholdNear: "0.05", allowlist: [recipient], allowlistOnly: true });
  const facts = (amount: string, to = recipient, exists = recipientExists) => ({
    recipient: to,
    amountYocto: parseNear(amount),
    feeYocto,
    availableYocto: BigInt(balance?.availableYocto ?? "0"),
    spentTodayYocto: 0n,
    accountExists: exists,
  });
  const small = assessSend(policy, facts("0.01"), account);
  check("0.01 NEAR to the allowlisted recipient: allowed, slide only", small.ok && !small.needsPhrase, small.blockReason ?? `needsPhrase=${small.needsPhrase}`);
  const atThreshold = assessSend(policy, facts("0.05"), account);
  check("0.05 NEAR (at the extra-confirm threshold): needs the phrase", atThreshold.ok && atThreshold.needsPhrase, atThreshold.phraseReasons.join(" ") || "no phrase required");
  const over = assessSend(policy, facts("0.06"), account);
  check("0.06 NEAR: over the per-send cap, blocked", Boolean(over.blockReason?.includes("per-transaction")), over.blockReason ?? "not blocked");
  const stranger = assessSend(policy, facts("0.01", "near", true), account);
  check("unknown recipient with allowlist-only: blocked", Boolean(stranger.blockReason?.includes("Allowlist")), stranger.blockReason ?? "not blocked");

  // 3. Full-access key (public information).
  const keys = await listKeys(account);
  const full = keys.filter((key) => key.kind === "full").length;
  check("account has a full-access key the signer can verify", full > 0, `${full} full-access and ${keys.length - full} other key(s) on chain`);

  // 4. Reconciliation by hash, through the archival node (regular nodes drop old transactions).
  const archival = new JsonRpcProvider({ url: "https://archival-rpc.mainnet.fastnear.com" }, { retries: 3, wait: 500, backoff: 1.5 });
  for (const item of [MAINNET_PROOF.send, MAINNET_PROOF.swapWrap, MAINNET_PROOF.swapDeposit]) {
    try {
      const found = await archival.viewTransactionStatus({ txHash: item.hash, accountId: account, waitUntil: "EXECUTED" }) as unknown as {
        status?: unknown;
        transaction?: { hash?: string; receiver_id?: string; actions?: unknown[] };
      };
      const failed = Boolean(found.status && typeof found.status === "object" && "Failure" in found.status);
      check(`reconcile ${item.hash.slice(0, 8)}…: landed`, !failed && found.transaction?.hash === item.hash, `${failed ? "FAILED on chain" : "SUCCESS"} -> ${found.transaction?.receiver_id}`);
    } catch (err) {
      check(`reconcile ${item.hash.slice(0, 8)}…`, false, err instanceof Error ? err.message.slice(0, 160) : String(err));
    }
  }

  // 5. Dry 1Click quote.
  try {
    const quote = await dryIntentsQuote({ accountId: account, amountNear: "0.03", toSymbol: "USDC" });
    check("NEAR Intents 1Click quote with dry: true", quote.dry === true && Number(quote.amountOutFormatted) > 0, `0.03 NEAR -> about ${quote.amountOutFormatted} ${quote.destinationSymbol} (${quote.label})`);
  } catch (err) {
    check("NEAR Intents 1Click quote with dry: true", false, err instanceof Error ? err.message.slice(0, 160) : String(err));
  }

  const failed = checks.filter((item) => !item.ok).length;
  const report = { network: "mainnet", rpc: RPC_URL, account, recipient, at: new Date().toISOString(), signed: 0, broadcast: 0, failed, checks };
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\n${checks.length - failed}/${checks.length} passed. Nothing was signed or broadcast.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
