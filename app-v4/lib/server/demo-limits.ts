import { formatNear, parseNear } from "@/lib/units";
import { type AgentState, type RateBucket, spentToday, utcDay } from "./state";

// Limits for the shared demo account. Per-visitor limits stop one person from blocking others;
// the global cap stops the demo account from being drained by many visitors.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function demoLimits() {
  return {
    visitorPerHour: envNumber("DEMO_SENDS_PER_HOUR", 8),
    visitorPerDay: envNumber("DEMO_SENDS_PER_DAY", 20),
    networkPerHour: envNumber("DEMO_NETWORK_SENDS_PER_HOUR", 30),
    networkPerDay: envNumber("DEMO_NETWORK_SENDS_PER_DAY", 100),
    globalDailyYocto: parseNear((process.env.DEMO_GLOBAL_DAILY_NEAR || "20").trim()),
  };
}

function hourKey(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

export function visitorSpentToday(state: AgentState, key: string, now = new Date()): bigint {
  const entry = state.visitorSpend[key];
  return entry && entry.day === utcDay(now) ? BigInt(entry.yocto || "0") : 0n;
}

function counts(bucket: RateBucket | undefined, now: Date): { hour: number; day: number } {
  if (!bucket) return { hour: 0, day: 0 };
  return {
    hour: bucket.hourKey === hourKey(now) ? bucket.hourCount : 0,
    day: bucket.dayKey === utcDay(now) ? bucket.dayCount : 0,
  };
}

export type DemoGate = { ok: true } | { ok: false; reason: string; status: 403 | 429 };

/** Checks rate limits and the global cap. The per-visitor daily NEAR limit is checked by the wallet policy. */
export function checkDemoGate(state: AgentState, visitorKey: string, ipKey: string, amountYocto: bigint, now = new Date()): DemoGate {
  const limits = demoLimits();
  const globalSpent = spentToday(state, now);
  if (globalSpent + amountYocto > limits.globalDailyYocto) {
    return {
      ok: false,
      status: 403,
      reason: `The shared demo hit its ${formatNear(limits.globalDailyYocto)} NEAR safety cap for today. It resets at 00:00 UTC.`,
    };
  }
  const mine = counts(state.rates[visitorKey], now);
  if (mine.hour >= limits.visitorPerHour) return { ok: false, status: 429, reason: `Demo rate limit: at most ${limits.visitorPerHour} sends per hour per visitor.` };
  if (mine.day >= limits.visitorPerDay) return { ok: false, status: 429, reason: `Demo rate limit: at most ${limits.visitorPerDay} sends per day per visitor.` };
  if (ipKey !== visitorKey) {
    const net = counts(state.rates[ipKey], now);
    if (net.hour >= limits.networkPerHour) return { ok: false, status: 429, reason: `Demo rate limit: too many sends from this network this hour.` };
    if (net.day >= limits.networkPerDay) return { ok: false, status: 429, reason: `Demo rate limit: too many sends from this network today.` };
  }
  return { ok: true };
}

function bump(bucket: RateBucket | undefined, now: Date): RateBucket {
  const current = counts(bucket, now);
  return { hourKey: hourKey(now), hourCount: current.hour + 1, dayKey: utcDay(now), dayCount: current.day + 1 };
}

/** Records a completed demo send against the visitor, their network, and the global total. Drops entries from earlier days. */
export function recordDemoSend(state: AgentState, visitorKey: string, ipKey: string, amountYocto: bigint, now = new Date()): AgentState {
  const day = utcDay(now);
  const rates: Record<string, RateBucket> = {};
  for (const [key, bucket] of Object.entries(state.rates)) if (bucket.dayKey === day) rates[key] = bucket;
  rates[visitorKey] = bump(state.rates[visitorKey], now);
  if (ipKey !== visitorKey) rates[ipKey] = bump(state.rates[ipKey], now);
  const visitorSpend: AgentState["visitorSpend"] = {};
  for (const [key, entry] of Object.entries(state.visitorSpend)) if (entry.day === day) visitorSpend[key] = entry;
  visitorSpend[visitorKey] = { day, yocto: (visitorSpentToday(state, visitorKey, now) + amountYocto).toString() };
  const global = spentToday(state, now) + amountYocto;
  return { ...state, rates, visitorSpend, spentDay: day, spentYocto: global.toString() };
}

/** The scheduled agent gets its own daily budget on the demo account, separate from visitors. */
export const AGENT_SPEND_KEY = "agent";

export function addKeyedSpend(state: AgentState, key: string, amountYocto: bigint, now = new Date()): AgentState {
  const day = utcDay(now);
  const visitorSpend = { ...state.visitorSpend, [key]: { day, yocto: (visitorSpentToday(state, key, now) + amountYocto).toString() } };
  return { ...state, visitorSpend, spentDay: day, spentYocto: (spentToday(state, now) + amountYocto).toString() };
}
