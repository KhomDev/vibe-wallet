import { publicError } from "../errors";
import { explorerTxUrl } from "../config";
import { toPolicy } from "../policy";
import { parseNear } from "../units";
import { getDemoSecrets } from "./env";
import { AGENT_LEGACY_KEY } from "./agent-keys";
import { releaseDemoSpend, reserveDemoSpend, type Reservation } from "./demo-limits";
import { visitorPolicy } from "./policy";
import { dryIntentsQuote, nearUsdPrice } from "./quote";
import { estimateTransferFee } from "../near/read";
import {
  AbortTransaction,
  isFridayUtc,
  loadState,
  pushLog,
  transact,
  utcDay,
  type AgentRule,
  type AgentState,
} from "./state";
import { executeDemoTransfer, SendError } from "./transfer";

export type TickResult = {
  ran: number;
  skipped: number;
  blocked: boolean;
  logs: AgentState["logs"];
  rules: AgentRule[];
  killed: boolean;
};

const LEASE_MS = 120_000;

export function isDue(rule: AgentRule, now: Date): boolean {
  if (!rule.enabled) return false;
  if (rule.leaseUntil && Date.parse(rule.leaseUntil) > now.getTime()) return false;
  if (rule.type === "price_rule") return true;
  if (rule.type !== "schedule_send") return false;
  const lastDay = rule.lastRunAt ? rule.lastRunAt.slice(0, 10) : "";
  if (lastDay === utcDay(now)) return false;
  if (rule.cadence === "daily") return true;
  return rule.cadence === "weekly_friday" && isFridayUtc(now);
}

function setRule(state: AgentState, id: string, change: Partial<AgentRule>): AgentState {
  return { ...state, rules: state.rules.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)) };
}

type Claim =
  | { kind: "gone" }
  | { kind: "blocked"; reason: string }
  | { kind: "claimed"; rule: AgentRule; reservation: Reservation };

/**
 * Runs the due agent rules. With `owner` set, only that visitor's rules run (the "Run agent now"
 * button); the cron runs every visitor's rules.
 *
 * Each payment is claimed before it is sent: one compare-and-swap write marks the rule as run for
 * today, leases it, re-checks the kill switches and allowlist, and reserves the spend against the
 * owner's daily limit, the owner's network budget and the global cap. A concurrent tick reading the
 * same rule sees the claim and skips it, so a rule cannot pay twice. If the send certainly did not
 * happen, the reservation is given back.
 */
