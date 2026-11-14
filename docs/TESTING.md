# Testing

All times below are in Europe/Budapest (CET, UTC+1). Date: 13 November 2026.

## 14 November 2026 (later): wallet connector, executed swaps, on-chain limits

| Check | Result |
| --- | --- |
| `npm test` | 89/89 passed |
| `npm run typecheck` / `npm run lint` / `npm run build` | 0 errors / 0 errors (7 warnings) / passed; first-load JS 293 kB (wallet modules load on demand) |
| `npm audit --omit=dev` | 0 critical, 0 high, 6 moderate, 17 low (wallet SDK transitive dependencies; Meteor Wallet left out for its high advisories) |
| NEAR mainnet, `npm run mainnet:check` | 16/16, nothing signed ([evidence](evidence/mainnet-check-2026-11-14.json)) |
| Browser load of the production build | The setup screen lists HOT Wallet, MyNearWallet and Intear Wallet with their icons; no "secret key" field; no console errors or CSP violations |

New tests:

- `tests/intents-swap.test.ts`: the executable quote request (delivers to and refunds the user, `dry: false`); `verifyLiveQuote` rejecting a different amount, recipient, refund account, token, missing or self deposit address, near-expiry and zero output; `buildSwapTransactions` for a fresh account, a ready account and a partial wNEAR balance (only the shortfall is wrapped); chain state read with view calls only; `assessSwap` (kill switch, ceiling, per-send, daily, balance, phrase always required); the executable-quote route refusing on testnet; the `onchain_limits` intent.
- `tests/wallet-connector.test.ts`: the selector uses FastNEAR RPC; a send the policy blocks (kill switch, caps, unknown recipient, phrase at threshold, unconfirmed) never reaches the wallet; the TriagePay reader's exact view calls and field mapping, and full-precision formatting of tiny caps.

Not covered by automated tests: signing in to a real wallet and approving a real payment. Those need the
wallet owner and were not done for this change.

## 14 November 2026: security remediation

After the fixes recorded in [SECURITY-REVIEW-2026-11-14.md](SECURITY-REVIEW-2026-11-14.md):

| Check | Result |
| --- | --- |
| `npm test` | 79/79 passed |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 6 warnings (`@next/next/no-img-element` on the landing page) |
| `npm run build` | Passed (middleware 39.6 kB) |
| Local production build against testnet, `scripts/e2e-http.mjs` | 19/19 ([evidence](evidence/testnet-e2e-2026-11-14.json)) |
| NEAR mainnet, `npm run mainnet:check` (no key, nothing signed) | 12/12 ([evidence](evidence/mainnet-check-2026-11-14.json)) |
| Playwright | Not re-run: Playwright browsers are not installed on the machine used for this change. `e2e/production.spec.ts` now confirms with four right-arrow presses, since Enter no longer confirms |

New tests:

- `tests/demo-routes.test.ts` drives the real route handlers (`demo/session`, `demo/send`, `demo/policy`, `agent/rules`, `agent/run`, `agent/status`, `cron/agent`) against an in-memory compare-and-swap store and a stub JSON-RPC that decodes every signed transaction (`tests/helpers/rpc-stub.ts`). It covers the single-use confirmation token, 9 parallel sends against the 2 NEAR daily limit, 8 visitors in parallel against a global cap, the visitor-id mint limit, per-visitor policy isolation, the operator-only global kill switch, no NEAR Social transaction on visitor routes, agent rule ownership, two concurrent agent runs paying once, the agent respecting the global cap, the testnet-only demo signer, and cron auth.
- `tests/security-units.test.ts`: the cross-site/content-type guard, client-IP derivation (Vercel header, right-most hop, IPv6 /64), cron secret comparison, token binding and expiry, secret detection, vault v2 and v1 compatibility, Unicode phrases, look-alike and hidden-character account ids, whole-token recipient and amount matching, negation, strict voice yes/no, policy loosening detection, the rate limiter.
- `tests/demo-limits.test.ts` was rewritten for reservations: per-visitor and per-network budgets, the global cap with fees, release, and 12 concurrent reservations against one store (exactly 6 commit).
- `tests/routes.test.ts`: the intent route's per-client limit (25 calls give 20 model calls and five 429s) and pasted-secret refusal.
- `tests/intent.test.ts`: "Every Friday send..." with the cadence first is a schedule, never an immediate send.
- `tests/history-and-safety.test.ts`: the signer-isolation walk now works on Windows paths too.

