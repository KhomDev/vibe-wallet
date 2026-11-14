import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isValidAccountId } from "../account-id";

export type { AgentLog, AgentRule } from "../agent-types";
import type { AgentLog, AgentRule } from "../agent-types";

/**
 * Durable state for the shared demo account: counters, per-visitor settings, agent rules and logs.
 *
 * Authority: one JSON document in private Vercel Blob, updated only by compare-and-swap on its ETag
 * (`transact`). Every request reads its own snapshot and writes back against that snapshot's ETag,
 * so two requests can never both commit a decision made from the same state. Without a Blob token
 * (local development) a JSON file guarded by an in-process lock plays the same role.
 *
 * NEAR Social is a public, best-effort mirror written only by the authenticated cron route. It is
 * never read back as state, so a failed mirror write cannot roll anything back.
 */

export type RateBucket = {
  hourKey: string;
  hourCount: number;
  dayKey: string;
  dayCount: number;
};

/** What a demo visitor changed for themselves. Nothing here affects any other visitor. */
export type VisitorRecord = {
  /** Extra recipients this visitor allowlisted (the demo recipient is always allowed). */
  allowlist: string[];
  /** This visitor's own stop switch: blocks their sends and their agent rules. */
  stopped: boolean;
  /** UTC day of the last change, used to prune old records. */
  seen: string;
};

export type AgentState = {
  version: number;
  /** Operator-only global kill switch. Visitors cannot change it. */
  killed: boolean;
  /** Global demo spend for `spentDay`: transfer amounts plus estimated network fees. */
  spentDay: string;
  spentYocto: string;
  /** Operator allowlist shared by every visitor. Visitors add to their own list instead. */
  allowlist: string[];
  rules: AgentRule[];
  logs: AgentLog[];
  rates: Record<string, RateBucket>;
  /** Per-visitor and per-network demo spend for today. */
  visitorSpend: Record<string, { day: string; yocto: string }>;
  visitors: Record<string, VisitorRecord>;
  /** Visitor ids minted per network per day; see `mintsPerNetworkPerDay`. */
  mints: Record<string, { day: string; count: number }>;
  /** Single-use confirmation-token nonces, mapped to their expiry (ms). */
  usedTokens: Record<string, number>;
  /** Last public projection written to NEAR Social by the cron route. */
  mirror?: { hash: string; at: string; tx?: string };
  /** Marker for one-time counter resets; see COUNTER_RESET. */
  counterReset?: string;
  updatedAt: string;
};

export const STATE_VERSION = 2;

// Bumping this value clears today's demo counters once, the next time state is loaded.
// 2026-11-13: limits moved to per-visitor. 2026-11-14: spend is reserved before signing.
export const COUNTER_RESET = "2026-11-14-reservations";

export const LIMITS = {
  logs: 120,
  visitors: 2000,
  visitorAllowlist: 8,
  visitorRetentionDays: 14,
  usedTokens: 5000,
} as const;

function emptyState(): AgentState {
  return {
    version: STATE_VERSION,
    killed: false,
    spentDay: "",
    spentYocto: "0",
    allowlist: [],
    rules: [],
    logs: [],
    rates: {},
    visitorSpend: {},
    visitors: {},
    mints: {},
    usedTokens: {},
    counterReset: COUNTER_RESET,
    updatedAt: new Date(0).toISOString(),
  };
}

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isFridayUtc(date = new Date()): boolean {
  return date.getUTCDay() === 5;
}

// ---------------------------------------------------------------------------------------------
// Validation. Stored state is re-validated on every read, so a malformed or hand-edited document
// cannot smuggle an unexpected rule, recipient or link into the agent or the UI.

const DECIMAL = /^\d{1,12}(\.\d{1,24})?$/;
const TX_HASH = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;
const EXPLORER_PREFIXES = ["https://testnet.nearblocks.io/txns/", "https://nearblocks.io/txns/"];

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length <= max ? value : undefined;
}

