import { formatNear, parseNear } from "@/lib/units";
import { AbortTransaction, type AgentState, type RateBucket, spentToday, utcDay } from "./state";

// Limits for the shared demo account, all enforced on the server:
// - per visitor (signed cookie, or the network key without one): the wallet policy's 2 NEAR/day,
//   plus a send rate;
// - per network (hashed client IP): a NEAR budget and a send rate shared by every visitor on it,
//   which is what bounds one actor who mints many visitor ids;
// - global: a NEAR budget (transfer amounts plus estimated fees) and an hourly send rate.
// Spend is reserved inside the same compare-and-swap write that checks it, before anything is
// signed, so concurrent requests cannot overshoot a limit.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function envNear(name: string, fallback: string): bigint {
  const raw = (process.env[name] || "").trim();
  try {
    return parseNear(raw || fallback);
  } catch {
    return parseNear(fallback);
  }
}

export function demoLimits() {
  return {
    visitorPerHour: envNumber("DEMO_SENDS_PER_HOUR", 8),
    visitorPerDay: envNumber("DEMO_SENDS_PER_DAY", 20),
    networkPerHour: envNumber("DEMO_NETWORK_SENDS_PER_HOUR", 15),
    networkPerDay: envNumber("DEMO_NETWORK_SENDS_PER_DAY", 40),
    networkDailyYocto: envNear("DEMO_NETWORK_DAILY_NEAR", "3"),
    globalPerHour: envNumber("DEMO_GLOBAL_SENDS_PER_HOUR", 120),
    globalDailyYocto: envNear("DEMO_GLOBAL_DAILY_NEAR", "20"),
    mintsPerNetworkPerDay: envNumber("DEMO_VISITOR_MINTS_PER_DAY", 20),
  };
}

export function publicLimits() {
  const limits = demoLimits();
  return {
    perTxNear: "0.3",
    visitorDailyNear: "2",
    visitorSendsPerHour: limits.visitorPerHour,
    visitorSendsPerDay: limits.visitorPerDay,
    networkDailyNear: formatNear(limits.networkDailyYocto),
    networkSendsPerHour: limits.networkPerHour,
    networkSendsPerDay: limits.networkPerDay,
    globalDailyNear: formatNear(limits.globalDailyYocto),
    globalSendsPerHour: limits.globalPerHour,
  };
}

export const GLOBAL_RATE_KEY = "global";

