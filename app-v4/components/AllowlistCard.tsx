"use client";

import { allowlistView } from "@/lib/allowlist";
import type { StoredPolicy } from "@/lib/policy";

export function AllowlistCard({ policy, onPick, onClose }: {
  policy: StoredPolicy;
  onPick: (account: string) => void;
  onClose: () => void;
}) {
  const view = allowlistView(policy);
  return (
    <section className="glass mt-3 grid gap-3" data-testid="allowlist-card" aria-label="Who you can send to">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Who you can send to</h2>
        <span className="text-xs text-muted">{view.allowlistOnly ? "Allowlist only" : "Allowlist optional"}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-2xl bg-white/50 p-2"><strong className="block">{view.perTxNear}</strong><span className="text-xs text-muted">NEAR per send</span></div>
        <div className="rounded-2xl bg-white/50 p-2"><strong className="block">{view.dailyNear}</strong><span className="text-xs text-muted">NEAR per day</span></div>
        <div className="rounded-2xl bg-white/50 p-2"><strong className="block">{view.thresholdNear}</strong><span className="text-xs text-muted">extra confirm at</span></div>
      </div>
      {view.killed ? <p className="banner banner-danger">Sending is stopped by the kill switch. Resume sending first.</p> : null}
      {view.entries.length ? (
        <ul className="grid gap-2">
          {view.entries.map((entry) => (
            <li key={entry.accountId} className="flex items-center justify-between gap-3 rounded-2xl bg-white/50 p-3">
              <div className="min-w-0">
                <span className="mono block text-sm" title={entry.accountId}>{entry.display}</span>
                <span className="text-xs text-muted">Up to {entry.perSendNear} NEAR per send</span>
              </div>
              <button className="btn btn-primary shrink-0" type="button" onClick={() => onPick(entry.accountId)} aria-label={`Send 0.1 NEAR to ${entry.accountId}`}>
                Send 0.1
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="banner banner-warn">{view.emptyHelp}</p>
      )}
      <button className="btn btn-ghost" type="button" onClick={onClose}>Close</button>
    </section>
  );
}