function parseRule(raw: unknown): AgentRule | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = str(value.id, 64);
  const createdAt = str(value.createdAt, 40);
  const amountNear = str(value.amountNear, 40);
  if (!id || !createdAt || !amountNear || !DECIMAL.test(amountNear)) return null;
  const base = {
    id,
    createdAt,
    enabled: value.enabled !== false,
    amountNear,
    owner: str(value.owner, 80),
    ownerNet: str(value.ownerNet, 80),
    lastRunAt: str(value.lastRunAt, 40),
    lastResult: str(value.lastResult, 200),
    leaseUntil: str(value.leaseUntil, 40),
  };
  if (value.type === "schedule_send") {
    const recipient = str(value.recipient, 64);
    if (!recipient || !isValidAccountId(recipient)) return null;
    const cadence = value.cadence === "daily" ? "daily" : value.cadence === "weekly_friday" ? "weekly_friday" : null;
    if (!cadence) return null;
    return { ...base, type: "schedule_send", recipient, cadence };
  }
  if (value.type === "price_rule") {
    const belowUsd = typeof value.belowUsd === "number" ? value.belowUsd : Number.NaN;
    if (!Number.isFinite(belowUsd) || belowUsd <= 0 || belowUsd > 1_000_000) return null;
    const toSymbol = value.toSymbol === "USDT" ? "USDT" : "USDC";
    return { ...base, type: "price_rule", belowUsd, toSymbol };
  }
  return null;
}

const LOG_ACTIONS = new Set(["transfer", "quote", "blocked", "skipped", "info"]);

function parseLog(raw: unknown): AgentLog | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const id = str(value.id, 64);
  const at = str(value.at, 40);
  const reason = str(value.reason, 600);
  if (!id || !at || reason === undefined || typeof value.action !== "string" || !LOG_ACTIONS.has(value.action)) return null;
  const hash = str(value.hash, 64);
  const explorerUrl = str(value.explorerUrl, 200);
  return {
    id,
    at,
    action: value.action as AgentLog["action"],
    reason,
    ruleId: str(value.ruleId, 64),
    owner: str(value.owner, 80),
    hash: hash && TX_HASH.test(hash) ? hash : undefined,
    explorerUrl: explorerUrl && EXPLORER_PREFIXES.some((prefix) => explorerUrl.startsWith(prefix)) ? explorerUrl : undefined,
    quoteOnly: value.quoteOnly === true ? true : undefined,
  };
}

function parseBucket(raw: unknown): RateBucket | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const hourKey = str(value.hourKey, 20);
  const dayKey = str(value.dayKey, 20);
  const hourCount = Number(value.hourCount);
  const dayCount = Number(value.dayCount);
  if (!hourKey || !dayKey || !Number.isInteger(hourCount) || !Number.isInteger(dayCount) || hourCount < 0 || dayCount < 0) return null;
  return { hourKey, hourCount, dayKey, dayCount };
}

function record<T>(raw: unknown, parse: (value: unknown) => T | null, maxKey = 120): Record<string, T> {
  const out: Record<string, T> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length > maxKey) continue;
    const parsed = parse(value);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

function parseSpend(raw: unknown): { day: string; yocto: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const day = str(value.day, 20);
  const yocto = str(value.yocto, 60);
  return day && yocto && /^\d+$/.test(yocto) ? { day, yocto } : null;
}

function parseVisitor(raw: unknown): VisitorRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const allowlist = Array.isArray(value.allowlist)
    ? value.allowlist.filter((id): id is string => typeof id === "string" && isValidAccountId(id)).slice(0, LIMITS.visitorAllowlist)
    : [];
  return { allowlist, stopped: value.stopped === true, seen: str(value.seen, 20) ?? "" };
}

function parseMint(raw: unknown): { day: string; count: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const day = str(value.day, 20);
  const count = Number(value.count);
  return day && Number.isInteger(count) && count >= 0 ? { day, count } : null;
}

