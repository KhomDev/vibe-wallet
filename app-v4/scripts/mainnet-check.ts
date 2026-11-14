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
 *   5. a NEAR Intents 1Click quote with dry: true (quote only, no deposit address, no trade);
 *   6. the TriagePay policy wallet's limits, read from its contract (view calls);
 *   7. the confirm-card swap up to the signature: an executable quote (dry: false) is verified and the
 *      exact transactions are built from the account's chain state. They are not signed or sent.
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

  // 6. TriagePay policy wallet: limits the chain enforces.
  let onchain: unknown = null;
  try {
    const { readPolicyWallet, formatTokenAmount } = await import("../lib/near/policy-wallet");
    const policyWallet = await readPolicyWallet();
    onchain = policyWallet;
    const agent = policyWallet.agent;
    check(
      "TriagePay policy wallet limits read from chain",
      Boolean(agent) && !policyWallet.paused,
      agent
        ? `${policyWallet.walletId}: agent ${policyWallet.agentId} ${agent.active ? "active" : "revoked"}, per payment ${formatTokenAmount(agent.perCallMax, policyWallet.decimals)} wNEAR, per day ${formatTokenAmount(agent.dailyMax, policyWallet.decimals)} wNEAR, payees [${agent.payees.join(", ")}]`
        : "no agent",
    );
  } catch (err) {
    check("TriagePay policy wallet limits read from chain", false, err instanceof Error ? err.message.slice(0, 160) : String(err));
  }

  // 7. The confirm-card swap, up to the signature: an executable quote, verified, and the exact
  //    transactions the user's wallet would be asked to sign. Nothing is signed or sent, and no
  //    NEAR moves; 1Click only records a quote and a deposit address that expires unused.
  let swapPlan: unknown = null;
  try {
    const { fetchLiveQuote } = await import("../lib/server/intents-api");
    const { buildSwapTransactions, readSwapChainState, verifyLiveQuote } = await import("../lib/intents-swap-client");
    const { assessSwap } = await import("../lib/policy");
    const amountYocto = parseNear("0.03");
    const live = await fetchLiveQuote({ accountId: account, amountYocto, toSymbol: "USDC" });
    const problems = verifyLiveQuote(live, { accountId: account, amountYocto, toSymbol: "USDC" });
    check("executable 1Click quote (dry: false) matches the request", problems.length === 0, problems.join(" ") || `0.03 NEAR -> about ${live.amountOutFormatted} USDC (min ${live.minAmountOutFormatted}), deposit address ${live.depositAddress.slice(0, 12)}…, delivers to and refunds ${account}`);
    const view = async <T,>(contractId: string, method: string, args: Record<string, unknown>) => (await getProvider().callFunction({ contractId, method, args })) as unknown as T;
    const chain = await readSwapChainState(view, account, live.destinationAsset, "wrap.near");
    const built = buildSwapTransactions(live, account, chain, "wrap.near");
    const swapCheck = assessSwap(toPolicy({ ...defaultStoredPolicy(), perTxNear: "0.05", dailyNear: "0.2" }), {
      amountYocto,
      extraYocto: built.attachedYocto - amountYocto,
      feeYocto: feeYocto * 8n,
      availableYocto: BigInt(balance?.availableYocto ?? "0"),
      spentTodayYocto: 0n,
      maxSwapYocto: parseNear("1"),
    });
    const actions = built.transactions.flatMap((tx) => tx.actions.map((action) => `${tx.receiverId}.${action.type === "FunctionCall" ? action.params.methodName : "transfer"}`));
    check("swap policy (0.05 NEAR cap): allowed, phrase required", swapCheck.ok && swapCheck.needsPhrase, swapCheck.blockReason ?? `wNEAR held ${formatNear(chain.wrappedYocto)}; registered on wrap.near ${chain.userOnWrap}, on USDC ${chain.userOnDestination}`);
    check("exact unsigned swap transactions built", built.transactions.length >= 1 && actions[actions.length - 1] === "wrap.near.ft_transfer", `${built.transactions.length} transaction(s): ${actions.join(", ")}; attaches ${formatNear(built.attachedYocto)} NEAR in total`);
    swapPlan = { quote: { ...live, depositAddress: `${live.depositAddress.slice(0, 12)}…` }, chain: { ...chain, wrappedYocto: chain.wrappedYocto.toString() }, actions, attachedYocto: built.attachedYocto.toString(), signed: false };
  } catch (err) {
    check("executable 1Click quote and unsigned swap", false, err instanceof Error ? err.message.slice(0, 200) : String(err));
  }

  const failed = checks.filter((item) => !item.ok).length;
  const report = { network: "mainnet", rpc: RPC_URL, account, recipient, at: new Date().toISOString(), signed: 0, broadcast: 0, failed, checks, onchain, swapPlan };
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\n${checks.length - failed}/${checks.length} passed. Nothing was signed or broadcast.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
