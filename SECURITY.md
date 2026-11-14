# Security

## Reporting a vulnerability

Please report security issues privately: send a direct message to [@YKhomenkov](https://x.com/YKhomenkov)
on X, or open a GitHub issue titled "Security contact request" with no details, and we will reply with a
private channel. Do not put details of anything that could move funds or expose a key in a public issue.
Include the affected route or file, the steps, and what you observed.

The deployed demo runs on NEAR **testnet**. Please do not run load or drain tests against
`vibe-wallet-flame.vercel.app`; the demo account is shared with judges and other visitors. A local build
(`app-v4/README.md`) reproduces every server route.

## What protects what

| Asset | Protection | Where |
| --- | --- | --- |
| Your full-access key (personal wallet) | Encrypted in the browser: PBKDF2-SHA256 600,000 iterations → AES-GCM-256, fresh salt and IV, AAD bound to account, key and slot; 12+ character passphrase. Never in a request body. | `lib/vault.ts`, `lib/session.ts` |
| What gets signed | The model returns a typed intent only. It is accepted only if the recipient and amount appear in the user's own words. The policy runs on the confirm card and again inside the signer. | `lib/intent.ts`, `lib/policy.ts`, `lib/near/signer.ts` |
| Your confirmation | Slide (or four arrow-key steps), the confirm phrase when the policy asks for it, or a whole-utterance spoken "yes" for small allowlisted sends in hands-free mode. Allowlist additions and loosening any limit need the phrase. | `components/SlideConfirm.tsx`, `components/WalletApp.tsx`, `lib/handsfree.ts` |
| Double sends | One signing operation per account across tabs; transaction hash computed before broadcast and looked up after a failed send call. | `lib/near/signer.ts`, `lib/near/broadcast.ts` |
| The shared demo key | Server environment only; signs only on testnet (build and node `chain_id` both checked). | `lib/server/env.ts`, `lib/server/transfer.ts` |
| Demo spend | Limits checked and spend reserved in one compare-and-swap write before signing; single-use confirmation token per send; per-visitor, per-network and global caps. | `lib/server/state.ts`, `lib/server/demo-limits.ts`, `lib/server/confirm-token.ts` |
| Demo settings | Each visitor's stop switch, allowlist and agent rules belong to their signed cookie; the global kill switch is operator-only. | `app/api/demo/policy`, `app/api/agent/*` |
| The web origin | CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`; cross-site and non-JSON state-changing API requests rejected; API responses not cacheable. | `next.config.ts`, `middleware.ts`, `lib/request-guard.ts` |
| NEAR AI spend | Per-client and per-instance limits on `/api/intent` and `/api/transcribe`; pasted secrets refused before any model call. The final bound is the API key's spending limit. | `lib/server/rate-limit.ts` |
| Android wrapper (APK 1.2) | No cloud backup, microphone-only WebView permission for the app's origin, HTTPS-only with system CAs, `FLAG_SECURE`. | `app-v4/android` |

## Known limits

- The NEAR AI rate limiter is per server instance; the deployment has no shared KV store.
- The personal-wallet confirm phrase is a deliberate-intent check, not a secret bound to one recipient and amount.
- The published APK is 1.1; the Android hardening above ships with 1.2.
- No third-party audit. The internal review and its remediation are in
  [docs/SECURITY-REVIEW-2026-11-14.md](docs/SECURITY-REVIEW-2026-11-14.md).