export async function runAgentTick(reason: string, owner?: string): Promise<TickResult> {
  const secrets = getDemoSecrets();
  const initial = await loadState();
  const now = new Date();
  const ownerKilled = owner ? Boolean(initial.visitors[owner]?.stopped) : false;
  if (initial.killed || ownerKilled) {
    const { state } = await transact((current) => ({
      state: pushLog(current, {
        action: "skipped",
        owner: owner ?? "system",
        reason: initial.killed ? `The global kill switch is on. The agent did not run (${reason}).` : `Sending is stopped for you. Your agent rules did not run (${reason}).`,
      }),
      result: undefined,
    }));
    return { ran: 0, skipped: 1, blocked: true, logs: state.logs, rules: ownedRules(state, owner), killed: true };
  }

  let ran = 0;
  let skipped = 0;
  const candidates = initial.rules.filter((rule) => (!owner || rule.owner === owner) && isDue(rule, now));

  for (const candidate of candidates) {
    const ruleOwner = candidate.owner ?? AGENT_LEGACY_KEY;
    if (candidate.type === "schedule_send") {
      const fee = await estimateTransferFee(false).catch(() => parseNear("0.001"));
      let claim: Claim;
      try {
        ({ result: claim } = await transact<Claim>((current) => {
          const rule = current.rules.find((item) => item.id === candidate.id);
          if (!rule || !isDue(rule, now)) return { state: current, result: { kind: "gone" } };
          const policy = toPolicy(visitorPolicy(current, secrets.recipientId, ruleOwner));
          const recipient = rule.recipient || secrets.recipientId;
          const block = (message: string) => ({
            state: pushLog(setRule(current, rule.id, { lastRunAt: now.toISOString(), lastResult: message.slice(0, 180), leaseUntil: undefined }), {
              action: "blocked" as const,
              owner: ruleOwner,
              ruleId: rule.id,
              reason: `Scheduled payment was not sent: ${message}`,
            }),
            result: { kind: "blocked" as const, reason: message },
          });
          if (policy.killed) return block("sending is stopped.");
          if (!policy.allowlist.includes(recipient)) return block("the recipient is no longer on the allowlist.");
          let amount: bigint;
          try {
            amount = parseNear(rule.amountNear);
          } catch {
            return block("the stored amount is not valid.");
          }
          if (amount > policy.perTxYocto) return block(`${rule.amountNear} NEAR is above the per-send limit.`);
          try {
            const reserved = reserveDemoSpend(current, {
              visitorKey: ruleOwner,
              ipKey: rule.ownerNet ?? null,
              amountYocto: amount,
              feeYocto: fee,
              visitorDailyYocto: policy.dailyYocto,
            }, now);
            return {
              state: setRule(reserved.state, rule.id, { lastRunAt: now.toISOString(), leaseUntil: new Date(now.getTime() + LEASE_MS).toISOString(), lastResult: "sending…" }),
              result: { kind: "claimed", rule, reservation: reserved.reservation },
            };
          } catch (err) {
            if (err instanceof AbortTransaction) return block(err.message);
            throw err;
          }
        }));
      } catch (err) {
        skipped += 1;
        await transact((current) => ({
          state: pushLog(current, { action: "skipped", owner: ruleOwner, ruleId: candidate.id, reason: `Scheduled payment was not claimed: ${publicError(err)}` }),
          result: undefined,
        })).catch(() => undefined);
        continue;
      }
      if (claim.kind === "gone") continue;
      if (claim.kind === "blocked") {
        skipped += 1;
        continue;
      }
      const { rule, reservation } = claim;
      const recipient = rule.recipient || secrets.recipientId;
      try {
        const policy = toPolicy(visitorPolicy(await loadState(), secrets.recipientId, ruleOwner));
        const result = await executeDemoTransfer({
          accountId: secrets.accountId,
          secretKey: secrets.secretKey,
          expectedPublicKey: secrets.publicKey || undefined,
          recipient,
          amountNear: rule.amountNear,
          policy,
          spentTodayYocto: BigInt(reservation.spentBeforeYocto),
          userConfirmed: true,
          confirmationPhrase: null,
          skipPhrase: true,
        });
        await transact((current) => ({
          state: pushLog(setRule(current, rule.id, { lastResult: `sent ${result.hash}`, leaseUntil: undefined }), {
            action: "transfer",
            owner: ruleOwner,
            ruleId: rule.id,
            reason: `Scheduled ${rule.cadence === "daily" ? "daily" : "Friday"} payment of ${rule.amountNear} NEAR to ${recipient}. Trigger: ${reason}.`,
            hash: result.hash,
            explorerUrl: explorerTxUrl(result.hash),
          }),
          result: undefined,
        })).catch(() => undefined);
        ran += 1;
      } catch (err) {
        const certainNoMove = !(err instanceof SendError) || !err.broadcast || err.outcome === "failed";
        const message = publicError(err);
        await transact((current) => {
          const released = certainNoMove ? releaseDemoSpend(current, reservation, now) : current;
          return {
            state: pushLog(setRule(released, rule.id, { lastResult: message.slice(0, 180), leaseUntil: undefined }), {
              action: certainNoMove ? "blocked" : "info",
              owner: ruleOwner,
              ruleId: rule.id,
              reason: certainNoMove ? `Scheduled payment was not sent: ${message}` : `Scheduled payment has an unknown outcome; its spend stays counted. ${message}`,
              hash: err instanceof SendError ? err.hash : undefined,
            }),
            result: undefined,
          };
        }).catch(() => undefined);
        skipped += 1;
      }
      continue;
    }

    if (candidate.type === "price_rule") {
      let line: { action: "quote" | "skipped"; reason: string; result: string; quoteOnly?: boolean };
      try {
        const price = await nearUsdPrice();
        const threshold = Number(candidate.belowUsd);
        if (!(threshold > 0) || price >= threshold) {
          line = { action: "skipped", reason: `Price trigger not met: NEAR is $${price.toFixed(4)}, rule fires below $${threshold}.`, result: `price ${price} >= ${threshold}` };
          skipped += 1;
        } else {
          const quote = await dryIntentsQuote({ accountId: secrets.accountId, amountNear: candidate.amountNear, toSymbol: candidate.toSymbol || "USDC" });
          line = {
            action: "quote",
            quoteOnly: true,
            reason: `NEAR is $${price.toFixed(4)}, below $${threshold}. Quote only: ${quote.amountInFormatted} NEAR → about ${quote.amountOutFormatted} ${quote.destinationSymbol}. ${quote.label}`,
            result: `quote ${quote.amountOutFormatted} ${quote.destinationSymbol}`,
          };
          ran += 1;
        }
      } catch (err) {
        line = { action: "skipped", reason: `Price rule did not complete: ${publicError(err)}`, result: publicError(err).slice(0, 180) };
        skipped += 1;
      }
      await transact((current) => ({
        state: pushLog(setRule(current, candidate.id, { lastRunAt: now.toISOString(), lastResult: line.result }), {
          action: line.action,
          owner: ruleOwner,
          ruleId: candidate.id,
          reason: line.reason,
          quoteOnly: line.quoteOnly,
        }),
        result: undefined,
      })).catch(() => undefined);
    }
  }

  const { state } = await transact((current) => ({
    state: pushLog(current, { action: "info", owner: owner ?? "system", reason: `Agent tick finished (${reason}). Ran ${ran}, skipped ${skipped}.` }),
    result: undefined,
  }));
  return { ran, skipped, blocked: false, logs: state.logs, rules: ownedRules(state, owner), killed: false };
}

export function ownedRules(state: AgentState, owner?: string): AgentRule[] {
  return owner ? state.rules.filter((rule) => rule.owner === owner) : state.rules;
}

/** Logs one visitor may see: their own, plus system entries. */
export function visibleLogs(state: AgentState, owner: string, limit = 40): AgentState["logs"] {
  return state.logs.filter((log) => log.owner === owner || log.owner === "system").slice(-limit).reverse();
}
