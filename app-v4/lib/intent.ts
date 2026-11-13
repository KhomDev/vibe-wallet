import { isValidAccountId, normalizeAccountId } from "./account-id";

export type WalletIntent =
  | { type: "get_balance" }
  | { type: "send"; recipient: string; amountNear: string }
  | { type: "quote_swap"; amountNear: string; toSymbol: "USDT" | "USDC" | "ETH" }
  | { type: "history" }
  | { type: "explain_last" }
  | { type: "show_safety" }
  | { type: "stop" }
  | { type: "resume" }
  | { type: "allow"; recipient: string }
  | {
      type: "set_limit";
      perTxNear?: string;
      dailyNear?: string;
      thresholdNear?: string;
    }
  | { type: "help" }
  | { type: "schedule_send"; recipient: string; amountNear: string; cadence: "weekly_friday" | "daily" }
  | { type: "price_rule"; belowUsd: number; amountNear: string; toSymbol: "USDC" | "USDT" }
  | { type: "run_agent" }
  | { type: "agent_status" }
  | { type: "unknown"; reason: string };

const AMOUNT = "([0-9]+(?:\\.[0-9]+)?)";
const ACCOUNT = "([a-z0-9][a-z0-9._-]{1,63})(?![:\\w])";

export function normalizeUtterance(input: string): string {
  return input
    .toLowerCase()
    .replace(/[?!，。]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asAccount(value: string): string | null {
  const accountId = normalizeAccountId(value);
  return isValidAccountId(accountId) ? accountId : null;
}

function asSymbol(value: string): "USDT" | "USDC" | "ETH" | null {
  const symbol = value.toUpperCase();
  if (symbol === "USDT" || symbol === "TETHER") return "USDT";
  if (symbol === "USDC") return "USDC";
  if (symbol === "ETH" || symbol === "ETHER" || symbol === "ETHEREUM") return "ETH";
  return null;
}

export function parseIntent(input: string): WalletIntent {
  const text = normalizeUtterance(input);
  if (!text) return { type: "unknown", reason: "Say what you want to do with the wallet." };

  if (/\b(stop|kill switch|freeze|halt)\b/.test(text) && !/\b(do not|don't|dont)\b/.test(text)) {
    return { type: "stop" };
  }
  if (/\b(resume|unfreeze|turn sending back on|disable the kill)\b/.test(text)) {
    return { type: "resume" };
  }
  if (/\b(help|what can you do|what can i say)\b/.test(text)) return { type: "help" };
  if (/\b(safety|limits|allowlist|kill switch status)\b/.test(text)) return { type: "show_safety" };
  if (/\b(explain|what happened|what did i|last transaction|last tx)\b/.test(text)) {
    return { type: "explain_last" };
  }
  if (/\b(history|transactions|activity|recent txs|recent transactions)\b/.test(text)) {
    return { type: "history" };
  }

  const allow = text.match(new RegExp(`\\b(?:allow|trust|whitelist)\\s+${ACCOUNT}`));
  if (allow) {
    const recipient = asAccount(allow[1]);
    if (!recipient) return { type: "unknown", reason: "That allowlist entry is not a NEAR account id." };
    return { type: "allow", recipient };
  }

  const perTx = text.match(new RegExp(`(?:per transaction|per tx|transaction limit|send limit).*?${AMOUNT}`));
  const daily = text.match(new RegExp(`daily(?:\\s+limit)?(?:\\s+to)?\\s+${AMOUNT}`));
  const threshold = text.match(new RegExp(`(?:threshold|confirm above|extra confirm).*?${AMOUNT}`));
  if (perTx || daily || threshold) {
    return {
      type: "set_limit",
      perTxNear: perTx?.[1],
      dailyNear: daily?.[1],
      thresholdNear: threshold?.[1],
    };
  }

    if (/\b(run (the )?agent|agent now|execute (the )?rules)\b/.test(text)) {
    return { type: "run_agent" };
  }
  if (/\b(agent status|agent log|show (the )?agent|what did the agent)\b/.test(text)) {
    return { type: "agent_status" };
  }

  const scheduled = text.match(new RegExp(`(?:send|transfer|pay)\\s+${AMOUNT}\\s*(?:near|n)?\\s+to\\s+${ACCOUNT}\\s+every\\s+(friday|week|weekly|day|daily)`));
  if (scheduled) {
    const recipient = asAccount(scheduled[2]);
    if (!recipient) return { type: "unknown", reason: "That recipient is not a valid NEAR account id." };
    const cadence = /friday|week/.test(scheduled[3]) ? "weekly_friday" : "daily";
    return { type: "schedule_send", amountNear: scheduled[1], recipient, cadence };
  }

  const price = text.match(new RegExp(`if\\s+near\\s+(?:drops?\\s+)?(?:below|under|falls?\\s+below)\\s+\\$?\\s*${AMOUNT}\\s*[,.]?\\s*(?:then\\s+)?(?:swap|sell|quote)\\s+${AMOUNT}\\s*(?:near|n)?\\s*(?:to|for|into)\\s+(usdc|usdt)`));
  if (price) {
    const symbol = price[3].toUpperCase() === "USDT" ? "USDT" : "USDC";
    return { type: "price_rule", belowUsd: Number(price[1]), amountNear: price[2], toSymbol: symbol };
  }

const swap = text.match(
    new RegExp(`(?:quote|swap|exchange|convert|price)\\s+(?:of\\s+)?${AMOUNT}\\s*(?:near|wnear)?\\s+(?:to|for|into)\\s+([a-z]{2,12})`),
  );
  if (swap) {
    const symbol = asSymbol(swap[2]);
    if (!symbol) {
      return { type: "unknown", reason: "I can quote NEAR to USDT, USDC, or ETH." };
    }
    return { type: "quote_swap", amountNear: swap[1], toSymbol: symbol };
  }

  const sendTo = text.match(new RegExp(`(?:send|transfer|pay)\\s+${AMOUNT}\\s*(?:near|n)?\\s+to\\s+${ACCOUNT}`));
  if (sendTo) {
    const recipient = asAccount(sendTo[2]);
    if (!recipient) return { type: "unknown", reason: "That recipient is not a valid NEAR account id." };
    return { type: "send", amountNear: sendTo[1], recipient };
  }

  if (/\b(balance|how much|what do i have|available near)\b/.test(text)) {
    return { type: "get_balance" };
  }

  return {
    type: "unknown",
    reason: "Try: What's my balance? Send 0.5 NEAR to bob.testnet. Swap 1 NEAR to USDT. Send 0.2 NEAR to bob.testnet every Friday. If NEAR drops below $2, swap 0.1 NEAR to USDC.",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return /^\d+(\.\d+)?$/.test(text) ? text : null;
}

export function sanitizeIntent(value: unknown): WalletIntent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "get_balance":
    case "history":
    case "explain_last":
    case "show_safety":
    case "stop":
    case "resume":
    case "help":
      return { type: value.type };
    case "send": {
      const amountNear = decimal(value.amountNear);
      const recipient = typeof value.recipient === "string" ? asAccount(value.recipient) : null;
      if (!amountNear || !recipient) return null;
      return { type: "send", amountNear, recipient };
    }
    case "quote_swap": {
      const amountNear = decimal(value.amountNear);
      const toSymbol = typeof value.toSymbol === "string" ? asSymbol(value.toSymbol) : null;
      if (!amountNear || !toSymbol) return null;
      return { type: "quote_swap", amountNear, toSymbol };
    }
    case "allow": {
      const recipient = typeof value.recipient === "string" ? asAccount(value.recipient) : null;
      if (!recipient) return null;
      return { type: "allow", recipient };
    }
    case "set_limit": {
      const perTxNear = value.perTxNear === undefined ? undefined : decimal(value.perTxNear);
      const dailyNear = value.dailyNear === undefined ? undefined : decimal(value.dailyNear);
      const thresholdNear = value.thresholdNear === undefined ? undefined : decimal(value.thresholdNear);
      if (value.perTxNear !== undefined && !perTxNear) return null;
      if (value.dailyNear !== undefined && !dailyNear) return null;
      if (value.thresholdNear !== undefined && !thresholdNear) return null;
      if (!perTxNear && !dailyNear && !thresholdNear) return null;
      return { type: "set_limit", perTxNear: perTxNear ?? undefined, dailyNear: dailyNear ?? undefined, thresholdNear: thresholdNear ?? undefined };
    }
    case "run_agent":
    case "agent_status":
      return { type: value.type };
    case "schedule_send": {
      const amountNear = decimal(value.amountNear);
      const recipient = typeof value.recipient === "string" ? asAccount(value.recipient) : null;
      const cadence = value.cadence === "daily" ? "daily" : value.cadence === "weekly_friday" ? "weekly_friday" : null;
      if (!amountNear || !recipient || !cadence) return null;
      return { type: "schedule_send", amountNear, recipient, cadence };
    }
    case "price_rule": {
      const amountNear = decimal(value.amountNear);
      const belowUsd = typeof value.belowUsd === "number" ? value.belowUsd : Number(value.belowUsd);
      const toSymbol = typeof value.toSymbol === "string" && value.toSymbol.toUpperCase() === "USDT" ? "USDT" : "USDC";
      if (!amountNear || !Number.isFinite(belowUsd) || belowUsd <= 0) return null;
      return { type: "price_rule", belowUsd, amountNear, toSymbol };
    }
    case "unknown":
      return { type: "unknown", reason: typeof value.reason === "string" ? value.reason.slice(0, 280) : "I did not catch a wallet action." };
    default:
      return null;
  }
}

export function acceptModelIntent(message: string, intent: WalletIntent): WalletIntent {
  const haystack = message.toLowerCase();
  if (intent.type === "send" && !haystack.includes(intent.recipient.toLowerCase())) {
    return parseIntent(message);
  }
  if (intent.type === "allow" && !haystack.includes(intent.recipient.toLowerCase())) {
    return parseIntent(message);
  }
  if (intent.type === "schedule_send" && !haystack.includes(intent.recipient.toLowerCase())) {
    return parseIntent(message);
  }
  return intent;
}

export const INTENT_SYSTEM_PROMPT = `You classify requests for Vibe Wallet, a personal NEAR testnet voice wallet.
You never ask for, see, or return private keys, seed phrases, or passphrases.
Return one JSON object and nothing else.
Allowed shapes:
{"type":"get_balance"}
{"type":"send","recipient":"<near account id>","amountNear":"<decimal>"}
{"type":"quote_swap","amountNear":"<decimal>","toSymbol":"USDT"|"USDC"|"ETH"}
{"type":"history"}
{"type":"explain_last"}
{"type":"show_safety"}
{"type":"stop"}
{"type":"resume"}
{"type":"allow","recipient":"<near account id>"}
{"type":"set_limit","perTxNear":"<decimal optional>","dailyNear":"<decimal optional>","thresholdNear":"<decimal optional>"}
{"type":"help"}
{"type":"schedule_send","recipient":"<near account id>","amountNear":"<decimal>","cadence":"weekly_friday"|"daily"}
{"type":"price_rule","belowUsd":<number>,"amountNear":"<decimal>","toSymbol":"USDC"|"USDT"}
{"type":"run_agent"}
{"type":"agent_status"}
{"type":"unknown","reason":"<short>"}
Rules:
- amountNear is decimal NEAR, never yoctoNEAR.
- Copy the recipient exactly from the user. Do not invent one.
- quote_swap is a price quote only. Never say you executed a swap.
- price_rule is a standing rule. It only produces a dry NEAR Intents quote. Never say a swap executed.
- schedule_send is a standing payment rule, not an immediate transfer.
- "every Friday" or "every week" is weekly_friday. "every day" is daily.
- stop means the user wants the kill switch on. That also stops the agent.
- If there is no wallet action, use unknown.`;
