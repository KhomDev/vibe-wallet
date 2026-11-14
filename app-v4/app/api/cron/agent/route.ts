import { runAgentTick } from "@/lib/server/agent";
import { authorizedCron, getDemoSecrets } from "@/lib/server/env";
import { errorResponse, json } from "@/lib/server/http";
import { loadState, mirrorToSocial } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

/**
 * Daily Vercel Cron (Authorization: Bearer CRON_SECRET). Runs every visitor's due rules, then
 * mirrors the public part of the state to NEAR Social if it changed. This is the only route that
 * writes the mirror.
 */
async function run(request: Request): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    if (!authorizedCron(request, secrets.cronSecret)) {
      return json({ error: "Unauthorized cron request." }, { status: 401 });
    }
    const result = await runAgentTick("vercel cron");
    const mirror = await mirrorToSocial(await loadState());
    return json({ ran: result.ran, skipped: result.skipped, blocked: result.blocked, killed: result.killed, mirror });
  } catch (err) {
    return errorResponse(err, 500);
  }
}
