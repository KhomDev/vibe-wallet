import { createHash } from "node:crypto";
import { baseDecode, baseEncode, decodeSignedTransaction } from "near-api-js";

/**
 * A throwaway NEAR JSON-RPC that answers the calls the server signer makes, so tests can drive
 * the real route handlers end to end. Every broadcast is decoded and recorded; nothing leaves the
 * process. Unknown accounts do not exist; everything else has `balanceNear` NEAR.
 */
export type SentTransfer = { hash: string; signer: string; receiver: string; depositYocto: string; nonce: bigint };

export function installRpcStub(options: { chainId?: string; balanceYocto?: bigint; known?: string[]; sendDelayMs?: number } = {}) {
  const original = globalThis.fetch;
  const sent: SentTransfer[] = [];
  const nonces = new Map<string, bigint>();
  const known = new Set(options.known ?? []);
  const calls: string[] = [];
  const blockHash = baseEncode(new Uint8Array(32).fill(7));

  const reply = (id: unknown, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status: 200, headers: { "content-type": "application/json" } });
  const fail = (id: unknown, name: string, message: string) => new Response(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { name: "HANDLER_ERROR", cause: { name, info: {} }, code: -32000, message, data: message },
  }), { status: 200, headers: { "content-type": "application/json" } });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!/rpc|fastnear|localhost-rpc/.test(url)) {
      return original(input as RequestInfo, init);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { id: unknown; method: string; params: Record<string, unknown> | unknown[] };
    calls.push(body.method);
    const params = (body.params ?? {}) as Record<string, unknown>;
    switch (body.method) {
      case "status":
        return reply(body.id, { chain_id: options.chainId ?? "testnet", sync_info: { latest_block_hash: blockHash, latest_block_height: 100 } });
      case "gas_price":
        return reply(body.id, { gas_price: "100000000" });
      case "EXPERIMENTAL_protocol_config":
        return reply(body.id, {
          runtime_config: {
            storage_amount_per_byte: "10000000000000000000",
            transaction_costs: {
              action_receipt_creation_config: { send_sir: 108059500000, send_not_sir: 108059500000, execution: 108059500000 },
              action_creation_config: { transfer_cost: { send_sir: 115123062500, send_not_sir: 115123062500, execution: 115123062500 } },
            },
          },
        });
      case "block":
        return reply(body.id, { header: { hash: blockHash, height: 100 } });
      case "query": {
        const accountId = String(params.account_id ?? "");
        if (params.request_type === "view_account") {
          if (!known.has(accountId)) return fail(body.id, "UNKNOWN_ACCOUNT", `account ${accountId} does not exist while viewing`);
          return reply(body.id, { amount: String(options.balanceYocto ?? 50n * 10n ** 24n), locked: "0", storage_usage: 500, code_hash: "11111111111111111111111111111111", block_height: 100, block_hash: blockHash });
        }
        if (params.request_type === "view_access_key") {
          const key = `${accountId}:${String(params.public_key)}`;
          return reply(body.id, { nonce: Number(nonces.get(key) ?? 7n), permission: "FullAccess", block_height: 100, block_hash: blockHash });
        }
        if (params.request_type === "call_function") {
          return reply(body.id, { result: Array.from(Buffer.from("null")), logs: [], block_height: 100, block_hash: blockHash });
        }
        return fail(body.id, "UNKNOWN_REQUEST", "unsupported query");
      }
      case "send_tx": {
        const bytes = Buffer.from(String(params.signed_tx_base64), "base64");
        const signed = decodeSignedTransaction(new Uint8Array(bytes));
        const tx = signed.transaction;
        const hash = baseEncode(createHash("sha256").update(tx.encode()).digest());
        const key = `${tx.signerId}:${tx.publicKey.toString()}`;
        const current = nonces.get(key) ?? 7n;
        if (BigInt(tx.nonce) <= current) {
          return fail(body.id, "INVALID_TRANSACTION", `InvalidNonce: tx nonce ${tx.nonce} must be larger than ${current}`);
        }
        nonces.set(key, BigInt(tx.nonce));
        if (options.sendDelayMs) await new Promise((resolve) => setTimeout(resolve, options.sendDelayMs));
        for (const action of tx.actions as unknown as { transfer?: { deposit: bigint } }[]) {
          if (action.transfer) sent.push({ hash, signer: tx.signerId, receiver: tx.receiverId, depositYocto: action.transfer.deposit.toString(), nonce: BigInt(tx.nonce) });
        }
        return reply(body.id, {
          final_execution_status: "EXECUTED",
          status: { SuccessValue: "" },
          transaction: { hash, signer_id: tx.signerId, receiver_id: tx.receiverId, nonce: Number(tx.nonce), actions: [] },
          transaction_outcome: { id: hash, block_hash: blockHash, proof: [], outcome: { tokens_burnt: "44636512500000000000", gas_burnt: 1, logs: [], receipt_ids: [], status: { SuccessValue: "" }, executor_id: tx.signerId } },
          receipts_outcome: [],
        });
      }
      default:
        return fail(body.id, "UNKNOWN_METHOD", `unsupported ${body.method}`);
    }
  }) as typeof fetch;

  return {
    sent,
    calls,
    known,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Decodes a base58 block hash so unused-import linting stays quiet in some runners. */
export const decodeHash = (value: string) => baseDecode(value);
