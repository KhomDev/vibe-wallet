"use client";

import type { AgentLog, AgentRule } from "@/lib/agent-types";

function cadenceLabel(rule: AgentRule): string {
  if (rule.type === "price_rule") {
    return `If NEAR drops below $${rule.belowUsd}, quote ${rule.amountNear} NEAR → ${rule.toSymbol || "USDC"} (quote only)`;
  }
  const when = rule.cadence === "daily" ? "every day" : "every Friday";
  return `Send ${rule.amountNear} NEAR to ${rule.recipient} ${when}`;
}

export function AgentPanel({
  rules,
  logs,
  killed,
  busy,
  onRun,
  onDelete,
}: {
  rules: AgentRule[];
  logs: AgentLog[];
  killed: boolean;
  busy: boolean;
  onRun: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="card grid gap-3" data-testid="agent-panel">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Autonomous agent</h2>
        <button className="btn btn-primary" type="button" disabled={busy || killed} onClick={onRun}>
          {busy ? "Running…" : "Run agent now"}
        </button>
      </div>
      <p className="text-sm text-muted">
        Recurring testnet payments and price-trigger quotes. A daily Vercel cron runs the same tick. The kill switch stops the agent. Price rules only fetch a dry NEAR Intents quote — swaps are not executed on testnet.
      </p>
      {killed ? <p className="banner banner-danger" role="alert">Kill switch is on. The agent will not send or quote until you resume sending.</p> : null}
      {rules.length === 0 ? <p className="text-sm text-muted">No rules yet. Try: “Send 0.15 NEAR to the demo recipient every Friday.”</p> : (
        <ul className="grid gap-2 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="grid gap-1 rounded-2xl bg-white/40 p-3">
              <span>{cadenceLabel(rule)}</span>
              {rule.lastResult ? <span className="text-xs text-muted">Last: {rule.lastResult}</span> : null}
              <button className="btn btn-ghost" type="button" onClick={() => onDelete(rule.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">Activity log</h3>
      {logs.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
        <ol className="grid gap-2 text-sm">
          {logs.slice(0, 12).map((log) => (
            <li key={log.id} className="grid gap-1">
              <span>{log.reason}</span>
              {log.explorerUrl ? <a className="underline break-all" href={log.explorerUrl} target="_blank" rel="noreferrer">View on testnet explorer</a> : null}
              {log.quoteOnly ? <span className="banner banner-warn">Quote only. No swap was executed.</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
