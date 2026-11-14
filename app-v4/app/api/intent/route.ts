import { NEAR_AI_BASE_URL, NEAR_AI_MODEL } from "@/lib/config";
import { looksLikeSecret } from "@/lib/errors";
import { acceptModelIntent, INTENT_SYSTEM_PROMPT, parseIntent, sanitizeIntent, type WalletIntent } from "@/lib/intent";
import { clientIp } from "@/lib/server/env";
import { json } from "@/lib/server/http";
import { hit, ROUTE_LIMITS, tooMany } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GLM-5.3-Flash is a reasoning model. A low max_tokens budget can be spent
// entirely on reasoning_content, leaving message.content null. 1024 leaves
// room for both, and we also parse reasoning_content as a fallback.
const NEAR_AI_MAX_TOKENS = 1024;
const NEAR_AI_TIMEOUT_MS = 15_000;

type IntentResponse = {
  intent: WalletIntent;
  source: "near-ai" | "local-fallback";
  note: string | null;
};

function local(message: string, note: string | null): IntentResponse {
  return { intent: parseIntent(message), source: "local-fallback", note };
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("");
    return parts.trim() ? parts : null;
  }
  return null;
}

function messageText(payload: unknown): string | null {
  const choice = Array.isArray((payload as { choices?: unknown })?.choices)
    ? (payload as { choices: unknown[] }).choices[0]
    : null;
  const message =
    choice && typeof choice === "object" && choice !== null && "message" in choice
      ? (choice as { message: unknown }).message
      : null;
  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  return (
    asText(record.content) ??
    asText(record.reasoning_content) ??
    asText(record.reasoning)
  );
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
    return json(local("", "The request was empty, so the local parser answered."), { status: 200 });
  }
  if (!message.trim()) {
    return json(local(message, null));
  }
  // A pasted private key or seed phrase never leaves this server, not even to the model.
  if (looksLikeSecret(message)) {
    return json({ error: "That looks like a private key or seed phrase. It was not sent anywhere. Never paste it into a chat." }, { status: 400 });
  }

  const apiKey = process.env.NEAR_AI_API_KEY;
  if (!apiKey) {
    return json(local(message, "NEAR_AI_API_KEY is not set. Using the deterministic local parser."));
  }
  // The model call costs money: per-client and per-instance limits, then the local parser.
  const ip = clientIp(request);
  const mine = hit(`intent:${ip}`, ROUTE_LIMITS.intent);
  if (!mine.ok) return tooMany(mine.retryAfterSec, "Too many requests from this network. Wait a moment and try again.");
  const all = hit("intent:global", ROUTE_LIMITS.modelGlobal);
  if (!all.ok) return json(local(message, "NEAR AI is busy right now, so the local parser answered."));

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
        max_tokens: NEAR_AI_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: message },
        ],
      }),
      signal: AbortSignal.timeout(NEAR_AI_TIMEOUT_MS),
    });
    // 401 (invalid/expired) and 402 (no spending limit / no credits) both fall back silently.
    if (response.status === 401 || response.status === 402 || !response.ok) {
      return json(local(message, "Used the local parser."));
    }
    const payload = await response.json();
    const content = messageText(payload);
    if (!content) {
      return json(local(message, "NEAR AI Cloud returned an empty answer. Used the local parser instead."));
    }
    const sanitized = sanitizeIntent(extractJson(content));
    if (!sanitized) {
      return json(local(message, "NEAR AI Cloud returned an unusable intent. Used the local parser instead."));
    }
    return json({
      intent: acceptModelIntent(message, sanitized),
      source: "near-ai",
      note: null,
    } satisfies IntentResponse);
  } catch {
    return json(local(message, "NEAR AI Cloud was unreachable. Used the local parser instead."));
  }
}
