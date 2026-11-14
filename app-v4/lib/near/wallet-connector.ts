/**
 * NEAR Wallet Selector: the user's own wallet (HOT, MyNearWallet, Intear) holds the key and signs.
 * Vibe Wallet never sees a private key in this mode. Before it asks the wallet to sign, the app runs
 * the same policy as for any send, so it never requests a transaction outside the user's limits;
 * the wallet then shows its own confirmation.
 *
 * Browser wallets (MyNearWallet) sign by redirecting: the page leaves, and comes back with
 * `transactionHashes` or `errorCode` in the URL. `takeWalletRedirect()` reads and clears them.
 */
import type { NetworkId as SelectorNetworkId, Wallet, WalletSelector } from "@near-wallet-selector/core";
import { NETWORK_ID, RPC_URL, explorerAccountUrl } from "../config";

export type WalletOption = { id: string; name: string; iconUrl: string; type: string; description: string };

/** JSON actions in the format every Wallet Selector wallet accepts. */
export type WalletAction =
  | { type: "Transfer"; params: { deposit: string } }
  | { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } };

export type WalletTx = { receiverId: string; actions: WalletAction[] };

export type WalletOutcome = { hashes: string[]; redirected: false } | { hashes: []; redirected: true };

/** The loosely typed surface we call; every selector wallet implements it (as methods). */
type AnyWallet = {
  signIn(params: Record<string, unknown>): Promise<{ accountId: string }[] | void>;
  signAndSendTransaction(params: Record<string, unknown>): Promise<unknown>;
  signAndSendTransactions(params: Record<string, unknown>): Promise<unknown[] | void>;
};

/** Network config for the selector. Uses FastNEAR: the near.org RPC endpoints are deprecated. */
export function selectorNetwork() {
  return {
    networkId: NETWORK_ID as SelectorNetworkId,
    nodeUrl: RPC_URL,
    helperUrl: NETWORK_ID === "mainnet" ? "https://helper.mainnet.near.org" : "https://helper.testnet.near.org",
    explorerUrl: explorerAccountUrl("").replace(/\/address\/$/, ""),
    indexerUrl: NETWORK_ID === "mainnet" ? "https://api.kitwallet.app" : "https://testnet-api.kitwallet.app",
  };
}

let selector: Promise<WalletSelector> | null = null;

export function getSelector(): Promise<WalletSelector> {
  if (typeof window === "undefined") return Promise.reject(new Error("Wallets are available in the browser only."));
  if (!selector) {
    selector = (async () => {
      const [{ setupWalletSelector }, { setupHotWallet }, { setupMyNearWallet }, { setupIntearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/intear-wallet"),
      ]);
      return setupWalletSelector({
        network: selectorNetwork(),
        modules: [setupHotWallet(), setupMyNearWallet(), setupIntearWallet()],
      });
    })().catch((err) => {
      selector = null;
      throw err;
    });
  }
  return selector;
}

export async function listWallets(): Promise<WalletOption[]> {
  const current = await getSelector();
  return current.store.getState().modules.map((module) => ({
    id: module.id,
    name: module.metadata.name,
    iconUrl: module.metadata.iconUrl,
    type: module.type,
    description: module.metadata.description ?? "",
  }));
}

/** The account the selector already holds (after a redirect sign-in, or from a previous visit). */
export async function connectedAccount(): Promise<{ accountId: string; walletId: string } | null> {
  const current = await getSelector();
  const state = current.store.getState();
  const account = state.accounts.find((item) => item.active) ?? state.accounts[0];
  if (!account || !state.selectedWalletId) return null;
  return { accountId: account.accountId, walletId: state.selectedWalletId };
}

/** Starts sign-in. Resolves with the account, or null when the wallet redirected the page away. */
export async function connectWallet(walletId: string): Promise<string | null> {
  const current = await getSelector();
  const wallet = await current.wallet(walletId);
  // No contractId: no function-call key is requested; the wallet only shares the account id.
  const accounts = await (wallet as unknown as AnyWallet).signIn({});
  if (!accounts || !accounts.length) return null;
  return accounts[0].accountId;
}

export async function disconnectWallet(): Promise<void> {
  const current = await getSelector();
  if (!current.store.getState().selectedWalletId) return;
  const wallet: Wallet = await current.wallet();
  await wallet.signOut().catch(() => undefined);
}

function hashOf(outcome: unknown): string | null {
  const value = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | null;
  return value?.transaction?.hash || value?.transaction_outcome?.id || null;
}

function failureOf(outcome: unknown): string | null {
  const status = (outcome as { status?: unknown } | null)?.status;
  return status && typeof status === "object" && "Failure" in status ? JSON.stringify(status).slice(0, 240) : null;
}

/** Asks the connected wallet to sign and send. The wallet shows its own confirmation screen. */
export async function walletSend(signerId: string, transactions: WalletTx[]): Promise<WalletOutcome> {
  const current = await getSelector();
  const wallet = await current.wallet();
  const callbackUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] + "?app=1" : undefined;
  if (transactions.length === 1) {
    const outcome = await (wallet as unknown as AnyWallet).signAndSendTransaction({
      signerId,
      receiverId: transactions[0].receiverId,
      actions: transactions[0].actions,
      callbackUrl,
    });
    if (!outcome) return { hashes: [], redirected: true };
    const failed = failureOf(outcome);
    if (failed) throw new Error(`The transaction was rejected: ${failed}`);
    const hash = hashOf(outcome);
    return { hashes: hash ? [hash] : [], redirected: false };
  }
  const outcomes = await (wallet as unknown as AnyWallet).signAndSendTransactions({
    transactions: transactions.map((tx) => ({ signerId, receiverId: tx.receiverId, actions: tx.actions })),
    callbackUrl,
  });
  if (!outcomes) return { hashes: [], redirected: true };
  for (const outcome of outcomes) {
    const failed = failureOf(outcome);
    if (failed) throw new Error(`A transaction was rejected: ${failed}`);
  }
  return { hashes: outcomes.map(hashOf).filter((hash): hash is string => Boolean(hash)), redirected: false };
}

/** Reads and removes a browser wallet's redirect result from the URL. */
export function takeWalletRedirect(): { hashes: string[]; error: string | null } | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const hashes = (url.searchParams.get("transactionHashes") || "").split(",").map((item) => item.trim()).filter(Boolean);
  const error = url.searchParams.get("errorCode") || url.searchParams.get("errorMessage");
  if (!hashes.length && !error) return null;
  // Sign-in parameters (account_id, all_keys) are left for the wallet module, which reads them itself.
  for (const key of ["transactionHashes", "errorCode", "errorMessage"]) url.searchParams.delete(key);
  window.history.replaceState(null, "", url.toString());
  return { hashes, error: error ? decodeURIComponent(error) : null };
}
