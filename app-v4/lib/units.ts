const DECIMAL = /^\d+(\.\d+)?$/;

export function parseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new Error("Enter a positive decimal amount such as 0.5.");
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) {
    throw new Error(`Use at most ${decimals} decimal places.`);
  }
  const base = 10n ** BigInt(decimals);
  return BigInt(whole) * base + BigInt(frac.padEnd(decimals, "0"));
}

export function formatUnits(amount: bigint, decimals: number, maxFrac = 6): string {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const text = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return negative ? `-${text}` : text;
}

export function parseNear(amount: string): bigint {
  return parseUnits(amount, 24);
}

export function formatNear(amount: bigint, maxFrac = 6): string {
  return formatUnits(amount, 24, maxFrac);
}

export function formatNearToken(amount: string | bigint | null | undefined, maxFrac = 6): string {
  if (amount === null || amount === undefined || amount === "") return "0";
  const value = typeof amount === "bigint" ? amount : BigInt(amount);
  return formatNear(value, maxFrac);
}
