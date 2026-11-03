# outlayer/github-pr-verifier — TEE verifier WASM (Track B)

Rust `wasm32-wasip2` binary that runs inside OutLayer's Intel TDX workers
and proves a GitHub PR was actually merged — the trust anchor for the
PATCHPAY escrow contract ("Code ships. Payment follows.").

Implements ARCHITECTURE.md **§9 (SECURITY CORRECTIONS, authoritative)**:
fail-closed on any error/ambiguity; exact repo pin; strict response
validation; exact claim-line binding.

## 🔑 Verifier WASM hash (contract `verifier_wasm_hash` / OutLayer `version_key`)

```
bfb159945d7db097b28cf6bba938aec9ae2b09ef205c557ffd9ffee5e33ea198
```

- Binary: `target/wasm32-wasip2/release/github-pr-verifier.wasm`
  (395,979 bytes — under the 2 MiB FastFS limit)
- Built: `rustc 1.99.1`, `cargo build --target wasm32-wasip2 --release --locked`
- Reproduce: `./scripts/build_github_wasm.sh` (pinned toolchain; Docker
  route available via `--docker` when docker exists)
- The OutLayer worker refuses any bytes that don't match this hash.

## Interface contract (for Track A / contract)

- **stdin JSON:** `{bounty_id, nonce, repo, pr_number, expected_author,
  expected_branch, claimant, deadline_ns}` — `claimant` is the NEAR
  account that called `submit_pr` (never taken from PR text).
  - `deadline_ns` **or** `deadline` accepted (ns timestamps; the WASM
    accepts either key so the contract can use the scaffold's `deadline`
    name without breaking the §4 `deadline_ns` spec).
- **GitHub call:** `GET https://api.github.com/repos/{repo}/pulls/{pr_number}`
  — headers `Accept: application/vnd.github+json`,
  `User-Agent: patchpay-verifier`,
  `Authorization: Bearer $GITHUB_TOKEN` (token from an OutLayer encrypted
  secret → env var; without it the 60 req/hr shared-IP limit is a
  self-DoS risk).
- **Response hardening (§9.5):** body capped at **256 KiB**
  (`response_too_large`); strict JSON schema — only whitelisted fields
  are read and required fields must have the right type, else
  `bad_github_json`. No silent defaults.
- **Checks, in order, first failure wins (§9.5 + §9.1):**
  1. HTTP 200 → else `pr_not_found`
  2. `base.repo.full_name` EXACTLY equals input `repo` → else `wrong_repo`
  3. `base.ref == expected_branch` → else `wrong_branch`
  4. `expected_author == user.login` (when set; `user.login` is ALWAYS
     recorded as `pr_author`) → else `wrong_author`
  5. `merged == true` → else `not_merged`
  6. PR body contains a line exactly `Claim: <claimant>` (line-based,
     exact match — substring tricks like `Claim: alice.testnet.evil`
     do NOT satisfy claimant `alice.testnet`) → else `claim_not_in_body`
     (no claim line) / `claim_mismatch` (claim names someone else)
  7. `merged_at` valid RFC3339 and `<= deadline` → else `bad_merged_at` /
     `past_deadline` (malformed timestamp fails closed, never passes)
  8. `merge_commit_sha` present, 40-char hex → else `missing_merge_sha`
- **ANY** GitHub API error, missing field, or ambiguous/uncertain result
  → `verified: false` with a reason code. **Uncertain NEVER pays.**
- **stdout JSON (≤900 bytes):** `{bounty_id, nonce, verified, reason,
  pr_author, merge_commit_sha, merged_at, base_ref}` — `bounty_id`+`nonce`
  echo binds the attestation to the exact contract request (§9.8).

### ⚠️ Deliberate deviation from the Track A scaffold README

The scaffold listed `wasm_sha256` in the stdout schema. The WASM does
**not** self-report its hash: a binary can lie about its own hash, so a
contract must never trust it. The authoritative `SHA256(wasm)` comes from
the OutLayer attestation (worker-verified, hash-pinned `version_key`).
The hash above is the value to pin in `set_verifier_wasm_hash`.

## Test results (2026-11-03)

- **Host unit tests** (`cargo test`): **19/19 pass** — full check matrix,
  check ordering (first-failure-wins), exact-claim matching incl. the
  prefix-attack case, oversized/malformed/wrong-typed payload rejection,
  RFC3339 conversion spot-checks, output ≤900 bytes, nonce echo,
  `deadline`/`deadline_ns` alias.
- **WASM-under-wasmtime tests** (`scripts/test_local.sh`, mock GitHub API
  serving byte-realistic fixtures recorded from api.github.com):
  **18/18 pass** — happy path (`verified:true, reason:"ok"`,
  `pr_author` recorded) plus every fail-closed case above, header
  assertions (`Accept`/`User-Agent` exact, `Authorization: Bearer`
  sent only when `GITHUB_TOKEN` is set), and all outputs ≤900 bytes.
- **Fixtures:** real PRs from `out-layer/outlayer` (#30 merged,
  #27 merged, #29 closed-unmerged) + synthesized edge cases.

## Real cost per verification (testnet, queried live)

`estimate_execution_cost` on `outlayer.testnet` (2026-11-03):

| Resource limits | Cost |
|---|---|
| 1B instr / 128 MB / 60 s (defaults), 220 B input | **0.0070 NEAR** |
| 500M instr / 128 MB / 30 s (tight), 220 B input | **0.0040 NEAR** |

Suggested `verify_budget` sizing for the contract (§9.4): **0.01 NEAR
per attempt** at default limits (margin included), or 0.005 NEAR with
tight limits; 3-attempt cap → ~0.03 NEAR worst case per bounty.

## Deploy (testnet)

```bash
./scripts/build_github_wasm.sh
outlayer upload target/wasm32-wasip2/release/github-pr-verifier.wasm  # → FastFS URL + SHA256
outlayer deploy patchpay-verifier <FastFS URL>                        # → project + version (named by SHA256)
```

Then: store the GitHub PAT as an OutLayer encrypted secret bound to the
WASM hash (see SECRETS.md — Rohit's step), and set the escrow
contract's `verifier_wasm_hash` to the hash above.

**Blocked on Rohit:** `outlayer login testnet` needs his testnet account
key; the GitHub PAT is his step (SECRETS.md). Nothing here needs them
until deploy.

## Files

| Path | What |
|---|---|
| `src/main.rs` | Verifier (~450 lines incl. docs; pure `verify()` + WASI I/O) |
| `src/tests.rs` | 19 host unit tests |
| `scripts/build_github_wasm.sh` | Reproducible build (pinned toolchain / Docker) |
| `scripts/test_local.sh` | wasmtime + mock-GitHub test suite (18 cases) |
| `scripts/mock_github.py` | Mock GitHub API for local tests |
| `fixtures/` | Real + synthesized PR fixtures |
| `SECRETS.md` | What Rohit must provide (PAT spec, storage, never-commit rules) |
| `github-pr-verifier.wasm.sha256` | Pinned hash for the contract |
