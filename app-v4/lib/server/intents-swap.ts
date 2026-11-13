/**
 * Real NEAR Intents execution through the 1Click API (mainnet only).
 *
 * The in-app swap flow stays quote-only (dry: true) because the app and the
 * shared demo run on testnet, where Intents has no execution. This module is
 * the executed path: it requests a live quote with a deposit address, wraps
 * NEAR into wNEAR, deposits it with ft_transfer, tells 1Click about the
 * deposit, and polls until the swap settles. It refuses to run off mainnet.
 */
import { Account, actions, type KeyPairString } from "near-api-js";
import { QUOTE_ASSETS, type QuoteSymbol } from "../assets";
import { INTENTS_API_URL, IS_MAINNET } from "../config";
import { getProvider } from "../near/read";
import { parseUnits } from "../units";

const WRAP_CONTRACT = "wrap.near";
const TGAS = 1_000_000_000_000n;
const ONE_YOCTO = 1n;

export type AppFee = { recipient: string; fee: number };

export type SwapResult = {
  depositAddress: string;
  quote: Record<string, unknown>;
  wrapTx: string | null;
  depositTx: string;
  status: string;
  settlement: Record<string, unknown> | null;
};

type TxOut = { status: unknown; transaction: { hash: string } };

function api(path: string): string {
  return `${INTENTS_API_URL.replace(/\/$/, "")}${path}`;
}

function ok(result: TxOut): string {
  if (result.status && typeof result.status === "object" && "Failure" in result.status) {
    throw new Error(`Transaction failed: ${JSON.stringify(result.status).slice(0, 240)}`);
  }
  return result.transaction.hash;
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  return (await getProvider().callFunction({ contractId, method, args })) as unknown as T;
}

export async function requestLiveQuote(input: {
  accountId: string;
  amountNear: string;
  toSymbol: QuoteSymbol;
  slippageBps?: number;
  appFees?: AppFee[];
}): Promise<{ depositAddress: string; quote: Record<string, unknown> }> {
  const destination = QUOTE_ASSETS[input.toSymbol];
  const response = await fetch(api("/quote"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: input.slippageBps ?? 100,
      originAsset: QUOTE_ASSETS.NEAR.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount: parseUnits(input.amountNear, 24).toString(),
      recipient: input.accountId,
      recipientType: "DESTINATION_CHAIN",
      refundTo: input.accountId,
      refundType: "ORIGIN_CHAIN",
      deadline: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      ...(input.appFees?.length ? { appFees: input.appFees } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(String(payload?.message || `1Click quote failed (${response.status}).`));
  const depositAddress = String(payload?.quote?.depositAddress || "");
  if (!depositAddress) throw new Error("1Click returned no deposit address.");
  return { depositAddress, quote: payload.quote };
}

export async function executeIntentsSwap(input: {
  accountId: string;
  secretKey: string;
  amountNear: string;
  toSymbol: QuoteSymbol;
  userConfirmed: boolean;
  maxNear: string;
  appFees?: AppFee[];
  onStep?: (step: string) => void;
}): Promise<SwapResult> {
  if (!IS_MAINNET) throw new Error("Intents execution is mainnet-only. Testnet stays quote-only.");
  if (!input.userConfirmed) throw new Error("Signer refused: the swap was not confirmed.");
  const amountYocto = parseUnits(input.amountNear, 24);
  if (amountYocto <= 0n || amountYocto > parseUnits(input.maxNear, 24)) {
    throw new Error(`Swap amount must be above 0 and at most ${input.maxNear} NEAR.`);
  }
  const step = input.onStep ?? (() => undefined);
  const { depositAddress, quote } = await requestLiveQuote(input);
  step(`quote ${quote.amountInFormatted} NEAR -> ${quote.amountOutFormatted} ${input.toSymbol}, deposit ${depositAddress}`);

  const account = new Account(input.accountId, getProvider(), input.secretKey as KeyPairString);

  // Wrap only the shortfall, so leftover wNEAR is used first.
  const wrapped = BigInt(await view<string>(WRAP_CONTRACT, "ft_balance_of", { account_id: input.accountId }));
  let wrapTx: string | null = null;
  if (wrapped < amountYocto) {
    const res = await account.signAndSendTransaction({
      receiverId: WRAP_CONTRACT,
      actions: [actions.functionCall("near_deposit", {}, 30n * TGAS, amountYocto - wrapped)],
      waitUntil: "EXECUTED",
    }) as unknown as TxOut;
    wrapTx = ok(res);
    step(`wrapped NEAR: ${wrapTx}`);
  }

  // Deposit wNEAR to the 1Click deposit address.
  const res = await account.signAndSendTransaction({
    receiverId: WRAP_CONTRACT,
    actions: [
      actions.functionCall(
        "storage_deposit",
        { account_id: depositAddress, registration_only: true },
        30n * TGAS,
        1_250_000_000_000_000_000_000n,
      ),
      actions.functionCall(
        "ft_transfer",
        { receiver_id: depositAddress, amount: amountYocto.toString(), memo: "vibe-wallet intents swap" },
        30n * TGAS,
        ONE_YOCTO,
      ),
    ],
    waitUntil: "EXECUTED",
  }) as unknown as TxOut;
  const depositTx = ok(res);
  step(`deposited wNEAR: ${depositTx}`);

  await fetch(api("/deposit/submit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ txHash: depositTx, depositAddress }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined);

  let status = "PENDING_DEPOSIT";
  let settlement: Record<string, unknown> | null = null;
  const started = Date.now();
  while (Date.now() - started < 5 * 60 * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const poll = await fetch(api(`/status?depositAddress=${encodeURIComponent(depositAddress)}`), {
      signal: AbortSignal.timeout(20_000),
    }).then((r) => r.json()).catch(() => null) as Record<string, unknown> | null;
    if (!poll) continue;
    status = String(poll.status || status);
    step(`status ${status}`);
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(status)) {
      settlement = (poll.swapDetails as Record<string, unknown>) ?? poll;
      break;
    }
  }
  return { depositAddress, quote, wrapTx, depositTx, status, settlement };
}
