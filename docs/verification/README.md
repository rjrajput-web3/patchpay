# Verification

How to independently verify a PATCHPAY payout (Track B completes the tooling):

1. **On-chain:** bounty `Paid` event (`EVENT_JSON` log) on the escrow contract;
   `get_bounty` / `get_submission` views show the final state.
2. **GitHub:** the PR is `merged`, `base.ref` matches, author matches, PR body
   contains `Claim: <near-account>`, `merged_at <= deadline` — all public facts.
3. **Attestation:** each execution attests SHA256(wasm) + SHA256(input) +
   SHA256(output) + worker identity (TDX measurements) + Intel-signed TDX quote
   with the Task Hash embedded in REPORTDATA. Verify via the OutLayer dashboard
   "Verify" button (DCAP WASM build) or `outlayer-verify tx <near-tx-hash>`
   (no account needed).

**TODO (Track B):** record the real `verifier_wasm_hash`, the reproducible-build
script (`scripts/build_github_wasm.sh`), and a worked attestation example here.
