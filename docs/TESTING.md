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
| `npm test` (unit + API route tests, including `tests/network.test.ts`) | 28/28 passed (adds `tests/allowlist.test.ts`) |
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

## Hands-free, wake word, allowlist and slider tests

13 November 2026, late afternoon, Europe/Budapest (CET, UTC+1).

New unit tests:

- `tests/handsfree.test.ts`: wake phrases ("hey vibe", "hey AI", "hey wallet", "yo vibe", with a command in the same breath), stop words versus kill-switch phrases, spoken yes/no for voice confirm, Whisper silence-hallucination filter
- `tests/speech-text.test.ts`: rounding numbers for speech ("about 4.7"), removing fees, hashes and 64-character ids from speech, short casual fallback replies (15 words or fewer)
- `tests/allowlist.test.ts`: the `show_allowlist` intent ("who can I send to", "list allow list entries", "my contacts", …), the allowlist card data, and the empty-state help
- `tests/policy.test.ts` and `tests/intent.test.ts`: allowlisted sends within limits skip the typed phrase, "did you mean" for a typo of a contact, and bare names resolving to `name.testnet`

Playwright (`e2e/mobile.spec.ts`), with projects `iphone` (iPhone 13 device profile) and `android-chromium` (Pixel 7). The Pixel 7 project feeds a real speech clip in as the microphone with `--use-file-for-fake-audio-capture=tests/fixtures/handsfree-balance.wav`:

1. "Who can I send to?" card → tap **Send 0.1** → the command box is prefilled → the slider is unlocked with no phrase field
2. A typo of the allowlisted account → **Did you mean …?** and **Add … to allowlist** buttons, and no slider
3. A real pointer drag on the slider → real testnet send → **View transaction**
4. Full hands-free loop: one tap → on-device VAD fires on the fake mic → "Hey vibe." (wake) → "Send 0.01 NEAR to …" → "Yes, do it." → real testnet send → **Stop**. The transcripts are scripted with a route mock so the conversation is deterministic.
5. Hands-free with the wake word off: the fake-mic clip goes through the real NEAR AI Whisper and intent calls and gets the balance answer

| Run (local production build, `next start`) | `npm test` | Playwright (10 tests) |
| --- | --- | --- |
| 1 | 37/37 | 9/10 (iPhone drag test: the send preview took over 30 s waiting for the NEAR AI intent call; the timeout is now 60 s) |
| 2 | 37/37 | 10/10 |
| 3 | 37/37 | 10/10 |

An earlier set of runs stopped at the demo's own guard ("at most 8 sends per hour from this network"). The local test server now raises that with `DEMO_SENDS_PER_HOUR`/`DEMO_SENDS_PER_DAY`. Production keeps 8 per hour and 20 per day.

WebKit: Playwright's WebKit build needs system libraries that this machine could not install (the Debian mirror returned errors), so the `iphone` project ran with the iPhone 13 profile (viewport, touch, user agent) on Chromium. Run with `E2E_WEBKIT=1` where WebKit is installed to use the real engine.
