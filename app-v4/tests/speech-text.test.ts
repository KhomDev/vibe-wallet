import assert from "node:assert/strict";
import { test } from "node:test";
import { speakNumber, toSpeech } from "../lib/speech-text";

test("numbers are rounded for speech", () => {
  assert.equal(speakNumber("4.7123"), "about 4.7");
  assert.equal(speakNumber("0.2"), "0.2");
  assert.equal(speakNumber("0.12345"), "about 0.12");
  assert.equal(speakNumber("0.00004463"), "almost nothing");
});

test("speech drops hashes, fees, and long ids, and shortens names", () => {
  const spoken = toSpeech(`done, sent 0.2 to bob.testnet ✌️ Fee 0.00004463 NEAR. Tx A4yAYiZCYoS5QD5m6bq8bchBcBYZdVP7eZbMCkEcEXyu`);
  assert.equal(spoken.includes("bob.testnet"), false);
  assert.match(spoken, /sent 0\.2 to bob/);
  assert.equal(/fee|A4yAY|✌/i.test(spoken), false);
  assert.equal(toSpeech(`sending to ${"a".repeat(64)}`), "sending to that account");
  assert.equal(toSpeech("yo, you've got 4.71234 NEAR"), "yo, you've got about 4.7 NEAR");
});

test("fallback replies are short and casual (one sentence, about 15 words max)", async () => {
  const { parseIntent } = await import("../lib/intent");
  for (const input of ["", "blorp the flibber", "allow ???", "swap 1 near to doge"]) {
    const intent = parseIntent(input);
    if (intent.type !== "unknown") continue;
    const words = intent.reason.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 15, `${intent.reason} has ${words} words`);
    assert.doesNotMatch(intent.reason, /^(Please|Kindly|I am unable)/);
  }
  const spoken = toSpeech("yo, you've got 4.7123 NEAR to spend.");
  assert.ok(spoken.split(/\s+/).length <= 15);
});
