# PATCHPAY — Evidence Report: Deploy + Testnet E2E (2026-11-03)

**Status:** Contract + TEE verifier DEPLOYED and working. Full TEE→payout callback BLOCKED by OutLayer testnet limitation (verified, documented below). All other components proven with real on-chain transactions.

---

## 1. Deployed Components

### Escrow Contract
- **Account:** `patchpay.p2deployer.testnet`
- **Code hash:** `HhwwAC4ttsSZ1uKe8JaChRVDZfJNj66HgVzbpHwT3PFY` (latest, with callback-auth fix)
- **Deploy tx:** `AMRkDjuWBErK48mXUnMVHynTEXyuWPXboAuRV6Keaz5L`
- **Init tx:** `21V86MMoj9SX2dzNxSPSdiG4P3ZdmcBoUSwKVgPQTxe4` (owner: p2deployer.testnet)
- **Config:** outlayer_contract=`outlayer.testnet`, verifier_wasm_hash=`b17ae0f6fa374e71b56fe196e2101f6a7528cf0b3a2987e6d440bcd8202801a7` (pinned, tx `HhUuw4VyhcKZ9SJFCRm9ezS3JVBoiy2PtXcgN49a4V3u`)
- **Unit tests:** 36/36 pass (includes §9.6 adversarial matrix)

### TEE Verifier (OutLayer)
- **Project:** `p2deployer.testnet/patchpay-verifier` on `outlayer.testnet`
- **Version (SHA256):** `b17ae0f6fa374e71b56fe196e2101f6a7528cf0b3a2987e6d440bcd8202801a7`
- **WASM:** 396,063 bytes, wasm32-wasip2
- **FastFS URL:** https://test.fastfs.io/p2deployer.testnet/outlayer.testnet/b17ae0f6fa374e71b56fe196e2101f6a7528cf0b3a2987e6d440bcd8202801a7.wasm
- **Unit tests:** 37/37 pass

### GitHub Repo
- **URL:** https://github.com/rjrajput-web3/patchpay (public, main branch in sync)
- **Real test PR:** https://github.com/rjrajput-web3/patchpay/pull/1 (merged)
  - Merge commit: `ba1761705ca91e842ca884a36a721408a6a1ac37`
  - Author: rjrajput-web3, Base: main, Merged: 2026-11-03T10:51:44Z
  - PR body contains: `Claim: patchpay.p2deployer.testnet`

---

## 2. On-Chain E2E Trial (Real Transactions)

### Bounty 0 — Full lifecycle attempt
| Step | Tx Hash | Result |
|------|---------|--------|
| create_bounty | `BeBvEESmSALg5X9Q9Np97fMajx56DkpSbnr6DibAGzxi` | ✅ Bounty 0 created (0.1 NEAR reward + 0.1 verify budget) |
| submit_pr (nonce 0) | `vvupLcMy3365NLjrmSFgGuCausvWX6SH4TrC6X6aRM5` | ✅ Submission recorded; outlayer request succeeded |
| TEE callback | — | ❌ BLOCKED (see §4) |
| resolve_timeout | `9SWjhkuMY7yVchkGC6g2u8uWA6FAWrKSA1zyKN88sWbk` | ✅ Bounty reset to Open after 1800-block timeout |
| submit_pr (nonce 1) | `HuhQN2pEoMTKZNuNqVusuFUS98GWMqZoLLMmFZAcff9d` | ✅ Submission recorded; callback fired immediately with empty data → fail-closed Rejected |

### Bounty 1 — Concurrent submitters test
| Step | Tx Hash | Result |
|------|---------|--------|
| create_bounty | `NqAGwXpa6LZEiHA2TJnucXe35T7pXzfQVArYrvTyVaK` | ✅ Bounty 1 created |
| submit_pr (acct 1) | `324ydWFeyf5R4sZ4xERFreRPJvikYprLyyRYC5GQM1oB` | ✅ Nonce 0 recorded, bounty → VerificationPending |
| submit_pr (acct 2) | — | ✅ Correctly REJECTED ("bounty is not open") — no state corruption |

### Bounty 2 — Cancel and refund test
| Step | Tx Hash | Result |
|------|---------|--------|
| create_bounty | `DE9mSZrFcA7Kcwfj9bBJT3aNHkonvN8ztngp3msyMnNW` | ✅ Bounty 2 created |
| cancel_bounty | `EXbSZePtZuaHTn1XEo2MdxwK4nsb9bi4VRzRGV3SqK5r` | ✅ Bounty → Cancelled, refund processed |

---

## 3. What Works (Proven)

✅ Contract deployment and initialization  
✅ Bounty creation with escrowed funds  
✅ PR submission with nonce tracking  
✅ Verification timeout and recovery (`resolve_timeout`)  
✅ Concurrent submission protection  
✅ Bounty cancellation with refund  
✅ Fail-closed verification (empty/invalid result → Rejected, never pays)  
✅ TEE verifier WASM deployed to OutLayer testnet  
✅ Real GitHub PR merged and verifiable  

---

## 4. BLOCKER: On-Chain TEE Callback

