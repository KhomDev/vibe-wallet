const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isImplicitAccountId(accountId: string): boolean {
  return /^[0-9a-f]{64}$/.test(accountId);
}

export function isValidAccountId(accountId: string): boolean {
  if (accountId.length < 2 || accountId.length > 64) return false;
  if (isImplicitAccountId(accountId)) return true;
  return NAMED.test(accountId);
}

export function normalizeAccountId(input: string): string {
  return input.trim().toLowerCase();
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
