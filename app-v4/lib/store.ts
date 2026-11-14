import type { HistoryItem } from "./history";
import { defaultStoredPolicy, type StoredPolicy } from "./policy";
import type { CipherBlob } from "./vault";

export type AccountSlot = {
  accountId: string;
  publicKey: string;
  full: CipherBlob;
  agentPublicKey: string | null;
  agent: CipherBlob | null;
};

export type VaultRecord = {
  version: 1;
  active: AccountSlot;
  other: AccountSlot | null;
  createdAt: string;
};

const VAULT_KEY = "vibe.vault.v1";
const POLICY_KEY = "vibe.policy.v1";
const SPEND_KEY = "vibe.spend.v1";
const ACTIVITY_KEY = "vibe.activity.v1";

export type SpendEntry = { day: string; yocto: string };

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadVault(): VaultRecord | null {
  const vault = readJson<VaultRecord>(VAULT_KEY);
  if (!vault || vault.version !== 1 || !vault.active?.accountId || !vault.active.full) return null;
  return vault;
}

export function saveVault(vault: VaultRecord): void {
  writeJson(VAULT_KEY, vault);
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

export function loadPolicy(): StoredPolicy {
  const stored = readJson<StoredPolicy>(POLICY_KEY);
  if (!stored) return defaultStoredPolicy();
  return {
    ...defaultStoredPolicy(),
    ...stored,
    allowlist: Array.isArray(stored.allowlist) ? stored.allowlist : [],
  };
}

export function savePolicy(policy: StoredPolicy): void {
  writeJson(POLICY_KEY, policy);
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function loadSpend(accountId: string): bigint {
  const all = readJson<Record<string, SpendEntry>>(SPEND_KEY) ?? {};
  const entry = all[accountId];
  if (!entry || entry.day !== utcDay() || !/^\d+$/.test(entry.yocto)) return 0n;
  return BigInt(entry.yocto);
}

/** Adds (or, with a negative amount, gives back) today's spend. Never goes below zero. */
export function addSpend(accountId: string, amountYocto: bigint): bigint {
  const all = readJson<Record<string, SpendEntry>>(SPEND_KEY) ?? {};
  const current = loadSpend(accountId);
  const sum = current + amountYocto;
  const next = sum > 0n ? sum : 0n;
  all[accountId] = { day: utcDay(), yocto: next.toString() };
  writeJson(SPEND_KEY, all);
  return next;
}

// A send whose outcome the browser could not confirm. While one exists for an account, the wallet
// warns before another send, so a retry after a timeout does not pay twice without the user knowing.
const PENDING_KEY = "vibe.pending.v1";

export type PendingSend = { hash: string; recipient: string; amountYocto: string; at: number };

export function loadPendingSend(accountId: string): PendingSend | null {
  const all = readJson<Record<string, PendingSend>>(PENDING_KEY) ?? {};
  const entry = all[accountId];
  return entry && typeof entry.hash === "string" ? entry : null;
}

export function savePendingSend(accountId: string, entry: PendingSend | null): void {
  const all = readJson<Record<string, PendingSend>>(PENDING_KEY) ?? {};
  if (entry) all[accountId] = entry;
  else delete all[accountId];
  writeJson(PENDING_KEY, all);
}

export function loadActivity(accountId: string): HistoryItem[] {
  const all = readJson<Record<string, HistoryItem[]>>(ACTIVITY_KEY) ?? {};
  return Array.isArray(all[accountId]) ? all[accountId] : [];
}

export function rememberActivity(accountId: string, item: HistoryItem): HistoryItem[] {
  const all = readJson<Record<string, HistoryItem[]>>(ACTIVITY_KEY) ?? {};
  const existing = Array.isArray(all[accountId]) ? all[accountId] : [];
  const next = [item, ...existing.filter((row) => row.hash !== item.hash)].slice(0, 20);
  all[accountId] = next;
  writeJson(ACTIVITY_KEY, all);
  return next;
}
