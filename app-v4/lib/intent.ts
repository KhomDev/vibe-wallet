import { isValidAccountId, resolveAccountInput } from "./account-id";
import { NETWORK_ID } from "./config";

export type WalletIntent =
  | { type: "get_balance" }
  | { type: "send"; recipient: string; amountNear: string }
  | { type: "quote_swap"; amountNear: string; toSymbol: "USDT" | "USDC" | "ETH" }
  | { type: "history" }
  | { type: "explain_last" }
  | { type: "show_safety" }
  | { type: "show_allowlist" }
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
  | { type: "onchain_limits" }
  | { type: "unknown"; reason: string };

const AMOUNT = "([0-9]+(?:\\.[0-9]+)?)";
// An account token must end at whitespace, the end, or ASCII punctuation. Anything else right after
// it (a zero-width space, a combining mark, a non-ASCII letter) means the id was not what it looks
// like, so the match fails instead of silently truncating "bo​b.testnet" to "bo".
const ACCOUNT = "([a-z0-9][a-z0-9._-]{1,63})(?=$|[\\s,;!?)\\]\"'])";

// Invisible format characters (zero-width space/joiner, word joiner, bidi overrides) and combining
// marks have no place in a wallet command; they are how look-alike account ids are built.
const HIDDEN = /[\p{Cf}\p{Mn}\p{Me}]/u;

export function hasHiddenCharacters(input: string): boolean {
  return HIDDEN.test(input);
}

