/**
 * Executed NEAR Intents swap from the confirm card (mainnet only).
 *
 * 1. The server asks 1Click for a live quote (dry: false). It returns a one-time deposit address.
 * 2. `verifyLiveQuote` checks the quote against what the user asked for: same amount in, origin
 *    asset wNEAR, recipient and refund both the user's own account, a deadline in the future, a
 *    plausible deposit address, and an output above zero. Anything else is refused.
 * 3. `buildSwapTransactions` builds exactly these, and nothing else:
 *    - only if the user is not yet registered on the destination token: `storage_deposit` there
 *      (0.00125 NEAR), so the swapped tokens can be delivered back to the user's account;
 *    - one transaction to wrap.near: `storage_deposit` for the user (only if needed), `near_deposit`
 *      for the wNEAR shortfall (only if needed), `storage_deposit` for the deposit address, and
 *      `ft_transfer` of exactly the quoted amount to the deposit address.
 * 4. The user's signer sends them (the browser key, or their own wallet through Wallet Selector).
 * 5. The deposit is reported to 1Click and the swap status is polled until it settles.
 *
 * The policy treats a swap like a send to an unknown account: per-send and daily limits apply, the
 * kill switch stops it, and it always needs the confirm phrase plus the slide.
 */
import { QUOTE_ASSETS, type QuoteSymbol } from "./assets";
import { isValidAccountId } from "./account-id";
import type { WalletAction, WalletTx } from "./near/wallet-connector";

export const STORAGE_DEPOSIT_YOCTO = 1_250_000_000_000_000_000_000n;
const TGAS = 1_000_000_000_000n;

export type LiveQuote = {
  depositAddress: string;
  amountIn: string;
  amountInFormatted: string;
  amountOut: string;
  amountOutFormatted: string;
  minAmountOut: string;
  minAmountOutFormatted: string;
  deadline: string;
  timeEstimate: number;
  originAsset: string;
  destinationAsset: string;
  recipient: string;
  refundTo: string;
  toSymbol: QuoteSymbol;
};

export function verifyLiveQuote(
  quote: LiveQuote,
  expected: { accountId: string; amountYocto: bigint; toSymbol: QuoteSymbol },
  now = Date.now(),
): string[] {
  const problems: string[] = [];
  if (quote.amountIn !== expected.amountYocto.toString()) problems.push("The quote is for a different amount than you asked for.");
  if (quote.originAsset !== QUOTE_ASSETS.NEAR.assetId) problems.push("The quote does not start from wNEAR.");
  if (quote.destinationAsset !== QUOTE_ASSETS[expected.toSymbol].assetId) problems.push(`The quote does not deliver ${expected.toSymbol}.`);
  if (quote.recipient !== expected.accountId) problems.push("The quote would deliver to a different account than yours.");
  if (quote.refundTo !== expected.accountId) problems.push("A failed swap would refund a different account than yours.");
  if (!isValidAccountId(quote.depositAddress) || quote.depositAddress === expected.accountId) problems.push("The quote has no valid deposit address.");
  const deadline = Date.parse(quote.deadline);
  if (!Number.isFinite(deadline) || deadline < now + 2 * 60 * 1000) problems.push("The quote expires too soon. Ask again.");
  try {
    if (BigInt(quote.amountOut) <= 0n || BigInt(quote.minAmountOut) <= 0n) problems.push("The quote returns nothing.");
  } catch {
    problems.push("The quote returns nothing.");
  }
  return problems;
}

function call(methodName: string, args: Record<string, unknown>, deposit: bigint, gasTgas = 30n): WalletAction {
  return { type: "FunctionCall", params: { methodName, args, gas: (gasTgas * TGAS).toString(), deposit: deposit.toString() } };
}

export type SwapChainState = {
  /** wNEAR the user already holds. */
  wrappedYocto: bigint;
  /** Whether the user is registered on the wNEAR contract. */
  userOnWrap: boolean;
  /** Whether the user is registered on the destination token contract. */
  userOnDestination: boolean;
};