export function hourKey(date = new Date()): string {
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

export type SpendRequest = {
  /** Visitor key that owns the spend ("v:…", "ip:…"). */
  visitorKey: string;
  /** Network key, or null when there is none (for example a legacy rule). */
  ipKey: string | null;
  amountYocto: bigint;
  /** Estimated network fee, counted against the global budget only. */
  feeYocto: bigint;
  /** The visitor's daily NEAR limit from the wallet policy. */
  visitorDailyYocto: bigint;
};

/** Checks every server-side limit for one send against the given state. */
export function checkDemoGate(state: AgentState, request: SpendRequest, now = new Date()): DemoGate {
  const limits = demoLimits();
  const cost = request.amountYocto + request.feeYocto;
  if (spentToday(state, now) + cost > limits.globalDailyYocto) {
    return { ok: false, status: 403, reason: `The shared demo hit its ${formatNear(limits.globalDailyYocto)} NEAR safety cap for today. It resets at 00:00 UTC.` };
  }
  if (counts(state.rates[GLOBAL_RATE_KEY], now).hour >= limits.globalPerHour) {
    return { ok: false, status: 429, reason: "The shared demo is busy this hour. Try again in a few minutes." };
  }
  if (visitorSpentToday(state, request.visitorKey, now) + request.amountYocto > request.visitorDailyYocto) {
    return { ok: false, status: 403, reason: `This would pass your daily limit of ${formatNear(request.visitorDailyYocto)} NEAR.` };
  }
  const mine = counts(state.rates[request.visitorKey], now);
  if (mine.hour >= limits.visitorPerHour) return { ok: false, status: 429, reason: `Demo rate limit: at most ${limits.visitorPerHour} sends per hour per visitor.` };
  if (mine.day >= limits.visitorPerDay) return { ok: false, status: 429, reason: `Demo rate limit: at most ${limits.visitorPerDay} sends per day per visitor.` };
  if (request.ipKey && request.ipKey !== request.visitorKey) {
    const net = counts(state.rates[request.ipKey], now);
    if (net.hour >= limits.networkPerHour) return { ok: false, status: 429, reason: "Demo rate limit: too many sends from this network this hour." };
    if (net.day >= limits.networkPerDay) return { ok: false, status: 429, reason: "Demo rate limit: too many sends from this network today." };
    if (visitorSpentToday(state, request.ipKey, now) + request.amountYocto > limits.networkDailyYocto) {
      return { ok: false, status: 403, reason: `This network has used its ${formatNear(limits.networkDailyYocto)} NEAR demo budget for today. It resets at 00:00 UTC.` };
    }
  }
  return { ok: true };
}

function bump(bucket: RateBucket | undefined, now: Date, delta: 1 | -1): RateBucket {
  const current = counts(bucket, now);
  return {
    hourKey: hourKey(now),
    hourCount: Math.max(0, current.hour + delta),
    dayKey: utcDay(now),
    dayCount: Math.max(0, current.day + delta),
  };
}

function addSpend(state: AgentState, key: string, delta: bigint, now: Date): AgentState["visitorSpend"] {
  const next = visitorSpentToday(state, key, now) + delta;
  return { ...state.visitorSpend, [key]: { day: utcDay(now), yocto: (next > 0n ? next : 0n).toString() } };
}

export type Reservation = {
  visitorKey: string;
  ipKey: string | null;
  amountYocto: string;
  costYocto: string;
  day: string;
  hour: string;
  /** The visitor's spend today before this reservation. */
  spentBeforeYocto: string;
};

/**
 * Checks the gate and records the spend in one step. Throws AbortTransaction when a limit is hit,
 * which aborts the surrounding `transact` without writing.
 */
export function reserveDemoSpend(state: AgentState, request: SpendRequest, now = new Date()): { state: AgentState; reservation: Reservation } {
  const gate = checkDemoGate(state, request, now);
  if (!gate.ok) throw new AbortTransaction(gate.reason, gate.status);
  const cost = request.amountYocto + request.feeYocto;
  const spentBefore = visitorSpentToday(state, request.visitorKey, now);
  let rates = { ...state.rates };
  rates[request.visitorKey] = bump(rates[request.visitorKey], now, 1);
  rates[GLOBAL_RATE_KEY] = bump(rates[GLOBAL_RATE_KEY], now, 1);
  let next: AgentState = { ...state, rates, visitorSpend: addSpend(state, request.visitorKey, request.amountYocto, now) };
  if (request.ipKey && request.ipKey !== request.visitorKey) {
    rates = { ...next.rates, [request.ipKey]: bump(next.rates[request.ipKey], now, 1) };
    next = { ...next, rates, visitorSpend: addSpend(next, request.ipKey, request.amountYocto, now) };
  }
  next = { ...next, spentDay: utcDay(now), spentYocto: (spentToday(state, now) + cost).toString() };
  return {
    state: next,
    reservation: {
      visitorKey: request.visitorKey,
      ipKey: request.ipKey,
      amountYocto: request.amountYocto.toString(),
      costYocto: cost.toString(),
      day: utcDay(now),
      hour: hourKey(now),
      spentBeforeYocto: spentBefore.toString(),
    },
  };
}

/** Gives a reservation back after a send that certainly did not move NEAR. */
export function releaseDemoSpend(state: AgentState, reservation: Reservation, now = new Date()): AgentState {
  if (reservation.day !== utcDay(now)) return state;
  const amount = BigInt(reservation.amountYocto);
  const cost = BigInt(reservation.costYocto);
  const sameHour = reservation.hour === hourKey(now);
  const unbump = (bucket: RateBucket | undefined): RateBucket | undefined => {
    if (!bucket) return bucket;
    const current = counts(bucket, now);
    return { ...bucket, hourCount: sameHour ? Math.max(0, current.hour - 1) : current.hour, dayCount: Math.max(0, current.day - 1) };
  };
  const rates = { ...state.rates };
  for (const key of [reservation.visitorKey, GLOBAL_RATE_KEY, ...(reservation.ipKey && reservation.ipKey !== reservation.visitorKey ? [reservation.ipKey] : [])]) {
    const bucket = unbump(rates[key]);
    if (bucket) rates[key] = bucket;
  }
  let next: AgentState = { ...state, rates, visitorSpend: addSpend(state, reservation.visitorKey, -amount, now) };
  if (reservation.ipKey && reservation.ipKey !== reservation.visitorKey) {
    next = { ...next, visitorSpend: addSpend(next, reservation.ipKey, -amount, now) };
  }
  const global = spentToday(state, now) - cost;
  return { ...next, spentYocto: (global > 0n ? global : 0n).toString() };
}

/** Durable per-key action counter (agent runs, policy writes). */
export function checkAndBump(state: AgentState, key: string, perHour: number, now = new Date()): { state: AgentState; ok: boolean } {
  const current = counts(state.rates[key], now);
  if (current.hour >= perHour) return { state, ok: false };
  return { state: { ...state, rates: { ...state.rates, [key]: bump(state.rates[key], now, 1) } }, ok: true };
}
