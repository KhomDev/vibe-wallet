import { publicError } from "@/lib/errors";
import { runAgentTick } from "@/lib/server/agent";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { bumpRate, checkRunRate } from "@/lib/server/rate-limit";
import { loadState, updateState } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    const preview = await loadState();
    const rate = checkRunRate(preview, clientIp(request), secrets.cronSecret || secrets.accountId);
    if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429 });
    await updateState((state) => bumpRate(state, rate.key));
    const result = await runAgentTick("manual run from the app");
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 500 });
  }
}
