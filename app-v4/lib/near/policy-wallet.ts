/**
 * Read-only view of a TriagePay policy wallet (https://github.com/KhomDev/TriagePay): a NEAR smart
 * contract that holds funds and lets an agent key pay only within limits the contract enforces
 * (per-call cap, daily cap, payee allowlist, owner review queue, pause). Vibe Wallet's own limits are
 * checked by this app before it signs; TriagePay's are checked by the chain on every `pay`, so a
 * compromised agent cannot exceed them even with its key. This module only makes view calls.
 */
import { POLICY_AGENT_ID, POLICY_WALLET_ID } from "../config";
import { formatUnits } from "../units";
import { getProvider } from "./read";

export type PolicyWalletView = {
  walletId: string;
  agentId: string;
  owner: string;
  paused: boolean;
  tokens: string[];
  agent: {
    active: boolean;
    perCallMax: string;
    dailyMax: string;
    spentToday: string;
    remainingToday: string;
    payees: string[];
  } | null;
  review: {
    approvalThreshold: string;
    reviewUnknownPayees: boolean;
    pendingCount: number;
    maxPending: number;
  } | null;
  /** Token decimals used to format the amounts (wNEAR: 24). */
  decimals: number;
};

type ConfigRaw = { owner: string; paused: boolean; tokens: string[] };
type AgentRaw = { per_call_max: string; daily_max: string; payees: string[]; active: boolean; spent_in_window: string; remaining: string };
type ReviewRaw = { approval_threshold: string; review_unknown_payees: boolean; pending_count: number; max_pending: number };

type Viewer = <T>(contractId: string, method: string, args: Record<string, unknown>) => Promise<T>;

const defaultViewer: Viewer = async <T,>(contractId: string, method: string, args: Record<string, unknown>) =>
  (await getProvider().callFunction({ contractId, method, args })) as unknown as T;

const DECIMALS: Record<string, number> = { "wrap.near": 24, "wrap.testnet": 24 };

/** Full precision, so the tiny caps used by the TriagePay demo wallets do not show as "0". */
export function formatTokenAmount(raw: string, decimals: number): string {
  try {
    return formatUnits(BigInt(raw), decimals, decimals);
  } catch {
    return raw;
  }
}

export async function readPolicyWallet(
  walletId = POLICY_WALLET_ID,
  agentId = POLICY_AGENT_ID,
  view: Viewer = defaultViewer,
): Promise<PolicyWalletView> {
  const config = await view<ConfigRaw>(walletId, "get_config", {});
  const [agent, review] = await Promise.all([
    view<AgentRaw | null>(walletId, "get_agent", { agent_id: agentId }).catch(() => null),
    view<ReviewRaw>(walletId, "get_review_policy", {}).catch(() => null),
  ]);
  const decimals = DECIMALS[config.tokens?.[0] ?? ""] ?? 24;
  return {
    walletId,
    agentId,
    owner: config.owner,
    paused: Boolean(config.paused),
    tokens: config.tokens ?? [],
    agent: agent ? {
      active: Boolean(agent.active),
      perCallMax: String(agent.per_call_max),
      dailyMax: String(agent.daily_max),
      spentToday: String(agent.spent_in_window),
      remainingToday: String(agent.remaining),
      payees: agent.payees ?? [],
    } : null,
    review: review ? {
      approvalThreshold: String(review.approval_threshold),
      reviewUnknownPayees: Boolean(review.review_unknown_payees),
      pendingCount: Number(review.pending_count ?? 0),
      maxPending: Number(review.max_pending ?? 0),
    } : null,
    decimals,
  };
}
