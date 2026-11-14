export function publicError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const redacted = message
    .replace(/(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]+/g, "[redacted key]")
    .replace(/[1-9A-HJ-NP-Za-km-z]{80,}/g, "[redacted]");
  if (/DEPRECATED|fastnear\.com|code"?\s*:\s*-?429|"jsonrpc"|endpoint is deprecated/i.test(redacted)) {
    return "The network was busy. Wait a moment and try again.";
  }
  if (redacted.length > 220) return "Something went wrong. Try again in a moment.";
  return redacted;
}

// Prefixed NEAR keys, and bare base58 runs long enough to be a 64-byte ed25519 secret (~87-88
// characters). Implicit account ids are 64 hex characters and do not match. Seed phrases: 12 or
// more lowercase words with nothing else, the shape of a BIP-39 mnemonic.
const PREFIXED = /(?:ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{20,}/;
const BARE_BASE58 = /[1-9A-HJ-NP-Za-km-z]{80,}/;
const MNEMONIC = /^\s*(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\s*$/;

export function looksLikeSecret(text: string): boolean {
  return PREFIXED.test(text) || BARE_BASE58.test(text) || MNEMONIC.test(text.toLowerCase());
}

export function assertNoSecret(serialized: string): void {
  if (looksLikeSecret(serialized)) {
    throw new Error("Blocked a request that looked like a private key or seed phrase. It was not sent.");
  }
}
