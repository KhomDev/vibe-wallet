import { baseEncode, type Account, type Action } from "near-api-js";

type TxResult = {
  status: unknown;
  transaction: { hash: string };
  transaction_outcome: { id: string; outcome: { tokens_burnt: string | number } };
  receipts_outcome?: { outcome: { tokens_burnt: string | number } }[];
};

export type Broadcasted = { hash: string; feeYocto: bigint; reconciled: boolean };

/**
 * Error from a send. `broadcast` says whether the signed transaction may have reached the network:
 * false means it certainly did not (nothing moved); true with `outcome: "unknown"` means it may
 * still execute, so a retry could pay twice and callers must not release limits or retry blindly.
 */
export class SendError extends Error {
  constructor(
    message: string,
    readonly broadcast: boolean,
    readonly outcome: "not-sent" | "failed" | "unknown",
    readonly hash?: string,
  ) {
    super(message);
    this.name = "SendError";
  }
}

function fee(result: TxResult): bigint {
  const rows = [result.transaction_outcome, ...(result.receipts_outcome ?? [])];
  return rows.reduce((sum, row) => sum + BigInt(row.outcome.tokens_burnt), 0n);
}

function failure(result: TxResult): string | null {
  const status = result.status;
  if (status && typeof status === "object" && "Failure" in status) return JSON.stringify(status).slice(0, 240);
  return null;
}

/** Hash of a transaction as NEAR reports it: base58(sha256(borsh(transaction))). */
export async function transactionHash(encoded: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoded as BufferSource);
  return baseEncode(new Uint8Array(digest));
}

/**
 * Signs, computes the hash before broadcasting, sends, and waits for execution. If the send call
 * itself fails, the hash is looked up so a transaction that landed is reported as landed instead
 * of as an error the user might retry.
 */
export async function signAndBroadcast(account: Account, receiverId: string, actions: Action[]): Promise<Broadcasted> {
  // A nonce clash means another transaction from this key took the nonce first, so ours was not
  // included and re-signing with a fresh nonce cannot pay twice.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await signAndBroadcastOnce(account, receiverId, actions);
    } catch (err) {
      if (err instanceof SendError && err.outcome === "not-sent" && /InvalidNonce|nonce|InvalidTransaction/i.test(err.message) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 300 + attempt * 400));
        continue;
      }
      throw err;
    }
  }
}

async function signAndBroadcastOnce(account: Account, receiverId: string, actions: Action[]): Promise<Broadcasted> {
  let signed;
  try {
    signed = await account.createSignedTransaction({ receiverId, actions });
  } catch (err) {
    throw new SendError(err instanceof Error ? err.message : String(err), false, "not-sent");
  }
  const hash = await transactionHash(signed.transaction.encode());
  const provider = account.provider;
  try {
    const result = await provider.sendTransactionUntil(signed, "EXECUTED") as unknown as TxResult;
    const failed = failure(result);
    if (failed) throw new SendError(`The transaction was rejected: ${failed}`, true, "failed", hash);
    return { hash, feeYocto: fee(result), reconciled: false };
  } catch (err) {
    if (err instanceof SendError) throw err;
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
    const message = err instanceof Error ? err.message : String(err);
    // Errors that prove the node refused the transaction before including it (near-api-js raises
    // InvalidTransactionError for every pre-inclusion rejection, a nonce clash included).
    if (/InvalidTransaction|InvalidNonce|NotEnoughBalance|Expired|InvalidSignature|AccessKeyNotFound|LackBalanceForState|ShardCongested/i.test(`${name} ${message}`)
      || /does not exist|invalid transaction/i.test(message)) {
      throw new SendError(`${name ? `${name}: ` : ""}${message}`, false, "not-sent", hash);
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      try {
        const found = await provider.viewTransactionStatus({ txHash: hash, accountId: account.accountId, waitUntil: "EXECUTED" }) as unknown as TxResult;
        const failed = failure(found);
        if (failed) throw new SendError(`The transaction was rejected: ${failed}`, true, "failed", hash);
        return { hash, feeYocto: fee(found), reconciled: true };
      } catch (lookup) {
        if (lookup instanceof SendError) throw lookup;
      }
    }
    throw new SendError(`The network did not confirm transaction ${hash} in time. It may still go through: check your history before sending again.`, true, "unknown", hash);
  }
}
