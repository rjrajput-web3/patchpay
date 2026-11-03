# Deployment

## Testnet (current)

- Contract account: `patchpay.p2deployer.testnet` (subaccount of `p2deployer.testnet`)
- RPC: `https://rpc.testnet.fastnear.com`
- Build: `cd contracts/near-escrow && cargo near build` (or `cargo build
  --target wasm32-unknown-unknown --release` as fallback)
- Deploy script: `node scripts/deploy-testnet.mjs` (reads deployer key from a
  600-permission file — never committed)
- Init: `new({ "owner": "p2deployer.testnet" })`
- Config: `outlayer_contract = "outlayer.testnet"`,
  `verifier_wasm_hash` = the current Track B build hash
  (`outlayer/github-pr-verifier/github-pr-verifier.wasm.sha256`; pinned at deploy
  via `set_verifier_wasm_hash` by `scripts/deploy-testnet.mjs`; the contract's
  compiled default is still `UNSET_TRACK_B_PENDING` until the owner sets it)

## Storage economics (§9.7, measured)

Worst-case bounty record (max title/description/repo/branch/author, Borsh):
**1579 bytes → 0.01579 NEAR** at 1e19 yocto/byte. The flat `storage_fee`
(0.02 NEAR, collected at `create_bounty`) covers this with ~27% margin for trie
overhead. Measured by `cargo test storage_fee_covers_worst_case_record`
(`contracts/near-escrow/src/lib.rs`). The fee is non-refundable — it pays for
persistent on-chain state.

## Pre-mainnet checklist

- [ ] Track B verifier WASM audited + reproducible build (hash ↔ source verified)
- [ ] `set_verifier_wasm_hash` to the real SHA256 on testnet; full e2e
      (create → submit → TEE verify → payout → proof page)
- [ ] Adversarial tests: forged callback, replayed result, wrong nonce, expired
      mid-verification, OutLayer timeout, duplicate submission
- [ ] Confirm actual per-verification NEAR cost via `estimate_execution_cost`
- [ ] Security review of `contracts/near-escrow/src/lib.rs`
- [ ] Owner explicitly approves the exact mainnet deployment + funding transaction
