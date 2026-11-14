# Mainnet proof

The deployed Vibe Wallet runs on NEAR testnet so anyone can try it without real money. To show that the same code works with real value, two tiny mainnet actions were executed on 13 November 2026 (afternoon, Europe/Budapest, CET, UTC+1) with `app-v4/scripts/mainnet-proof.ts`.

Account: [`hlpok1lad.tg`](https://nearblocks.io/address/hlpok1lad.tg). Total cost: about 0.04 NEAR (0.01 NEAR went to the team's own sub-account `gateway.hlpok1lad.tg`, 0.03 NEAR was swapped to USDC, plus gas).

## 1. Native transfer through the wallet signer

`executeTransfer` from `lib/near/signer.ts`, the same function the browser wallet uses, with a strict policy: allowlist-only (recipient on the list), 0.05 NEAR per transaction, 0.2 NEAR per day, confirm flag required, and a check that the key is a full-access key for the account.

- 0.01 NEAR → `gateway.hlpok1lad.tg`: https://nearblocks.io/txns/A4yAYiZCYoS5QD5m6bq8bchBcBYZdVP7eZbMCkEcEXyu

## 2. Executed NEAR Intents swap (1Click)

`executeIntentsSwap` from `lib/server/intents-swap.ts`:

1. Requests a live quote (`dry: false`) for NEAR → USDC with `recipientType: DESTINATION_CHAIN` and gets a deposit address.
2. Wraps the shortfall of NEAR into wNEAR (`near_deposit` on `wrap.near`).
3. Registers storage for the deposit address and sends wNEAR to it with `ft_transfer`.
4. Calls `/deposit/submit`, then polls `/status` until `SUCCESS`, `REFUNDED`, or `FAILED`.

Result: 0.03 NEAR → 0.106562 USDC, status `SUCCESS`, slippage 8 bps.

| Step | Transaction |
| --- | --- |
| Wrap 0.03 NEAR | https://nearblocks.io/txns/8w76GGqBDSchTfpqrT8W5cGxvmNtu7uSzN4AaiMwoAVE |
| Deposit wNEAR to the 1Click deposit address | https://nearblocks.io/txns/AbmBP4bSxeoSS3eNZ6zvZmgD3stsXK1JdhaQqgTCMZv2 |
| USDC delivered to `hlpok1lad.tg` | https://nearblocks.io/txns/8ZSc3Uhnif6NB9emVHtqv7iXXJW6kvZio5u2aMwkJw5c |

Intent hashes reported by 1Click: `E9oyeSUEaFooJsrQFTkFuTQTWrgqiM7c9UgX2kZ7u5AX`, `2Yyk63iypEFrop2MZ6E9yDm7RLqh7BpyGMfqyLG1JrFG`.

## Mainnet check of the 14 November logic (no key, nothing signed)

After the security remediation (see [SECURITY-REVIEW-2026-11-14.md](SECURITY-REVIEW-2026-11-14.md)) the changed
logic was run against live NEAR mainnet with `npm run mainnet:check` (`app-v4/scripts/mainnet-check.ts`). It
needs no private key and signs nothing. Result on 14 November 2026: **12/12 passed, 0 transactions signed,
0 broadcast**. Full output: [evidence/mainnet-check-2026-11-14.json](evidence/mainnet-check-2026-11-14.json).

| Check | Result |
| --- | --- |
| RPC is mainnet | `free.rpc.fastnear.com` reports `chain_id: mainnet` |
| Shared-demo signer on mainnet | Refuses: "The shared demo account only signs on testnet..." |
| Live balance and recipient | `hlpok1lad.tg` 2.125 NEAR available; `gateway.hlpok1lad.tg` exists; fee estimate 0.0000446 NEAR |
| Policy: 0.01 NEAR to the allowlisted recipient | Allowed, slide only |
| Policy: 0.05 NEAR (at the extra-confirm threshold) | Allowed, needs the confirm phrase (the threshold now applies to allowlisted recipients) |
| Policy: 0.06 NEAR | Blocked, over the 0.05 NEAR per-send cap |
| Policy: unknown recipient, allowlist-only | Blocked |
| Full-access key on chain | 1 full-access key, which is what `executeTransfer` verifies before signing |
| Reconciliation by hash (what the signer does after a send call fails) | `A4yAYiZC...`, `8w76GGqB...`, `AbmBP4bS...` all found and reported as landed, via `archival-rpc.mainnet.fastnear.com` |
| NEAR Intents 1Click quote | `dry: true`, 0.03 NEAR to about 0.1027 USDC, no deposit address |

To repeat it:

```sh
cd app-v4
npm run mainnet:check -- hlpok1lad.tg gateway.hlpok1lad.tg ../docs/evidence/mainnet-check.json
```

The new signer path (per-account lock, pre-broadcast hash, reconciliation) also sent two real testnet
transfers through the local production build. Both hashes the app computed before broadcasting are the
hashes testnet recorded ([evidence/testnet-e2e-2026-11-14.json](evidence/testnet-e2e-2026-11-14.json)).

## Mainnet mode

- `lib/config.ts` reads `NEXT_PUBLIC_NEAR_NETWORK` (or `NEAR_NETWORK` for scripts). Only the exact value `mainnet` switches; anything else is testnet.
- RPC, NearBlocks explorer and indexer URLs, the scoped-key contract (`wrap.near` vs `wrap.testnet`) and bare-name resolution (`bob` to `bob.near`) follow the network.
- The shared demo signer never signs on mainnet: it checks both the build setting and the node's `chain_id`.
- `executeIntentsSwap` refuses to run unless the network is mainnet and the user confirmed, and caps the amount (`maxNear`).
- Unit tests in `tests/network.test.ts` cover the default, the switch, the URLs, and the testnet refusal; `tests/demo-routes.test.ts` covers the demo signer refusing a non-testnet node.

## Reproduce the real mainnet transactions

This moves real NEAR, so the script refuses to run without `--broadcast`. Keys come from the environment and are never printed or committed. `--skip-swap` sends only the transfer.

```sh
cd app-v4
NEAR_NETWORK=mainnet \
MAINNET_ACCOUNT_ID=<your-account.near> \
MAINNET_PRIVATE_KEY=ed25519:<secret> \
PROOF_RECIPIENT=<allowlisted-recipient.near> \
npx tsx scripts/mainnet-proof.ts --broadcast
```

Optional: `PROOF_SEND_NEAR` (default 0.01) and `PROOF_SWAP_NEAR` (default 0.03, capped at 0.05).
