# Changelog

## 2026-11-14: security remediation

Fixes for every finding of the internal red-team review of `bc01dbb`. The record, finding by finding, is in
[docs/SECURITY-REVIEW-2026-11-14.md](docs/SECURITY-REVIEW-2026-11-14.md).

### Shared demo account

- State has one authority, private Vercel Blob, and changes only through compare-and-swap writes with a
  per-request ETag. NEAR Social is now a write-only public mirror, written by the daily cron with no deposit.
- Every limit is checked and the spend reserved in the same write, before signing. Spend is returned only
  when a send certainly did not happen.
- Each send needs a single-use confirmation token from its own preview, bound to visitor, recipient and amount.
- Visitor ids are minted only by `POST /api/demo/session`, at most 20 per network per day. New per-network
  budget: 3 NEAR per day, 15 sends per hour, 40 per day. The global cap counts fees.
- Stop switch, allowlist and agent rules are per visitor; the global kill switch is operator-only. Resuming
  and adding a recipient need the phrase.
- Agent rules need a visitor cookie and belong to it. Payments are claimed atomically, so a rule cannot pay
  twice, and they count against the owner's limits and the global cap.
- The demo signer signs only on testnet (build setting and node `chain_id`).
- Demo extra-confirm threshold: 0.2 NEAR (was 0.05 and had no effect).

### Wallet and voice

- The extra-confirm threshold now applies to allowlisted recipients too.
- A model's intent is accepted only if the recipient is a whole account token the user said and the amount
  is a number they said. Negated requests, hidden characters and Unicode look-alikes are refused.
- "Every Friday send…" with the cadence first is parsed as a schedule, never as an immediate send.
- Voice "yes" must be the whole answer, negatives are checked first, and the question expires after 15
  seconds or when the card changes. A spoken confirm phrase must be the whole utterance.
- Allowlist additions and loosening any limit need the confirm phrase on every path (voice, text, Safety
  panel, "Add to allowlist").
- The scoped agent key is opt-in instead of being added automatically on import or unlock.
- Vault v2: PBKDF2 600,000 iterations, AAD, 12-character minimum; v1 vaults upgrade on unlock.
- Sends are serialized per account across tabs, with the transaction hash computed before broadcast and
  reconciled after a failed send call. The daily counter is reserved before broadcast.
- Bare base58 secrets and seed phrases are blocked before they leave the browser, and again on the server.
- The slider no longer confirms on Enter or Space; keyboard users step it with the right arrow.
- Agent rules are offered only on the demo account; personal-wallet sessions say so.

### Platform

- CSP (`frame-ancestors 'none'`), `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy, COOP.
- `middleware.ts` rejects cross-site and non-JSON state-changing API requests; API responses are `private, no-store`.
- Rate limits on `/api/intent`, `/api/transcribe`, `/api/quote` and the demo control routes.
- Client IP from the platform header on Vercel; IPv6 reduced to /64.
- CI: actions pinned by commit SHA, read-only token, a production build job.
- Android (APK 1.2): no backup, microphone-only WebView permission for the app's origin, HTTPS-only network
  config, navigation allowlist, `FLAG_SECURE`.

### Tooling and docs

- `npm run mainnet:check`: key-free check of the new logic against NEAR mainnet (signs nothing).
- `scripts/mainnet-proof.ts` now refuses to send without `--broadcast`.
- `scripts/e2e-http.mjs`: HTTP end-to-end check of a running build against testnet.
- New route-level tests drive the real handlers against a stub RPC that decodes every signed transaction.
- README rewritten; `SECURITY.md` added; architecture, testing, hands-free and mainnet docs updated.