export function normalize(raw: unknown): AgentState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const version = Number(value.version) || 1;
  let state: AgentState = {
    version,
    killed: value.killed === true,
    spentDay: str(value.spentDay, 20) ?? "",
    spentYocto: typeof value.spentYocto === "string" && /^\d+$/.test(value.spentYocto) ? value.spentYocto : "0",
    allowlist: Array.isArray(value.allowlist) ? value.allowlist.filter((id): id is string => typeof id === "string" && isValidAccountId(id)) : [],
    rules: Array.isArray(value.rules) ? value.rules.map(parseRule).filter((rule): rule is AgentRule => rule !== null) : [],
    logs: Array.isArray(value.logs) ? value.logs.map(parseLog).filter((log): log is AgentLog => log !== null).slice(-LIMITS.logs) : [],
    rates: record(value.rates, parseBucket),
    visitorSpend: record(value.visitorSpend, parseSpend),
    visitors: record(value.visitors, parseVisitor),
    mints: record(value.mints, parseMint),
    usedTokens: record(value.usedTokens, (item) => (typeof item === "number" && Number.isFinite(item) ? item : null), 80),
    mirror: value.mirror && typeof value.mirror === "object" ? {
      hash: str((value.mirror as Record<string, unknown>).hash, 80) ?? "",
      at: str((value.mirror as Record<string, unknown>).at, 40) ?? "",
      tx: str((value.mirror as Record<string, unknown>).tx, 64),
    } : undefined,
    counterReset: str(value.counterReset, 80),
    updatedAt: str(value.updatedAt, 40) ?? new Date(0).toISOString(),
  };
  if (state.version < STATE_VERSION) state = migrate(state);
  return applyCounterReset(state);
}

/**
 * v1 -> v2: rules and allowlist entries in v1 were written by unauthenticated requests and carry
 * no owner, so they cannot be attributed to anyone. They are dropped; visitors re-create their own.
 */
function migrate(state: AgentState): AgentState {
  const dropped = state.rules.filter((rule) => !rule.owner).length;
  const next: AgentState = {
    ...state,
    version: STATE_VERSION,
    allowlist: [],
    rules: state.rules.filter((rule) => Boolean(rule.owner)),
    visitors: {},
    mints: {},
    usedTokens: {},
  };
  return pushLog(next, {
    action: "info",
    owner: "system",
    reason: `State upgraded to v${STATE_VERSION}: ${dropped} unattributed agent rule(s) and the shared allowlist were cleared. Rules and allowlists are now per visitor.`,
  });
}

export function applyCounterReset(state: AgentState): AgentState {
  if (state.counterReset === COUNTER_RESET) return state;
  return { ...state, spentYocto: "0", rates: {}, visitorSpend: {}, counterReset: COUNTER_RESET };
}

/** Drops expired counters, tokens and stale visitor records so the document stays small. */
export function prune(state: AgentState, now = new Date()): AgentState {
  const day = utcDay(now);
  const rates: AgentState["rates"] = {};
  for (const [key, bucket] of Object.entries(state.rates)) if (bucket.dayKey === day) rates[key] = bucket;
  const visitorSpend: AgentState["visitorSpend"] = {};
  for (const [key, entry] of Object.entries(state.visitorSpend)) if (entry.day === day) visitorSpend[key] = entry;
  const mints: AgentState["mints"] = {};
  for (const [key, entry] of Object.entries(state.mints)) if (entry.day === day) mints[key] = entry;
  const nowMs = now.getTime();
  const tokenEntries = Object.entries(state.usedTokens).filter(([, exp]) => exp > nowMs).slice(-LIMITS.usedTokens);
  const cutoff = utcDay(new Date(nowMs - LIMITS.visitorRetentionDays * 86_400_000));
  const visitorEntries = Object.entries(state.visitors)
    .filter(([, visitor]) => visitor.seen >= cutoff)
    .sort((left, right) => (left[1].seen < right[1].seen ? 1 : -1))
    .slice(0, LIMITS.visitors);
  return {
    ...state,
    rates,
    visitorSpend,
    mints,
    usedTokens: Object.fromEntries(tokenEntries),
    visitors: Object.fromEntries(visitorEntries),
    logs: state.logs.slice(-LIMITS.logs),
  };
}

// ---------------------------------------------------------------------------------------------
// Stores.

