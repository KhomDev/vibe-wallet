# Vibe Wallet — NEAR Hackathon submission draft

This is a draft only. Do not submit the official form, create a public repo, or post on X until Sina explicitly says yes.

## Entry

- **Name:** Vibe Wallet
- **One-liner:** A personal NEAR testnet voice wallet you control by talking to a holographic orb, with slide-to-confirm and a kill switch that also stops the agent.
- **Live URL:** https://vibe-wallet-flame.vercel.app
- **Android APK:** https://vibe-wallet-flame.vercel.app/download/vibe-wallet.apk
- **Demo video:** `/workspace/vibe-wallet/demo/vibe-wallet-demo.mp4` (about 2 minutes, with captions at `vibe-wallet-demo.srt`)
- **Source (local only):** `/workspace/vibe-wallet/app-v4` — a local git repo is ready to push. No public repository has been created.
- **Other entry by the same author:** TBD (required in the README before official submission; at most two projects per person).

## What judges should do

1. Open the live URL on a phone, or scan the QR on the desktop landing.
2. Tap **Try a demo account**. The private key never enters the browser.
3. Send a small amount (example chips are allowlisted and under the 0.3 NEAR cap). Slide to confirm. Open the testnet explorer link.
4. Try a blocked payment, such as `Send 5 NEAR to …` or a recipient that is not on the allowlist. The orb goes into a blocked state and says why.
5. Add a Friday or daily payment, and a price rule such as `If NEAR drops below $10000, swap 0.1 NEAR to USDC`. Press **Run agent now**. Scheduled sends are real testnet transfers. Price rules are **quote only** — NEAR Intents have no testnet execution.
6. Turn on **Stop all sending**. The agent will not run until you resume.

## NEAR use

- Real testnet native transfers, with explorer links.
- NEAR AI Cloud intent parse (`z-ai/glm-5.3-flash`), with a local parser fallback.
- NEAR Intents 1Click quotes with `dry: true`, labeled quote-only.
- Function-call access keys on `wrap.testnet` for personal wallets; demo signing is server-side only.

## Honest labels

| Action | Real or simulated |
| --- | --- |
| Demo and personal native NEAR sends on testnet | Real testnet transactions |
| Scheduled agent payments | Real testnet transactions, inside limits |
| Swap / price-trigger | Real dry Intents quote only. No swap is executed |
| Mainnet | Never used |

## Team and accounts

- Deployed on Sina Jalilian’s Vercel team `sinajalilian03`, project `vibe-wallet`.
- Not deployed on the khomdev account.
