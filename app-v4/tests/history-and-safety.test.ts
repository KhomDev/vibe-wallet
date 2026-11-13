import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { explainTransaction, type HistoryItem } from "../lib/history";
import { parseNear } from "../lib/units";

test("explain a transfer in plain language", () => {
  const tx: HistoryItem = {
    hash: "abc",
    signer: "alice.testnet",
    receiver: "bob.testnet",
    actions: ["TRANSFER"],
    methods: [],
    depositYocto: parseNear("0.2").toString(),
    feeYocto: parseNear("0.00008").toString(),
    success: true,
    timestampMs: Date.UTC(2026, 10, 13, 0, 0, 0),
    source: "local",
  };
  const text = explainTransaction(tx, "alice.testnet");
  assert.match(text, /you sent 0\.2 NEAR to bob\.testnet/);
  assert.match(text, /succeeded/i);
});

test("server routes do not import the signer or print secret keys", () => {
  const intent = readFileSync(new URL("../app/api/intent/route.ts", import.meta.url), "utf8");
  const quote = readFileSync(new URL("../app/api/quote/route.ts", import.meta.url), "utf8");
  const transcribe = readFileSync(new URL("../app/api/transcribe/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(intent, /near\/signer|near-api-js|NEAR_AI_API_KEY\s*=/);
  assert.match(intent, /process\.env\.NEAR_AI_API_KEY/);
  assert.match(quote, /dry:\s*true/);
  assert.doesNotMatch(quote, /body\.dry/);
  assert.match(transcribe, /process\.env\.NEAR_AI_API_KEY/);
  assert.doesNotMatch(transcribe, /NEAR_AI_API_KEY\s*=/);

  const root = new URL("../", import.meta.url);
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(path);
    }
  }
  walk(new URL("app/api", root).pathname);
  walk(new URL("lib/server", root).pathname);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from ["'][^"']*near\/signer["']/, `import signer in ${file}`);
    assert.doesNotMatch(source, /console\.log\([^)]*(secretKey|private_key|DEMO_NEAR_PRIVATE_KEY)/i, file);
  }
});
