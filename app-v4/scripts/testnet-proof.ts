import { suggestTestnetAccountId } from "../lib/account-id";
import { QUOTE_ONLY_LABEL } from "../lib/assets";
import { explorerTxUrl } from "../lib/config";
import { explainTransaction } from "../lib/history";
import { createFundedAccount, fetchHistory, isScopedKey, listKeys, readBalance } from "../lib/near/read";
import { addScopedKey, executeScopedCall, executeTransfer } from "../lib/near/signer";
import { assessSend, defaultStoredPolicy, toPolicy } from "../lib/policy";
import { formatNear, parseNear } from "../lib/units";

function redact(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g, "ed25519:[redacted]");
}

async function main() {
  const senderId = suggestTestnetAccountId();
  const recipientId = suggestTestnetAccountId();
  const sender = await createFundedAccount(senderId);
  const recipient = await createFundedAccount(recipientId);
  const scoped = await addScopedKey({
    accountId: sender.accountId,
    fullSecret: sender.secretKey,
    expectedPublicKey: sender.publicKey,
  });
  const keys = await listKeys(sender.accountId);
  if (!keys.some(isScopedKey)) throw new Error("Scoped function-call key was not visible on-chain.");
  let scopedCall: { hash: string; feeNear: string } | { error: string };
  try {
    const call = await executeScopedCall({
      accountId: sender.accountId,
      agentSecret: scoped.agentSecret,
      expectedAgentPublicKey: scoped.agentPublicKey,
    });
    scopedCall = { hash: call.hash, feeNear: formatNear(call.feeYocto, 8) };
  } catch (error) {
    scopedCall = { error: redact(error) };
  }

  const amountNear = "0.2";
  const policy = toPolicy({ ...defaultStoredPolicy(), allowlist: [recipient.accountId] });
  const sent = await executeTransfer({
    accountId: sender.accountId,
    fullSecret: sender.secretKey,
    expectedPublicKey: sender.publicKey,
    recipient: recipient.accountId,
    amountYocto: parseNear(amountNear),
    policy,
    spentTodayYocto: 0n,
    userConfirmed: true,
    confirmationPhrase: null,
  });
  const recipientAfter = await readBalance(recipient.accountId);
  const senderAfter = await readBalance(sender.accountId);
  if (!recipientAfter || BigInt(recipientAfter.totalYocto) < parseNear(amountNear)) {
    throw new Error("Recipient balance did not include the transfer.");
  }

  let killBlocked = false;
  try {
    await executeTransfer({
      accountId: sender.accountId,
      fullSecret: sender.secretKey,
      expectedPublicKey: sender.publicKey,
      recipient: recipient.accountId,
      amountYocto: parseNear("0.01"),
      policy: { ...policy, killed: true },
      spentTodayYocto: 0n,
      userConfirmed: true,
      confirmationPhrase: null,
    });
  } catch (error) {
    killBlocked = redact(error).toLowerCase().includes("kill switch");
  }
  if (!killBlocked) throw new Error("Kill switch did not block a send.");

  const risky = assessSend(toPolicy(defaultStoredPolicy()), {
    recipient: recipient.accountId,
    amountYocto: parseNear("0.6"),
    feeYocto: 1n,
    availableYocto: parseNear("10"),
    spentTodayYocto: 0n,
    accountExists: true,
  });
  if (!risky.needsPhrase) throw new Error("High-value unknown sends should require the confirm phrase.");

  const history = await fetchHistory(sender.accountId).catch(() => []);
  const quoteResponse = await fetch("https://1click.chaindefuser.com/v0/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: "nep141:wrap.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:usdt.tether-token.near",
      amount: parseNear("1").toString(),
      recipient: sender.accountId,
      recipientType: "INTENTS",
      refundTo: sender.accountId,
      refundType: "INTENTS",
      deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }),
  });
  const quote = await quoteResponse.json();
  if (!quoteResponse.ok || quote.quoteRequest?.dry !== true) {
    throw new Error(`Dry quote failed: ${JSON.stringify(quote).slice(0, 300)}`);
  }

  const proof = {
    network: "testnet",
    sender: sender.accountId,
    recipient: recipient.accountId,
    senderBalanceAfterCreate: sender.balance.totalNear,
    senderBalanceAfterSend: senderAfter?.availableNear ?? null,
    recipientBalanceAfterSend: recipientAfter.totalNear,
    addKeyTx: scoped.hash,
    scopedCall,
    sendTx: sent.hash,
    sendAmountNear: amountNear,
    sendFeeNear: formatNear(sent.feeYocto, 8),
    killSwitchBlocked: killBlocked,
    fullAccessKeys: keys.filter((key) => key.kind === "full").length,
    scopedKeys: keys.filter(isScopedKey).map((key) => ({
      receiver: key.receiver,
      methods: key.methods,
      allowanceNear: key.allowanceYocto ? formatNear(BigInt(key.allowanceYocto)) : null,
    })),
    indexerSeen: history.some((item) => item.hash === sent.hash),
    explainSample: history[0] ? explainTransaction(history[0], sender.accountId) : null,
    quote: {
      dry: true,
      label: QUOTE_ONLY_LABEL,
      amountIn: quote.quote?.amountInFormatted,
      amountOut: quote.quote?.amountOutFormatted,
      amountOutUsd: quote.quote?.amountOutUsd,
    },
    explorer: {
      addKey: explorerTxUrl(scoped.hash),
      send: explorerTxUrl(sent.hash),
      scopedCall: "hash" in scopedCall ? explorerTxUrl(scopedCall.hash) : null,
    },
  };
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((error) => {
  console.error(redact(error));
  process.exit(1);
});
