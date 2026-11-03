# Security

Implements ARCHITECTURE.md §9 (authoritative). Read the contract at
`contracts/near-escrow/src/lib.rs` — every claim below maps to code + unit tests.

## Trust model

- **The OutLayer worker never moves funds.** It returns a verification verdict; the
  NEAR contract independently decides payout. A compromised/malicious verifier can
  at worst deny payouts (availability), never steal escrowed NEAR.
- **Callback authentication:** `on_verification_result` is `#[private]` and asserts
  `predecessor == config.outlayer_contract`. `on_transfer_result` asserts
  `predecessor == current_account_id` (self only). Only the configured OutLayer
  contract can trigger payout logic.
- **Claimant binding (§9.1):** payout receiver is ALWAYS the `submit_pr` caller.
  `input_data.claimant` = submitter; the WASM must find exactly
  `Claim: <submitter>` in the PR body; GitHub `user.login` is recorded and checked
  against `expected_author` when set. Front-running a PR number cannot redirect
  funds: the caller's account is the only possible recipient.
- **Safe payout (§9.2):** `VerificationPassed → PayoutPending → PayoutSucceeded`.
  The bounty is marked paid ONLY in the transfer-result callback after the NEAR
  transfer confirms. `PayoutFailed` keeps funds locked with `retry_transfer`
  (bounded, permissionless) and `recover_transfer` (receiver-only explicit
  recovery). No silent loss, no stuck-forever.
- **Timeouts (§9.3):** every verification carries a block-height deadline
  (`timeout_height`, default 1800 blocks). `resolve_timeout` marks the submission
  `TimedOut` and re-opens the bounty — never stuck waiting for a callback.
  Late/duplicate callbacks are state-checked no-ops: a callback for a bounty that
  is `PayoutSucceeded`/`Cancelled`/`Refunded`/`Expired`, or a submission that is
  not `Pending`, changes nothing and pays nothing.
- **Replay / double-payout protection:** per-submission nonce
  (`bounty.submission_count` at submit time) echoed by the verifier and asserted
  in the callback; a result resolves only a `Pending` submission on a
  `VerificationPending` bounty; terminal states are one-way; transfer callbacks
  resolve only `InFlight` transfers.
- **Attempt limits + fee accounting (§9.4):** max 3 verification attempts per
  bounty; each attempt deducts `verification_fee` from the on-chain budget and
  records `fee_charged` on the submission. Exhausted budget/attempts → no further
  verifications; cancel/refund still allowed. Prevents budget-exhaustion griefing.
- **Attestation binding (§9.8):** the request pins `version_key` = WASM SHA256;
  the callback asserts the echoed version whenever the payload carries it.
  Proof Center displays bounty ID, nonce, WASM/input/output SHA256, worker
  identity/measurements, TDX quote reference, and all tx hashes.
- **No admin backdoor:** the owner can update `outlayer_contract`,
  `verifier_wasm_hash`, and fee params only. No method transfers arbitrary funds
  to the owner or anyone else.
- **No secrets in repo:** `.gitignore` blocks `.env`, `*.key`, `*.pem`; the GitHub
  token lives as an OutLayer encrypted secret (env var inside TEE), never on-chain
  or in frontend code.
- **Wallet policy:** external wallets only — no creation/import, no seed or
  private-key input/storage, no custodial or automatic signing.

## Known limitations / honest approximations

- Attestation proves *what ran*, not that the verifier logic is correct — the Track B
  WASM must be reviewed; reproducible builds let anyone confirm hash ↔ source.
- **Per-attempt fee is an estimate** (`verification_fee`, default 0.05 NEAR): the
  contract deducts it up-front because the exact OutLayer execution cost is not
  knowable on-chain at submit time. OutLayer refunds unused deposit to the contract.
  Refine with real `estimate_execution_cost` data in Track B.
- **Callback payload shape** is still an open question; the contract parses
  defensively (direct JSON, JSON-in-string, or nested under
  `output`/`stdout`/`result`/`data`) and fail-closes to reject on ambiguity.
  Track B integration tests must pin the exact shape.
- **Version assertion is best-effort** until the payload shape is confirmed: when
  the output carries `wasm_sha256`/`version_key` it is asserted against the pinned
  hash; otherwise we rely on OutLayer's hash-pinned execution.
- `submit_pr` is unusable on-chain until the owner sets the real
  `verifier_wasm_hash` (currently `UNSET_TRACK_B_PENDING`).
- GitHub API rate limits from TEE egress IPs are mitigated by the token; without it
  the 60 req/hr shared-IP limit is a self-DoS risk.
- Storage fee (default 0.02 NEAR) covers the measured worst-case bounty record;
  see `docs/deployment/` for the measured bytes. The fee is non-refundable (it
  pays for persistent on-chain state).
