"use client";

import { useEffect, useState, type ReactNode } from "react";
import { explorerTxUrl } from "@/lib/config";
import type { HistoryItem } from "@/lib/history";
import { getProvider } from "@/lib/near/read";
import type { KeySummary } from "@/lib/near/read";
import type { StoredPolicy } from "@/lib/policy";
import { haptic, pop } from "@/lib/sounds";
import { formatUnits } from "@/lib/units";
import type { QuoteView } from "@/lib/client";
import { CountUp } from "./CountUp";
import { SafetyPanel } from "./SafetyPanel";

const TOKENS = [
  { symbol: "USDC", subtitle: "USD Coin", contract: "usdc.fakes.testnet", decimals: 6, mark: "usdc" },
  { symbol: "ETH", subtitle: "Ether", contract: "eth.fakes.testnet", decimals: 18, mark: "eth" },
] as const;

export function WalletTab({
  accountId,
  availableNear,
  nearPrice,
  hidden,
  onToggleHidden,
  history,
  quote,
  onSend,
  onReceive,
  onSwap,
  policy,
  spentTodayNear,
  keys,
  hasAgentKey,
  busy,
  onPolicy,
  onAllow,
  onRemoveAllow,
  onKill,
  onResume,
  onRefreshKeys,
  onScopedCall,
  onAddScopedKey,
  hasScopedKeyOnChain,
  onForget,
  onLock,
  otherAccount,
  onCreateRecipient,
  onSwitch,
  demo,
  globalKilled,
  agentSlot,
}: {
  accountId: string;
  availableNear: number;
  nearPrice: number | null;
  hidden: boolean;
  onToggleHidden: () => void;
  history: HistoryItem[];
  quote: QuoteView | null;
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  policy: StoredPolicy;
  spentTodayNear: string;
  keys: KeySummary[];
  hasAgentKey: boolean;
  busy: boolean;
  onPolicy: (policy: StoredPolicy) => void;
  onAllow: (accountId: string) => void;
  onRemoveAllow: (accountId: string) => void;
  onKill: () => void;
  onResume: () => void;
  onRefreshKeys: () => void;
  onScopedCall: () => void;
  onAddScopedKey: () => void;
  hasScopedKeyOnChain: boolean;
  onForget: () => void;
  onLock: () => void;
  otherAccount: string | null;
  onCreateRecipient: () => void;
  onSwitch: () => void;
  demo?: boolean;
  globalKilled?: boolean;
  agentSlot?: ReactNode;
}) {
  const [tokens, setTokens] = useState<{ symbol: string; subtitle: string; amount: string; mark: string }[]>(
    TOKENS.map((token) => ({ symbol: token.symbol, subtitle: token.subtitle, amount: "0.00", mark: token.mark })),
  );
  const usd = nearPrice === null ? null : availableNear * nearPrice;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = [];
      for (const token of TOKENS) {
        let amount = "0.00";
        try {
          const raw = await getProvider().callFunction<string>({
            contractId: token.contract,
            method: "ft_balance_of",
            args: { account_id: accountId },
          });
          const digits = String(raw ?? "0").replace(/"/g, "");
          if (/^\d+$/.test(digits)) amount = formatUnits(BigInt(digits), token.decimals, 2);
        } catch {
          amount = "0.00";
        }
        next.push({ symbol: token.symbol, subtitle: token.subtitle, amount, mark: token.mark });
      }
      if (!cancelled) setTokens(next);
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-2 min-w-0">
      <section className="glass wallet-card">
        <div className="label">
          <span>Total Balance</span>
          <button className="icon-btn" type="button" aria-label={hidden ? "Show balance" : "Hide balance"} onClick={onToggleHidden} style={{ width: 32, height: 32 }}>
            <Eye off={hidden} />
          </button>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="big">{hidden ? "••••" : <><CountUp value={availableNear} /> NEAR</>}</p>
            <p className="usd">{hidden ? "Hidden" : usd === null ? "USD price loading" : `≈ $${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}</p>
          </div>
          <svg className="spark" viewBox="0 0 92 36" aria-hidden>
            <path d="M2 26 C14 26 18 18 28 18 C40 18 42 8 54 10 C66 12 70 22 90 8" fill="none" stroke="#7ddec4" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
        <p className="mono mt-2 text-xs text-muted break-all">{accountId}</p>
        {demo ? <p className="mt-2 text-sm">Shared demo account · testnet only · key not in this browser</p> : null}
      </section>
      <div className="actions-3">
        <button className="pastel send" type="button" onClick={() => { pop(560); haptic(8); onSend(); }}>
          <Arrow />
          <span>Send</span>
        </button>
        <button className="pastel receive" type="button" onClick={() => { pop(480); haptic(8); onReceive(); }}>
          <Arrow down />
          <span>Receive</span>
        </button>
        <button className="pastel swap" type="button" onClick={() => { pop(620); haptic(8); onSwap(); }}>
          <SwapIcon />
          <span>Swap</span>
        </button>
      </div>
      <article className="glass token">
        <span className="mark near">N</span>
        <div><strong>NEAR</strong><em>Protocol Token</em></div>
        <div className="right"><strong>{hidden ? "••••" : `${availableNear.toLocaleString(undefined, { maximumFractionDigits: 4 })} NEAR`}</strong><small>{usd === null || hidden ? "" : `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</small></div>
      </article>
      {tokens.map((token) => (
        <article className="glass token" key={token.symbol}>
          <span className={`mark ${token.mark}`}>{token.symbol === "ETH" ? "◆" : "$"}</span>
          <div><strong>{token.symbol}</strong><em>{token.subtitle}</em></div>
          <div className="right"><strong>{hidden ? "••••" : `${token.amount} ${token.symbol}`}</strong><small>{token.symbol === "USDC" && !hidden ? `$${token.amount}` : ""}</small></div>
        </article>
      ))}
      {quote ? <p className="banner banner-warn">{quote.label} {quote.amountInFormatted} {quote.originSymbol} → {quote.amountOutFormatted} {quote.destinationSymbol}</p> : null}
      <section className="glass">
        <h2 className="text-lg font-semibold">Recent activity</h2>
        {history.length === 0 ? <p className="text-sm text-muted">No transactions yet.</p> : (
          <ul className="mt-2 grid gap-3">
            {history.slice(0, 6).map((item) => (
              <li key={item.hash} className="text-sm">
                <a className="link underline" href={explorerTxUrl(item.hash)} target="_blank" rel="noreferrer">{item.actions.join(", ") || "transaction"}</a>
                <span className="mt-1 block text-muted break-all">{item.signer} → {item.receiver}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {demo ? null : (
        <section className="glass grid gap-2">
          <h2 className="text-lg font-semibold">This account</h2>
          {otherAccount ? (
            <button className="btn btn-ghost" type="button" onClick={onSwitch}>Switch to {otherAccount}</button>
          ) : (
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCreateRecipient}>Create a recipient account</button>
          )}
          <button className="btn btn-ghost" type="button" onClick={onLock}>Lock</button>
        </section>
      )}
      {agentSlot}
      <SafetyPanel
        demo={demo}
        policy={policy}
        spentTodayNear={spentTodayNear}
        keys={keys}
        accountId={accountId}
        hasAgentKey={hasAgentKey}
        busy={busy}
        onChange={onPolicy}
        onAllow={onAllow}
        onRemoveAllow={onRemoveAllow}
        onKill={onKill}
        onResume={onResume}
        onRefreshKeys={onRefreshKeys}
        onScopedCall={onScopedCall}
        onAddScopedKey={onAddScopedKey}
        hasScopedKeyOnChain={hasScopedKeyOnChain}
        onForget={onForget}
        globalKilled={globalKilled}
      />
    </div>
  );
}

function Eye({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M1.5 9s2.8-4.5 7.5-4.5S16.5 9 16.5 9 13.7 13.5 9 13.5 1.5 9 1.5 9Z" fill="none" stroke="#2c2a2e" strokeWidth="1.4" />
      <circle cx="9" cy="9" r="2" fill="none" stroke="#2c2a2e" strokeWidth="1.4" />
      {off ? <path d="M3 15 15 3" stroke="#2c2a2e" strokeWidth="1.4" /> : null}
    </svg>
  );
}

function Arrow({ down }: { down?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden style={{ transform: down ? "rotate(180deg)" : undefined }}>
      <path d="M9 14V4M9 4 5 8M9 4l4 4" fill="none" stroke="#2c2a2e" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path d="M4 6h10l-2.5-2.5M14 12H4l2.5 2.5" fill="none" stroke="#2c2a2e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
