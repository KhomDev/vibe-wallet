"use client";

import { explorerTxUrl } from "@/lib/config";
import type { IntentSource, QuoteView } from "@/lib/client";
import { normalizePhrase, type SendCheck } from "@/lib/policy";

export type Pending =
  | {
      kind: "send";
      recipient: string;
      amountNear: string;
      feeNear: string;
      balanceAfterNear: string;
      amountYocto: string;
      check: SendCheck;
    }
  | { kind: "resume" }
  | { kind: "allow"; recipient: string }
  | { kind: "limits"; perTxNear?: string; dailyNear?: string; thresholdNear?: string }
  | { kind: "schedule"; recipient: string; amountNear: string; cadence: "weekly_friday" | "daily" }
  | { kind: "price"; belowUsd: number; amountNear: string; toSymbol: "USDC" | "USDT" };

export type ReceiptView = {
  hash: string;
  recipient: string;
  amountNear: string;
  feeNear: string;
};

export function ActionCards({
  pending,
  phrase,
  confirmPhrase,
  source,
  note,
  receipt,
  quote,
  busy,
  onPhrase,
  onConfirm,
  onCancel,
  onDismissReceipt,
  onDismissQuote,
}: {
  pending: Pending | null;
  phrase: string;
  confirmPhrase: string;
  source: IntentSource | null;
  note: string | null;
  receipt: ReceiptView | null;
  quote: QuoteView | null;
  busy: boolean;
  onPhrase: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismissReceipt: () => void;
  onDismissQuote: () => void;
}) {
  const needsPhrase = pending?.kind === "send" ? pending.check.needsPhrase : pending?.kind === "schedule" || pending?.kind === "price" ? false : Boolean(pending);
  const phraseOk = !needsPhrase || normalizePhrase(phrase) === normalizePhrase(confirmPhrase);
  const blocked = pending?.kind === "send" ? Boolean(pending.check.blockReason) : false;

  return (
    <div className="grid gap-3">
      {pending ? (
        <section className="card grid gap-3" aria-live="polite">
          <p className="text-sm text-muted">{sourceLabel(source)}{note ? ` · ${note}` : ""}</p>
          {pending.kind === "send" ? (
            <>
              <h2 className="text-2xl font-semibold">Confirm send</h2>
              <p className="text-4xl font-semibold">{pending.amountNear} NEAR</p>
              <p>To <span className="mono break-all">{pending.recipient}</span></p>
              <p>Estimated fee: {pending.feeNear} NEAR</p>
              <p>Available after send: about {pending.balanceAfterNear} NEAR</p>
              {pending.check.warnings.length > 0 ? (
                <div className="banner banner-warn">
                  <p className="font-semibold">Warnings</p>
                  <ul className="list-disc pl-5">{pending.check.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </div>
              ) : null}
              {pending.check.phraseReasons.length > 0 ? (
                <div>
                  <p className="font-semibold">Why this needs the confirm phrase</p>
                  <ul className="list-disc pl-5 text-sm">{pending.check.phraseReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </div>
              ) : <p className="text-sm">This recipient is allowlisted and under your threshold. Click Confirm, or say confirm.</p>}
              {pending.check.blockReason ? <p className="banner banner-danger" role="alert">{pending.check.blockReason}</p> : null}
            </>
          ) : null}
          {pending.kind === "resume" ? <h2 className="text-2xl font-semibold">Resume sending</h2> : null}
          {pending.kind === "allow" ? <h2 className="text-2xl font-semibold">Allow {pending.recipient}</h2> : null}
          {pending.kind === "limits" ? (
            <>
              <h2 className="text-2xl font-semibold">Change limits</h2>
              <p>Per transaction: {pending.perTxNear ?? "unchanged"}. Daily: {pending.dailyNear ?? "unchanged"}. Threshold: {pending.thresholdNear ?? "unchanged"}.</p>
            </>
          ) : null}
          {pending.kind === "schedule" ? (
            <>
              <h2 className="text-2xl font-semibold">Add a scheduled payment</h2>
              <p>Send {pending.amountNear} NEAR to <span className="mono break-all">{pending.recipient}</span> {pending.cadence === "daily" ? "every day" : "every Friday"}.</p>
              <p className="text-sm text-muted">The agent will send a real testnet transfer when the rule is due, unless the kill switch or a limit blocks it.</p>
            </>
          ) : null}
          {pending.kind === "price" ? (
            <>
              <h2 className="text-2xl font-semibold">Add a price-trigger rule</h2>
              <p>If NEAR drops below ${pending.belowUsd}, quote a swap of {pending.amountNear} NEAR to {pending.toSymbol}.</p>
              <p className="banner banner-warn">Quote only. NEAR Intents have no testnet execution, so the agent will not swap.</p>
            </>
          ) : null}
          {pending.kind !== "send" && pending.kind !== "schedule" && pending.kind !== "price" ? <p>Enter the confirm phrase, then click Confirm. This does not move NEAR by itself.</p> : null}
          <p className="text-sm">Your private key stays in this browser. The assistant never receives it.</p>
          {needsPhrase ? (
            <label className="grid gap-1 text-sm">
              Type: {confirmPhrase}
              <input className="field" value={phrase} onChange={(event) => onPhrase(event.target.value)} autoComplete="off" />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" type="button" disabled={busy || blocked || !phraseOk} onClick={onConfirm}>Confirm</button>
            <button className="btn btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </section>
      ) : null}
      {receipt ? (
        <section className="card grid gap-2">
          <h2 className="text-2xl font-semibold">Receipt</h2>
          <p className="banner banner-ok">Sent {receipt.amountNear} NEAR to <span className="mono break-all">{receipt.recipient}</span>.</p>
          <p>Network fee: {receipt.feeNear} NEAR</p>
          <p className="mono break-all">{receipt.hash}</p>
          <a className="underline" href={explorerTxUrl(receipt.hash)} target="_blank" rel="noreferrer">View on testnet explorer</a>
          <button className="btn btn-ghost" type="button" onClick={onDismissReceipt}>Dismiss receipt</button>
        </section>
      ) : null}
      {quote ? (
        <section className="card grid gap-2">
          <h2 className="text-2xl font-semibold">Quote only</h2>
          <p className="banner banner-warn">{quote.label}</p>
          <p className="text-3xl font-semibold">{quote.amountInFormatted} {quote.originSymbol} → {quote.amountOutFormatted} {quote.destinationSymbol}</p>
          <p>Minimum out: {quote.minAmountOutFormatted} {quote.destinationSymbol}</p>
          <p>About ${quote.amountInUsd} in and ${quote.amountOutUsd} out. Estimate {quote.timeEstimate} seconds if this were executed on mainnet.</p>
          <button className="btn btn-ghost" type="button" onClick={onDismissQuote}>Dismiss quote</button>
        </section>
      ) : null}
    </div>
  );
}

function sourceLabel(source: IntentSource | null): string {
  if (source === "near-ai") return "Parsed by NEAR AI Cloud";
  if (source === "local-fallback") return "Parsed by the local parser";
  return "Action";
}
