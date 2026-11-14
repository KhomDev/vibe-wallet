/**
 * Sends from a connected wallet (Wallet Selector). Same contract as executeTransfer in signer.ts:
 * the policy runs again on live data right before the wallet is asked, so the app never requests a
 * transaction outside the user's limits. The wallet then shows its own confirmation, and the key
 * never leaves it.
 */
import { assessSend, phraseMatches, type Policy } from "../policy";
import { NETWORK_ID } from "../config";
import { SendError } from "./broadcast";
import { accountExists, estimateTransferFee, readBalance } from "./read";
import { walletSend, type WalletOutcome } from "./wallet-connector";

export async function walletTransfer(input: {
  accountId: string;
  recipient: string;
  amountYocto: bigint;
  policy: Policy;
  spentTodayYocto: bigint;
  userConfirmed: boolean;
  confirmationPhrase: string | null;
  onBeforeBroadcast?: () => void;
}): Promise<WalletOutcome> {
  const refuse = (message: string): never => {
    throw new SendError(message, false, "not-sent");
  };
  if (!input.userConfirmed) refuse("Not confirmed.");
  if (input.policy.killed) refuse("The kill switch is on. Sending is stopped.");
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
  if (check.needsPhrase && !phraseMatches(input.policy, input.confirmationPhrase)) refuse("This send needs the confirm phrase as well as the slide.");
  input.onBeforeBroadcast?.();
  try {
    return await walletSend(input.accountId, [{ receiverId: input.recipient, actions: [{ type: "Transfer", params: { deposit: input.amountYocto.toString() } }] }]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A wallet that was closed or declined never sent anything.
    if (/reject|cancel|denied|closed|user/i.test(message) && !/was rejected:/i.test(message)) throw new SendError(message, false, "not-sent");
    throw new SendError(message, true, "unknown");
  }
}