export type Snapshot = { state: AgentState; etag?: string; exists: boolean };
export type WriteResult = { ok: true; etag?: string } | { ok: false; conflict: boolean; error: string };

export interface StateStore {
  readonly kind: "blob" | "file" | "memory";
  read(): Promise<Snapshot>;
  /** Writes `next` only if the stored document is still the one `prev` was read from. */
  write(next: AgentState, prev: Snapshot): Promise<WriteResult>;
}

const BLOB_PATH = "vibe-wallet/agent-state.json";

/**
 * The Blob `get()` response can carry a weak validator (`W/"<hash>"`, e.g. after transfer compression), but
 * `put({ ifMatch })` compares against the strong ETag (`"<hash>"`), so a weak value never matches and every
 * write fails as a conflict. Same hash, so dropping the weak prefix keeps the compare-and-swap exact.
 */
export function strongEtag(etag: string | undefined): string | undefined {
  return etag ? etag.replace(/^W\//i, "") : etag;
}

function isConflict(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: unknown }).name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return /Precondition|AlreadyExists/i.test(name) || /already exists|precondition|if-match|etag|\b412\b|\b409\b/i.test(message);
}

class BlobStore implements StateStore {
  readonly kind = "blob" as const;
  constructor(private readonly token: string) {}

  async read(): Promise<Snapshot> {
    const { get } = await import("@vercel/blob");
    // useCache:false reads origin storage; content and ETag come from the same response.
    const result = await get(BLOB_PATH, { access: "private", useCache: false, token: this.token, abortSignal: AbortSignal.timeout(8_000) });
    if (!result) return { state: emptyState(), exists: false };
    if (result.statusCode !== 200 || !result.stream) throw new Error(`Unexpected blob response ${result.statusCode}.`);
    const text = await new Response(result.stream).text();
    return { state: normalize(JSON.parse(text)), etag: strongEtag(result.blob.etag), exists: true };
  }

  async write(next: AgentState, prev: Snapshot): Promise<WriteResult> {
    if (prev.exists && !prev.etag) return { ok: false, conflict: false, error: "Refusing an unconditional overwrite: the snapshot has no ETag." };
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(BLOB_PATH, JSON.stringify(next), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
        token: this.token,
        cacheControlMaxAge: 0,
        ...(prev.exists ? { ifMatch: prev.etag } : { allowOverwrite: false }),
      });
      return { ok: true, etag: "etag" in blob ? (blob as { etag?: string }).etag : undefined };
    } catch (err) {
      return { ok: false, conflict: isConflict(err), error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** Local development store. The etag is a revision number checked against the file on disk. */
class FileStore implements StateStore {
  readonly kind = "file" as const;
  constructor(private readonly path: string) {}

  private readRaw(): { state: AgentState; rev: number } | null {
    try {
      if (!existsSync(this.path)) return null;
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { rev?: number; state?: unknown };
      if (typeof raw.rev === "number" && raw.state) return { state: normalize(raw.state), rev: raw.rev };
      return { state: normalize(raw), rev: 0 };
    } catch {
      return null;
    }
  }

  async read(): Promise<Snapshot> {
    const current = this.readRaw();
    return current ? { state: current.state, etag: String(current.rev), exists: true } : { state: emptyState(), exists: false };
  }

  async write(next: AgentState, prev: Snapshot): Promise<WriteResult> {
    const current = this.readRaw();
    const currentEtag = current ? String(current.rev) : undefined;
    if (prev.exists !== Boolean(current) || (prev.exists && prev.etag !== currentEtag)) {
      return { ok: false, conflict: true, error: "concurrently updated" };
    }
    const rev = (current?.rev ?? 0) + 1;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ rev, state: next }, null, 2), { mode: 0o600 });
      renameSync(tmp, this.path);
      return { ok: true, etag: String(rev) };
    } catch (err) {
      return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/** In-memory store with real CAS semantics, used by tests. */
export class MemoryStore implements StateStore {
  readonly kind = "memory" as const;
  private doc: { state: AgentState; rev: number } | null;
  /** Optional hook to inject latency or failures. */
  beforeWrite?: () => Promise<void> | void;
  writes = 0;
  conflicts = 0;

  constructor(initial?: AgentState) {
    this.doc = initial ? { state: structuredClone(initial), rev: 1 } : null;
  }

  async read(): Promise<Snapshot> {
    await Promise.resolve();
    return this.doc ? { state: structuredClone(this.doc.state), etag: String(this.doc.rev), exists: true } : { state: emptyState(), exists: false };
  }

  async write(next: AgentState, prev: Snapshot): Promise<WriteResult> {
    await this.beforeWrite?.();
    const currentEtag = this.doc ? String(this.doc.rev) : undefined;
    if (prev.exists !== Boolean(this.doc) || (prev.exists && prev.etag !== currentEtag)) {
      this.conflicts += 1;
      return { ok: false, conflict: true, error: "concurrently updated" };
    }
    this.doc = { state: structuredClone(next), rev: (this.doc?.rev ?? 0) + 1 };
    this.writes += 1;
    return { ok: true, etag: String(this.doc.rev) };
  }

  peek(): AgentState | null {
    return this.doc ? structuredClone(this.doc.state) : null;
  }
}

let override: StateStore | null = null;
let fileStore: FileStore | null = null;

/** Tests swap in a MemoryStore. Passing null restores the environment-selected store. */
export function setStateStore(store: StateStore | null): void {
  override = store;
}

export function getStateStore(): StateStore {
  if (override) return override;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new BlobStore(token);
  if (!fileStore) fileStore = new FileStore(process.env.AGENT_STATE_PATH || join(tmpdir(), "vibe-wallet-agent-state.json"));
  return fileStore;
}

/**
 * On Vercel each function instance has its own /tmp, so a file store would give every instance its
 * own counters. Money-moving routes refuse to run in that configuration.
 */
export function assertDurableState(): void {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN && !override) {
    throw new Error("The demo's durable state store is not configured on this deployment, so demo sends are off.");
  }
}

