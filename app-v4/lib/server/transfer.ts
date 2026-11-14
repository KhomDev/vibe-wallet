/**
 * Server-side testnet transfer for the shared demo account only.
 * API routes must import this module, not lib/near/signer.ts.
 */
import { Account, actions } from "near-api-js";
import { assessSend, phraseMatches, type Policy } from "../policy";
import { parseNear } from "../units";
import { SendError, signAndBroadcast } from "../near/broadcast";
import {
  accountExists,
  asSecret,
  assertFullAccessKey,
  estimateTransferFee,
  getProvider,
  publicKeyOf,
  readBalance,
  type BalanceView,
} from "../near/read";
import { assertDemoNetwork } from "./env";

export type ServerTx = {
  hash: string;
  feeYocto: bigint;
  success: boolean;
  reconciled: boolean;
  balance: BalanceView | null;
};

export { SendError };

/**
 * Re-checks everything and sends. Any refusal before the broadcast is a SendError with
 * broadcast=false, so the caller can safely give the reserved spend back.
 */
export async function executeDemoTransfer(input: {
  accountId: string;
  secretKey: string;
  expectedPublicKey?: string;
  recipient: string;
  amountNear: string;
  policy: Policy;
  /** The visitor's spend today, not counting this send. */
  spentTodayYocto: bigint;
  userConfirmed: boolean;
  confirmationPhrase: string | null;
  /** Agent rules: the owner's slide when creating the rule is the confirmation. */
  skipPhrase?: boolean;
}): Promise<ServerTx> {
  const refuse = (message: string): never => {
    throw new SendError(message, false, "not-sent");
  };
  try {
    await assertDemoNetwork();
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err));
  }
  if (!input.userConfirmed) refuse("Signer refused: the send was not confirmed.");
  if (input.policy.killed) refuse("Sending is stopped. The kill switch also stops the demo agent.");
  let secret;
  try {
    secret = asSecret(input.secretKey);
  } catch {
    return refuse("The demo key is not configured correctly.");
  }
  const actual = publicKeyOf(secret);
  if (input.expectedPublicKey && input.expectedPublicKey !== actual) {
    refuse("Signer refused: the demo key does not match the configured public key.");
  }
  try {
    await assertFullAccessKey(input.accountId, actual);
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err));
  }
  const amountYocto = parseNear(input.amountNear);
  const [balance, exists, feeYocto] = await Promise.all([
    readBalance(input.accountId),
    accountExists(input.recipient),
    estimateTransferFee(input.recipient === input.accountId),
  ]).catch((err) => refuse(err instanceof Error ? err.message : String(err)));
  if (!balance) refuse("The demo account is not visible on testnet.");
  const check = assessSend(input.policy, {
    recipient: input.recipient,
    amountYocto,
    feeYocto,
    availableYocto: BigInt(balance!.availableYocto),
    spentTodayYocto: input.spentTodayYocto,
    accountExists: exists,
  }, input.accountId);
  if (check.blockReason) refuse(check.blockReason);
  if (!input.skipPhrase && check.needsPhrase && !phraseMatches(input.policy, input.confirmationPhrase)) {
    refuse("Signer refused: this send needs the confirm phrase as well as a confirmation.");
  }
  const account = new Account(input.accountId, getProvider(), secret);
  const sent = await withSignerLock(() => signAndBroadcast(account, input.recipient, [actions.transfer(amountYocto)]));
  return { hash: sent.hash, feeYocto: sent.feeYocto, success: true, reconciled: sent.reconciled, balance };
}

let signerLock: Promise<unknown> = Promise.resolve();

/** One demo signature at a time per instance, so concurrent visitors do not race for a nonce. */
function withSignerLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = signerLock.then(fn, fn);
  signerLock = run.catch(() => undefined);
  return run;
}

export async function previewSend(input: {
  accountId: string;
  recipient: string;
  amountNear: string;
  policy: Policy;
  spentTodayYocto: bigint;
}) {
  const amountYocto = parseNear(input.amountNear);
  const [balance, exists, feeYocto] = await Promise.all([
    readBalance(input.accountId),
    accountExists(input.recipient),
    estimateTransferFee(false),
  ]);
  if (!balance) throw new Error("The demo account is not visible on testnet.");
  const check = assessSend(input.policy, {
    recipient: input.recipient,
    amountYocto,
    feeYocto,
    availableYocto: BigInt(balance.availableYocto),
    spentTodayYocto: input.spentTodayYocto,
    accountExists: exists,
  }, input.accountId);
  const after = BigInt(balance.availableYocto) - amountYocto - feeYocto;
  return { balance, exists, feeYocto, amountYocto, check, after: after > 0n ? after : 0n };
}
