# Testing

All times below are in Europe/Budapest (CET, UTC+1). Date: 13 November 2026.

## How to run

From `app-v4/`:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e   # Playwright against production (default https://vibe-wallet-flame.vercel.app)
```

GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, and unit tests on every push and pull request. It does not need secrets and does not hit production.

## Unit tests

`npm test` runs Node's test runner via `tsx` on `tests/*.test.ts`.

These tests cover:

- The deterministic local intent parser (balances, sends, swaps, schedules, price rules, help, history)
- Local-fallback behavior when a model invents a recipient, when `NEAR_AI_API_KEY` is unset, and when NEAR AI returns 401/402
- Guardrails: kill switch, per-transaction and daily limits, allowlist, confirm phrase, missing accounts
- API routes: `/api/intent` (local fallback, silent 401/402, successful NEAR AI parse, `reasoning_content` fallback) and `/api/transcribe` (missing key, missing audio, Whisper success)
- Server routes do not import the browser signer

Results (recorded after the production-ready run on 13 November 2026):

| Suite | Result |
| --- | --- |
| `npm run lint` | _pending_ |
| `npm run typecheck` | _pending_ |
| `npm test` (unit + API route tests) | _pending_ |

## Production end-to-end

Two layers are run against `https://vibe-wallet-flame.vercel.app`:

1. Playwright (`npm run test:e2e`): landing page, CTA opening the app, typed commands, voice via a fake audio fixture posted to `/api/transcribe`, slide-to-confirm testnet send, Wallet tab, APK download returning HTTP 200.
2. The existing production API/script suite in `/tmp/vw-tools/e2e-prod.py` (landing, APK, manifest, demo session, policy blocks, real send, kill switch, agent quote run, cron auth).

Results (recorded after the production deploy on 13 November 2026):

| Suite | Result |
| --- | --- |
| Playwright production e2e | _pending_ |
| Production API e2e (`e2e-prod.py`) | _pending_ |

## What's real in those tests

The Playwright and API e2e suites perform a real 0.1 NEAR testnet transfer from the shared demo account. They do not execute a swap. Voice in Playwright uses a recorded fixture (`tests/fixtures/whats-my-balance.webm`) as a fake microphone input; transcription still goes through production `/api/transcribe`.
