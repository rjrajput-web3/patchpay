# apps/web — PATCHPAY frontend (separate track)

Intentionally empty in Track A. The frontend track builds here:

- Landing, marketplace, bounty details, create-bounty flow
- Wallet via `@near-wallet-selector` — **external wallets only** (no create/import,
  no seed or private-key input, no custodial signing)
- Developer workspace, PR submission, verification progress, escrow dashboard,
  proof center, payout/refund history, security page, docs, FAQ

Every displayed bounty/balance must come from live contract data — no hardcoded
fake listings.
