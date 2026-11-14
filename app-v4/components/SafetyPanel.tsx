"use client";

import { useEffect, useState } from "react";
import { isValidAccountId, resolveAccountInput } from "@/lib/account-id";
import { NETWORK_ID, SCOPED_ALLOWANCE_NEAR, SCOPED_CONTRACT_ID, SCOPED_METHODS } from "@/lib/config";
import { formatNear, parseNear } from "@/lib/units";
import { normalizePhrase, phraseMatches, toPolicy, validPhrase, type StoredPolicy } from "@/lib/policy";
import { isScopedKey, type KeySummary } from "@/lib/near/read";

/** True when `next` allows anything `current` did not: higher limits, a new phrase, allowlist-only off. */
export function loosens(current: StoredPolicy, next: StoredPolicy): boolean {
  const bigger = (a: string, b: string) => {
    try {
      return parseNear(b) > parseNear(a);
    } catch {
      return true;
    }
  };
  return bigger(current.perTxNear, next.perTxNear)
    || bigger(current.dailyNear, next.dailyNear)
    || bigger(current.thresholdNear, next.thresholdNear)
    || normalizePhrase(current.confirmPhrase) !== normalizePhrase(next.confirmPhrase)
    || (current.allowlistOnly && !next.allowlistOnly);
}

