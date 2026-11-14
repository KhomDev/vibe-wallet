# Vibe Wallet (app)

This directory is the Next.js app, API routes, middleware, and the Capacitor Android project.

The judge-facing README, architecture, security and test notes live at the repository root:

- [README.md](../README.md)
- [SECURITY.md](../SECURITY.md) and [docs/SECURITY-REVIEW-2026-11-14.md](../docs/SECURITY-REVIEW-2026-11-14.md)
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- [docs/TESTING.md](../docs/TESTING.md)

```sh
npm install
cp .env.example .env.local
npm run dev          # http://127.0.0.1:43123
npm test             # unit, route and security tests (no network, no secrets)
npm run lint
npm run typecheck
npm run build
npm run mainnet:check   # key-free check against NEAR mainnet; signs nothing
```

The shared demo needs a testnet demo account (`DEMO_NEAR_*` in `.env.example`). Locally, without
`BLOB_READ_WRITE_TOKEN`, demo state is kept in a JSON file (`AGENT_STATE_PATH`, default in the OS temp
directory). On Vercel, demo sends refuse to run without the Blob token.

Live app: https://vibe-wallet-flame.vercel.app