// ---------------------------------------------------------------------------------------------
// Transactions.

/** Thrown by a mutator to abort a transaction without writing (for example, a limit was hit). */
export class AbortTransaction extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "AbortTransaction";
  }
}

let lock: Promise<unknown> = Promise.resolve();

/** Serializes transactions inside one process; CAS handles the other processes. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => undefined);
  return run;
}

function comparable(state: AgentState): string {
  return JSON.stringify({ ...state, updatedAt: "" });
}

export async function loadSnapshot(): Promise<Snapshot> {
  return getStateStore().read();
}

export async function loadState(): Promise<AgentState> {
  return (await loadSnapshot()).state;
}

/**
 * Reads the current state, applies `fn`, and writes the result only if nobody else wrote in
 * between. On a conflict it re-reads and re-runs `fn` against the newer state, so every decision
 * `fn` makes (a limit check, a rule claim, a token use) is made against the state it commits.
 * A result identical to the input is not written at all.
 */
export async function transact<R>(
  fn: (state: AgentState) => { state: AgentState; result: R } | Promise<{ state: AgentState; result: R }>,
  options: { attempts?: number } = {},
): Promise<{ state: AgentState; result: R; wrote: boolean }> {
  const attempts = options.attempts ?? 8;
  const store = getStateStore();
  let lastError = "Could not update the demo state.";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = await withLock(async () => {
      const snapshot = await store.read();
      const current = snapshot.state;
      const { state: proposed, result } = await fn(structuredClone(current));
      const pruned = prune(proposed);
      if (snapshot.exists && comparable(pruned) === comparable(current)) {
        return { done: true as const, state: current, result, wrote: false };
      }
      const next = { ...pruned, version: STATE_VERSION, updatedAt: new Date().toISOString() };
      const wrote = await store.write(next, snapshot);
      if (wrote.ok) return { done: true as const, state: next, result, wrote: true };
      if (!wrote.conflict) throw new Error(`Could not persist the demo state: ${wrote.error}`);
      lastError = wrote.error;
      return { done: false as const };
    });
    if (outcome.done) return { state: outcome.state, result: outcome.result, wrote: outcome.wrote };
    await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 60 + Math.floor(Math.random() * 40)));
  }
  throw new Error(`The demo state is busy (${lastError}). Try again in a moment.`);
}

