# tests

- Contract unit tests live with the contract: `contracts/near-escrow/src/lib.rs`
  (`#[cfg(test)]`) — run with `cargo test`. They cover create/cancel/refund flows,
  `submit_pr` validation (deadline, status, attempt cap, budget), callback
  predecessor rejection, nonce-mismatch and version-mismatch rejection,
  the safe payout state machine (never paid before transfer confirmation),
  payout-failure recovery (bounded retry + receiver recovery), the §9.6
  adversarial matrix (refund-vs-callback race, concurrent submitters with nonce
  isolation, duplicate callbacks), `resolve_timeout`, transfer retry bounds, and
  storage-fee coverage of the worst-case record.
- Integration tests (testnet, Track B): full create → submit → TEE verify → payout
  flow against `outlayer.testnet` with the real verifier WASM.
- Security tests: forged callback (wrong predecessor), replayed result, duplicate
  payout attempt — the contract must reject all without state corruption.
- e2e: frontend + contract + GitHub + OutLayer (later track).
