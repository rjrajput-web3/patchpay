# Architecture

System components and data flow (full design: `~/workspace/patchpay/ARCHITECTURE.md`;
**§9 SECURITY CORRECTIONS are authoritative** and implemented in
`contracts/near-escrow/src/lib.rs`).

```
Creator ──create_bounty (reward + verify_budget + storage_fee)──▶ NEAR ESCROW
Developer ──submit_pr(bounty, pr#) ────────────────────────────▶   │ request_execution
  payout receiver is ALWAYS the submitter (§9.1)                   │ (pinned version_key,
                                                                  │  block-height timeout)
                                                                  ▼
                                                          outlayer.testnet ──▶ TEE worker
                                                                  │ resolve_execution
                                                                  ▼
                                                          on_verification_result (private)
                                                          predecessor + nonce + version checks
                                                          verified+eligible?
                                                            YES → VerificationPassed
                                                            NO  → Rejected, bounty → Open
                                                                  │
                                                                  ▼
                                                          SAFE PAYOUT (§9.2)
                                                          VerificationPassed → PayoutPending
                                                            → transfer-result callback
                                                            → PayoutSucceeded (terminal)
                                                            ↘ transfer failed → PayoutFailed
                                                              → retry_transfer (bounded)
                                                              → recover_transfer (receiver)
```

## State machines

**Bounty:** `Open → VerificationPending → VerificationPassed → PayoutPending →
PayoutSucceeded` (terminal). Recoverable branches: `VerificationPending → Open`
(reject/timeout), `PayoutPending → PayoutFailed → PayoutPending` (retry).
Terminal exits: `Cancelled`, `Refunded` (via retryable transfers).

**Submission:** `Pending → Verified | Rejected | TimedOut`.

**Transfer (every outgoing payment):** `InFlight → Done | Failed → InFlight`
(retry, bounded) — funds are never silently lost (§9.7).

## Key rules

- **Claimant binding (§9.1):** payout → `submit_pr` caller only; `input_data.claimant`
  = submitter; the WASM must find `Claim: <submitter>` in the PR body; GitHub
  `user.login` recorded and checked against `expected_author` when set.
- **Timeouts (§9.3):** each verification carries `timeout_height` (default 1800
  blocks); `resolve_timeout` re-opens stuck bounties. Late/duplicate callbacks are
  state-checked no-ops — they can NEVER pay a terminal bounty. Nonce echo checked.
- **Attempts + fees (§9.4):** max 3 verification attempts per bounty; each deducts
  `verification_fee` (conservative estimate of the OutLayer cost) from the budget
  on-chain; budget/attempts exhausted → no more verifications, cancel/refund still
  allowed.
- **Attestation binding (§9.8):** `version_key` = WASM SHA256 pinned in the request;
  the callback asserts the echoed version when the payload carries it.
- **Owner powers:** update `outlayer_contract`, `verifier_wasm_hash`, fee params —
  values only. **No fund-withdrawal path exists.**
- **Submitter concurrency:** one in-flight verification per bounty at a time;
  sequential submissions by different submitters are isolated by nonce — only the
  verified one pays.

## Contract interface

`create_bounty(args)` (payable: `reward + verify_budget + storage_fee`) ·
`cancel_bounty(bounty_id)` (creator, Open → Cancelled + refund transfer) ·
`submit_pr(bounty_id, pr_number)` (Open && before deadline → Pending submission,
attempt + fee deducted, OutLayer call) ·
`on_verification_result(bounty_id, nonce)` (private; OutLayer only) ·
`on_transfer_result(transfer_id)` (private; self only) ·
`retry_transfer(transfer_id)` (bounded) · `recover_transfer(transfer_id)`
(receiver-only explicit recovery) ·
`resolve_timeout(bounty_id)` (after timeout height) ·
`claim_refund(bounty_id)` (creator, after deadline) ·
views: `get_bounty`, `list_bounties`, `get_submission`, `get_transfer`,
`get_config`, `get_owner`.
