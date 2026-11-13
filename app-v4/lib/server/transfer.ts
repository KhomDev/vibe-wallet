/**
 * Server-side testnet transfer for the shared demo account only.
 * API routes must import this module, not lib/near/signer.ts.
 */
import { Account, actions } from "near-api-js";
import { assessSend, phraseMatches, type Policy } from "../policy";
import { parseNear } from "../units";
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

type TxResult = {
  status: unknown;
  transaction: { hash: string };
  transaction_outcome: { id: string; outcome: { tokens_burnt: string | number } };
  receipts_outcome?: { outcome: { tokens_burnt: string | number } }[];
};

export type ServerTx = {
  hash: string;
  feeYocto: bigint;
  success: boolean;
  balance: BalanceView | null;
};

function txHash(result: TxResult): string {
  return result.transaction?.hash || result.transaction_outcome.id;
}

function txFee(result: TxResult): bigint {
  const rows = [result.transaction_outcome, ...(result.receipts_outcome ?? [])];
  return rows.reduce((sum, row) => sum + BigInt(row.outcome.tokens_burnt), 0n);
}

function assertSuccess(result: TxResult): void {
  const status = result.status;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new Error(`The transaction was rejected: ${JSON.stringify(status).slice(0, 240)}`);
  }
}

export async function executeDemoTransfer(input: {
  accountId: string;
  secretKey: string;
  expectedPublicKey?: string;
  recipient: string;
  amountNear: string;
  policy: Policy;
  spentTodayYocto: bigint;
  userConfirmed: boolean;
  confirmationPhrase: string | null;
  skipPhrase?: boolean;
}): Promise<ServerTx> {
  if (!input.userConfirmed) throw new Error("Signer refused: the send was not confirmed.");
  if (input.policy.killed) throw new Error("The kill switch is on. Sending is stopped, including the demo agent.");
  const secret = asSecret(input.secretKey);
  const actual = publicKeyOf(secret);
  if (input.expectedPublicKey && input.expectedPublicKey !== actual) {
    throw new Error("Signer refused: the demo key does not match the configured public key.");
  }
  await assertFullAccessKey(input.accountId, actual);
  const amountYocto = parseNear(input.amountNear);
  const [balance, exists, feeYocto] = await Promise.all([
    readBalance(input.accountId),
    accountExists(input.recipient),
    estimateTransferFee(input.recipient === input.accountId),
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
  if (check.blockReason) throw new Error(check.blockReason);
  if (!input.skipPhrase && check.needsPhrase && !phraseMatches(input.policy, input.confirmationPhrase)) {
    throw new Error("Signer refused: this send needs the confirm phrase as well as a confirmation.");
  }
  const account = new Account(input.accountId, getProvider(), secret);
  const result = await account.signAndSendTransaction({
    receiverId: input.recipient,
    actions: [actions.transfer(amountYocto)],
    waitUntil: "EXECUTED",
  }) as unknown as TxResult;
  assertSuccess(result);
  return { hash: txHash(result), feeYocto: txFee(result), success: true, balance };
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
