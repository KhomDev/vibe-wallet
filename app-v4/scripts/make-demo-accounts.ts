import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { createFundedAccount, readBalance } from "../lib/near/read";

const dir = "/workspace/secrets/vibe-wallet";

async function make(name: string, file: string) {
  const path = `${dir}/${file}`;
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    const bal = await readBalance(saved.accountId);
    console.log("exists", saved.accountId, "available", bal?.availableNear ?? "missing");
    return saved.accountId as string;
  }
  const created = await createFundedAccount(name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({
    accountId: created.accountId,
    publicKey: created.publicKey,
    secretKey: created.secretKey,
    network: "testnet",
  }, null, 2) + "\n", { mode: 0o600 });
  console.log("created", created.accountId, "available", created.balance.availableNear, "pubkey", created.publicKey);
  return created.accountId;
}

async function main() {
  const suffix = Math.random().toString(16).slice(2, 10);
  const demo = await make(`vibedemo${suffix}.testnet`, "demo-account.json");
  const recv = await make(`viberecv${suffix}.testnet`, "recv-account.json");
  console.log("DEMO_ACCOUNT", demo);
  console.log("RECV_ACCOUNT", recv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
