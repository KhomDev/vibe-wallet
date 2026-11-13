import { readFileSync } from "node:fs";
import { Account, actions, type KeyPairString } from "near-api-js";
import { getProvider, publicKeyOf, readBalance } from "../lib/near/read";
import { formatNear, parseNear } from "../lib/units";

function asSecret(value: string): KeyPairString {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  return (trimmed.startsWith("ed25519:") ? trimmed : `ed25519:${trimmed}`) as KeyPairString;
}

async function main() {
  const demoId = "ba73c44d88b3e145da74bfd009a9a25dcc1797c4974e7e2fe301f7be63ac532f";
  const bankPath = "/workspace/secrets/atelier-one/keychain/collector.atelier-one.testnet.json";
  const raw = JSON.parse(readFileSync(bankPath, "utf8")) as { account_id?: string; private_key: string };
  const bankId = raw.account_id || "collector.atelier-one.testnet";
  const demo = await readBalance(demoId);
  const bank = await readBalance(bankId);
  const available = Number(demo?.availableNear ?? "0");
  console.log("demo_id", demoId, "demo_available", demo?.availableNear ?? "0");
  console.log("bank_id", bankId, "bank_available", bank?.availableNear ?? "0", "has_priv", Boolean(raw.private_key), "pub", publicKeyOf(asSecret(raw.private_key)));
  const target = 4;
  if (available >= 3) {
    console.log("topup_skipped already_at_or_above_3");
    return;
  }
  const need = (target - available).toFixed(4);
  const amount = parseNear(need);
  if (!bank || BigInt(bank.availableYocto) < amount + parseNear("0.05")) {
    throw new Error("The funding account does not have enough testnet NEAR.");
  }
  const account = new Account(bankId, getProvider(), asSecret(raw.private_key));
  const result = await account.signAndSendTransaction({
    receiverId: demoId,
    actions: [actions.transfer(amount)],
    waitUntil: "EXECUTED",
  }) as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
  const hash = result.transaction?.hash || result.transaction_outcome?.id;
  const after = await readBalance(demoId);
  console.log("topup_amount", need, "tx", hash, "explorer", `https://testnet.nearblocks.io/txns/${hash}`);
  console.log("demo_available_after", after?.availableNear ?? "0", "fee_context_bank_after", formatNear(BigInt((await readBalance(bankId))?.availableYocto ?? "0")));
}

main().catch((err) => {
  console.error("topup_failed", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
