import { publicError } from "@/lib/errors";
import { runAgentTick } from "@/lib/server/agent";
import { authorizedCron, getDemoSecrets } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}

async function run(request: Request): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    if (!authorizedCron(request, secrets.cronSecret)) {
      return Response.json({ error: "Unauthorized cron request." }, { status: 401 });
    }
    const result = await runAgentTick("vercel cron");
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 500 });
  }
}
