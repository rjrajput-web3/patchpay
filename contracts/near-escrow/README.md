# patchpay-escrow — NEAR escrow contract

Rust (`near-sdk` 5) contract implementing ARCHITECTURE.md **§9** (authoritative).

## Build & test

```bash
cargo test                                  # unit tests (state machine, races, bounds)
cargo near build                            # wasm -> target/near/patchpay_escrow.wasm
# fallback: cargo build --target wasm32-unknown-unknown --release
```

## Interface

**Change methods**

| Method | Access | Effect |
|---|---|---|
| `new(owner)` | init | sets owner + default config |
| `create_bounty(args)` | payable `reward + verify_budget + storage_fee` | validates, measures storage, stores `Bounty{Open}` |
| `cancel_bounty(bounty_id)` | creator, `Open` | → `Cancelled`, refund via retryable transfer |
| `submit_pr(bounty_id, pr_number)` | anyone, `Open` && before deadline | deducts attempt + fee, stores `Submission{Pending}`, calls `outlayer.testnet.request_execution` (pinned `version_key`, block-height timeout) |
| `on_verification_result(bounty_id, nonce)` | `#[private]`, OutLayer only | nonce + version + eligibility checks → `VerificationPassed` + payout start, or reject → `Open` |
| `on_transfer_result(transfer_id)` | `#[private]`, self only | confirms transfer → `PayoutSucceeded`, or `PayoutFailed` (retryable) |
| `retry_transfer(transfer_id)` | anyone, bounded | re-fires a failed transfer |
| `recover_transfer(transfer_id)` | recipient only, after bound | explicit recovery |
| `resolve_timeout(bounty_id)` | anyone, after `timeout_height` | stuck submission → `TimedOut`, bounty → `Open` |
| `claim_refund(bounty_id)` | creator, after deadline | → `Refunded`, refund via retryable transfer |
| `set_outlayer_contract` / `set_verifier_wasm_hash` / `set_fee_params` | owner | config values only — no fund movement |

**Views:** `get_bounty`, `list_bounties(status?, page, limit)`, `get_submission`,
`get_transfer`, `get_config`, `get_owner`.

## Invariants (tested)

- Payout receiver is ALWAYS the `submit_pr` caller — never PR text.
- Bounty is NEVER marked paid before the transfer-result callback confirms.
- Late/duplicate callbacks are no-ops; they can never pay a terminal bounty.
- Every outgoing transfer is ledgered (`PendingTransfer`) and retryable; funds
  are never silently lost.
- No admin fund-withdrawal path exists.
