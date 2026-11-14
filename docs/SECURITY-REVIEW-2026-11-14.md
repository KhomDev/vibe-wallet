# Security review and remediation, 14 November 2026

An internal red-team review of Vibe Wallet at commit `bc01dbb` (13 Nov 2026) reported **0 Critical, 0 High,
8 Medium, 18 Low and 13 Info** findings. This file records what was changed for each one, and how it was
tested. Every fix below is in this repository. Tests are in `app-v4/tests/`, and evidence files are in
`docs/evidence/`.

The review's summary was accurate. Key custody, the vault's AES-GCM construction, signer isolation, the
scoped agent key, display-equals-signed on the personal path and the absence of XSS/SSRF all held. The
weaknesses were in the **shared demo backend**: its control plane was unauthenticated, its spend accounting
was not atomic, and its documented limits were not the ones enforced. On the personal-wallet side, the
gaps were in the **confirmation model**.

## Status at a glance

| Status | Count | Meaning |
| --- | --- | --- |
| Fixed | 33 | Code changed, covered by a test or an executed check |
| Fixed in source, ships with APK 1.2 | 3 | Android wrapper changes; the published APK 1.1 needs a rebuild with the release keystore |
| Open, operator action | 3 | Cannot be done from the repository: APK checksum/fingerprint publication and a Vercel settings check |

## How the demo backend works now

- **One authority for state.** One JSON document in private Vercel Blob. Every change is a compare-and-swap
  write against the ETag of the snapshot it was computed from (`transact` in `lib/server/state.ts`). Each
  request carries its own ETag; before this change a module-level ETag was shared between concurrent
  requests in one instance. A request that changes nothing writes nothing. NEAR Social is a public mirror
  written only by the authenticated daily cron, with no deposit, and it is never read back.
- **Spend is reserved before signing.** The write that checks every limit also records the spend and uses
  up the confirmation token. The transfer is signed only after that write commits. The spend is returned
  only when the send certainly did not happen (the transaction was refused before inclusion, or failed on
  chain). If the outcome is unknown, the spend stays counted.
- **Identity.** A signed, httpOnly visitor cookie, issued only by `POST /api/demo/session`. Each network
  (hashed client IP, IPv6 reduced to /64) can mint at most 20 cookies per UTC day. Without a cookie, a
  request counts against its network.
- **Per-visitor settings.** Each visitor's allowlist additions, stop switch and agent rules belong to that
  visitor and affect no one else. Only the operator can turn the global kill switch on or off
  (`Authorization: Bearer <CRON_SECRET>`).
- **Request guard.** `middleware.ts` rejects any state-changing `/api` request whose `Sec-Fetch-Site` or
  `Origin` is another site, and any JSON route called without `application/json`. Every `/api` response is
  `Cache-Control: private, no-store`.

### Demo limits (enforced on the server, `lib/server/demo-limits.ts`)

| Scope | Limit |
| --- | --- |
| Per send | 0.3 NEAR, allowlisted recipients only |
| Extra confirm | at or above 0.2 NEAR, the confirm phrase is also required |
| Per visitor | 2 NEAR per UTC day, 8 sends per hour, 20 per day |
| Per network | 3 NEAR per UTC day, 15 sends per hour, 40 per day, 20 new visitor ids per day |
| Global | 20 NEAR per UTC day (amounts plus estimated fees), 120 sends per hour |
| Agent | 3 rules per visitor; each payment counts against the rule owner's visitor, network and global limits |

## Findings

### Medium

