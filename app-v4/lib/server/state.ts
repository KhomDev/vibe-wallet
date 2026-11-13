import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type { AgentLog, AgentRule } from "../agent-types";
import type { AgentLog, AgentRule } from "../agent-types";

export type RateBucket = {
  hourKey: string;
  hourCount: number;
  dayKey: string;
  dayCount: number;
};

export type AgentState = {
  killed: boolean;
  spentDay: string;
  spentYocto: string;
  allowlist: string[];
  rules: AgentRule[];
  logs: AgentLog[];
  rates: Record<string, RateBucket>;
  updatedAt: string;
};

const EMPTY: AgentState = {
  killed: false,
  spentDay: "",
  spentYocto: "0",
  allowlist: [],
  rules: [],
  logs: [],
  rates: {},
  updatedAt: new Date(0).toISOString(),
};

function filePath(): string {
  return process.env.AGENT_STATE_PATH || "/workspace/secrets/vibe-wallet/agent-state.json";
}

function tmpPath(): string {
  return join("/tmp", "vibe-wallet-agent-state.json");
}

const BLOB_PATH = "vibe-wallet/agent-state.json";
const SOCIAL_CONTRACT = "v1.social08.testnet";
const SOCIAL_KEY = "vibewallet";

function extractSocial(raw: unknown, accountId: string): AgentState | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!record) return null;
  const account = record[accountId];
  const branch = account && typeof account === "object" ? (account as Record<string, unknown>)[SOCIAL_KEY] : null;
  const agent = branch && typeof branch === "object" ? (branch as Record<string, unknown>).agent : branch;
  const text = typeof agent === "string" ? agent : agent ? JSON.stringify(agent) : null;
  if (!text) return null;
  try { return normalize(JSON.parse(text)); } catch { return null; }
}

async function readSocial(): Promise<AgentState | null> {
  try {
    const { getDemoSecrets } = await import("./env");
    const { getProvider } = await import("../near/read");
    const secrets = getDemoSecrets();
    const raw = await getProvider().callFunction({
      contractId: SOCIAL_CONTRACT,
      method: "get",
      args: { keys: [`${secrets.accountId}/${SOCIAL_KEY}/agent`] },
    });
    return extractSocial(raw, secrets.accountId);
  } catch {
    return null;
  }
}

async function writeSocial(state: AgentState): Promise<void> {
  const { getDemoSecrets } = await import("./env");
  const { Account, actions } = await import("near-api-js");
  const { asSecret, getProvider } = await import("../near/read");
  const { parseNear } = await import("../units");
  const secrets = getDemoSecrets();
  const account = new Account(secrets.accountId, getProvider(), asSecret(secrets.secretKey));
  const data = { [secrets.accountId]: { [SOCIAL_KEY]: { agent: JSON.stringify(state) } } };
  await account.signAndSendTransaction({
    receiverId: SOCIAL_CONTRACT,
    actions: [actions.functionCall("set", { data }, 40_000_000_000_000n, parseNear("0.01"))],
    waitUntil: "EXECUTED",
  });
}


type BlobSnapshot = { state: AgentState; etag?: string };

