import { NETWORK_ID, type NetworkId } from "./config";
import { assertNoSecret } from "./errors";
import { parseIntent, sanitizeIntent, type WalletIntent } from "./intent";

export type IntentSource = "near-ai" | "local-fallback";

export type ResolvedIntent = {
  intent: WalletIntent;
  source: IntentSource;
  note: string | null;
};

export async function resolveIntent(message: string, accountId: string): Promise<ResolvedIntent> {
  // A pasted key or seed phrase is stopped here, before it leaves the browser.
  assertNoSecret(message);
  const payload = { message, accountId, network: NETWORK_ID };
  try {
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json();
    const intent = sanitizeIntent(json.intent) ?? parseIntent(message);
    return {
      intent,
      source: json.source === "near-ai" ? "near-ai" : "local-fallback",
      note: typeof json.note === "string" ? json.note : null,
    };
  } catch {
    return {
      intent: parseIntent(message),
      source: "local-fallback",
      note: "The intent service was unreachable. Used the local parser in the browser.",
    };
  }
}

export type QuoteView = {
  dry: true;
  label: string;
  originSymbol: string;
  destinationSymbol: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  minAmountOutFormatted: string;
  amountInUsd: string;
  amountOutUsd: string;
  timeEstimate: number;
};

export async function requestQuote(input: { accountId: string; amountNear: string; toSymbol: string }): Promise<QuoteView> {
  assertNoSecret(JSON.stringify(input));
  const response = await fetch("/api/quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "The quote failed.");
  return json as QuoteView;
}


export type DemoLimitsView = {
  perTxNear: string;
  visitorDailyNear: string;
  visitorSendsPerHour: number;
  visitorSendsPerDay: number;
  networkDailyNear: string;
  networkSendsPerHour: number;
  networkSendsPerDay: number;
  globalDailyNear: string;
  globalSendsPerHour: number;
};

export type DemoSessionView = {
  mode: "demo";
  network: NetworkId;
  accountId: string;
  publicKey: string | null;
  recipientId: string;
  explorerUrl: string;
  recipientExplorerUrl: string;
  availableNear: string;
  policy: import("./policy").StoredPolicy;
  spentTodayNear: string;
  killed: boolean;
  globalKilled: boolean;
  stopped: boolean;
  limits: DemoLimitsView;
  note: string;
};

export async function startDemoSession(): Promise<DemoSessionView> {
  const response = await fetch("/api/demo/session", { method: "POST" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "The demo account is unavailable.");
  return json as DemoSessionView;
}

export async function previewDemoSend(input: { recipient: string; amountNear: string }) {
  const response = await fetch("/api/demo/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, preview: true }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Could not preview the demo send.");
  return json as {
    preview: true;
    recipient: string;
    amountNear: string;
    feeNear: string;
    balanceAfterNear: string;
    check: import("./policy").SendCheck;
    availableNear: string;
    confirmPhrase: string;
    /** Required by the send; bound to this visitor, recipient and amount, valid 5 minutes. */
    confirmToken: string | null;
    confirmExpiresAt: number | null;
  };
}

export async function sendDemoTransfer(input: { recipient: string; amountNear: string; phrase: string; confirmToken: string | null }) {
  const response = await fetch("/api/demo/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error || "The demo send was blocked.") as Error & { blocked?: boolean; check?: import("./policy").SendCheck; needsPreview?: boolean };
    error.blocked = Boolean(json.blocked);
    error.check = json.check;
    error.needsPreview = Boolean(json.needsPreview);
    throw error;
  }
  return json as { hash: string; feeNear: string; explorerUrl: string; recipient: string; amountNear: string; availableNear: string | null };
}

export async function updateDemoPolicy(input: { killed?: boolean; allow?: string; remove?: string; phrase?: string }) {
  const response = await fetch("/api/demo/policy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Could not update the demo policy.");
  return json as { policy: import("./policy").StoredPolicy; killed: boolean; globalKilled: boolean; stopped: boolean; spentTodayNear: string };
}

export async function fetchAgentStatus() {
  const response = await fetch("/api/agent/status", { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Could not load the agent.");
  return json as {
    killed: boolean;
    globalKilled: boolean;
    stopped: boolean;
    spentTodayNear: string;
    rules: import("./agent-types").AgentRule[];
    logs: import("./agent-types").AgentLog[];
    updatedAt: string;
  };
}

export async function addAgentRule(input: Record<string, unknown>) {
  const response = await fetch("/api/agent/rules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Could not save the agent rule.");
  return json;
}

export async function runAgentNow() {
  const response = await fetch("/api/agent/run", { method: "POST" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "The agent did not run.");
  return json as {
    ran: number;
    skipped: number;
    blocked: boolean;
    logs: import("./agent-types").AgentLog[];
    rules: import("./agent-types").AgentRule[];
    killed: boolean;
  };
}
