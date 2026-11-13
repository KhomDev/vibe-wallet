import { readFileSync } from "fs";
import { readBalance } from "../lib/near/read";

const files: Array<{ accountId: string; file: string }> = [
  { accountId: "atelier-one-bank1.testnet", file: "atelier-one/keychain/atelier-one-bank1.testnet.json" },
  { accountId: "atelier-one-bank2.testnet", file: "atelier-one/keychain/atelier-one-bank2.testnet.json" },
  { accountId: "atelier-one-bank3.testnet", file: "atelier-one/keychain/atelier-one-bank3.testnet.json" },
  { accountId: "treasury.atelier-one.testnet", file: "atelier-one/keychain/treasury.atelier-one.testnet.json" },
  { accountId: "collector.atelier-one.testnet", file: "atelier-one/keychain/collector.atelier-one.testnet.json" },
  { accountId: "studio.atelier-one.testnet", file: "atelier-one/keychain/studio.atelier-one.testnet.json" },
  { accountId: "museswarm-bank1.testnet", file: "muse-swarm/museswarm-bank1.testnet.json" },
  { accountId: "treasury.museswarm.testnet", file: "muse-swarm/keys.json#treasury" },
  { accountId: "retr0school.testnet", file: "near/retr0school.testnet.json" },
  { accountId: "diploma.retr0school.testnet", file: "near/diploma.retr0school.testnet.json" },
];

async function main() {
  for (const row of files) {
    const file = row.file.includes("#") ? row.file.split("#")[0] : row.file;
    let extra = "";
    try {
      const data = JSON.parse(readFileSync(`/workspace/secrets/${file}`, "utf8"));
      if (data.implicit_account_id) extra = ` implicit=${data.implicit_account_id}`;
    } catch {}
    try {
      const bal = await readBalance(row.accountId);
      console.log(`${row.accountId}\tavail=${bal?.availableNear ?? "GONE"}\t${extra}`);
    } catch (err) {
      console.log(`${row.accountId}\terror=${err instanceof Error ? err.message : "err"}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