/** "don't send…", "do not pay…", "never transfer…": the user is describing what not to do. */
const NEGATED_SEND = /\b(?:don't|dont|do not|never|not|no)\b[^.!?]{0,24}\b(?:send|transfer|pay|stop)\b/;

// "Who can I send to?", "show my allowlist", "list allow list entries", "my contacts", "allowed recipients".
const ALLOWLIST_QUERY = new RegExp(
  [
    "\\bwho (?:can|may) i (?:send|pay|transfer)(?: (?:to|money|near))?\\b",
    "\\b(?:show|list|view|see|display|open|read|get|what(?:'s| is| are)(?: in)?)(?: me)?(?: (?:my|the|all))? (?:allow ?list|white ?list|allowed|contacts|trusted)",
    "\\ballow ?list(?: entries| accounts| contacts)?$",
    "^(?:my )?allow ?list\\b",
    "\\b(?:my|saved) contacts\\b",
    "^contacts$",
    "\\ballowed (?:recipients|accounts|contacts|people)\\b",
    "\\btrusted (?:recipients|accounts|contacts)\\b",
  ].join("|"),
);

/** Lowercases ASCII only: Unicode lowercasing maps look-alikes (KELVIN SIGN → "k") onto real ids. */
export function asciiLower(input: string): string {
  return input.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

export function normalizeUtterance(input: string): string {
  return asciiLower(input)
    .replace(/[‘’]/g, "'")
    .replace(/[?!，。]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asAccount(value: string): string | null {
  const accountId = resolveAccountInput(value, NETWORK_ID);
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
  if (!text) return { type: "unknown", reason: "yo, what do you wanna do?" };
  if (hasHiddenCharacters(input)) {
    return { type: "unknown", reason: "that has hidden characters in it. retype the account name." };
  }

  if (/\b(stop|kill switch|freeze|halt)\b/.test(text) && !/\b(do not|don't|dont|never|not)\b/.test(text)) {
    return { type: "stop" };
  }
  if (NEGATED_SEND.test(text)) {
    return { type: "unknown", reason: "sounds like you don't want to send, so nothing's drafted." };
  }
  if (/\b(resume|unfreeze|turn sending back on|disable the kill)\b/.test(text)) {
    return { type: "resume" };
  }
  if (/\b(help|what can you do|what can i say)\b/.test(text)) return { type: "help" };
  if (ALLOWLIST_QUERY.test(text)) return { type: "show_allowlist" };
  if (/\b(on[- ]?chain (limits?|policy|rules)|triagepay|policy wallet|contract limits?)\b/.test(text)) return { type: "onchain_limits" };
  if (/\b(safety|limits|kill switch status)\b/.test(text)) return { type: "show_safety" };
  if (/\b(explain|what happened|what did i|last transaction|last tx)\b/.test(text)) {
    return { type: "explain_last" };
  }
  if (/\b(history|transactions|activity|recent txs|recent transactions)\b/.test(text)) {
    return { type: "history" };
  }

  const allow = text.match(new RegExp(`\\b(?:allow|trust|whitelist)\\s+${ACCOUNT}`));
  if (allow && !/^(list|entries|recipients|accounts)$/.test(allow[1])) {
    const recipient = asAccount(allow[1]);
    if (!recipient) return { type: "unknown", reason: "hmm, that's not a NEAR account id." };
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
  // The same rule with the cadence first: "every Friday send 0.1 NEAR to bob".
  const leading = text.match(new RegExp(`\\bevery\\s+(friday|week|weekly|day|daily)\\s*,?\\s+(?:send|transfer|pay)\\s+${AMOUNT}\\s*(?:near|n)?\\s+to\\s+${ACCOUNT}`));
  if (scheduled || leading) {
    const [amount, account, when] = scheduled ? [scheduled[1], scheduled[2], scheduled[3]] : [leading![2], leading![3], leading![1]];
    const recipient = asAccount(account);
    if (!recipient) return { type: "unknown", reason: "hmm, that recipient isn't a valid NEAR account." };
    const cadence = /friday|week/.test(when) ? "weekly_friday" : "daily";
    return { type: "schedule_send", amountNear: amount, recipient, cadence };
  }
  // A recurring request in a shape we did not recognise must never become a one-off send now.
  if (/\b(every|each|weekly|daily|recurring)\b/.test(text) && /\b(send|transfer|pay)\b/.test(text)) {
    return { type: "unknown", reason: "sounds like a repeat payment. try \"send 0.1 NEAR to bob every Friday\"." };
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
    if (!recipient) return { type: "unknown", reason: "hmm, that recipient isn't a valid NEAR account." };
    return { type: "send", amountNear: sendTo[1], recipient };
  }

  if (/\b(balance|how much|what do i have|available near)\b/.test(text)) {
    return { type: "get_balance" };
  }

  return {
    type: "unknown",
    reason: "didn't get that, try \"what's my balance\" or \"send 0.1 to bob\".",
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
    case "show_allowlist":
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
    case "onchain_limits":
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
      return { type: "unknown", reason: typeof value.reason === "string" ? value.reason.slice(0, 280) : "didn't catch a wallet thing there." };
    default:
      return null;
  }
}

/** Account-shaped tokens in what the user said, resolved the same way as a typed recipient. */
function accountTokens(message: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of normalizeUtterance(message).split(/[\s,;!?()[\]"']+/)) {
    const token = raw.replace(/^@+/, "").replace(/[.:]+$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(token)) continue;
    tokens.add(token);
    const resolved = resolveAccountInput(token, NETWORK_ID);
    if (isValidAccountId(resolved)) tokens.add(resolved);
  }
  return tokens;
}

/** True when the recipient is a whole token of the message, not a substring of a longer id. */
export function mentionsAccount(message: string, recipient: string): boolean {
  return accountTokens(message).has(recipient);
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  half: "0.5", "a half": "0.5", "a tenth": "0.1", "one tenth": "0.1",
};

function sameDecimal(left: string, right: string): boolean {
  const norm = (value: string) => {
    const [whole, fraction = ""] = value.replace(/^0+(?=\d)/, "").split(".");
    return `${whole || "0"}.${fraction.replace(/0+$/, "")}`;
  };
  return norm(left) === norm(right);
}

/** True when the amount appears in the message as a number (or a simple number word). */
export function mentionsAmount(message: string, amountNear: string): boolean {
  const text = normalizeUtterance(message);
  const numbers = text.match(/\d+(?:\.\d+)?|\.\d+/g) ?? [];
  if (numbers.some((value) => sameDecimal(value.startsWith(".") ? `0${value}` : value, amountNear))) return true;
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text) && sameDecimal(value, amountNear)) return true;
  }
  const point = text.match(/\b(zero|one|two|three|four|five|six|seven|eight|nine)?\s*point\s+(zero|one|two|three|four|five|six|seven|eight|nine)\b/);
  if (point) {
    const value = `${NUMBER_WORDS[point[1] ?? "zero"] ?? "0"}.${NUMBER_WORDS[point[2]]}`;
    if (sameDecimal(value, amountNear)) return true;
  }
  return false;
}

/** Words the user must have said for the model's intent to be taken at face value. */
const CORROBORATE: Partial<Record<WalletIntent["type"], RegExp>> = {
  stop: /\b(stop|kill|freeze|halt|pause)\b/,
  resume: /\b(resume|unfreeze|unpause|back on|start sending|turn on)\b/,
  run_agent: /\b(agent|rules?)\b/,
  quote_swap: /\b(swap|quote|exchange|convert|price|usdc|usdt|eth)\b/,
  set_limit: /\b(limit|threshold|cap|confirm above)\b/,
  allow: /\b(allow|trust|whitelist|add)\b/,
};

/**
 * Accepts a model-produced intent only if the user's own words back it: the recipient must be a
 * whole account token they said, the amount must be a number they said, and actions such as stop
 * or a swap quote need a matching word. Otherwise the deterministic local parser decides.
 */
export function acceptModelIntent(message: string, intent: WalletIntent): WalletIntent {
  const text = normalizeUtterance(message);
  if (hasHiddenCharacters(message) || NEGATED_SEND.test(text)) return parseIntent(message);
  if ((intent.type === "send" || intent.type === "schedule_send") && (!mentionsAccount(message, intent.recipient) || !mentionsAmount(message, intent.amountNear))) {
    return parseIntent(message);
  }
  if (intent.type === "allow" && !mentionsAccount(message, intent.recipient)) return parseIntent(message);
  if (intent.type === "price_rule" && !mentionsAmount(message, intent.amountNear)) return parseIntent(message);
  const needed = CORROBORATE[intent.type];
  if (needed && !needed.test(text)) return parseIntent(message);
  return intent;
}

export const INTENT_SYSTEM_PROMPT = `You classify requests for Vibe Wallet, a personal NEAR ${NETWORK_ID} voice wallet.
You never ask for, see, or return private keys, seed phrases, or passphrases.
Return one JSON object and nothing else.
Allowed shapes:
{"type":"get_balance"}
{"type":"send","recipient":"<near account id>","amountNear":"<decimal>"}
{"type":"quote_swap","amountNear":"<decimal>","toSymbol":"USDT"|"USDC"|"ETH"}
{"type":"history"}
{"type":"explain_last"}
{"type":"show_safety"}
{"type":"show_allowlist"}
{"type":"stop"}
{"type":"resume"}
{"type":"allow","recipient":"<near account id>"}
{"type":"set_limit","perTxNear":"<decimal optional>","dailyNear":"<decimal optional>","thresholdNear":"<decimal optional>"}
{"type":"help"}
{"type":"schedule_send","recipient":"<near account id>","amountNear":"<decimal>","cadence":"weekly_friday"|"daily"}
{"type":"price_rule","belowUsd":<number>,"amountNear":"<decimal>","toSymbol":"USDC"|"USDT"}
{"type":"run_agent"}
{"type":"agent_status"}
{"type":"onchain_limits"}
{"type":"unknown","reason":"<short>"}
Rules:
- amountNear is decimal NEAR, never yoctoNEAR.
- Copy the recipient exactly from the user. Do not invent one.
- quote_swap is a price quote only. Never say you executed a swap.
- price_rule is a standing rule. It only produces a dry NEAR Intents quote. Never say a swap executed.
- schedule_send is a standing payment rule, not an immediate transfer.
- "every Friday" or "every week" is weekly_friday. "every day" is daily.
- stop means the user wants the kill switch on. That also stops the agent.
- show_allowlist lists the accounts the user may send to, with the send limits. Use it for "who can I send to", "show my allowlist", "list allow list entries", "my contacts", "allowed recipients".
- allow adds one named account. Never use allow for a request to list or show the allowlist.
- onchain_limits shows the limits a TriagePay policy-wallet contract enforces on chain ("show on-chain limits", "what does the contract allow").
- quote_swap on mainnet drafts a real swap that the user must confirm with the phrase and the slide; never say it already executed.
- If there is no wallet action, use unknown. Its reason is one short casual sentence (max 15 words), chill Gen Z tone, never formal, e.g. "yo, I only do wallet stuff, try asking your balance."`;
