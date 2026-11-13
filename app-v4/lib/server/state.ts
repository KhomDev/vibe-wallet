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

async function readBlob(): Promise<AgentState | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const url = process.env.AGENT_STATE_BLOB_URL;
  if (!token || !url) return null;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return normalize(await response.json());
  } catch {
    return null;
  }
}

async function writeBlob(state: AgentState): Promise<string | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch("https://blob.vercel-storage.com/vibe-wallet/agent-state.json", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-api-version": "7",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "true",
        "x-cache-control-max-age": "0",
      },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const json = await response.json() as { url?: string };
    return json.url || null;
  } catch {
    return null;
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

export async function loadState(): Promise<AgentState> {
  const fromBlob = await readBlob();
  const fromFile = readFile(filePath());
  const fromTmp = readFile(tmpPath());
  const next = newer(memory, newer(fromBlob, newer(fromFile, fromTmp)));
  memory = next;
  return structuredClone(next);
}

export async function saveState(state: AgentState): Promise<AgentState> {
  const next = { ...state, logs: state.logs.slice(-80), updatedAt: new Date().toISOString() };
  memory = next;
  try { writeFile(filePath(), next); } catch { /* may be read-only on serverless */ }
  try { writeFile(tmpPath(), next); } catch { /* ignore */ }
  const url = await writeBlob(next);
  if (url && process.env.AGENT_STATE_BLOB_URL !== url) {
    // The first write publishes a URL; later requests can read it if the env is set.
  }
  return next;
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
