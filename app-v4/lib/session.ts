import { publicKeyOf } from "./near/read";
import type { AccountSlot, VaultRecord } from "./store";
import { decryptSecret, encryptSecret, isLegacyBlob, vaultContext } from "./vault";

export type Session = {
  accountId: string;
  fullPublicKey: string;
  fullSecret: string;
  agentPublicKey: string | null;
  agentSecret: string | null;
  passphrase: string;
  /** owned: key encrypted in this browser. connected: the user's own wallet signs. demo: server key. */
  mode?: "owned" | "demo" | "connected";
  demoRecipient?: string;
  /** Wallet Selector module id, for connected sessions. */
  walletId?: string;
};

export function isDemoSession(session: Session | null | undefined): boolean {
  return session?.mode === "demo";
}

export function isConnectedSession(session: Session | null | undefined): boolean {
  return session?.mode === "connected";
}

export function connectedSession(accountId: string, walletId: string): Session {
  return { accountId, walletId, mode: "connected", fullPublicKey: "", fullSecret: "", agentPublicKey: null, agentSecret: null, passphrase: "" };
}

export async function sessionFromSlot(slot: AccountSlot, passphrase: string): Promise<Session> {
  const fullSecret = await decryptSecret(slot.full, passphrase, vaultContext(slot.accountId, slot.publicKey, "full"));
  if (publicKeyOf(fullSecret) !== slot.publicKey) {
    throw new Error("The stored key does not match this account.");
  }
  const agentSecret = slot.agent && slot.agentPublicKey
    ? await decryptSecret(slot.agent, passphrase, vaultContext(slot.accountId, slot.agentPublicKey, "agent"))
    : null;
  return {
    accountId: slot.accountId,
    fullPublicKey: slot.publicKey,
    fullSecret,
    agentPublicKey: slot.agentPublicKey,
    agentSecret,
    passphrase,
  };
}

export async function sessionFromVault(vault: VaultRecord, passphrase: string): Promise<Session> {
  return sessionFromSlot(vault.active, passphrase);
}

/** True when a slot still uses the v1 vault format and should be re-encrypted. */
export function slotNeedsUpgrade(slot: AccountSlot | null | undefined): boolean {
  return Boolean(slot && (isLegacyBlob(slot.full) || (slot.agent && isLegacyBlob(slot.agent))));
}

export async function encryptSlot(input: {
  accountId: string;
  publicKey: string;
  fullSecret: string;
  agentPublicKey: string | null;
  agentSecret: string | null;
  passphrase: string;
}): Promise<AccountSlot> {
  return {
    accountId: input.accountId,
    publicKey: input.publicKey,
    full: await encryptSecret(input.fullSecret, input.passphrase, vaultContext(input.accountId, input.publicKey, "full")),
    agentPublicKey: input.agentPublicKey,
    agent: input.agentSecret && input.agentPublicKey
      ? await encryptSecret(input.agentSecret, input.passphrase, vaultContext(input.accountId, input.agentPublicKey, "agent"))
      : null,
  };
}

export async function slotFromSession(session: Session): Promise<AccountSlot> {
  return encryptSlot({
    accountId: session.accountId,
    publicKey: session.fullPublicKey,
    fullSecret: session.fullSecret,
    agentPublicKey: session.agentPublicKey,
    agentSecret: session.agentSecret,
    passphrase: session.passphrase,
  });
}