export function SafetyPanel({
  policy,
  spentTodayNear,
  keys,
  accountId,
  hasAgentKey,
  hasScopedKeyOnChain,
  busy,
  onChange,
  onAllow,
  onRemoveAllow,
  onKill,
  onResume,
  onRefreshKeys,
  onScopedCall,
  onAddScopedKey,
  onForget,
  demo,
  globalKilled,
}: {
  policy: StoredPolicy;
  spentTodayNear: string;
  keys: KeySummary[];
  accountId: string;
  hasAgentKey: boolean;
  hasScopedKeyOnChain: boolean;
  busy: boolean;
  onChange: (policy: StoredPolicy) => void;
  onAllow: (accountId: string) => void;
  onRemoveAllow: (accountId: string) => void;
  onKill: () => void;
  onResume: () => void;
  onRefreshKeys: () => void;
  onScopedCall: () => void;
  onAddScopedKey: () => void;
  onForget: () => void;
  demo?: boolean;
  globalKilled?: boolean;
}) {
  const [perTx, setPerTx] = useState(policy.perTxNear);
  const [daily, setDaily] = useState(policy.dailyNear);
  const [threshold, setThreshold] = useState(policy.thresholdNear);
  const [phrase, setPhrase] = useState(policy.confirmPhrase);
  const [current, setCurrent] = useState("");
  const [allow, setAllow] = useState("");
  const [forget, setForget] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPerTx(policy.perTxNear);
    setDaily(policy.dailyNear);
    setThreshold(policy.thresholdNear);
    setPhrase(policy.confirmPhrase);
  }, [policy]);

  // Loosening a control needs the current confirm phrase, the same as the voice/text command path.
  // A stored phrase that is no longer valid (an old all-punctuation phrase) can be replaced freely.
  function authorized(next: StoredPolicy): boolean {
    if (!loosens(policy, next)) return true;
    if (!validPhrase(policy.confirmPhrase)) return true;
    return phraseMatches({ confirmPhrase: policy.confirmPhrase }, current);
  }

  function saveLimits() {
    const next = { ...policy, perTxNear: perTx.trim(), dailyNear: daily.trim(), thresholdNear: threshold.trim(), confirmPhrase: phrase.trim() };
    try {
      toPolicy(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Those limits are not valid.");
      return;
    }
    if (!authorized(next)) {
      setMessage("Raising a limit, raising the threshold, or changing the phrase needs your current confirm phrase.");
      return;
    }
    onChange(next);
    setCurrent("");
    setMessage("Limits saved on this device.");
  }

  function toggleAllowlistOnly(checked: boolean) {
    const next = { ...policy, allowlistOnly: checked };
    if (!authorized(next)) {
      setMessage("Turning allowlist-only off needs your current confirm phrase.");
      return;
    }
    onChange(next);
    setCurrent("");
  }

  function addAllow() {
    const id = resolveAccountInput(allow, NETWORK_ID);
    if (!isValidAccountId(id)) {
      setMessage("That is not a NEAR account id.");
      return;
    }
    // Opens the same confirm-phrase card as saying "allow name.testnet".
    onAllow(id);
    setAllow("");
    setMessage(null);
  }

  const matched = keys.some(isScopedKey) || hasScopedKeyOnChain;

  return (
    <aside className="grid gap-4">
      <section className="card grid gap-3">
        <h2 className="text-lg font-semibold">Safety</h2>
        <p className="text-sm text-muted">{demo
          ? "This is the shared testnet demo. The private key stays on the server, never in this browser. The allowlist, per-send and daily caps, per-network and global caps, and rate limits are enforced on the server. Your stop switch stops your sends and your agent rules."
          : "The assistant can only propose an action. Signing happens in this browser, after these checks run again. The full-access key is encrypted here."}</p>
        <p className="text-sm">Sent today: <strong>{spentTodayNear} NEAR</strong> of {policy.dailyNear} NEAR.{demo ? " Demo caps: 0.3 NEAR per send and 2 NEAR per day per visitor." : ""}</p>
        {globalKilled ? <p className="banner banner-danger">The operator has paused the whole demo. Balance, history and quotes still work.</p> : null}
        <button className="btn btn-danger" type="button" disabled={Boolean(globalKilled)} onClick={policy.killed ? onResume : onKill}>
          {policy.killed ? "Resume sending" : "Stop all sending"}
        </button>
        {demo ? null : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={policy.allowlistOnly} onChange={(event) => toggleAllowlistOnly(event.target.checked)} />
              Allowlist only
            </label>
            <label className="grid gap-1 text-sm">Per-transaction limit (NEAR)<input className="field" value={perTx} onChange={(event) => setPerTx(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Daily limit (NEAR)<input className="field" value={daily} onChange={(event) => setDaily(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">
              Extra confirm at or above (NEAR)
              <input className="field" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
              <span className="text-xs text-muted">Sends of this amount or more need the confirm phrase, even to allowlisted contacts.</span>
            </label>
            <label className="grid gap-1 text-sm">New confirm phrase<input className="field" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" /></label>
            <label className="grid gap-1 text-sm">
              Current confirm phrase (needed to loosen anything)
              <input className="field" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="off" data-testid="current-phrase" />
            </label>
            <button className="btn btn-primary" type="button" onClick={saveLimits}>Save limits</button>
          </>
        )}
        {message ? <p className="text-sm" role="status">{message}</p> : null}
      </section>
      <section className="card grid gap-3">
        <h2 className="text-lg font-semibold">Allowlist</h2>
        {policy.allowlist.length === 0 ? <p className="text-sm text-muted">No saved recipients yet. Unknown recipients need the confirm phrase.</p> : (
          <ul className="grid gap-2 text-sm">
            {policy.allowlist.map((id) => (
              <li key={id} className="flex items-center justify-between gap-2">
                <span className="mono break-all">{id}</span>
                <button className="btn btn-ghost" type="button" onClick={() => onRemoveAllow(id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input className="field mono" placeholder={NETWORK_ID === "mainnet" ? "name.near" : "name.testnet"} value={allow} onChange={(event) => setAllow(event.target.value)} autoCapitalize="none" spellCheck={false} />
          <button className="btn btn-ghost" type="button" onClick={addAllow}>Allow…</button>
        </div>
        <p className="text-xs text-muted">Adding someone opens a card that needs your confirm phrase. Removing someone does not.</p>
      </section>
      {demo ? null : (
        <section className="card grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">On-chain keys</h2>
            <button className="btn btn-ghost" type="button" onClick={onRefreshKeys}>Refresh</button>
          </div>
          <p className="text-sm text-muted">Optional scoped key: function-call on {SCOPED_CONTRACT_ID}, methods {SCOPED_METHODS.join(" and ")}, allowance {SCOPED_ALLOWANCE_NEAR} NEAR. A function-call key cannot transfer NEAR. {matched ? "Matched on-chain." : "Not added."}</p>
          {keys.length === 0 ? <p className="text-sm">No keys loaded.</p> : (
            <ul className="grid gap-3 text-sm">
              {keys.map((key) => (
                <li key={key.publicKey} className="grid gap-1">
                  <span className="mono break-all">{key.publicKey}</span>
                  {key.kind === "full" ? <span>Full access. Used only for sends you confirm. Never sent to the assistant.</span> : null}
                  {key.kind === "function-call" ? (
                    <span>Function call on {key.receiver}. Methods: {key.methods?.length ? key.methods.join(", ") : "any"}. Gas allowance {key.allowanceYocto ? `${formatNear(BigInt(key.allowanceYocto))} NEAR` : "unlimited"}.</span>
                  ) : null}
                  {key.kind === "other" ? <span>{key.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {matched ? (
            <button className="btn btn-ghost" type="button" disabled={!hasAgentKey || busy} onClick={onScopedCall}>
              {hasAgentKey ? `Call ${SCOPED_CONTRACT_ID} with the scoped key` : "Scoped key secret is not in this browser"}
            </button>
          ) : (
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={onAddScopedKey} data-testid="add-scoped-key">
              Add the scoped key (signs one AddKey transaction)
            </button>
          )}
        </section>
      )}
      {demo ? null : (
        <section className="card grid gap-3">
          <h2 className="text-lg font-semibold">Remove wallet from this browser</h2>
          <label className="grid gap-1 text-sm">
            Type {accountId}
            <input className="field mono" value={forget} onChange={(event) => setForget(event.target.value)} autoCapitalize="none" spellCheck={false} />
          </label>
          <button className="btn btn-ghost" type="button" onClick={() => forget === accountId ? onForget() : setMessage("Type the account id exactly.")}>Remove</button>
        </section>
      )}
    </aside>
  );
}
