import assert from "node:assert/strict";
import { test } from "node:test";
import { NO, YES, isLikelyHallucination, isStopPhrase, matchWake } from "../lib/handsfree";

test("wake phrases are recognized and the rest becomes the command", () => {
  assert.deepEqual(matchWake("Hey Vibe, what's my balance?"), { woke: true, rest: "what's my balance?" });
  assert.equal(matchWake("hey AI").woke, true);
  assert.equal(matchWake("Hey wallet.").woke, true);
  assert.equal(matchWake("Yo vibe send 0.1 near to bob").rest, "send 0.1 near to bob");
  assert.equal(matchWake("hey, vibe").woke, true);
  assert.equal(matchWake("what a vibe today").woke, false);
  assert.equal(matchWake("send 0.1 NEAR to bob").woke, false);
});

test("stop words end the session but kill-switch phrases do not", () => {
  for (const t of ["stop", "Bye.", "goodbye", "stop listening", "that's all"]) assert.equal(isStopPhrase(t), true, t);
  for (const t of ["stop sending", "stop all sending", "freeze"]) assert.equal(isStopPhrase(t), false, t);
});

test("spoken yes and no for voice confirm", () => {
  for (const t of ["yes", "Yeah.", "do it", "yep send it", "Yes, do it."]) assert.match(t, YES);
  for (const t of ["go ahead", "ok", "sure"]) assert.doesNotMatch(t, YES);
  for (const t of ["no", "nah", "cancel that", "wait"]) assert.match(t, NO);
  assert.doesNotMatch("send 0.2 to bob", YES);
});

test("common Whisper silence hallucinations are ignored", () => {
  assert.equal(isLikelyHallucination("Thank you."), true);
  assert.equal(isLikelyHallucination("  "), true);
  assert.equal(isLikelyHallucination("what's my balance"), false);
});
