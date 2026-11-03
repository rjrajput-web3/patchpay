# PATCHPAY — Code ships. Payment follows.

GitHub bounty escrow on NEAR with TEE-verified PR merges.

A bounty creator locks NEAR in an on-chain escrow contract. A developer completes the
work and submits a GitHub Pull Request. An OutLayer TEE worker verifies the PR was
actually merged (repo, author, branch, merge state, merge time — all server-side GitHub
facts), and the NEAR contract independently validates the attested result before
releasing payment. **A GitHub merge becomes a verifiable payment trigger.**

Built for the NEAR **Build Beyond Boundaries** hackathon (Nov 1–14, 2026).
**TESTNET ONLY** during development — no mainnet, no real funds.

## Repo layout

```
/apps
  /web        — frontend (wallet-selector, marketplace, dashboards) — separate track
  /api        — backend (GitHub OAuth/webhooks, queue) — minimal placeholder
/contracts
  /near-escrow — NEAR escrow contract (Rust, near-sdk) — THIS TRACK
/outlayer
  /github-pr-verifier — TEE WASM verifier (Track B)
/packages
  /shared     — shared TS/Rust helpers
  /types      — shared type definitions
/docs
  /architecture — system design + contract interface
  /security     — threat model, assumptions, audit notes
  /deployment   — testnet/mainnet deployment runbooks
  /verification — verifier build + attestation verification guide
/tests        — contract, integration, security, e2e tests
```

## Quick start (contract)

```bash
# Rust toolchain + cargo-near required
cd contracts/near-escrow
cargo test                                  # unit tests
cargo near build                            # build wasm -> target/near/
```

Testnet deploy (needs funded testnet deployer key — never commit it):

```bash
node scripts/deploy-testnet.mjs   # see docs/deployment/
```

## Contract interface (summary — implements ARCHITECTURE.md §9)

- `create_bounty(args)` — payable `reward + verify_budget + storage_fee`; stores `Bounty{Open}`
- `cancel_bounty(bounty_id)` — creator, Open only → `Cancelled`, refund via retryable transfer
- `submit_pr(bounty_id, pr_number)` — anyone, Open && before deadline → stores
  `Submission{nonce}`, deducts one attempt + fee from the budget (max 3 attempts),
  sets `VerificationPending`, calls `outlayer.testnet.request_execution` with
  hash-pinned verifier version + JSON input (claimant = submitter) + block-height timeout
- `on_verification_result(bounty_id, nonce)` — `#[private]`, OutLayer only; asserts
  echoed nonce + pinned version, eligibility → `VerificationPassed` (starts safe payout)
  or reject → `Open`. Late/duplicate callbacks are no-ops.
- Safe payout: `VerificationPassed → PayoutPending → PayoutSucceeded`, confirmed by
  the `on_transfer_result` callback — NEVER marked paid before confirmation;
  `PayoutFailed` recovers via bounded `retry_transfer` / receiver-only `recover_transfer`
- `resolve_timeout(bounty_id)` — re-opens bounties stuck waiting for a callback
- `claim_refund(bounty_id)` — creator, after deadline → `Refunded`, refund via retryable transfer
- Every outgoing transfer is ledgered and retryable — funds are never silently lost
- Views: `get_bounty`, `list_bounties`, `get_submission`, `get_transfer`, `get_config`

Full interface: [`docs/architecture/`](docs/architecture/).
Security model: [`docs/security/`](docs/security/).

## Wallet policy (final)

External NEAR wallets only (`@near-wallet-selector`). **No wallet creation, no import,
no seed/private-key input or storage, no custodial signing.** Every state-changing
action shows a review screen first; nothing signs without explicit user approval.

## Status

- [x] Track A: escrow contract + unit tests + testnet deploy
- [ ] Track B: OutLayer `github-pr-verifier` WASM + real `verifier_wasm_hash`
- [ ] Frontend (`apps/web`) + backend (`apps/api`)
- [ ] Full testnet e2e (create → submit → TEE verify → payout → proof page)

## License

MIT — see [LICENSE](LICENSE).