async function readBlob(): Promise<{ snapshot: BlobSnapshot | null; missing: boolean; error?: string }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { snapshot: null, missing: true };
  try {
    const { head, BlobNotFoundError } = await import("@vercel/blob");
    try {
      const meta = await head(BLOB_PATH, { token });
      const url = `${meta.url}${meta.url.includes("?") ? "&" : "?"}cb=${Date.now()}`;
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          "cache-control": "no-cache, no-store",
          pragma: "no-cache",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return { snapshot: null, missing: false, error: `blob HTTP ${response.status}` };
      return { snapshot: { state: normalize(await response.json()), etag: meta.etag }, missing: false };
    } catch (err) {
      if (err instanceof BlobNotFoundError || (err && typeof err === "object" && "name" in err && String((err as { name: string }).name).includes("NotFound"))) {
        return { snapshot: null, missing: true };
      }
      throw err;
    }
  } catch (err) {
    return { snapshot: null, missing: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function writeBlob(state: AgentState, etag?: string): Promise<{ ok: true; etag?: string } | { ok: false; conflict?: boolean; error: string }> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { ok: false, error: "no blob token" };
  try {
    const { put } = await import("@vercel/blob");
    const blob = await put(BLOB_PATH, JSON.stringify(state), {
      access: "private",
      addRandomSuffix: false,
      token,
      cacheControlMaxAge: 0,
      ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
    });
    return { ok: true, etag: "etag" in blob ? (blob as { etag?: string }).etag : undefined };
  } catch (err) {
    const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
    const message = err instanceof Error ? err.message : String(err);
    const conflict = name.includes("Precondition") || name.includes("already") || /already exists|precondition|if-match|412|409/i.test(message);
    return { ok: false, conflict, error: message };
  }
}

function readFile(path: string): AgentState | null {
  try {
    if (!existsSync(path)) return null;
    return normalize(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

function writeFile(path: string, state: AgentState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function normalize(raw: unknown): AgentState {
  const value = raw && typeof raw === "object" ? raw as Partial<AgentState> : {};
  return {
    killed: Boolean(value.killed),
    spentDay: typeof value.spentDay === "string" ? value.spentDay : "",
    spentYocto: typeof value.spentYocto === "string" ? value.spentYocto : "0",
    allowlist: Array.isArray(value.allowlist) ? value.allowlist.filter((id) => typeof id === "string") : [],
    rules: Array.isArray(value.rules) ? value.rules as AgentRule[] : [],
    logs: Array.isArray(value.logs) ? value.logs as AgentLog[] : [],
    rates: value.rates && typeof value.rates === "object" ? value.rates as Record<string, RateBucket> : {},
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function newer(left: AgentState | null, right: AgentState | null): AgentState {
  if (!left) return right ?? { ...EMPTY };
  if (!right) return left;
  return Date.parse(left.updatedAt) >= Date.parse(right.updatedAt) ? left : right;
}

let memory: AgentState | null = null;
let memoryEtag: string | undefined;

export async function loadState(): Promise<AgentState> {
  const fromSocial = await readSocial();
  if (fromSocial) {
    memory = fromSocial;
    return structuredClone(fromSocial);
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const result = await readBlob();
    if (result.error) throw new Error(`Could not read durable agent state: ${result.error}`);
    if (result.snapshot) {
      memory = result.snapshot.state;
      memoryEtag = result.snapshot.etag;
      return structuredClone(result.snapshot.state);
    }
    memory = { ...EMPTY };
    memoryEtag = undefined;
    return structuredClone(memory);
  }
  const fromFile = readFile(filePath());
  const fromTmp = readFile(tmpPath());
  const next = newer(memory, newer(fromFile, fromTmp));
  memory = next;
  return structuredClone(next);
}

export async function saveState(state: AgentState): Promise<AgentState> {
  const next = { ...state, logs: state.logs.slice(-80), updatedAt: new Date().toISOString() };
  let socialOk = false;
  try {
    await writeSocial(next);
    memory = next;
    socialOk = true;
  } catch (err) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw err;
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const wrote = await writeBlob(next, memoryEtag);
    if (wrote.ok) {
      memory = next;
      memoryEtag = wrote.etag;
      return next;
    }
    if (socialOk) return next;
    if (wrote.conflict) {
      const latest = await readBlob();
      if (latest.snapshot) {
        memory = latest.snapshot.state;
        memoryEtag = latest.snapshot.etag;
      }
      throw new Error("concurrently updated");
    }
    throw new Error(`Could not persist agent state: ${wrote.error}`);
  }
  memory = next;
  try { writeFile(filePath(), next); } catch { /* may be read-only on serverless */ }
  try { writeFile(tmpPath(), next); } catch { /* ignore */ }
  return next;
}

export async function updateState(mutator: (state: AgentState) => AgentState | Promise<AgentState>): Promise<AgentState> {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await loadState();
    const next = await mutator(structuredClone(current));
    try {
      return await saveState(next);
    } catch (err) {
      last = err;
      if (!String(err instanceof Error ? err.message : err).includes("concurrently")) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 70));
    }
  }
  throw last instanceof Error ? last : new Error("Could not update agent state.");
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isFridayUtc(date = new Date()): boolean {
  return date.getUTCDay() === 5;
}

export function spentToday(state: AgentState): bigint {
  return state.spentDay === utcDay() ? BigInt(state.spentYocto || "0") : 0n;
}

export function addSpent(state: AgentState, amount: bigint): AgentState {
  const day = utcDay();
  const current = state.spentDay === day ? BigInt(state.spentYocto || "0") : 0n;
  return { ...state, spentDay: day, spentYocto: (current + amount).toString() };
}

export function pushLog(state: AgentState, log: Omit<AgentLog, "id" | "at"> & { id?: string; at?: string }): AgentState {
  const entry: AgentLog = {
    id: log.id || crypto.randomUUID(),
    at: log.at || new Date().toISOString(),
    ...log,
  };
  return { ...state, logs: [...state.logs, entry].slice(-80) };
}