/** The exact transactions for one swap. Also returns the NEAR they attach in total. */
export function buildSwapTransactions(
  quote: LiveQuote,
  accountId: string,
  state: SwapChainState,
  wrapContract = "wrap.near",
): { transactions: WalletTx[]; attachedYocto: bigint } {
  const amount = BigInt(quote.amountIn);
  const transactions: WalletTx[] = [];
  let attached = 0n;
  const destinationContract = quote.destinationAsset.replace(/^nep141:/, "");
  if (!state.userOnDestination) {
    transactions.push({ receiverId: destinationContract, actions: [call("storage_deposit", { account_id: accountId, registration_only: true }, STORAGE_DEPOSIT_YOCTO)] });
    attached += STORAGE_DEPOSIT_YOCTO;
  }
  const wrapActions: WalletAction[] = [];
  if (!state.userOnWrap) {
    wrapActions.push(call("storage_deposit", { account_id: accountId, registration_only: true }, STORAGE_DEPOSIT_YOCTO, 10n));
    attached += STORAGE_DEPOSIT_YOCTO;
  }
  const shortfall = amount > state.wrappedYocto ? amount - state.wrappedYocto : 0n;
  if (shortfall > 0n) {
    wrapActions.push(call("near_deposit", {}, shortfall, 10n));
    attached += shortfall;
  }
  wrapActions.push(call("storage_deposit", { account_id: quote.depositAddress, registration_only: true }, STORAGE_DEPOSIT_YOCTO, 10n));
  attached += STORAGE_DEPOSIT_YOCTO;
  wrapActions.push(call("ft_transfer", { receiver_id: quote.depositAddress, amount: amount.toString(), memo: "vibe-wallet intents swap" }, 1n, 30n));
  attached += 1n;
  transactions.push({ receiverId: wrapContract, actions: wrapActions });
  return { transactions, attachedYocto: attached };
}

type Viewer = <T>(contractId: string, method: string, args: Record<string, unknown>) => Promise<T>;

export async function readSwapChainState(view: Viewer, accountId: string, destinationAsset: string, wrapContract = "wrap.near"): Promise<SwapChainState> {
  const destination = destinationAsset.replace(/^nep141:/, "");
  const [wrapped, onWrap, onDestination] = await Promise.all([
    view<string | null>(wrapContract, "ft_balance_of", { account_id: accountId }).catch(() => "0"),
    view<unknown>(wrapContract, "storage_balance_of", { account_id: accountId }).catch(() => null),
    view<unknown>(destination, "storage_balance_of", { account_id: accountId }).catch(() => null),
  ]);
  return {
    wrappedYocto: BigInt(String(wrapped ?? "0").replace(/"/g, "") || "0"),
    userOnWrap: onWrap !== null && onWrap !== undefined,
    userOnDestination: onDestination !== null && onDestination !== undefined,
  };
}

// --- Browser calls to this app's server, which talks to 1Click ---------------------------------

export async function requestLiveQuote(input: { accountId: string; amountNear: string; toSymbol: QuoteSymbol }): Promise<LiveQuote> {
  const response = await fetch("/api/intents/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "The swap quote failed.");
  return json.quote as LiveQuote;
}

export async function submitDeposit(input: { txHash: string; depositAddress: string }): Promise<void> {
  await fetch("/api/intents/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => undefined);
}

export type SwapStatus = { status: string; done: boolean; success: boolean; detail: Record<string, unknown> | null };

export async function swapStatus(depositAddress: string): Promise<SwapStatus> {
  const response = await fetch(`/api/intents/status?depositAddress=${encodeURIComponent(depositAddress)}`, { cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  const status = String(json.status || "UNKNOWN");
  return { status, done: ["SUCCESS", "REFUNDED", "FAILED"].includes(status), success: status === "SUCCESS", detail: json.swapDetails ?? null };
}

export async function waitForSwap(depositAddress: string, onStatus: (status: string) => void, timeoutMs = 4 * 60 * 1000): Promise<SwapStatus> {
  const started = Date.now();
  let last: SwapStatus = { status: "PENDING_DEPOSIT", done: false, success: false, detail: null };
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try {
      last = await swapStatus(depositAddress);
      onStatus(last.status);
      if (last.done) return last;
    } catch {
      // keep polling
    }
  }
  return last;
}
