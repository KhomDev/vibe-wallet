import { AGENT_RUNS_PER_HOUR_NETWORK, AGENT_RUNS_PER_HOUR_VISITOR } from "@/lib/server/agent-keys";
import { runAgentTick, visibleLogs } from "@/lib/server/agent";
import { checkAndBump } from "@/lib/server/demo-limits";
import { clientIp, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json } from "@/lib/server/http";
import { AbortTransaction, assertDurableState, loadState, transact } from "@/lib/server/state";
import { resolveVisitor, visitorSecret } from "@/lib/server/visitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Run agent now": runs the caller's own due rules, at most 6 times an hour per visitor. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertDurableState();
    const secrets = getDemoSecrets();
    const visitor = resolveVisitor(request, clientIp(request), visitorSecret(secrets.cronSecret || secrets.secretKey));
    if (!visitor.fromCookie) return json({ error: "Open the demo first (Try a demo account) to run the agent." }, { status: 401 });
    await transact((current) => {
      const mine = checkAndBump(current, `run:${visitor.key}`, AGENT_RUNS_PER_HOUR_VISITOR);
      if (!mine.ok) throw new AbortTransaction(`The agent can be run at most ${AGENT_RUNS_PER_HOUR_VISITOR} times an hour.`, 429);
      const net = checkAndBump(mine.state, `run:${visitor.ipKey}`, AGENT_RUNS_PER_HOUR_NETWORK);
      if (!net.ok) throw new AbortTransaction("The agent was run too often from this network this hour.", 429);
      return { state: net.state, result: undefined };
    });
    const result = await runAgentTick("manual run from the app", visitor.key);
    const state = await loadState();
    return json({ ...result, logs: visibleLogs(state, visitor.key) });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
