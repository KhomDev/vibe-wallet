/**
 * Signer layer. This is the only module that turns a confirmed action into a
 * signed NEAR transaction. API routes must not import it. Secrets stay in the
 * caller process (the browser) and are never put in a request body.
 */
import { Account, KeyPair, PublicKey, actions, type KeyPairString } from "near-api-js";
import {
  NETWORK_ID,
  SCOPED_ALLOWANCE_NEAR,
  SCOPED_CALL_METHOD,
  SCOPED_CONTRACT_ID,
  SCOPED_METHODS,
} from "../config";
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
} from "./read";

type TxResult = {
  status: unknown;
  transaction: { hash: string };
  transaction_outcome: { id: string; outcome: { tokens_burnt: string | number } };
  receipts_outcome?: { outcome: { tokens_burnt: string | number } }[];
};

export type SignedTx = {
  hash: string;
  feeYocto: bigint;
  success: boolean;
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

function assertExpectedKey(secretKey: string, expectedPublicKey: string): KeyPairString {
  const secret = asSecret(secretKey);
  const actual = publicKeyOf(secret);
  if (actual !== expectedPublicKey) {
    throw new Error("Signer refused: the in-memory key does not match the public key stored for this wallet.");
  }
  return secret;
}

export async function addScopedKey(input: {
  accountId: string;
  fullSecret: string;
  expectedPublicKey: string;
}): Promise<{ agentSecret: string; agentPublicKey: string; hash: string }> {
  const secret = assertExpectedKey(input.fullSecret, input.expectedPublicKey);
  await assertFullAccessKey(input.accountId, input.expectedPublicKey);
  const agent = KeyPair.fromRandom("ed25519");
  const agentPublicKey = agent.getPublicKey().toString();
  const account = new Account(input.accountId, getProvider(), secret);
  const result = await account.signAndSendTransaction({
    receiverId: input.accountId,
    actions: [
      actions.addFunctionCallAccessKey(
        PublicKey.fromString(agentPublicKey),
        SCOPED_CONTRACT_ID,
        [...SCOPED_METHODS],
        parseNear(SCOPED_ALLOWANCE_NEAR),
      ),
    ],
    waitUntil: "EXECUTED",
  }) as unknown as TxResult;
  assertSuccess(result);
  return { agentSecret: agent.toString(), agentPublicKey, hash: txHash(result) };
}

export async function executeScopedCall(input: {
  accountId: string;
  agentSecret: string;
  expectedAgentPublicKey: string;
}): Promise<SignedTx> {
  const secret = assertExpectedKey(input.agentSecret, input.expectedAgentPublicKey);
  const view = await getProvider().viewAccessKey({
    accountId: input.accountId,
    publicKey: input.expectedAgentPublicKey,
  });
  if (view.permission === "FullAccess" || !view.permission || typeof view.permission !== "object" || !("FunctionCall" in view.permission)) {
    throw new Error("Signer refused: the scoped call key is not a function-call key.");
  }
  const call = view.permission.FunctionCall;
  if (call.receiver_id !== SCOPED_CONTRACT_ID || !call.method_names.includes(SCOPED_CALL_METHOD)) {
    throw new Error("Signer refused: this key is not limited to the expected contract method.");
  }
  const account = new Account(input.accountId, getProvider(), secret);
  const result = await account.signAndSendTransaction({
    receiverId: SCOPED_CONTRACT_ID,
    actions: [actions.functionCall(SCOPED_CALL_METHOD, { account_id: input.accountId }, 20_000_000_000_000n, 0n)],
    waitUntil: "EXECUTED",
  }) as unknown as TxResult;
  assertSuccess(result);
  return { hash: txHash(result), feeYocto: txFee(result), success: true };
}

export async function executeTransfer(input: {
  accountId: string;
  fullSecret: string;
  expectedPublicKey: string;
  recipient: string;
  amountYocto: bigint;
  policy: Policy;
  spentTodayYocto: bigint;
  userConfirmed: boolean;
  confirmationPhrase: string | null;
}): Promise<SignedTx & { balance: BalanceView | null }> {
  if (!input.userConfirmed) throw new Error("Signer refused: the send was not confirmed.");
  if (input.policy.killed) throw new Error("The kill switch is on. Sending is stopped.");
  const secret = assertExpectedKey(input.fullSecret, input.expectedPublicKey);
  await assertFullAccessKey(input.accountId, input.expectedPublicKey);
  const [balance, exists, feeYocto] = await Promise.all([
    readBalance(input.accountId),
    accountExists(input.recipient),
    estimateTransferFee(input.recipient === input.accountId),
  ]);
  if (!balance) throw new Error(`Your account is not visible on ${NETWORK_ID}.`);
  const check = assessSend(input.policy, {
    recipient: input.recipient,
    amountYocto: input.amountYocto,
    feeYocto,
    availableYocto: BigInt(balance.availableYocto),
    spentTodayYocto: input.spentTodayYocto,
    accountExists: exists,
  }, input.accountId);
  if (check.blockReason) throw new Error(check.blockReason);
  if (check.needsPhrase && !phraseMatches(input.policy, input.confirmationPhrase)) {
    throw new Error("Signer refused: this send needs the confirm phrase as well as a click.");
  }
  const account = new Account(input.accountId, getProvider(), secret);
  const result = await account.signAndSendTransaction({
    receiverId: input.recipient,
    actions: [actions.transfer(input.amountYocto)],
    waitUntil: "EXECUTED",
  }) as unknown as TxResult;
  assertSuccess(result);
  return { hash: txHash(result), feeYocto: txFee(result), success: true, balance };
}
