/**
 * Browser vault: a secret key encrypted with AES-GCM-256 under a key derived from the passphrase.
 *
 * v2 (current): PBKDF2-HMAC-SHA256 with 600,000 iterations (OWASP 2023 guidance), a fresh 16-byte
 * salt and 12-byte IV per encryption, and additional authenticated data that binds the ciphertext
 * to its account id, public key and slot, so a blob copied into another slot fails to decrypt.
 * v1 blobs (120,000 iterations, no AAD) still decrypt; the app re-encrypts them as v2 on unlock.
 */
export type CipherBlob = {
  salt: string;
  iv: string;
  ciphertext: string;
  /** Absent on v1 blobs. */
  v?: 2;
  iter?: number;
};

const V1_ITERATIONS = 120_000;
export const V2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** What the ciphertext is bound to. */
export function vaultContext(accountId: string, publicKey: string, slot: "full" | "agent"): string {
  return `vibe-wallet:v2:${slot}:${accountId}:${publicKey}`;
}

export async function encryptSecret(secret: string, passphrase: string, context: string): Promise<CipherBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, V2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(secret),
  );
  return {
    v: 2,
    iter: V2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export function isLegacyBlob(blob: CipherBlob): boolean {
  return blob.v !== 2;
}

export async function decryptSecret(blob: CipherBlob, passphrase: string, context: string): Promise<string> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const legacy = isLegacyBlob(blob);
  const iterations = legacy ? V1_ITERATIONS : Math.max(V2_ITERATIONS, Number(blob.iter) || V2_ITERATIONS);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      legacy
        ? { name: "AES-GCM", iv: iv as BufferSource }
        : { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(context) },
      key,
      base64ToBytes(blob.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("That passphrase did not unlock this wallet.");
  }
}

/** A rough strength hint for the setup screen. Length is what matters most against offline guessing. */
export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE) return `Use a passphrase of at least ${MIN_PASSPHRASE} characters. Four random words work well.`;
  if (/^(.)\1+$/.test(passphrase)) return "That passphrase is one repeated character. Pick something harder to guess.";
  if (new Set(passphrase).size < 5) return "That passphrase uses too few different characters.";
  return null;
}