| ID | Finding | What changed | Test / evidence |
| --- | --- | --- | --- |
| VW-MONEY-01 | Unauthenticated state writes signed a NEAR Social transaction (0.01 NEAR + gas) each, uncapped | No visitor route signs a chain transaction. State writes go to Blob only, and only when something changed. The NEAR Social mirror runs from the cron, at most once per change, with zero deposit. The policy route needs a visitor cookie and is rate-limited (per instance and durably). The global cap now counts network fees. | `demo-routes`: "VW-DEMO-01 / VW-MONEY-01" (no-op writes nothing; no `v1.social08.testnet` transaction) |
| VW-DEMO-02 | Per-visitor caps were bypassed by discarding the cookie | Visitor ids are minted only by the session route, at most 20 per network per day. Every visitor on a network also shares that network's 3 NEAR/day budget and send rate. | `demo-routes`: "VW-DEMO-02"; `demo-limits`: "per-network NEAR budget bounds one actor" |
| VW-DEMO-03 | Check-then-act let concurrent sends overshoot caps | The reservation is written atomically with the checks (compare-and-swap), before signing. | `demo-routes`: 9 parallel 0.3 NEAR sends sign at most 2 NEAR, and recorded spend equals signed; 8 visitors in parallel stay under a 0.5 NEAR global cap; `demo-limits`: 12 concurrent reservations, exactly 6 commit |
| VW-AGENT-01 | Anyone could create, delete and run the rules the cron pays | Rules need a visitor cookie and belong to that visitor. A scheduled payment must go to the owner's allowlist and is capped at 0.3 NEAR. Its spend counts against the owner. "Run agent now" runs only the caller's rules. | `demo-routes`: "VW-AGENT-01 / VW-AGENT-04" |
| VW-AGENT-02 | Concurrent agent ticks double-paid | Each payment is claimed (marked run for today, leased, spend reserved) in one compare-and-swap write before it is sent. | `demo-routes`: two runs plus the cron at once give exactly one payment, counted once; testnet: `docs/evidence/testnet-e2e-2026-11-14.json` (two concurrent runs, `ran=1`) |
| VW-AGENT-03 | State read preferred the older NEAR Social copy; a failed mirror rolled back the kill switch and counters | Blob is the only state read. NEAR Social is write-only and best-effort, and cannot affect state. | `lib/server/state.ts` (no social read); `demo-limits`: CAS tests |
| VW-IV-01 | Voice "yes" prefix-matched ("ok", "sure, not now"), was tested before "no", and never expired | Yes must be the whole answer ("yes", "yes, do it", "confirm"). Any negative word anywhere cancels, and it is checked first. A spoken yes counts only for the card it was asked about, for 15 seconds. The prompt repeats amount and recipient. | `security-units`: "VW-IV-01" (11 non-answers rejected) |
| VW-WEB-02 | `/api/intent` and `/api/transcribe` were unrated paid-model proxies | Per-client limits (intent 20/min and 300/day, transcribe 15/min and 200/day), a per-instance ceiling, the cross-site/content-type guard, and pasted secrets refused before any model call. **Residual:** the limiter is per server instance, because the deployment has no shared KV store. The final bound is the NEAR AI key's spending limit (operator setting). | `routes`: 25 calls give 20 model calls and 5 HTTP 429; `security-units`: limiter |

### Low

