# Vibe Wallet

Source lives in `app-v4/`. Submission draft: `SUBMISSION.md`. Demo video: `demo/vibe-wallet-demo.mp4`.

Live: https://vibe-wallet-flame.vercel.app

This local git repository is ready to push. No public remote has been created.

## Sister project

Our team also built [TriagePay](https://github.com/KhomDev/TriagePay) at NEAR HACKATHON ([live demo](https://triagepay-demo.vercel.app)).

How the two differ:

- **Vibe Wallet is for people.** You talk to your NEAR wallet in plain words. NEAR AI turns what you say into a payment, a scheduled payment, a price rule or a swap quote, and you confirm with a slide.
- **TriagePay is for AI agents.** It's a policy wallet contract that lets an agent pay per API call over x402. Its limits, payee allowlist and owner review live on chain, so a prompt-injected agent's payment to an attacker is refused by the contract.

Both put guardrails between an AI and your money. In Vibe Wallet you approve each payment yourself, while in TriagePay the smart contract enforces the limits.
