import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSend, defaultStoredPolicy, phraseMatches, toPolicy } from "../lib/policy";
import { formatNear, parseNear } from "../lib/units";

const policy = toPolicy(defaultStoredPolicy());
const base = {
  recipient: "bob.testnet",
  amountYocto: parseNear("0.1"),
  feeYocto: parseNear("0.0001"),
  availableYocto: parseNear("10"),
  spentTodayYocto: 0n,
  accountExists: true,
};

test("units convert NEAR without floating point", () => {
  assert.equal(parseNear("0.5"), 500_000_000_000_000_000_000_000n);
  assert.equal(parseNear("1"), 1_000_000_000_000_000_000_000_000n);
  assert.equal(formatNear(parseNear("0.5")), "0.5");
  assert.equal(formatNear(44_636_512_500_000_000_000n, 8), "0.00004463");
});

test("kill switch blocks every send", () => {
  const check = assessSend({ ...policy, killed: true }, base);
  assert.equal(check.ok, false);
  assert.match(check.blockReason ?? "", /kill switch/i);
});

test("per-transaction and daily limits block oversized sends", () => {
  assert.match(assessSend(policy, { ...base, amountYocto: parseNear("3") }).blockReason ?? "", /per-transaction/);
  assert.match(assessSend(policy, { ...base, spentTodayYocto: parseNear("4.95") }).blockReason ?? "", /daily/);
});

test("allowlist warns by default and can require membership", () => {
  const unknown = assessSend(policy, base);
  assert.equal(unknown.ok, true);
  assert.match(unknown.warnings.join(" "), /allowlist/);
  const allowlisted = assessSend({ ...policy, allowlist: ["bob.testnet"] }, base);
  assert.equal(allowlisted.ok, true);
  const forced = assessSend({ ...policy, allowlist: ["carol.testnet"], allowlistOnly: true }, base);
  assert.equal(forced.ok, false);
  assert.match(forced.blockReason ?? "", /allowlist/i);
});

test("missing named accounts are blocked and the confirm phrase is required at the threshold", () => {
  assert.match(assessSend(policy, { ...base, accountExists: false }).blockReason ?? "", /does not exist/);
  const high = assessSend({ ...policy, allowlist: ["bob.testnet"] }, { ...base, amountYocto: parseNear("0.5") });
  assert.equal(high.needsPhrase, true);
  assert.equal(phraseMatches(policy, "Confirm send!"), true);
  assert.equal(phraseMatches(policy, "send it"), false);
});
