import type { StoredPolicy } from "../policy";
import { type AgentState, visitorRecord } from "./state";

/**
 * Shared demo policy. Allowlisted sends below `thresholdNear` need only the slide; at or above it
 * they also need the confirm phrase. The phrase is public on purpose (the demo has no secrets); the
 * server-side control for the demo is the confirmation token bound to visitor, recipient and amount.
 */
export const DEMO_POLICY_DEFAULTS: Omit<StoredPolicy, "allowlist" | "killed"> = {
  perTxNear: "0.3",
  dailyNear: "2",
  thresholdNear: "0.2",
  confirmPhrase: "confirm send",
  allowlistOnly: true,
};

export function demoStoredPolicy(recipientId: string, killed: boolean, allowlist: string[]): StoredPolicy {
  const allowed = [recipientId, ...allowlist.filter((id) => id !== recipientId)];
  return {
    ...DEMO_POLICY_DEFAULTS,
    allowlist: [...new Set(allowed)],
    killed,
  };
}

/** The policy one visitor sees: operator list + their own entries; stopped if either switch is on. */
export function visitorPolicy(state: AgentState, recipientId: string, visitorKey: string): StoredPolicy & { globalKilled: boolean; stopped: boolean } {
  const visitor = visitorRecord(state, visitorKey);
  const policy = demoStoredPolicy(recipientId, state.killed || visitor.stopped, [...state.allowlist, ...visitor.allowlist]);
  return { ...policy, globalKilled: state.killed, stopped: visitor.stopped };
}
