import { Account, JsonRpcProvider, KeyPair, keyToImplicitAddress, type KeyPairString } from "near-api-js";
import { FAUCET_URL, NETWORK_ID, RPC_URL, SCOPED_CONTRACT_ID, SCOPED_METHODS, historyUrl } from "../config";
import { mapIndexerTransactions, type HistoryItem } from "../history";
import { formatNear } from "../units";

export type BalanceView = {
  totalYocto: string;
  availableYocto: string;
  storageYocto: string;
  totalNear: string;
  availableNear: string;
  storageNear: string;
};

export type KeySummary = {
  publicKey: string;
  kind: "full" | "function-call" | "other";
  receiver?: string;
  methods?: string[];
  allowanceYocto?: string | null;
  detail?: string;
};

let provider: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider({ url: RPC_URL }, { retries: 3, wait: 400, backoff: 1.5 });
  return provider;
}

export function generateEd25519(): { secretKey: string; publicKey: string } {
  const keyPair = KeyPair.fromRandom("ed25519");
  return { secretKey: keyPair.toString(), publicKey: keyPair.getPublicKey().toString() };
}

export function publicKeyOf(secretKey: string): string {
  return KeyPair.fromString(asSecret(secretKey)).getPublicKey().toString();
}

export function implicitAccountId(publicKey: string): string {
  return keyToImplicitAddress(publicKey);
}

export function asSecret(secretKey: string): KeyPairString {
  const trimmed = secretKey.trim().replace(/^"|"$/g, "");
  if (!trimmed.startsWith("ed25519:")) {
    throw new Error("Paste an ed25519 secret key, including the ed25519: prefix.");
  }
  return trimmed as KeyPairString;
}

function missingAccount(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /does not exist|AccountDoesNotExist|unknown account/i.test(message);
}

export async function readBalance(accountId: string): Promise<BalanceView | null> {
  try {
    const state = await new Account(accountId, getProvider()).getState();
    return {
      totalYocto: state.balance.total.toString(),
      availableYocto: state.balance.available.toString(),
      storageYocto: state.balance.usedOnStorage.toString(),
      totalNear: formatNear(state.balance.total),
      availableNear: formatNear(state.balance.available),
      storageNear: formatNear(state.balance.usedOnStorage),
    };
  } catch (err) {
    if (missingAccount(err)) return null;
    throw err;
  }
}

export async function accountExists(accountId: string): Promise<boolean> {
  const balance = await readBalance(accountId);
  return balance !== null;
}

export async function waitForAccount(accountId: string, timeoutMs = 60_000): Promise<BalanceView> {
  const started = Date.now();
  let last = "not indexed yet";
  while (Date.now() - started < timeoutMs) {
    try {
      const balance = await readBalance(accountId);
      if (balance) return balance;
      last = "account is not visible yet";
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`The faucet accepted ${accountId}, but testnet has not shown it yet (${last}).`);
}

export async function requestFaucet(accountId: string, publicKey: string): Promise<string> {
  const response = await fetch(FAUCET_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.slice(0, 280) || `The testnet faucet returned ${response.status}.`);
  }
  return text.slice(0, 500);
}

export async function createFundedAccount(accountId: string): Promise<{
  accountId: string;
  secretKey: string;
  publicKey: string;
  balance: BalanceView;
}> {
  const keys = generateEd25519();
  await requestFaucet(accountId, keys.publicKey);
  const balance = await waitForAccount(accountId);
  return { accountId, ...keys, balance };
}

export async function listKeys(accountId: string): Promise<KeySummary[]> {
  const list = await new Account(accountId, getProvider()).getAccessKeyList();
  return list.keys.map((key) => summarizeKey(key.public_key, key.access_key.permission));
}

export function summarizeKey(publicKey: string, permission: unknown): KeySummary {
  if (permission === "FullAccess") return { publicKey, kind: "full" };
  if (permission && typeof permission === "object" && "FunctionCall" in permission) {
    const call = (permission as { FunctionCall: { receiver_id?: string; method_names?: string[]; allowance?: string | null } }).FunctionCall;
    return {
      publicKey,
      kind: "function-call",
      receiver: call.receiver_id,
      methods: call.method_names ?? [],
      allowanceYocto: call.allowance ?? null,
    };
  }
  return { publicKey, kind: "other", detail: "Unrecognised access-key permission." };
}

export async function assertFullAccessKey(accountId: string, publicKey: string): Promise<void> {
  try {
    const view = await getProvider().viewAccessKey({ accountId, publicKey });
    if (view.permission !== "FullAccess") {
      throw new Error("That key is on the account, but it is not a full-access key.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("full-access")) throw err;
    throw new Error(`That key does not control this account on ${NETWORK_ID}.`);
  }
}

export async function fetchHistory(accountId: string): Promise<HistoryItem[]> {
  const response = await fetch(historyUrl(accountId));
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.errors?.[0]?.message ?? `History request failed (${response.status}).`;
    throw new Error(message);
  }
  return mapIndexerTransactions(payload);
}

type FeeLeg = { send_sir?: string | number; send_not_sir?: string | number; execution?: string | number };

function legGas(leg: FeeLeg | undefined, toSelf: boolean): bigint {
  if (!leg) return 0n;
  const send = toSelf ? leg.send_sir : leg.send_not_sir;
  return BigInt(send ?? 0) + BigInt(leg.execution ?? 0);
}

export async function estimateTransferFee(toSelf: boolean): Promise<bigint> {
  const fallback = 100_000_000_000_000_000_000n;
  try {
    const [config, gasResponse] = await Promise.all([
      getProvider().experimental_protocolConfig({ finality: "final" }),
      fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "gas", method: "gas_price", params: [null] }),
      }).then((response) => response.json()),
    ]);
    const costs = config.runtime_config?.transaction_costs;
    const gasUnits = legGas(costs?.action_receipt_creation_config, toSelf) + legGas(costs?.action_creation_config?.transfer_cost, toSelf);
    const gasPrice = BigInt(gasResponse?.result?.gas_price ?? 0);
    if (gasUnits === 0n || gasPrice === 0n) return fallback;
    return gasUnits * gasPrice;
  } catch {
    return fallback;
  }
}

export function isScopedKey(key: KeySummary): boolean {
  return key.kind === "function-call"
    && key.receiver === SCOPED_CONTRACT_ID
    && SCOPED_METHODS.every((method) => key.methods?.includes(method));
}
