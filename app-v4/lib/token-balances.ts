import { formatUnits } from "./units";

export type TokenSpec = { symbol: string; subtitle: string; contract: string; decimals: number; mark: string };

/** One token row: what the account holds on its own wallet, and what it holds inside NEAR Intents. */
export type TokenBalance = {
  symbol: string;
  subtitle: string;
  mark: string;
  /** "loading" until the first read, "error" when the chain could not be read (never shown as 0). */
  status: "loading" | "ok" | "error";
  /** NEP-141 balance on the token contract (ft_balance_of), formatted. */
  wallet: string | null;
  /** Multi-token balance of nep141:<contract> on the Intents contract (mt_batch_balance_of), formatted. */
  intents: string | null;
};

export type ViewCall = (contractId: string, method: string, args: Record<string, unknown>) => Promise<unknown>;

export const INTENTS_CONTRACT_MAINNET = "intents.near";

/** Up to 6 fraction digits, so a 0.09625 USDC swap output is not rounded away. */
const MAX_FRAC = 6;

function toAmount(raw: unknown): bigint | null {
  const digits = String(raw ?? "").replace(/"/g, "").trim();
  return /^\d+$/.test(digits) ? BigInt(digits) : null;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

export function loadingBalances(tokens: readonly TokenSpec[]): TokenBalance[] {
  return tokens.map((t) => ({ symbol: t.symbol, subtitle: t.subtitle, mark: t.mark, status: "loading", wallet: null, intents: null }));
}

/**
 * Reads each token's wallet balance and, when an Intents contract is given (mainnet), the account's balance
 * of the same token inside NEAR Intents. A failed read is reported as an error instead of 0, so a flaky RPC
 * can never make a funded account look empty.
 */
export async function readTokenBalances(
  accountId: string,
  tokens: readonly TokenSpec[],
  view: ViewCall,
  intentsContract: string | null,
): Promise<TokenBalance[]> {
  const walletReads = tokens.map((t) => withRetry(() => view(t.contract, "ft_balance_of", { account_id: accountId })).then(toAmount, () => null));
  const intentsRead: Promise<(bigint | null)[] | null> = intentsContract
    ? withRetry(() => view(intentsContract, "mt_batch_balance_of", { account_id: accountId, token_ids: tokens.map((t) => `nep141:${t.contract}`) }))
        .then((raw) => (Array.isArray(raw) ? raw.map(toAmount) : null), () => null)
    : Promise.resolve(null);
  const [wallet, intents] = await Promise.all([Promise.all(walletReads), intentsRead]);
  return tokens.map((t, i) => {
    const w = wallet[i];
    const m = intents ? intents[i] ?? null : null;
    return {
      symbol: t.symbol,
      subtitle: t.subtitle,
      mark: t.mark,
      status: w === null ? "error" : "ok",
      wallet: w === null ? null : formatUnits(w, t.decimals, MAX_FRAC),
      intents: m !== null && m > 0n ? formatUnits(m, t.decimals, MAX_FRAC) : null,
    };
  });
}
