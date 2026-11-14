const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isImplicitAccountId(accountId: string): boolean {
  return /^[0-9a-f]{64}$/.test(accountId);
}

export function isValidAccountId(accountId: string): boolean {
  if (accountId.length < 2 || accountId.length > 64) return false;
  if (isImplicitAccountId(accountId)) return true;
  return NAMED.test(accountId);
}

/**
 * Trims and lowercases ASCII letters only. Non-ASCII characters are kept as they are, so the result
 * fails isValidAccountId instead of being remapped onto a different real account (Unicode
 * lowercasing turns KELVIN SIGN + "ob.testnet" into "kob.testnet").
 */
export function normalizeAccountId(input: string): string {
  return input.trim().replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/**
 * Turns what a person typed or said into an account id: lowercases, drops a
 * leading "@" and trailing punctuation, and adds the network suffix to a bare
 * name ("bob" -> "bob.testnet"). Implicit 64-hex ids are left alone.
 */
export function resolveAccountInput(input: string, network: "testnet" | "mainnet" = "testnet"): string {
  const raw = normalizeAccountId(input).replace(/^@+/, "").replace(/[.,;:!?]+$/, "");
  if (!raw || isImplicitAccountId(raw) || raw.includes(".")) return raw;
  if (/^0x[0-9a-f]{40}$/.test(raw)) return raw;
  return `${raw}.${network === "mainnet" ? "near" : "testnet"}`;
}

export function normalizeNewTestnetName(input: string): string {
  const raw = normalizeAccountId(input);
  const accountId = raw.endsWith(".testnet") ? raw : `${raw}.testnet`;
  if (!/^[a-z0-9]([a-z0-9-_]{0,48}[a-z0-9])?\.testnet$/.test(accountId)) {
    throw new Error("Use a lowercase name such as amber-otter or amber-otter.testnet.");
  }
  return accountId;
}

export function suggestTestnetAccountId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `vibe${suffix}.testnet`;
}