| ID | Finding | What changed | Test / evidence |
| --- | --- | --- | --- |
| VW-DEMO-01 | Global kill switch and allowlist were writable by anyone | The stop switch and allowlist additions are per visitor; the global switch is operator-only; resuming and adding a recipient need the phrase. | `demo-routes`: "VW-DEMO-01 / VW-MONEY-01" |
| VW-DEMO-04 | The slide was not verifiable server-side | `preview` returns an HMAC token bound to visitor, recipient and amount, valid 5 minutes and usable once. The send requires it. | `demo-routes`: "VW-DEMO-04"; `security-units`: token binding and expiry |
| VW-DEMO-05 | Demo signer not pinned to testnet; session reported "testnet" as a constant | The demo signer refuses unless the build is testnet **and** the RPC node reports `chain_id: testnet`. The session reports the real network. | `demo-routes`: "VW-DEMO-05"; mainnet: `docs/evidence/mainnet-check-2026-11-14.json` (refuses on mainnet) |
| VW-DEMO-06 | Global cap absent on the agent path | Agent payments go through the same reservation as visitor sends. | `demo-routes`: "VW-DEMO-06" |
| VW-PW-01 | Non-ASCII or punctuation phrases normalized to empty | Phrases keep letters and digits of every script. A phrase needs at least 4 of them, and an empty phrase never matches. | `security-units`: "VW-PW-01" |
| VW-PW-06 | PBKDF2 120k, 8-character floor, no AAD | New vault format v2: PBKDF2-SHA256 600,000 iterations, a 12-character minimum with a strength hint, and AAD binding each blob to account id, public key and slot. v1 blobs open and are re-encrypted as v2 on unlock. | `security-units`: "VW-PW-06" (v2 round trip, wrong-slot AAD rejected, v1 compatibility) |
| VW-IV-02 | "Extra confirm at or above" never changed anything | The threshold applies to every recipient, allowlisted ones included. The demo threshold is 0.2 NEAR. | `policy`, `demo-limits`: threshold tests; mainnet check: 0.05 needs the phrase |
| VW-IV-03 | Model recipient check was a substring match; amount unchecked | The recipient must be a whole account token the user said ("alice.evil.testnet" no longer passes for "alice.testnet"), and the amount must be a number (or simple number words) they said. Negated requests are refused. Otherwise the local parser decides. | `security-units`: "VW-IV-03" |
| VW-IV-04 | Account ids truncated at hidden characters; Unicode lowercasing remapped look-alikes | Account tokens must end at whitespace or ASCII punctuation. Messages with zero-width, bidi or combining characters are refused. Account ids are lowercased ASCII-only, so look-alikes stay invalid. | `security-units`: "VW-IV-04" |
| VW-IV-05 | Confirm phrase static, displayed, satisfiable by any transcript containing it | A spoken phrase must be the whole utterance. Every allowlist addition and every loosening policy change now needs the phrase (voice, text, the Safety panel and the "Add to allowlist" button). A personal wallet asks for "your confirm phrase" in a masked field instead of printing it. **Residual:** the personal-wallet phrase is not bound to a specific recipient and amount; the card shows both and the signer re-checks them. The demo phrase is public by design; its server-side binding is the token (VW-DEMO-04). | `security-units`: "VW-PW-02"; UI code in `WalletApp.tsx`, `SafetyPanel.tsx` |
| VW-AGENT-04 | `/api/agent/status` disclosed rules and logs anonymously | Status needs a visitor cookie and returns only that visitor's rules and logs, plus system entries. | `demo-routes`: "VW-AGENT-01 / VW-AGENT-04"; testnet e2e: anonymous status returns 401 |
| VW-WEB-01 | No CSP, frame-ancestors or X-Frame-Options; slide completed on Enter | CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy (mic self only), COOP. Enter and Space no longer confirm; keyboard users press the right arrow four times. | testnet e2e: page headers; browser load showed no CSP violations; `e2e/production.spec.ts` |
| VW-WEB-03 | No CSRF/origin or Content-Type enforcement | `middleware.ts`: cross-site `Sec-Fetch-Site`/`Origin` gives 403; JSON routes require `application/json` (415). | `security-units`: "VW-WEB-03"; testnet e2e: cross-origin 403, text/plain 415 |
| VW-WEB-04 | CI actions pinned by tag, default token, no build | Actions pinned to commit SHAs, `permissions: contents: read`, `persist-credentials: false`, a production build job. | `.github/workflows/ci.yml` |
| VW-ANDROID-01 | Auto Backup enabled with no rules | `allowBackup="false"`, `fullBackupContent="false"`, data-extraction rules excluding every domain. **Ships with APK 1.2.** | `AndroidManifest.xml`, `res/xml/data_extraction_rules.xml` |
| VW-ANDROID-02 | WebView granted every permission to any origin | Grants only microphone capture, and only to `https://vibe-wallet-flame.vercel.app`. Everything else is denied. **Ships with APK 1.2.** | `MainActivity.java` |
| VW-ANDROID-03 | APK is a shell for an unpinned remote origin | `allowNavigation` limited to the app host, a network security config (HTTPS only, system CAs only, no user-installed CAs), mixed content and WebView debugging off. Certificate pinning is not used, because the host's certificates rotate. **Ships with APK 1.2.** | `capacitor.config.ts`, `res/xml/network_security_config.xml` |
| VW-CRYPTO-01 | Concurrent sends reused a nonce; a retry after a timeout could pay twice | One signing operation per account at a time (in the tab and across tabs via Web Locks). The transaction hash is computed before broadcasting. After a failed send call the hash is looked up, so a send that landed reports as landed. An unknown outcome is remembered, and the next send waits until it settles. The server signer is serialized per instance and retries a nonce clash with a fresh nonce. | `demo-routes` (nonce clashes in the concurrency test are refused and released); testnet: both e2e hashes found on chain exactly as computed; mainnet: reconciliation of the 13 Nov proof hashes |

### Info

