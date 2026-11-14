import { isImplicitAccountId } from "./account-id";
import { DEFAULT_STORED_POLICY } from "./config";
import { formatNear, parseNear } from "./units";

export type StoredPolicy = {
  perTxNear: string;
  dailyNear: string;
  thresholdNear: string;
  confirmPhrase: string;
  allowlist: string[];
  allowlistOnly: boolean;
  killed: boolean;
};

export type Policy = {
  perTxYocto: bigint;
  dailyYocto: bigint;
  thresholdYocto: bigint;
  confirmPhrase: string;
  allowlist: string[];
  allowlistOnly: boolean;
  killed: boolean;
};

export type SendFacts = {
  recipient: string;
  amountYocto: bigint;
  feeYocto: bigint;
  availableYocto: bigint;
  spentTodayYocto: bigint;
  accountExists: boolean;
};

export type SendCheck = {
  ok: boolean;
  blockReason: string | null;
  warnings: string[];
  phraseReasons: string[];
  needsPhrase: boolean;
  /** True when the recipient is on the allowlist. */
  allowlisted?: boolean;
  /** A known account that differs by a typo or two, offered as "Did you mean". */
  similarTo?: string | null;
};

export function defaultStoredPolicy(): StoredPolicy {
  return { ...DEFAULT_STORED_POLICY, allowlist: [] };
}

export function toPolicy(stored: StoredPolicy): Policy {
  const phrase = stored.confirmPhrase.trim();
  if (!validPhrase(phrase)) throw new Error("The confirm phrase needs at least 4 letters or digits.");
  return {
    perTxYocto: parseNear(stored.perTxNear),
    dailyYocto: parseNear(stored.dailyNear),
    thresholdYocto: parseNear(stored.thresholdNear),
    confirmPhrase: phrase,
    allowlist: stored.allowlist,
    allowlistOnly: stored.allowlistOnly,
    killed: stored.killed,
  };
}

/**
 * Case-, punctuation- and spacing-insensitive form of a phrase. Letters and digits of every script
 * are kept, so "密码密码" stays a 4-character phrase instead of collapsing to "".
 */
export function normalizePhrase(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

/** A phrase counts only if at least 4 letters or digits survive normalization. */
export function validPhrase(value: string): boolean {
  return normalizePhrase(value).replace(/\s/g, "").length >= 4;
}

export function phraseMatches(policy: Pick<Policy, "confirmPhrase">, phrase: string | null): boolean {
  if (!phrase) return false;
  const expected = normalizePhrase(policy.confirmPhrase);
  return expected.length > 0 && normalizePhrase(phrase) === expected;
}

function levenshtein(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 2) return 3;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let col = 1; col <= right.length; col += 1) {
    let previous = rows[0];
    rows[0] = col;
    for (let row = 1; row <= left.length; row += 1) {
      const current = rows[row];
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      rows[row] = Math.min(rows[row] + 1, rows[row - 1] + 1, previous + cost);
      previous = current;
    }
  }
  return rows[left.length];
}

export function assessSend(policy: Policy, facts: SendFacts, ownAccountId?: string): SendCheck {
  const warnings: string[] = [];
  const phraseReasons: string[] = [];
  const allowlisted = policy.allowlist.includes(facts.recipient);
  const implicit = isImplicitAccountId(facts.recipient);

  let blockReason: string | null = null;
  if (policy.killed) blockReason = "The kill switch is on. Sending is stopped.";
  else if (facts.amountYocto <= 0n) blockReason = "Amount must be greater than zero.";
  else if (ownAccountId && facts.recipient === ownAccountId) blockReason = "You cannot send to your own account.";
  else if (facts.amountYocto > policy.perTxYocto) {
    blockReason = `This is above your per-transaction limit of ${formatNear(policy.perTxYocto)} NEAR.`;
  } else if (facts.spentTodayYocto + facts.amountYocto > policy.dailyYocto) {
    blockReason = `This would pass your daily limit of ${formatNear(policy.dailyYocto)} NEAR.`;
  } else if (policy.allowlistOnly && !allowlisted) {
    blockReason = "Allowlist-only is on, and this recipient is not on it.";
  } else if (!implicit && !facts.accountExists) {
    blockReason = "That named account does not exist on testnet. NEAR will not create it with a transfer.";
  } else if (facts.amountYocto + facts.feeYocto > facts.availableYocto) {
    blockReason = "Your available balance does not cover this amount plus the estimated fee.";
  }

  if (!allowlisted) {
    warnings.push("This recipient is not on your allowlist.");
    phraseReasons.push("The recipient is not on your allowlist.");
  }
  if (implicit) {
    warnings.push(
      facts.accountExists
        ? "This is an unnamed implicit account. Compare the full 64-character id. A typo cannot be reversed."
        : "This implicit account is not on-chain yet. A transfer creates it, and only the matching private key can use the funds.",
    );
    // An allowlisted implicit id was already checked when it was added.
    if (!allowlisted) phraseReasons.push("The recipient is an implicit account.");
  }
  const similar = allowlisted ? undefined : [...policy.allowlist, ...(ownAccountId ? [ownAccountId] : [])].find((known) => {
    return known !== facts.recipient && levenshtein(known, facts.recipient) <= 2;
  });
  if (similar) {
    warnings.push(`This looks similar to ${similar} but is not the same account.`);
    phraseReasons.push(`The recipient looks similar to ${similar}.`);
  }
  if (facts.availableYocto > 0n && facts.amountYocto * 10n >= facts.availableYocto * 8n) {
    warnings.push("This is most of your available balance.");
    phraseReasons.push("The amount is most of your available balance.");
  }
  // The threshold applies to every recipient: allowlisted sends below it need only the slide; at
  // or above it they also need the phrase. A recipient that is not allowlisted always needs it.
  if (facts.amountYocto >= policy.thresholdYocto) {
    phraseReasons.push(`The amount is at or above your extra-confirm threshold of ${formatNear(policy.thresholdYocto)} NEAR.`);
  }

  const needsPhrase = phraseReasons.length > 0;
  return {
    ok: blockReason === null,
    blockReason,
    warnings,
    phraseReasons,
    needsPhrase,
    allowlisted,
    similarTo: similar && similar !== ownAccountId ? similar : null,
  };
}
