export function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const redacted = message.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]+/g, "ed25519:[redacted]");
  if (/DEPRECATED|fastnear\.com|code"?\s*:\s*-?429|"jsonrpc"|endpoint is deprecated/i.test(redacted)) {
    return "The testnet network was busy. Wait a moment and try again.";
  }
  if (redacted.length > 180) return "Something went wrong. Try again in a moment.";
  return redacted;
}

export function assertNoSecret(serialized: string): void {
  if (/ed25519:[1-9A-HJ-NP-Za-km-z]{20,}/.test(serialized)) {
    throw new Error("Blocked a request that looked like a private key.");
  }
}