| ID | Finding | What changed |
| --- | --- | --- |
| VW-DEMO-07 | `clientIp` trusted the left-most `x-forwarded-for` | On Vercel: `x-real-ip` (set by the platform). Elsewhere: the right-most hop only. IPv6 is reduced to /64. Tested in `security-units`. |
| VW-PW-02 | Safety panel and "Add to allowlist" skipped the phrase | Both now open the phrase-gated allow card; loosening limits needs the current phrase. |
| VW-PW-03 | "Nothing is signed until you physically slide" was not literally true | The scoped-key AddKey is no longer automatic (it is a Safety-panel button that says it signs one transaction). The keyboard needs four deliberate steps. The README now names every way a send is confirmed. |
| VW-PW-04 | `run_agent` ignored the local kill switch; agent offered to personal wallets | `run_agent` refuses while sending is stopped. Agent rules are demo-only and say so for personal wallets. |
| VW-PW-05 | Personal daily counter was success-only | Spend is counted right before broadcast and returned only when the send certainly did not happen; an unknown outcome stays counted until reconciled. |
| VW-IV-06 | "never stop sending" triggered stop; model stop/run/quote needed no corroboration | Negation guard; model intents for stop, resume, run_agent, quote, set_limit and allow need a matching word in the user's text. Stop still needs no confirmation (it only ever stops). |
| VW-AGENT-05 | Dead config; rules cast without validation | `AGENT_STATE_BLOB_URL` removed. Rules, logs, counters and explorer links are schema-validated on every read (`demo-limits`: "stored rules and logs are validated on read"). |
| VW-WEB-05 | Cookie-issuing GET was `public` cacheable | All `/api` responses are `private, no-store`; the session GET no longer issues cookies. |
| VW-WEB-06 | No published APK checksum or certificate fingerprint | **Open, operator action:** build APK 1.2 with the release keystore, then publish its SHA-256 and signing-certificate fingerprint next to the download link. |
| VW-WEB-07 | Preview-deployment env scoping unverifiable from the repo | **Open, operator action:** in Vercel, scope `DEMO_NEAR_PRIVATE_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` and `NEAR_AI_API_KEY` to Production only, or enable Deployment Protection for previews. |
| VW-ANDROID-04 | APK unverifiable; no `FLAG_SECURE` | `FLAG_SECURE` added (ships with 1.2). Checksum and fingerprint: **open**, as VW-WEB-06. |
| VW-CRYPTO-02 | AddKey signed automatically on import/unlock | AddKey is opt-in (see VW-PW-03). |
| VW-CRYPTO-03 | `assertNoSecret` only matched `ed25519:` | Also catches bare base58 runs of 80+ characters (a 64-byte secret is ~88) and 12–24-word seed phrases, in the browser and again in `/api/intent`. Implicit 64-hex account ids pass. |

## README claims, after the fixes

| # | Claim | Now |
| --- | --- | --- |
| C1 | The AI never holds a key; it returns a typed intent only | Holds |
| C2 | A model-made recipient or amount that the user did not say is rejected | Holds (whole-token recipient, matching amount, negation guard) |
| C3 | Every send passes the policy, then needs your confirmation | Holds, with the confirmations named: the slide (or four arrow-key steps), a whole-utterance spoken "yes" for allowlisted sends below the threshold in hands-free mode, and the confirm phrase when required. Agent payments are confirmed once, when you slide to create the rule. |
| C4 | Personal wallet key encrypted in the browser, never sent to a server | Holds (vault v2) |
| C5 | Demo limits | Holds as published in the table above |
| C6 | The agent runs inside the same limits and stops with the kill switch | Holds |
| C7 | Mainnet is opt-in; Intents execution mainnet-only; in-app quotes `dry: true` | Holds; the demo signer additionally refuses mainnet |
| C8 | Scoped key: two view methods, 0.05 NEAR allowance, cannot transfer | Holds; now added only on request |
| C9 | API routes do not import the browser signer | Holds (the test now also passes on Windows) |
| C10 | No secrets in git | Holds |
| C11 | Nothing is signed without your action | Holds: no automatic AddKey, no one-key confirm, no unattended send except agent rules you created |

## Test results (14 November 2026)

| Check | Result |
| --- | --- |
| `npm test` (unit, route and security tests) | 79/79 passed |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors (6 existing `no-img-element` warnings) |
| `npm run build` | Passed, middleware included |
| Local production build against NEAR testnet (`scripts/e2e-http.mjs`) | 19/19 passed, two real transfers: [7Py477om…](https://testnet.nearblocks.io/txns/7Py477omDvYMysjMxYBo5GeiTLYnhVDuoSg8tb2RSEBv), [jgPVdXZa…](https://testnet.nearblocks.io/txns/jgPVdXZaVhgqaxGdbnTVE3rEhJFE8Dq49tVi2QfxZ2G) |
| NEAR mainnet, key-free (`npm run mainnet:check`) | 12/12 passed, nothing signed: [docs/evidence/mainnet-check-2026-11-14.json](evidence/mainnet-check-2026-11-14.json) |
| Playwright browser e2e | Not re-run for this change (Playwright browsers are not installed on the machine used). `e2e/production.spec.ts` was updated for the new keyboard confirm. |