export async function updateState(mutator: (state: AgentState) => AgentState | Promise<AgentState>): Promise<AgentState> {
  const { state } = await transact(async (current) => ({ state: await mutator(current), result: undefined }));
  return state;
}

// ---------------------------------------------------------------------------------------------
// Helpers.

export function spentToday(state: AgentState, now = new Date()): bigint {
  return state.spentDay === utcDay(now) ? BigInt(state.spentYocto || "0") : 0n;
}

export function pushLog(state: AgentState, log: Omit<AgentLog, "id" | "at"> & { id?: string; at?: string }): AgentState {
  const entry: AgentLog = {
    ...log,
    id: log.id || crypto.randomUUID(),
    at: log.at || new Date().toISOString(),
  };
  return { ...state, logs: [...state.logs, entry].slice(-LIMITS.logs) };
}

export function visitorRecord(state: AgentState, key: string): VisitorRecord {
  return state.visitors[key] ?? { allowlist: [], stopped: false, seen: "" };
}

export function withVisitor(state: AgentState, key: string, change: (record: VisitorRecord) => VisitorRecord, now = new Date()): AgentState {
  const next = { ...change(visitorRecord(state, key)), seen: utcDay(now) };
  return { ...state, visitors: { ...state.visitors, [key]: next } };
}

// ---------------------------------------------------------------------------------------------
// NEAR Social mirror (cron only).

const SOCIAL_CONTRACT = "v1.social08.testnet";
const SOCIAL_KEY = "vibewallet";

/** The public part of the state: no visitor keys, counters or allowlists. */
export function mirrorProjection(state: AgentState) {
  return {
    version: state.version,
    killed: state.killed,
    spentDay: state.spentDay,
    spentYocto: state.spentYocto,
    rules: state.rules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      amountNear: rule.amountNear,
      recipient: rule.recipient,
      cadence: rule.cadence,
      belowUsd: rule.belowUsd,
      toSymbol: rule.toSymbol,
      lastRunAt: rule.lastRunAt,
    })),
    logs: state.logs.filter((log) => log.action === "transfer" || log.action === "quote").slice(-20).map((log) => ({
      at: log.at,
      action: log.action,
      hash: log.hash,
    })),
  };
}

/**
 * Writes the public projection to NEAR Social when it changed since the last mirror. Attaches no
 * deposit (the account's existing storage balance pays for storage). Never throws.
 */
export async function mirrorToSocial(state: AgentState): Promise<{ mirrored: boolean; reason: string; tx?: string }> {
  try {
    if (process.env.AGENT_SOCIAL_MIRROR === "off") return { mirrored: false, reason: "mirror disabled" };
    const projection = mirrorProjection(state);
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(JSON.stringify(projection)).digest("hex").slice(0, 32);
    if (state.mirror?.hash === hash) return { mirrored: false, reason: "unchanged" };
    const { getDemoSecrets, assertDemoNetwork } = await import("./env");
    await assertDemoNetwork();
    const { Account, actions } = await import("near-api-js");
    const { asSecret, getProvider } = await import("../near/read");
    const secrets = getDemoSecrets();
    const account = new Account(secrets.accountId, getProvider(), asSecret(secrets.secretKey));
    const data = { [secrets.accountId]: { [SOCIAL_KEY]: { agent: JSON.stringify(projection) } } };
    const result = await account.signAndSendTransaction({
      receiverId: SOCIAL_CONTRACT,
      actions: [actions.functionCall("set", { data }, 40_000_000_000_000n, 0n)],
      waitUntil: "EXECUTED",
    }) as unknown as { transaction?: { hash?: string } };
    const tx = result.transaction?.hash;
    await updateState((current) => ({ ...current, mirror: { hash, at: new Date().toISOString(), tx } }));
    return { mirrored: true, reason: "changed", tx };
  } catch (err) {
    return { mirrored: false, reason: err instanceof Error ? err.message.slice(0, 160) : "mirror failed" };
  }
}