**Problem:** The OutLayer testnet does not deliver async TEE results to calling contracts via the `.then()` promise pattern.

**Evidence:**
1. Our contract calls `outlayer.testnet.request_execution` with `.then(on_verification_result)`.
2. The `.then()` callback fires IMMEDIATELY (within the same transaction) with empty data, not after the TEE worker completes.
3. The TEE worker processes the request asynchronously (via events), but the result goes to `on_execution_response` ON THE OUTLAYER CONTRACT, not back to our contract.
4. Our callback fail-closes (Rejected) on the empty immediate result.

**Root cause:** The deployed `outlayer.testnet` does not implement the `promise_return(yield)` pattern that would allow `.then()` to wait for the TEE result. The official docs describe the `.then()` pattern, but the testnet deployment doesn't support it for contract-to-contract calls.

**Impact:** The full "TEE verification → on-chain payout" loop cannot complete. The contract correctly handles this (fail-closed, timeout recovery), but a real payout triggered by TEE verification is not possible until OutLayer supports contract callbacks.

**Workaround for demo:** The TEE verification can be run via `outlayer run` (direct) to produce a real attestation, and the contract's payout logic is proven by unit tests (36/36). The integration gap is documented here honestly.

---

## 5. Pending Items

### GitHub PAT (Rohit's step)
- **What:** Fine-grained PAT, public-repo read-only, for the OutLayer encrypted secret (`GITHUB_TOKEN`).
- **Why:** Without it, the TEE verifier uses unauthenticated GitHub API (60 req/hr shared). With it: 5,000 req/hr.
- **Where:** Rohit enters it in the OutLayer dashboard (https://app.outlayer.ai/secrets) for project `p2deployer.testnet/patchpay-verifier`, bound to the WASM hash.
- **Status:** Documented in `outlayer/github-pr-verifier/SECRETS.md`. NOT blocking the demo (single test works unauthenticated).

### Vercel Deployment (Parent agent step)
- **What:** Connect https://github.com/rjrajput-web3/patchpay to Vercel at `patchpay.vercel.app`.
- **Why blocked:** Subagent has no browser access; Vercel dashboard required (CLI is not official per standing rules). No API token available.
- **Ready:** Frontend builds successfully (`npm run build` ✅). `NEXT_PUBLIC_CONTRACT_ACCOUNT` defaults to `patchpay.p2deployer.testnet`. Env vars documented in `apps/web/.env.example`.
- **Action for parent:** Use browser to connect the repo in Vercel dashboard (team rohit-3f05), set root directory to `apps/web`, add env vars from `.env.example`.

### Demo Video
- **Status:** Not started. Blocked on Vercel URL (need a live site to record) and the TEE callback (can't show real on-chain payout).
- **Plan when unblocked:** 75-90s, real screen recordings of the Vercel site + real tx hashes + edge-tts ChristopherNeural voiceover, per `~/workspace/video-production-base-config.md`.

---

## 6. Files Changed (this session)

- `contracts/near-escrow/src/lib.rs`: Fixed `VERIFIER_PROJECT_ID` to full ID; fixed verification callback auth (self-caller, not outlayer); fixed `ext_outlayer` to 7-param signature with explicit resource limits.
- `scripts/deploy-testnet.mjs`: Fixed key format handling, gas values (30 TGas for init), owner-signed config calls.
- `apps/web/lib/config.ts`, `apps/web/.env.example`: Point to deployed `patchpay.p2deployer.testnet`.
- All committed and pushed to https://github.com/rjrajput-web3/patchpay (main).

---

## 7. Remaining Issues

1. **TEE callback integration** (blocker, external): OutLayer testnet doesn't support async contract callbacks. Mitigation: monitor OutLayer for updates; relayer pattern is a fallback (not implemented — would weaken trust model).
2. **Vercel deployment** (blocker, needs parent): No browser/API access from subagent.
3. **GitHub PAT** (Rohit's step): Needed for production-rate TEE verification.
4. **Bounty 0 nonce 1**: Stuck in Rejected (fail-closed on empty callback). This is correct behavior — the bounty can be cancelled/refunded, or a new bounty created for further tests.

---

## 8. Test Summary

| Suite | Result |
|-------|--------|
| Contract unit tests | 36/36 pass |
| Verifier unit tests | 37/37 pass |
| On-chain: create_bounty | ✅ (3 bounties) |
| On-chain: submit_pr | ✅ (4 submissions) |
| On-chain: resolve_timeout | ✅ |
| On-chain: cancel_bounty | ✅ |
| On-chain: concurrent protection | ✅ |
| On-chain: TEE callback → payout | ❌ BLOCKED (external) |
| Frontend build | ✅ |
| Vercel deploy | ❌ BLOCKED (needs parent) |

---

**Deployed contract:** `patchpay.p2deployer.testnet`  
**Verifier project:** `p2deployer.testnet/patchpay-verifier` (outlayer.testnet)  
**Repo:** https://github.com/rjrajput-web3/patchpay  
**Evidence:** All tx hashes above are verifiable on NEAR testnet via https://rpc.testnet.fastnear.com
