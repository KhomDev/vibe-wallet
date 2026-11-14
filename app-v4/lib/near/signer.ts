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
import { SendError, signAndBroadcast } from "./broadcast";
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

export type SignedTx = {
  hash: string;
  feeYocto: bigint;
  success: boolean;
  /** True when the send call failed but the hash was found on chain afterwards. */
  reconciled: boolean;
};

export { SendError };

const tabLocks = new Map<string, Promise<unknown>>();

/**
 * Runs one signing operation per account at a time: across tabs with the Web Locks API when the
 * browser has it, and always within this tab. Two sends can no longer read the same access-key
 * nonce and race each other.
 */
export async function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const previous = tabLocks.get(accountId) ?? Promise.resolve();
  const run: Promise<T> = previous.catch(() => undefined).then(async (): Promise<T> => {
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks : undefined;
    return locks ? await locks.request(`vibe-wallet-sign:${accountId}`, fn) : await fn();
  });
  tabLocks.set(accountId, run.catch(() => undefined));
  return run;
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
  return withAccountLock(input.accountId, async () => {
    await assertFullAccessKey(input.accountId, input.expectedPublicKey);
    const agent = KeyPair.fromRandom("ed25519");
    const agentPublicKey = agent.getPublicKey().toString();
    const account = new Account(input.accountId, getProvider(), secret);
    const sent = await signAndBroadcast(account, input.accountId, [
      actions.addFunctionCallAccessKey(
        PublicKey.fromString(agentPublicKey),
        SCOPED_CONTRACT_ID,
        [...SCOPED_METHODS],
        parseNear(SCOPED_ALLOWANCE_NEAR),
      ),
    ]);
    return { agentSecret: agent.toString(), agentPublicKey, hash: sent.hash };
  });
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
  const sent = await withAccountLock(input.accountId, () => signAndBroadcast(account, SCOPED_CONTRACT_ID, [
    actions.functionCall(SCOPED_CALL_METHOD, { account_id: input.accountId }, 20_000_000_000_000n, 0n),
  ]));
  return { hash: sent.hash, feeYocto: sent.feeYocto, success: true, reconciled: sent.reconciled };
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
  /** Called after every check passed, right before the transaction is signed and sent. */
  onBeforeBroadcast?: () => void;
}): Promise<SignedTx & { balance: BalanceView | null }> {
  const refuse = (message: string): never => {
    throw new SendError(message, false, "not-sent");
  };
  if (!input.userConfirmed) refuse("Signer refused: the send was not confirmed.");
  if (input.policy.killed) refuse("The kill switch is on. Sending is stopped.");
  const secret = assertExpectedKey(input.fullSecret, input.expectedPublicKey);
  return withAccountLock(input.accountId, async () => {
  await assertFullAccessKey(input.accountId, input.expectedPublicKey);
  const [balance, exists, feeYocto] = await Promise.all([
    readBalance(input.accountId),
    accountExists(input.recipient),
    estimateTransferFee(input.recipient === input.accountId),
  ]);
  if (!balance) refuse(`Your account is not visible on ${NETWORK_ID}.`);
  const check = assessSend(input.policy, {
    recipient: input.recipient,
    amountYocto: input.amountYocto,
    feeYocto,
    availableYocto: BigInt(balance!.availableYocto),
    spentTodayYocto: input.spentTodayYocto,
    accountExists: exists,
  }, input.accountId);
  if (check.blockReason) refuse(check.blockReason);
  if (check.needsPhrase && !phraseMatches(input.policy, input.confirmationPhrase)) {
    refuse("Signer refused: this send needs the confirm phrase as well as the slide.");
  }
  const account = new Account(input.accountId, getProvider(), secret);
  input.onBeforeBroadcast?.();
  const sent = await signAndBroadcast(account, input.recipient, [actions.transfer(input.amountYocto)]);
  return { hash: sent.hash, feeYocto: sent.feeYocto, success: true, reconciled: sent.reconciled, balance };
  });
}
