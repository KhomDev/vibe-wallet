/**
 * Turns an on-screen reply into something nice to hear: no hashes, no fees,
 * no 64-character ids, rounded numbers, no emoji. Screen text keeps details.
 */

const IMPLICIT = /\b[0-9a-f]{64}\b/g;
const BASE58_HASH = /\b[1-9A-HJ-NP-Za-km-z]{40,50}\b/g;
const NAMED = /\b([a-z0-9][a-z0-9_-]*)((?:\.[a-z0-9_-]+)*)\.(testnet|near)\b/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

/** Rounds to at most 2 decimals; says "about" when that changed the value. */
export function speakNumber(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const decimals = (value.split(".")[1] ?? "").length;
  if (decimals <= 2) return value.replace(/\.?0+$/, (m) => (value.includes(".") ? "" : m)) || "0";
  const digits = Math.abs(n) >= 1 ? 1 : 2;
  const rounded = Number(n.toFixed(digits));
  if (rounded === 0) return "almost nothing";
  return `about ${rounded}`;
}

export function toSpeech(text: string): string {
  let out = text
    .replace(EMOJI, "")
    // Drop whole sentences that are only about fees, hashes, or explorers.
    .replace(/[^.!?]*\b(fee|fees|transaction hash|tx hash|explorer|nearblocks)\b[^.!?]*[.!?]?/gi, " ")
    .replace(/\b(tx|transaction)\s+[1-9A-HJ-NP-Za-km-z]{40,50}\b\.?/gi, "")
    .replace(IMPLICIT, "that account")
    .replace(BASE58_HASH, "")
    .replace(NAMED, (_m, name: string) => name)
    .replace(/\$?\b\d+\.\d+\b/g, (m) => (m.startsWith("$") ? `$${speakNumber(m.slice(1))}` : speakNumber(m)))
    .replace(/\babout about\b/g, "about")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!out) out = "done.";
  return out;
}
