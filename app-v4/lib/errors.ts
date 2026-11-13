export function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const redacted = message.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g, "ed25519:[redacted]");
  if (redacted.length > 420) return `${redacted.slice(0, 420)}…`;
  return redacted;
}

export function assertNoSecret(serialized: string): void {
  if (/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/.test(serialized)) {
    throw new Error("Blocked a request that looked like a private key.");
  }
}
