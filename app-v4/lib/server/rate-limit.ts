import { createHash } from "node:crypto";
import { type AgentState, utcDay, type RateBucket } from "./state";

// Defaults protect the shared demo. A local test server can raise them with
// DEMO_SENDS_PER_HOUR / DEMO_SENDS_PER_DAY (never set on production).
function limit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 16);
}

function hourKey(date = new Date()): string {
  return date.toISOString().slice(0, 13);
}

export function checkRate(state: AgentState, ip: string, salt: string): { ok: true; key: string } | { ok: false; reason: string; key: string } {
  const key = hashIp(ip, salt || "demo");
  const bucket: RateBucket = state.rates[key] ?? { hourKey: hourKey(), hourCount: 0, dayKey: utcDay(), dayCount: 0 };
  const hour = bucket.hourKey === hourKey() ? bucket.hourCount : 0;
  const day = bucket.dayKey === utcDay() ? bucket.dayCount : 0;
  const hourLimit = limit("DEMO_SENDS_PER_HOUR", 8);
  const dayLimit = limit("DEMO_SENDS_PER_DAY", 20);
  if (hour >= hourLimit) return { ok: false, key, reason: `Demo rate limit: at most ${hourLimit} sends per hour from this network.` };
  if (day >= dayLimit) return { ok: false, key, reason: `Demo rate limit: at most ${dayLimit} sends per day from this network.` };
  return { ok: true, key };
}

export function bumpRate(state: AgentState, key: string): AgentState {
  const bucket = state.rates[key] ?? { hourKey: hourKey(), hourCount: 0, dayKey: utcDay(), dayCount: 0 };
  const next: RateBucket = {
    hourKey: hourKey(),
    hourCount: bucket.hourKey === hourKey() ? bucket.hourCount + 1 : 1,
    dayKey: utcDay(),
    dayCount: bucket.dayKey === utcDay() ? bucket.dayCount + 1 : 1,
  };
  return { ...state, rates: { ...state.rates, [key]: next } };
}

export function checkRunRate(state: AgentState, ip: string, salt: string): { ok: true; key: string } | { ok: false; reason: string } {
  const key = `run:${hashIp(ip, salt || "demo")}`;
  const bucket = state.rates[key];
  if (bucket && bucket.hourKey === hourKey() && bucket.hourCount >= 6) {
    return { ok: false, reason: "The agent can be run at most 6 times an hour from this network." };
  }
  return { ok: true, key };
}