### Testnet end-to-end (local production build)

`next start` with a throwaway testnet demo account, driven over HTTP by `scripts/e2e-http.mjs`:

| Step | Result |
| --- | --- |
| Page headers | CSP `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| Session | Visitor cookie minted; `network: testnet`; `Cache-Control: private, no-store` |
| Cross-origin POST / `text/plain` body | 403 / 415 |
| Send without a token | 409 |
| Preview, then send 0.01 NEAR | Real transfer [7Py477om...](https://testnet.nearblocks.io/txns/7Py477omDvYMysjMxYBo5GeiTLYnhVDuoSg8tb2RSEBv); token replay 409 |
| 0.2 NEAR to the allowlisted friend | Needs the phrase (threshold) |
| Allow without phrase / stop / resume without phrase / resume with phrase | 403 / stopped (sends blocked) / 403 / resumed |
| Agent: rule created, two concurrent "Run agent now" | One payment, [jgPVdXZa...](https://testnet.nearblocks.io/txns/jgPVdXZaVhgqaxGdbnTVE3rEhJFE8Dq49tVi2QfxZ2G) |
| Agent status: own rules only / anonymous | 1 rule / 401 |

Loading the app in a browser with the new CSP showed no CSP violations. The only console error was a 429
from the public NearBlocks API on the history request, which the app already handles.

The sections below are the earlier runs and are kept as recorded.

## How to run

From `app-v4/`:

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e   # Playwright against the shared testnet demo (default https://vibe-wallet-testnet.vercel.app)
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

An earlier set of runs stopped at the demo's own guard ("at most 8 sends per hour from this network"). The local test server now raises that with `DEMO_SENDS_PER_HOUR`/`DEMO_SENDS_PER_DAY`. Production keeps 8 per hour and 20 per day, now counted per visitor (see below).

WebKit: Playwright's WebKit build needs system libraries that this machine could not install (the Debian mirror returned errors), so the `iphone` project ran with the iPhone 13 profile (viewport, touch, user agent) on Chromium. Run with `E2E_WEBKIT=1` where WebKit is installed to use the real engine.

### Production check (13 Nov 2026, against vibe-wallet-flame.vercel.app)

- The first run failed every mobile test at `openDemo`. The demo button is server-rendered, and a click before hydration did nothing. `openDemo` now retries the click until the app opens.
- Rerun: 7 of 8 passed. Android Pixel 7 passed 5 of 5, and iPhone 13 passed 2 of 3. The failure was correct: that day's test sends had used up the demo's 2 NEAR daily cap, so the policy blocked the send ("This would pass your daily limit of 2 NEAR"). The cap resets at 00:00 UTC.
- The desktop production spec passed 2 of 2.

### Per-visitor demo limits (13 Nov 2026)

The shared demo used to count its 2 NEAR daily limit and its send rate for everyone at once, so a single visitor could block the rest. It now counts per visitor:

- **Who is a visitor:** opening the demo sets `vw_vid`, an HMAC-signed, httpOnly, Secure, SameSite=Lax cookie. Sends count against that id. With no cookie, or a forged one, they count against a hash of the IP.
- **Per visitor:** 2 NEAR per UTC day (the wallet policy), 8 sends per hour, and 20 per day.
- **Per network:** 30 sends per hour and 100 per day, to slow down cookie rotation.
- **Global:** at most 20 NEAR per UTC day across the whole demo account (`DEMO_GLOBAL_DAILY_NEAR`). The scheduled agent has its own budget, which also counts toward the global total.
- **One-time reset:** `COUNTER_RESET` in `lib/server/state.ts` cleared the counter that test runs had filled on 13 Nov.

`tests/demo-limits.test.ts` covers cookie signing and forgery, the IP fallback, two visitors on one IP, one visitor's limit not blocking another, the global cap, per-visitor and per-network rates, day rollover, the agent budget, and the reset.
