"use client";

import { useEffect, useState } from "react";
import { isValidAccountId, normalizeAccountId } from "@/lib/account-id";
import { SCOPED_ALLOWANCE_NEAR, SCOPED_CONTRACT_ID, SCOPED_METHODS } from "@/lib/config";
import { formatNear } from "@/lib/units";
import { toPolicy, type StoredPolicy } from "@/lib/policy";
import { isScopedKey, type KeySummary } from "@/lib/near/read";

export function SafetyPanel({
  policy,
  spentTodayNear,
  keys,
  accountId,
  hasAgentKey,
  busy,
  onChange,
  onKill,
  onResume,
  onRefreshKeys,
  onScopedCall,
  onForget,
  demo,
}: {
  policy: StoredPolicy;
  spentTodayNear: string;
  keys: KeySummary[];
  accountId: string;
  hasAgentKey: boolean;
  busy: boolean;
  onChange: (policy: StoredPolicy) => void;
  onKill: () => void;
  onResume: () => void;
  onRefreshKeys: () => void;
  onScopedCall: () => void;
  onForget: () => void;
  demo?: boolean;
}) {
  const [perTx, setPerTx] = useState(policy.perTxNear);
  const [daily, setDaily] = useState(policy.dailyNear);
  const [threshold, setThreshold] = useState(policy.thresholdNear);
  const [phrase, setPhrase] = useState(policy.confirmPhrase);
  const [allow, setAllow] = useState("");
  const [forget, setForget] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPerTx(policy.perTxNear);
    setDaily(policy.dailyNear);
    setThreshold(policy.thresholdNear);
    setPhrase(policy.confirmPhrase);
  }, [policy]);

  function saveLimits() {
    const next = { ...policy, perTxNear: perTx.trim(), dailyNear: daily.trim(), thresholdNear: threshold.trim(), confirmPhrase: phrase.trim() };
    try {
      toPolicy(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Those limits are not valid.");
      return;
    }
    onChange(next);
    setMessage("Limits saved on this device.");
  }

  function addAllow() {
    const id = normalizeAccountId(allow);
    if (!isValidAccountId(id)) {
      setMessage("That is not a NEAR account id.");
      return;
    }
    if (!policy.allowlist.includes(id)) onChange({ ...policy, allowlist: [...policy.allowlist, id] });
    setAllow("");
    setMessage(null);
  }

  const matched = keys.some(isScopedKey);

  return (
    <aside className="grid gap-4">
      <section className="card grid gap-3">
        <h2 className="text-lg font-semibold">Safety</h2>
        <p className="text-sm text-muted">{demo ? "This is the shared testnet demo. The private key stays on the server, never in this browser. Caps, the allowlist, and rate limits are enforced server-side. The kill switch also stops the agent." : "The assistant can only propose an action. Signing happens here, after these checks. The full-access key is encrypted in this browser."}</p>
        <p className="text-sm">Sent today: <strong>{spentTodayNear} NEAR</strong> of {policy.dailyNear} NEAR.{demo ? " Demo caps are 0.3 NEAR per send and 2 NEAR per day." : ""}</p>
        <button className="btn btn-danger" type="button" onClick={policy.killed ? onResume : onKill}>
          {policy.killed ? "Resume sending" : "Stop all sending"}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={policy.allowlistOnly} onChange={(event) => onChange({ ...policy, allowlistOnly: event.target.checked })} />
          Allowlist only
        </label>
        <label className="grid gap-1 text-sm">Per-transaction limit (NEAR)<input className="field" value={perTx} onChange={(event) => setPerTx(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Daily limit (NEAR)<input className="field" value={daily} onChange={(event) => setDaily(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Extra confirm at or above (NEAR)<input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Confirm phrase<input className="field" value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label>
        <button className="btn btn-primary" type="button" onClick={saveLimits}>Save limits</button>
        {message ? <p className="text-sm">{message}</p> : null}
      </section>
      <section className="card grid gap-3">
        <h2 className="text-lg font-semibold">Allowlist</h2>
        {policy.allowlist.length === 0 ? <p className="text-sm text-muted">No saved recipients yet. Unknown recipients need the confirm phrase.</p> : (
          <ul className="grid gap-2 text-sm">
            {policy.allowlist.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="mono break-all">{id}</span>
                <button className="btn btn-ghost" type="button" onClick={() => onChange({ ...policy, allowlist: policy.allowlist.filter((item) => item !== id) })}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input className="field mono" placeholder="name.testnet" value={allow} onChange={(event) => setAllow(event.target.value)} autoCapitalize="none" spellCheck={false} />
          <button className="btn btn-ghost" type="button" onClick={addAllow}>Allow</button>
        </div>
      </section>
      <section className="card grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">On-chain keys</h2>
          <button className="btn btn-ghost" type="button" onClick={onRefreshKeys}>Refresh</button>
        </div>
        <p className="text-sm text-muted">Expected scoped key: function-call on {SCOPED_CONTRACT_ID}, methods {SCOPED_METHODS.join(" and ")}, allowance {SCOPED_ALLOWANCE_NEAR} NEAR. {matched ? "Matched on-chain." : "Not seen on-chain yet."}</p>
        {keys.length === 0 ? <p className="text-sm">No keys loaded.</p> : (
          <ul className="grid gap-3 text-sm">
            {keys.map((key) => (
              <li key={key.publicKey} className="grid gap-1">
                <span className="mono break-all">{key.publicKey}</span>
                {key.kind === "full" ? <span>Full access. Used only for confirmed native sends. Never sent to the assistant.</span> : null}
                {key.kind === "function-call" ? (
                  <span>Function call on {key.receiver}. Methods: {key.methods?.length ? key.methods.join(", ") : "any"}. Gas allowance {key.allowanceYocto ? `${formatNear(BigInt(key.allowanceYocto))} NEAR` : "unlimited"}.</span>
                ) : null}
                {key.kind === "other" ? <span>{key.detail}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <button className="btn btn-ghost" type="button" disabled={!hasAgentKey || busy} onClick={onScopedCall}>
          {hasAgentKey ? "Call wrap.testnet with the scoped key" : "Scoped key secret is not in this browser"}
        </button>
      </section>
      <section className="card grid gap-3">
        <h2 className="text-lg font-semibold">Remove wallet from this browser</h2>
        <label className="grid gap-1 text-sm">
          Type {accountId}
          <input className="field mono" value={forget} onChange={(event) => setForget(event.target.value)} autoCapitalize="none" spellCheck={false} />
        </label>
        <button className="btn btn-ghost" type="button" onClick={() => forget === accountId ? onForget() : setMessage("Type the account id exactly.")}>Remove</button>
      </section>
    </aside>
  );
}
