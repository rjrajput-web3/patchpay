# apps/web — PATCHPAY frontend (Track C)

Next.js 14 (App Router) + TypeScript + Tailwind. NEAR testnet.

## Pages

| Route | Page |
|---|---|
| `/` | Landing: hero, how-escrow-works, TEE explainer, payout flow, FAQ, CTA, live marketplace preview |
| `/bounties` | Marketplace: search / filter / sort over live contract data |
| `/bounties/[id]` | Bounty detail: payout-state timeline, attempts, fee budget, submissions, cancel/refund/timeout/retry actions |
| `/bounties/new` | Create bounty form + **review screen** before signing |
| `/bounties/[id]/submit` | Submit PR: claim-line instructions + verification status tracker |
| `/dashboard` | Escrow dashboard: totals, locked NEAR, pending verifications, payouts, expiries, refunds, your tx log |
| `/proof/[bountyId]/[nonce]` | **Public** proof center — read-only, no wallet needed |

Wallet connection is a **modal** (not a page), via `@near-wallet-selector`
(+ `@near-wallet-selector/react-hook`) — official NEAR standard.
External wallets only: no creation, no import, no seed/private-key handling,
no custodial signing, no auto-sign. Every state-changing action shows a review
screen, then `signAndSendTransaction`, then explicit wallet approval.

## Contract wiring

All wiring lives in `lib/config.ts`:

- `CONTRACT_ACCOUNT` — **PLACEHOLDER** (`patchpay.testnet`). Track A deployment
  is pending funding. After deploy: one-line change (or set
  `NEXT_PUBLIC_CONTRACT_ACCOUNT`). Also flip `CONTRACT_DEPLOYED = true`.
- `OUTLAYER_CONTRACT = "outlayer.testnet"`
- `VERIFIER_WASM_HASH = "b17ae0f6fa374e71b56fe196e2101f6a7528cf0b3a2987e6d440bcd8202801a7"`

View calls use `near-api-js` (`get_bounty`, `list_bounties`, `get_submission`,
`get_transfer`, `get_config`). If the contract account doesn't exist, the app
throws `ContractNotDeployedError` internally and renders an informational
banner — never a crash, never mock data.

## Brand

New PATCHPAY identity (nothing from VAULTRY/SpactVault): warm off-white
paper, charcoal/deep-ink type, restrained orange accent, editorial
developer-tool aesthetic. No gradients.

## Dev

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # must pass with zero errors
npm run typecheck
```

Env (see `.env.example`): `NEXT_PUBLIC_NETWORK_ID`, `NEXT_PUBLIC_CONTRACT_ACCOUNT`,
`NEXT_PUBLIC_NODE_URL`, `NEXT_PUBLIC_EXPLORER_URL`. No secrets, no hardcoded localhost.
