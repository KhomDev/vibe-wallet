import { NEAR_AI_BASE_URL, NEAR_AI_MODEL } from "@/lib/config";
import { acceptModelIntent, INTENT_SYSTEM_PROMPT, parseIntent, sanitizeIntent, type WalletIntent } from "@/lib/intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntentResponse = {
  intent: WalletIntent;
  source: "near-ai" | "local-fallback";
  note: string | null;
};

function local(message: string, note: string | null): IntentResponse {
  return { intent: parseIntent(message), source: "local-fallback", note };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  return JSON.parse(body.slice(start, end + 1));
}

export async function POST(request: Request): Promise<Response> {
  let message = "";
  try {
    const body = await request.json();
    message = typeof body?.message === "string" ? body.message.slice(0, 1000) : "";
  } catch {
    return Response.json(local("", "The request was empty, so the local parser answered."), { status: 200 });
  }
  if (!message.trim()) {
    return Response.json(local(message, null));
  }

  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    return Response.json(local(message, "NEAR_AI_API_KEY is not set. Using the deterministic local parser."));
  }

  try {
    const response = await fetch(`${NEAR_AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: NEAR_AI_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    // 401 (invalid/expired) and 402 (no spending limit / no credits) both fall back silently.
    if (response.status === 401 || response.status === 402 || !response.ok) {
      return Response.json(local(message, "Used the local parser."));
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return Response.json(local(message, "NEAR AI Cloud returned an empty answer. Used the local parser instead."));
    }
    const sanitized = sanitizeIntent(extractJson(content));
    if (!sanitized) {
      return Response.json(local(message, "NEAR AI Cloud returned an unusable intent. Used the local parser instead."));
    }
    return Response.json({
      intent: acceptModelIntent(message, sanitized),
      source: "near-ai",
      note: null,
    } satisfies IntentResponse);
  } catch {
    return Response.json(local(message, "NEAR AI Cloud was unreachable. Used the local parser instead."));
  }
}
