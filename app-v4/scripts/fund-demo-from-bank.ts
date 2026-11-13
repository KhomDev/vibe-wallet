import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { Account, actions, KeyPair, type KeyPairString } from "near-api-js";
import { generateEd25519, getProvider, implicitAccountId, publicKeyOf, readBalance, waitForAccount } from "../lib/near/read";
import { parseNear } from "../lib/units";

console.log("start");

type TxResult = {
  status: unknown;
  transaction: { hash: string };
  transaction_outcome: { id: string };
};

function asSecret(value: string): KeyPairString {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  if (trimmed.startsWith("ed25519:")) return trimmed as KeyPairString;
  return `ed25519:${trimmed}` as KeyPairString;
}

async function transfer(fromId: string, secret: string, toId: string, amountYocto: bigint) {
  const key = asSecret(secret);
  console.log("signer_pub", publicKeyOf(key), "from", fromId, "to_len", toId.length, "amount", amountYocto.toString());
  const account = new Account(fromId, getProvider(), key);
  const result = await account.signAndSendTransaction({
    receiverId: toId,
    actions: [actions.transfer(amountYocto)],
    waitUntil: "EXECUTED",
  }) as unknown as TxResult;
  return result.transaction?.hash || result.transaction_outcome.id;
}

async function main() {
  const bankPath = "/workspace/secrets/atelier-one/keychain/collector.atelier-one.testnet.json";
  const raw = JSON.parse(readFileSync(bankPath, "utf8")) as { account_id?: string; private_key: string; public_key?: string; implicit_account_id?: string };
  const bank = { ...raw, account_id: raw.account_id || "collector.atelier-one.testnet" };
  console.log("bank_id", bank.account_id, "has_priv", Boolean(bank.private_key), "priv_is_ed25519", String(bank.private_key).startsWith("ed25519:"));
  if (bank.public_key) console.log("file_pub", bank.public_key);
  const derivedPub = publicKeyOf(asSecret(bank.private_key));
  console.log("derived_pub", derivedPub);
  const before = await readBalance(bank.account_id);
  console.log("available_before", before?.availableNear);

  const demoKeys = generateEd25519();
  const recvKeys = generateEd25519();
  const demoId = implicitAccountId(demoKeys.publicKey);
  const recvId = implicitAccountId(recvKeys.publicKey);
  console.log("demo_implicit", demoId);
  console.log("recv_implicit", recvId);

  const demoHash = await transfer(bank.account_id, bank.private_key, demoId, parseNear("3"));
  console.log("funded_demo_tx", demoHash);
  const recvHash = await transfer(bank.account_id, bank.private_key, recvId, parseNear("1"));
  console.log("funded_recv_tx", recvHash);

  const demoBal = await waitForAccount(demoId);
  const recvBal = await waitForAccount(recvId);
  const after = await readBalance(bank.account_id);
  console.log("demo_available", demoBal.availableNear);
  console.log("recv_available", recvBal.availableNear);
  console.log("bank_available_after", after?.availableNear);

  const dir = "/workspace/secrets/vibe-wallet";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(`${dir}/demo-account.json`, JSON.stringify({
    accountId: demoId,
    publicKey: demoKeys.publicKey,
    secretKey: demoKeys.secretKey,
    network: "testnet",
    fundedFrom: bank.account_id,
    fundTx: demoHash,
  }, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(`${dir}/recv-account.json`, JSON.stringify({
    accountId: recvId,
    publicKey: recvKeys.publicKey,
    secretKey: recvKeys.secretKey,
    network: "testnet",
    fundedFrom: bank.account_id,
    fundTx: recvHash,
  }, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(`${dir}/cron.secret`, require("crypto").randomBytes(24).toString("hex") + "\n", { mode: 0o600 });
  console.log("secrets_written_ok");
}

main().catch((err) => {
  console.error("ERR", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack.split("\n").slice(0, 12).join("\n"));
  process.exit(1);
});
