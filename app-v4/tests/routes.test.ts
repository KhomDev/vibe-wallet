import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { POST as intentPost } from "../app/api/intent/route";
import { POST as transcribePost } from "../app/api/transcribe/route";

const originalFetch = globalThis.fetch;
const originalKey = process.env.NEAR_AI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.NEAR_AI_API_KEY;
  else process.env.NEAR_AI_API_KEY = originalKey;
});

async function postIntent(message: unknown, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await intentPost(
    new Request("http://localhost/api/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof message === "string" || message === undefined ? JSON.stringify({ message: message ?? "" }) : JSON.stringify(message),
      ...init,
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test("intent route uses the local parser when no API key is set", async () => {
  delete process.env.NEAR_AI_API_KEY;
  const { status, body } = await postIntent("What's my balance?");
  assert.equal(status, 200);
  assert.equal(body.source, "local-fallback");
  assert.deepEqual(body.intent, { type: "get_balance" });
});

test("intent route falls back silently on 401 and 402 from NEAR AI", async () => {
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  for (const code of [401, 402]) {
    globalThis.fetch = (async () => new Response("denied", { status: code })) as typeof fetch;
    const { status, body } = await postIntent("Send 0.1 NEAR to bob.testnet");
    assert.equal(status, 200);
    assert.equal(body.source, "local-fallback");
    assert.deepEqual(body.intent, { type: "send", amountNear: "0.1", recipient: "bob.testnet" });
  }
});

test("intent route returns a near-ai source when the model returns usable JSON", async () => {
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"type":"get_balance"}' } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const { status, body } = await postIntent("What's my balance?");
  assert.equal(status, 200);
  assert.equal(body.source, "near-ai");
  assert.deepEqual(body.intent, { type: "get_balance" });
  assert.equal(body.note, null);
});

test("intent route can parse JSON out of reasoning_content when content is empty", async () => {
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              reasoning_content: 'thinking...\n{"type":"quote_swap","amountNear":"1","toSymbol":"USDT"}',
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  const { status, body } = await postIntent("Quote 1 NEAR to USDT");
  assert.equal(status, 200);
  assert.equal(body.source, "near-ai");
  assert.deepEqual(body.intent, { type: "quote_swap", amountNear: "1", toSymbol: "USDT" });
});

test("transcribe route rejects missing audio and missing keys without leaking secrets", async () => {
  delete process.env.NEAR_AI_API_KEY;
  const empty = await transcribePost(new Request("http://localhost/api/transcribe", { method: "POST", body: new FormData() }));
  assert.equal(empty.status, 503);
  const emptyJson = (await empty.json()) as { error?: string };
  assert.match(emptyJson.error ?? "", /not configured/i);
  assert.doesNotMatch(JSON.stringify(emptyJson), /sk-/);

  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  const form = new FormData();
  const short = await transcribePost(new Request("http://localhost/api/transcribe", { method: "POST", body: form }));
  assert.equal(short.status, 400);
});

test("transcribe route forwards audio to NEAR AI Whisper and returns the text", async () => {
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  let sawModel = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as FormData;
    sawModel = String(body.get("model") ?? "");
    const file = body.get("file");
    assert.ok(file);
    return new Response(JSON.stringify({ text: " What's my balance? " }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(400).fill(1)], { type: "audio/webm" }), "clip.webm");
  const response = await transcribePost(new Request("http://localhost/api/transcribe", { method: "POST", body: form }));
  const json = (await response.json()) as { text?: string; source?: string };
  assert.equal(response.status, 200);
  assert.equal(json.text, "What's my balance?");
  assert.equal(json.source, "near-ai-whisper");
  assert.equal(sawModel, "openai/whisper-large-v3");
});

test("VW-WEB-02: the intent route rate-limits paid model calls per client", async () => {
  const { resetRateLimits } = await import("../lib/server/rate-limit");
  resetRateLimits();
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  let outbound = 0;
  globalThis.fetch = (async () => {
    outbound += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"type":"get_balance"}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const statuses: number[] = [];
  for (let i = 0; i < 25; i += 1) statuses.push((await postIntent("What's my balance?", { headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" } })).status);
  assert.equal(outbound, 20, "20 model calls per minute per client");
  assert.equal(statuses.filter((code) => code === 429).length, 5);
  resetRateLimits();
});

test("VW-CRYPTO-03: a pasted secret is refused by the intent route and never forwarded", async () => {
  process.env.NEAR_AI_API_KEY = "test-key-not-real";
  let outbound = 0;
  globalThis.fetch = (async () => {
    outbound += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const bare = "5".repeat(20) + "AbCdEfGhJkLmNpQrStUvWxYz".repeat(3);
  const { status } = await postIntent(`here is my key ${bare}`);
  assert.equal(status, 400);
  assert.equal(outbound, 0);
});
