import { publicError } from "@/lib/errors";
import { formatNear } from "@/lib/units";
import { getDemoSecrets } from "@/lib/server/env";
import { loadState, spentToday } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const secrets = getDemoSecrets();
    const state = await loadState();
    return Response.json({
      accountId: secrets.accountId,
      recipientId: secrets.recipientId,
      killed: state.killed,
      spentTodayNear: formatNear(spentToday(state)),
      rules: state.rules,
      logs: state.logs.slice(-40).reverse(),
      updatedAt: state.updatedAt,
    });
  } catch (err) {
    return Response.json({ error: publicError(err) }, { status: 500 });
  }
}
