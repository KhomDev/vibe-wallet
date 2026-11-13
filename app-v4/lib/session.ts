import { publicKeyOf } from "./near/read";
import type { AccountSlot, VaultRecord } from "./store";
import { decryptSecret, encryptSecret } from "./vault";

export type Session = {
  accountId: string;
  fullPublicKey: string;
  fullSecret: string;
  agentPublicKey: string | null;
  agentSecret: string | null;
  passphrase: string;
  mode?: "owned" | "demo";
  demoRecipient?: string;
};

export function isDemoSession(session: Session | null | undefined): boolean {
  return session?.mode === "demo";
}

export async function sessionFromSlot(slot: AccountSlot, passphrase: string): Promise<Session> {
  const fullSecret = await decryptSecret(slot.full, passphrase);
  if (publicKeyOf(fullSecret) !== slot.publicKey) {
    throw new Error("The stored key does not match this account.");
  }
  const agentSecret = slot.agent ? await decryptSecret(slot.agent, passphrase) : null;
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

export async function slotFromSession(session: Session): Promise<AccountSlot> {
  return {
    accountId: session.accountId,
    publicKey: session.fullPublicKey,
    full: await encryptSecret(session.fullSecret, session.passphrase),
    agentPublicKey: session.agentPublicKey,
    agent: session.agentSecret ? await encryptSecret(session.agentSecret, session.passphrase) : null,
  };
}
