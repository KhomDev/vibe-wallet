"use client";

import { useEffect, useState } from "react";
import { explorerAccountUrl } from "@/lib/config";
import { publicError } from "@/lib/errors";
import { formatTokenAmount, readPolicyWallet, type PolicyWalletView } from "@/lib/near/policy-wallet";

/**
 * Live, read-only view of the TriagePay policy wallet: limits that the NEAR chain enforces on every
 * agent payment. Vibe Wallet's own limits run in this app before it signs; these run in a contract,
 * so even a stolen agent key cannot pay outside them.
 */
export function OnChainLimitsCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [view, setView] = useState<PolicyWalletView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setView(await readPolicyWallet());
    } catch (err) {
      setError(publicError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [refreshKey]);

  const token = view?.tokens[0] ?? "wrap";
  const fmt = (raw: string) => (view ? `${formatTokenAmount(raw, view.decimals)} ${token.startsWith("wrap") ? "wNEAR" : token}` : raw);

  return (
    <section className="card grid gap-3" data-testid="onchain-limits">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Limits enforced on chain</h2>
        <button className="btn btn-ghost" type="button" disabled={loading} onClick={() => void load()}>{loading ? "Reading…" : "Refresh"}</button>
      </div>
      <p className="text-sm text-muted">
        Read live from a <a className="underline" href="https://github.com/KhomDev/TriagePay" target="_blank" rel="noreferrer">TriagePay</a> policy
        wallet contract. Vibe Wallet checks your limits before it signs; this contract checks its agent&apos;s limits on every payment, so a
        compromised agent key still cannot pay outside them.
      </p>
      {error ? <p className="banner banner-warn">Could not read the contract: {error}</p> : null}
      {view ? (
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-2"><dt>Contract</dt><dd><a className="mono underline break-all" href={explorerAccountUrl(view.walletId)} target="_blank" rel="noreferrer">{view.walletId}</a></dd></div>
          <div className="flex justify-between gap-2"><dt>Owner</dt><dd className="mono break-all">{view.owner}</dd></div>
          <div className="flex justify-between gap-2"><dt>Paused</dt><dd>{view.paused ? "yes: every payment is refused" : "no"}</dd></div>
          {view.agent ? (
            <>
              <div className="flex justify-between gap-2"><dt>Agent</dt><dd className="mono break-all">{view.agentId} · {view.agent.active ? "active" : "revoked"}</dd></div>
              <div className="flex justify-between gap-2"><dt>Per payment</dt><dd>{fmt(view.agent.perCallMax)}</dd></div>
              <div className="flex justify-between gap-2"><dt>Per UTC day</dt><dd>{fmt(view.agent.dailyMax)} · {fmt(view.agent.remainingToday)} left</dd></div>
              <div className="flex justify-between gap-2"><dt>May pay</dt><dd className="mono break-all">{view.agent.payees.join(", ") || "nobody"}</dd></div>
            </>
          ) : <p className="text-sm">No agent {view.agentId} on this contract.</p>}
          {view.review ? (
            <div className="flex justify-between gap-2"><dt>Owner review</dt><dd>above {fmt(view.review.approvalThreshold)}; {view.review.pendingCount}/{view.review.maxPending} waiting</dd></div>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}
