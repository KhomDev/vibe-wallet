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
- Network selection: testnet by default, mainnet only on an explicit switch, network-aware explorer URLs, and Intents execution refusing to run off mainnet

Results, recorded 13 November 2026 in the afternoon, Europe/Budapest (CET, UTC+1):

| Suite | Result |
| --- | --- |
| `npm run lint` | 0 errors, 6 warnings (`@next/next/no-img-element` on the landing page) |
| `npm run typecheck` | 0 errors |
| `npm test` (unit + API route tests, including `tests/network.test.ts`) | 23/23 passed |
| `npm run build` | Passed |

`npm audit` after safe overrides for `postcss` (8.5.32) and `zod` (4.6.7): 0 high, 0 critical. Six moderate findings remain in dev-only `minimatch` / typescript-eslint. Forcing a Next 16 or `@vercel/blob` 2.4.0 downgrade was not safe, so those were not applied.

## Production end-to-end

Two layers were run against `https://vibe-wallet-flame.vercel.app` after deployment `dpl_BVioz4KJkVEnZsV5rYQXvzpdKFar` (aliased at 13 November 2026, Europe/Budapest):

1. Playwright (`npm run test:e2e`): landing page, CTA opening the app, typed commands, voice via a fake audio fixture posted to `/api/transcribe`, slide-to-confirm testnet send, Wallet tab, APK download returning HTTP 200.
2. The production API suite (landing, APK, manifest, demo session, policy blocks, real send, kill switch, agent quote run, cron auth).

| Suite | Result |
| --- | --- |
| Playwright production e2e | 2/2 passed (43.3s) |
| Production API e2e | 17/17 passed. Real send: https://testnet.nearblocks.io/txns/DkxWEEVkFEYc5yDQuCYUaZs4sxUVAf3H2x9skeLTnCCx |

Spoken-audio checks against production `/api/transcribe` then `/api/intent`, same afternoon:

| Clip | Transcript source | Transcript | Intent | Latency (transcribe + intent) |
| --- | --- | --- | --- | --- |
| "what's my balance" (wav) | near-ai-whisper | What's my balance? | near-ai `get_balance` | 1230 ms + 3801 ms |
| "what's my balance" (webm) | near-ai-whisper | What's my balance? | near-ai `get_balance` | 1106 ms + 1867 ms |
| "send 0.1 NEAR to a94ddd8e…" (webm, TTS of a 64-character implicit id) | near-ai-whisper | Heard a near-miss on the hex id | near-ai `send` 0.1, recipient mis-heard | 1399 ms + 10419 ms |

The long implicit account id is hard for TTS and Whisper to copy exactly. Named accounts and the in-app suggestion chips are the reliable path; the Playwright send types the id and confirms it on-chain.

## Secret scan

`gitleaks detect` on git history (11 commits at the time of the first scan, then the new work): no leaks. A working-tree scan only flagged gitignored files (`.env.local`, `.next` cache), which are not in the repository. `.env.example` contains names and public URLs only, no secret values.

## What's real in those tests

The Playwright and API e2e suites perform a real 0.1 NEAR testnet transfer from the shared demo account. They do not execute a swap. Voice in Playwright uses a recorded fixture (`tests/fixtures/whats-my-balance.webm`) as a fake microphone input; transcription still goes through production `/api/transcribe`.

## Mainnet proof run

13 November 2026, afternoon, Europe/Budapest (CET, UTC+1): `scripts/mainnet-proof.ts` executed a 0.01 NEAR transfer through `executeTransfer` and a NEAR → USDC Intents swap through `executeIntentsSwap` on mainnet. Status `SUCCESS`. Links: [docs/MAINNET.md](MAINNET.md).

After that change, production was redeployed and Playwright against `https://vibe-wallet-flame.vercel.app` passed 2/2 (23.8s), including a real slide-to-confirm testnet send.
