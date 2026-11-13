import { explorerAccountUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { readBalance } from "@/lib/near/read";
import { formatNear } from "@/lib/units";
import { getDemoSecrets } from "@/lib/server/env";
import { demoStoredPolicy } from "@/lib/server/policy";
import { loadState, spentToday } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return session();
}

export async function POST(): Promise<Response> {
  return session();
}

async function session(): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    const state = await loadState();
    const balance = await readBalance(secrets.accountId);
    const policy = demoStoredPolicy(secrets.recipientId, state.killed, state.allowlist.length ? state.allowlist : [secrets.recipientId]);
    return Response.json({
      mode: "demo",
      network: "testnet",
      accountId: secrets.accountId,
      publicKey: secrets.publicKey || null,
      recipientId: secrets.recipientId,
      explorerUrl: explorerAccountUrl(secrets.accountId),
      recipientExplorerUrl: explorerAccountUrl(secrets.recipientId),
      availableNear: balance?.availableNear ?? "0",
      policy,
      spentTodayNear: formatNear(spentToday(state)),
      killed: state.killed,
      note: "This is a shared testnet demo account. The private key stays on the server and is never sent to the browser. Sends are capped, rate-limited, and allowlisted.",
    });
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 500 });
  }
}
