import { explorerTxUrl } from "../config";
import { toPolicy } from "../policy";
import { parseNear } from "../units";
import { getDemoSecrets } from "./env";
import { demoStoredPolicy } from "./policy";
import { dryIntentsQuote, nearUsdPrice } from "./quote";
import {
  addSpent,
  isFridayUtc,
  loadState,
  pushLog,
  saveState,
  spentToday,
  utcDay,
  type AgentRule,
  type AgentState,
} from "./state";
import { executeDemoTransfer } from "./transfer";

export type TickResult = {
  ran: number;
  skipped: number;
  blocked: boolean;
  logs: AgentState["logs"];
  rules: AgentRule[];
  killed: boolean;
};

function due(rule: AgentRule, now: Date): boolean {
  if (!rule.enabled) return false;
  if (rule.type === "price_rule") return true;
  if (rule.type !== "schedule_send") return false;
  const lastDay = rule.lastRunAt ? rule.lastRunAt.slice(0, 10) : "";
  if (lastDay === utcDay(now)) return false;
  if (rule.cadence === "daily") return true;
  return rule.cadence === "weekly_friday" && isFridayUtc(now);
}

export async function runAgentTick(reason: string): Promise<TickResult> {
  const secrets = getDemoSecrets();
  let state = await loadState();
  if (state.killed) {
    state = await saveState(pushLog(state, {
      action: "skipped",
      reason: `Kill switch is on. The agent did not run (${reason}).`,
    }));
    return { ran: 0, skipped: 1, blocked: true, logs: state.logs, rules: state.rules, killed: true };
  }

  const now = new Date();
  const policy = toPolicy(demoStoredPolicy(secrets.recipientId, false, state.allowlist.length ? state.allowlist : [secrets.recipientId]));
  let ran = 0;
  let skipped = 0;

  for (const rule of state.rules) {
    if (!due(rule, now)) continue;
    const mark = (next: AgentState, result: string): AgentState => ({
      ...next,
      rules: next.rules.map((item) => item.id === rule.id ? { ...item, lastRunAt: now.toISOString(), lastResult: result } : item),
    });

    if (rule.type === "schedule_send") {
      const recipient = rule.recipient || secrets.recipientId;
      try {
        parseNear(rule.amountNear);
        const result = await executeDemoTransfer({
          accountId: secrets.accountId,
          secretKey: secrets.secretKey,
          expectedPublicKey: secrets.publicKey || undefined,
          recipient,
          amountNear: rule.amountNear,
          policy,
          spentTodayYocto: spentToday(state),
          userConfirmed: true,
          confirmationPhrase: policy.confirmPhrase,
          skipPhrase: true,
        });
        state = addSpent(state, parseNear(rule.amountNear));
        state = pushLog(state, {
          action: "transfer",
          ruleId: rule.id,
          reason: `Scheduled ${rule.cadence} payment of ${rule.amountNear} NEAR to ${recipient}. Trigger: ${reason}.`,
          hash: result.hash,
          explorerUrl: explorerTxUrl(result.hash),
        });
        state = mark(state, `sent ${result.hash}`);
        ran += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state = pushLog(state, {
          action: message.toLowerCase().includes("kill") || message.toLowerCase().includes("limit") || message.toLowerCase().includes("allowlist") ? "blocked" : "skipped",
          ruleId: rule.id,
          reason: `Scheduled payment was not sent: ${message}`,
        });
        state = mark(state, message.slice(0, 180));
        skipped += 1;
      }
      continue;
    }

    if (rule.type === "price_rule") {
      try {
        const price = await nearUsdPrice();
        const threshold = Number(rule.belowUsd);
        if (!(threshold > 0) || price >= threshold) {
          state = pushLog(state, {
            action: "skipped",
            ruleId: rule.id,
            reason: `Price trigger not met: NEAR is $${price.toFixed(4)}, rule fires below $${threshold}.`,
          });
          state = mark(state, `price ${price} >= ${threshold}`);
          skipped += 1;
          continue;
        }
        const quote = await dryIntentsQuote({
          accountId: secrets.accountId,
          amountNear: rule.amountNear,
          toSymbol: rule.toSymbol || "USDC",
        });
        state = pushLog(state, {
          action: "quote",
          ruleId: rule.id,
          quoteOnly: true,
          reason: `NEAR is $${price.toFixed(4)}, below $${threshold}. Quote only: ${quote.amountInFormatted} NEAR → about ${quote.amountOutFormatted} ${quote.destinationSymbol}. ${quote.label}`,
        });
        state = mark(state, `quote ${quote.amountOutFormatted} ${quote.destinationSymbol}`);
        ran += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state = pushLog(state, { action: "skipped", ruleId: rule.id, reason: `Price rule did not complete: ${message}` });
        state = mark(state, message.slice(0, 180));
        skipped += 1;
      }
    }
  }

  state = pushLog(state, {
    action: "info",
    reason: `Agent tick finished (${reason}). Ran ${ran}, skipped ${skipped}.`,
  });
  state = await saveState(state);
  return { ran, skipped, blocked: false, logs: state.logs, rules: state.rules, killed: false };
}
