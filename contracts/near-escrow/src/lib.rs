//! PATCHPAY NEAR escrow contract.
//!
//! GitHub bounty escrow with TEE-verified PR merges (OutLayer).
//!
//! Flow: creator locks `reward + verify_budget + storage_fee` via `create_bounty`
//! -> developer calls `submit_pr` (permissionless, before deadline; payout receiver
//! is ALWAYS the submitter, never an address from PR text) -> contract calls
//! `outlayer.request_execution` with a hash-pinned verifier version and a
//! block-height timeout -> the TEE worker verifies the GitHub PR server-side
//! facts -> `on_verification_result` (private, caller must be the OutLayer
//! contract) validates the echoed nonce + pinned version and eligibility, then
//! either moves to the safe payout state machine or rejects back to Open.
//!
//! Security properties (per ARCHITECTURE.md §9 — AUTHORITATIVE):
//! - §9.1 claimant binding: payout -> submitter (on-chain caller); PR body
//!   `Claim: <submitter>` must match; GitHub author recorded/checked.
//! - §9.2 safe payout: VerificationPassed -> PayoutPending -> PayoutSucceeded,
//!   transfer confirmed via promise callback; NEVER Paid before confirmation;
//!   PayoutFailed is recoverable via bounded retries + explicit recovery.
//! - §9.3 timeouts: every verification carries a block-height deadline;
//!   `resolve_timeout` re-opens stuck bounties; late/duplicate callbacks are
//!   state-checked no-ops and can NEVER pay a terminal bounty.
//! - §9.4 attempt limits + fee accounting: max 3 verification attempts per
//!   bounty; each attempt deducts `verification_fee` from the budget on-chain.
//! - §9.7 storage + recovery: storage fee accounted at creation; failed refund
//!   transfers are retained + retryable, never silently dropped.
//! - §9.8 attestation binding: nonce echo + pinned WASM version asserted.
//! - The verifier/worker can NEVER move funds; only the contract pays out, and
//!   only on the strict happy path.
//! - No direct admin fund-withdrawal function — but the owner CAN update config
//!   values, including the OutLayer contract and verifier WASM hash, with no
//!   timelock or multisig. A compromised owner could point at an always-true
//!   verifier and drain escrow via the normal payout path; the owner key is a
//!   trust assumption until one-way pinning + timelock land.
//! - TESTNET ONLY unless the owner explicitly approves a mainnet deployment.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
};

/// Placeholder until Track B builds + deploys the real verifier WASM and the
/// owner pins its SHA256 via `set_verifier_wasm_hash`.
pub const UNSET_VERIFIER_HASH: &str = "UNSET_TRACK_B_PENDING";
/// OutLayer project id the verifier is deployed under (Track B:
/// `outlayer deploy patchpay-verifier <FastFS URL>`).
pub const VERIFIER_PROJECT_ID: &str = "p2deployer.testnet/patchpay-verifier";
/// Protocol storage price: 1e19 yoctoNEAR per byte.
pub const STORAGE_PRICE_YOCTO_PER_BYTE: u128 = 10_000_000_000_000_000_000;

const GAS_FOR_OUTLAYER_REQUEST: Gas = Gas::from_tgas(60);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(60);
/// Cap on the OutLayer callback payload we will read (OOG safety).
const MAX_VERIFICATION_RESULT_BYTES: usize = 1_048_576;
const LIST_LIMIT_MAX: u64 = 100;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BountyStatus {
    Open,
    VerificationPending,
    /// Verifier said yes; payout transfer NOT yet confirmed.
    VerificationPassed,
    /// Reward transfer in flight, awaiting transfer-result callback.
    PayoutPending,
    /// Terminal: payout transfer confirmed on-chain. (The "paid" state.)
    PayoutSucceeded,
    /// Recoverable: payout transfer failed; funds locked; retry exposed.
    PayoutFailed,
    /// Terminal.
    Cancelled,
    /// Terminal.
    Refunded,
    /// Informational terminal marker (funds leave via claim_refund -> Refunded).
    Expired,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmissionStatus {
    Pending,
    Verified,
    Rejected,
    TimedOut,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferKind {
    PayoutReward,
    BudgetRefund,
    BountyRefund,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferStatus {
    InFlight,
    Done,
    Failed,
}

/// Every outgoing value transfer goes through this ledger so failures are
/// retryable and funds are never silently lost (§9.2, §9.7).
#[near(serializers = [json, borsh])]
#[derive(Debug, Clone)]
pub struct PendingTransfer {
    pub id: u64,
    pub bounty_id: u64,
    pub to: AccountId,
    pub amount: U128,
    pub kind: TransferKind,
    pub attempts: u64,
    pub status: TransferStatus,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone)]
pub struct Bounty {
    pub id: u64,
    pub creator: AccountId,
    pub title: String,
    pub description: String,
    /// "owner/repo"
    pub repo: String,
    pub issue_number: Option<u64>,
    pub target_branch: String,
    /// GitHub login, optional
    pub expected_author: Option<String>,
    /// yoctoNEAR, locked in escrow
    pub reward: U128,
    /// yoctoNEAR reserved for OutLayer execution fees
    pub verify_budget: U128,
    /// yoctoNEAR of the budget already consumed by attempts
    pub verify_spent: U128,
    /// nanosecond timestamp
    pub deadline: u64,
    pub status: BountyStatus,
    /// nonce source: submission_count at submit time == submission nonce
    pub submission_count: u64,
    /// verification attempts used (hard-capped)
    pub attempts: u64,
    /// measured storage bytes of this bounty record (transparency)
    pub storage_bytes: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone)]
pub struct Submission {
    pub bounty_id: u64,
    /// payout receiver — ALWAYS the submit_pr caller (§9.1)
    pub submitter: AccountId,
    pub pr_number: u64,
    pub nonce: u64,
    pub status: SubmissionStatus,
    pub requested_at: u64,
    /// block height after which `resolve_timeout` may fire (§9.3)
    pub timeout_height: u64,
    /// yoctoNEAR deducted from the bounty budget for this attempt (§9.4)
    pub fee_charged: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Debug, Clone)]
pub struct Config {
    pub outlayer_contract: AccountId,
    /// SHA256 hex of the pinned verifier WASM (placeholder until Track B).
    pub verifier_wasm_hash: String,
    /// yoctoNEAR attached to each `request_execution` call and deducted per
    /// attempt from the bounty budget (conservative estimate of the actual
    /// OutLayer execution cost; refined with real cost data in Track B).
    pub verification_fee: U128,
    pub min_reward: U128,
    pub max_reward: U128,
    pub min_verify_budget: U128,
    /// hard cap on verification attempts per bounty (§9.4)
    pub max_verification_attempts: u64,
    /// blocks after which a verification request may be timed out (§9.3)
    pub verification_timeout_blocks: u64,
    /// bound on transfer retries before explicit recovery is required
    pub max_transfer_attempts: u64,
    /// flat storage fee covering the bounty record's staking cost (§9.7)
    pub storage_fee: U128,
    pub max_title_len: u64,
    pub max_description_len: u64,
}

#[near(serializers = [json])]
#[derive(Debug, Clone)]
pub struct CreateBountyArgs {
    pub title: String,
    pub description: String,
    pub repo: String,
    pub issue_number: Option<u64>,
    pub target_branch: String,
    pub expected_author: Option<String>,
    pub reward: U128,
    pub verify_budget: U128,
    /// nanosecond timestamp
    pub deadline: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    config: Config,
    bounties: IterableMap<u64, Bounty>,
    /// key: (bounty_id, nonce)
    submissions: LookupMap<(u64, u64), Submission>,
    transfers: IterableMap<u64, PendingTransfer>,
    next_bounty_id: u64,
    next_transfer_id: u64,
}

// ---------------------------------------------------------------------------
// Cross-contract interfaces
// ---------------------------------------------------------------------------

/// OutLayer execution contract (testnet: outlayer.testnet).
/// Params per the official NEAR integration docs; `source` pins the exact
/// verifier build via `version_key` (the WASM SHA256, §9.8).
/// Signature matches the deployed outlayer contract (7 params).
#[near_sdk::ext_contract(ext_outlayer)]
pub trait ExtOutLayer {
    fn request_execution(
        &mut self,
        source: near_sdk::serde_json::Value,
        resource_limits: near_sdk::serde_json::Value,
        input_data: near_sdk::serde_json::Value,
        secrets_ref: near_sdk::serde_json::Value,
        response_format: near_sdk::serde_json::Value,
        payer_account_id: near_sdk::serde_json::Value,
        params: near_sdk::serde_json::Value,
    );
}

#[near_sdk::ext_contract(ext_self)]
pub trait ExtSelf {
    fn on_verification_result(&mut self, bounty_id: u64, nonce: u64);
    fn on_transfer_result(&mut self, transfer_id: u64);
}

// ---------------------------------------------------------------------------
// Verifier output parsing
// ---------------------------------------------------------------------------

/// Expected stdout JSON from the Track B verifier (<=900 bytes).
/// `wasm_sha256`/`version_key` are optional: when present and non-empty the
/// callback asserts them against the pinned hash (§9.8); when absent we rely
/// on OutLayer's hash-pinned execution (documented, Track B confirms).
#[derive(Debug)]
struct VerifierOutput {
    bounty_id: u64,
    nonce: u64,
    verified: bool,
    reason: String,
    wasm_sha256: Option<String>,
    version_key: Option<String>,
}

fn as_verifier_output(v: &near_sdk::serde_json::Value) -> Option<VerifierOutput> {
    let o = v.as_object()?;
    Some(VerifierOutput {
        bounty_id: o.get("bounty_id")?.as_u64()?,
        nonce: o.get("nonce")?.as_u64()?,
        verified: o.get("verified")?.as_bool()?,
        reason: o
            .get("reason")
            .and_then(|r| r.as_str())
            .unwrap_or("")
            .to_string(),
        wasm_sha256: o
            .get("wasm_sha256")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
        version_key: o
            .get("version_key")
            .and_then(|r| r.as_str())
            .map(|s| s.to_string()),
    })
}

/// Parse the OutLayer execution result defensively: the exact callback payload
/// shape is still an open question, so accept the verifier JSON directly,
/// nested under `output`/`stdout`/`result`/`data`, or as a JSON-encoded
/// string. Returns None when nothing parses (fail-closed: never pays).
fn parse_verifier_output(v: &near_sdk::serde_json::Value) -> Option<VerifierOutput> {
    if let Some(o) = as_verifier_output(v) {
        return Some(o);
    }
    for key in ["output", "stdout", "result", "data"] {
        if let Some(inner) = v.get(key) {
            if let Some(o) = parse_verifier_output(inner) {
                return Some(o);
            }
        }
    }
    if let Some(s) = v.as_str() {
        if let Ok(inner) = near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(s) {
            return parse_verifier_output(&inner);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Events (NEP-297)
// ---------------------------------------------------------------------------

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"nep297\",\"version\":\"1.0.0\",\"event\":\"patchpay_{event}\",\"data\":{data}}}"
    ));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(owner), Some(name), None) => {
            let ok_part = |p: &str, max: usize| {
                !p.is_empty()
                    && p.len() <= max
                    && p.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
            };
            ok_part(owner, 64) && ok_part(name, 128)
        }
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Contract implementation
// ---------------------------------------------------------------------------

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            config: Config {
                outlayer_contract: "outlayer.testnet".parse().unwrap(),
                verifier_wasm_hash: UNSET_VERIFIER_HASH.to_string(),
                verification_fee: U128(50_000_000_000_000_000_000_000), // 0.05 NEAR est.
                min_reward: U128(10_000_000_000_000_000_000_000),       // 0.01 NEAR
                max_reward: U128(1_000_000_000_000_000_000_000_000_000), // 1000 NEAR
                min_verify_budget: U128(50_000_000_000_000_000_000_000), // 0.05 NEAR
                max_verification_attempts: 3,
                verification_timeout_blocks: 1800, // ~36 min at ~1.2s/block
                max_transfer_attempts: 5,
                storage_fee: U128(20_000_000_000_000_000_000_000), // 0.02 NEAR
                max_title_len: 120,
                max_description_len: 1000,
            },
            bounties: IterableMap::new(b"b"),
            submissions: LookupMap::new(b"s"),
            transfers: IterableMap::new(b"t"),
            next_bounty_id: 0,
            next_transfer_id: 0,
        }
    }

    // ---- owner config (values only — NEVER fund movement) ----

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "only the owner can call this"
        );
    }

    pub fn set_outlayer_contract(&mut self, outlayer_contract: AccountId) {
        self.assert_owner();
        self.config.outlayer_contract = outlayer_contract.clone();
        emit(
            "config_updated",
            near_sdk::serde_json::json!({"field": "outlayer_contract", "value": outlayer_contract}),
        );
    }

    pub fn set_verifier_wasm_hash(&mut self, wasm_hash: String) {
        self.assert_owner();
        assert!(
            !wasm_hash.is_empty() && wasm_hash.len() <= 128,
            "wasm hash must be 1..=128 chars"
        );
        self.config.verifier_wasm_hash = wasm_hash.clone();
        emit(
            "config_updated",
            near_sdk::serde_json::json!({"field": "verifier_wasm_hash", "value": wasm_hash}),
        );
    }

    pub fn set_fee_params(
        &mut self,
        verification_fee: U128,
        min_reward: U128,
        max_reward: U128,
        min_verify_budget: U128,
        max_verification_attempts: u64,
        verification_timeout_blocks: u64,
        max_transfer_attempts: u64,
        storage_fee: U128,
    ) {
        self.assert_owner();
        assert!(min_reward.0 <= max_reward.0, "min_reward must be <= max_reward");
        assert!(max_verification_attempts >= 1, "attempts must be >= 1");
        self.config.verification_fee = verification_fee;
        self.config.min_reward = min_reward;
        self.config.max_reward = max_reward;
        self.config.min_verify_budget = min_verify_budget;
        self.config.max_verification_attempts = max_verification_attempts;
        self.config.verification_timeout_blocks = verification_timeout_blocks;
        self.config.max_transfer_attempts = max_transfer_attempts;
        self.config.storage_fee = storage_fee;
        emit("config_updated", near_sdk::serde_json::json!({"field": "fee_params"}));
    }

    // ---- bounty lifecycle ----

    /// Create a bounty, locking `reward + verify_budget + storage_fee`.
    /// Attached deposit must equal that sum exactly.
    #[payable]
    pub fn create_bounty(&mut self, args: CreateBountyArgs) -> u64 {
        let creator = env::predecessor_account_id();
        let now = env::block_timestamp();
        let cfg = self.config.clone();

        assert!(
            !args.title.is_empty() && args.title.chars().count() as u64 <= cfg.max_title_len,
            "title must be 1..=max_title_len chars"
        );
        assert!(
            args.description.chars().count() as u64 <= cfg.max_description_len,
            "description too long"
        );
        assert!(valid_repo(&args.repo), "repo must be \"owner/repo\"");
        assert!(
            !args.target_branch.is_empty() && args.target_branch.len() <= 64,
            "target_branch must be 1..=64 chars"
        );
        if let Some(a) = &args.expected_author {
            assert!(!a.is_empty() && a.len() <= 64, "expected_author must be 1..=64 chars");
        }
        assert!(
            args.reward.0 >= cfg.min_reward.0 && args.reward.0 <= cfg.max_reward.0,
            "reward out of bounds"
        );
        assert!(
            args.verify_budget.0 >= cfg.min_verify_budget.0,
            "verify_budget below minimum"
        );
        assert!(args.deadline > now, "deadline must be in the future");

        let expected = NearToken::from_yoctonear(
            args.reward
                .0
                .saturating_add(args.verify_budget.0)
                .saturating_add(cfg.storage_fee.0),
        );
        assert_eq!(
            env::attached_deposit(),
            expected,
            "attach exactly reward + verify_budget + storage_fee"
        );

        let id = self.next_bounty_id;
        self.next_bounty_id += 1;

        // Measure the record's storage footprint for transparent accounting (§9.7).
        let usage_before = env::storage_usage();
        self.bounties.insert(
            id,
            Bounty {
                id,
                creator: creator.clone(),
                title: args.title.clone(),
                description: args.description.clone(),
                repo: args.repo.clone(),
                issue_number: args.issue_number,
                target_branch: args.target_branch.clone(),
                expected_author: args.expected_author.clone(),
                reward: args.reward,
                verify_budget: args.verify_budget,
                verify_spent: U128(0),
                deadline: args.deadline,
                status: BountyStatus::Open,
                submission_count: 0,
                attempts: 0,
                storage_bytes: 0, // filled in below
            },
        );
        let storage_bytes = env::storage_usage().saturating_sub(usage_before);
        if let Some(mut b) = self.bounties.get(&id).cloned() {
            b.storage_bytes = storage_bytes;
            self.bounties.insert(id, b);
        }

        emit(
            "bounty_created",
            near_sdk::serde_json::json!({
                "bounty_id": id, "creator": creator, "repo": args.repo,
                "reward": args.reward, "verify_budget": args.verify_budget,
                "storage_fee": cfg.storage_fee, "storage_bytes": storage_bytes,
                "deadline": args.deadline,
            }),
        );
        id
    }

    /// Cancel an Open bounty; creator is refunded reward + unspent budget
    /// through the retryable transfer ledger (§9.7).
    pub fn cancel_bounty(&mut self, bounty_id: u64) {
        let mut bounty = self
            .bounties
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("bounty not found"));
        assert_eq!(
            env::predecessor_account_id(),
            bounty.creator,
            "only the creator can cancel"
        );
        assert_eq!(bounty.status, BountyStatus::Open, "only Open bounties can be cancelled");

        bounty.status = BountyStatus::Cancelled;
        self.bounties.insert(bounty_id, bounty.clone());

        let refund = bounty
            .reward
            .0
            .saturating_add(bounty.verify_budget.0.saturating_sub(bounty.verify_spent.0));
        emit(
            "bounty_cancelled",
            near_sdk::serde_json::json!({"bounty_id": bounty_id, "refund": U128(refund)}),
        );
        self.enqueue_transfer(bounty_id, bounty.creator.clone(), refund, TransferKind::BountyRefund);
    }

    /// Submit a PR for verification. Permissionless, but the payout receiver is
    /// ALWAYS the caller (submitter) — `claimant` in the OutLayer input is the
    /// submitter, and the WASM must find `Claim: <submitter>` in the PR body
    /// (§9.1). Consumes one verification attempt and deducts the fee (§9.4).
    pub fn submit_pr(&mut self, bounty_id: u64, pr_number: u64) -> u64 {
        let mut bounty = self
            .bounties
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("bounty not found"));
        assert_eq!(bounty.status, BountyStatus::Open, "bounty is not open");
        assert!(env::block_timestamp() < bounty.deadline, "bounty deadline has passed");
        assert!(pr_number > 0, "invalid PR number");
        assert!(
            bounty.attempts < self.config.max_verification_attempts,
            "verification attempts exhausted for this bounty"
        );
        let budget_left = bounty.verify_budget.0.saturating_sub(bounty.verify_spent.0);
        assert!(
            budget_left >= self.config.verification_fee.0,
            "verify budget exhausted for this bounty"
        );

        // G3 (audit P-04): refuse verification while the verifier hash is still
        // the UNSET placeholder. Without this, `version_ok` treats an output
        // that omits hash fields as valid, so a bounty could be verified with
        // no pinned verifier at all. Checked before any fee/attempt is consumed.
        assert!(
            !self.config.verifier_wasm_hash.is_empty()
                && self.config.verifier_wasm_hash != UNSET_VERIFIER_HASH,
            "verifier WASM hash is not set — owner must pin the real verifier hash via set_verifier_wasm_hash before any verification"
        );

        let submitter = env::predecessor_account_id();
        let nonce = bounty.submission_count;

        // §9.4: deduct this attempt's cost up-front, record it on-chain.
        bounty.verify_spent = U128(bounty.verify_spent.0.saturating_add(self.config.verification_fee.0));
        bounty.attempts += 1;
        bounty.submission_count += 1;
        bounty.status = BountyStatus::VerificationPending;
        self.bounties.insert(bounty_id, bounty.clone());

        let timeout_height =
            env::block_height().saturating_add(self.config.verification_timeout_blocks);
        self.submissions.insert(
            (bounty_id, nonce),
            Submission {
                bounty_id,
                submitter: submitter.clone(),
                pr_number,
                nonce,
                status: SubmissionStatus::Pending,
                requested_at: env::block_timestamp(),
                timeout_height,
                fee_charged: self.config.verification_fee,
            },
        );

        // §9.1: claimant is the submitter (the on-chain caller), never PR text.
        let input_data = near_sdk::serde_json::json!({
            "bounty_id": bounty_id,
            "nonce": nonce,
            "repo": bounty.repo,
            "pr_number": pr_number,
            "expected_author": bounty.expected_author,
            "expected_branch": bounty.target_branch,
            "claimant": submitter,
            "deadline": bounty.deadline,
        })
        .to_string();
        // §9.8: pin the exact verifier build by WASM SHA256.
        let source = near_sdk::serde_json::json!({
            "Project": {
                "project_id": VERIFIER_PROJECT_ID,
                "version_key": self.config.verifier_wasm_hash,
            }
        });

        emit(
            "verification_requested",
            near_sdk::serde_json::json!({
                "bounty_id": bounty_id, "nonce": nonce, "submitter": submitter,
                "pr_number": pr_number, "attempt": bounty.attempts,
                "fee_charged": self.config.verification_fee,
                "timeout_height": timeout_height,
                "version_key": self.config.verifier_wasm_hash,
            }),
        );

        // NOTE: the promise is intentionally detached — near-sdk creates the
        // receipts in `Drop::drop`, so this is fire-and-forget by design; the
        // callback carries the result back into the contract.
        // `request_execution` returns its yield promise via `promise_return`,
        // so `.then()` fires when the TEE worker resolves (not immediately).
        #[allow(unused_must_use)]
        ext_outlayer::ext(self.config.outlayer_contract.clone())
            .with_static_gas(GAS_FOR_OUTLAYER_REQUEST)
            .with_attached_deposit(NearToken::from_yoctonear(self.config.verification_fee.0))
            .request_execution(
                source,
                near_sdk::serde_json::json!({
                    "max_instructions": 1_000_000_000u64,
                    "max_memory_mb": 128u32,
                    "max_execution_seconds": 60u64,
                }),
                near_sdk::serde_json::Value::String(input_data),
                near_sdk::serde_json::Value::Null, // secrets_ref: none (PAT is Rohit's step)
                near_sdk::serde_json::Value::String("Json".to_string()),
                near_sdk::serde_json::Value::Null, // payer_account_id: sender (us) pays
                near_sdk::serde_json::Value::Null, // params: none
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_verification_result(bounty_id, nonce),
            );

        nonce
    }

    // ---- verification callback ----
    //
    // SECURITY MODEL (verified against the outlayer contract source):
    // `request_execution` returns its yield promise via `env::promise_return`,
    // so our `.then(on_verification_result)` chains onto that yield promise.
    // This callback fires ONLY when the OutLayer worker resolves OUR execution
    // via `resolve_execution` → `promise_yield_resume`. The predecessor of a
    // `.then()` callback is always the account that created it (this contract),
    // so `#[private]` + `assert_self_caller` is the correct authorization —
    // an outlayer-predecessor check can never pass and would brick verification.
    // Result authenticity: only outlayer.testnet can resume our yield, so the
    // promise bytes are authentically the TEE worker's output. Nonce echo +
    // pinned WASM version + bounty state checks are defense in depth.

    fn assert_self_caller(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "unauthorized: callback must come from this contract"
        );
    }

    /// OutLayer execution callback. `#[private]` + self-caller check; parses the
    /// result defensively (fail-closed: unparseable => reject, never pay).
    #[private]
    pub fn on_verification_result(&mut self, bounty_id: u64, nonce: u64) {
        self.assert_self_caller();
        // Read the raw promise result ourselves (byte-capped against OOG) so a
        // malformed payload degrades to a rejection instead of panicking.
        let result: Result<near_sdk::serde_json::Value, PromiseError> =
            match env::promise_result_checked(0, MAX_VERIFICATION_RESULT_BYTES) {
                Ok(bytes) => {
                    near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(&bytes)
                        .map_err(|_| PromiseError::Failed)
                }
                Err(_) => Err(PromiseError::Failed),
            };
        self.handle_verification_outcome(bounty_id, nonce, result);
    }

    fn handle_verification_outcome(
        &mut self,
        bounty_id: u64,
        nonce: u64,
        result: Result<near_sdk::serde_json::Value, PromiseError>,
    ) {
        let output = match result {
            Ok(v) => parse_verifier_output(&v),
            Err(_) => None,
        };

        let mut bounty = match self.bounties.get(&bounty_id) {
            Some(b) => b.clone(),
            None => {
                emit(
                    "stale_callback_ignored",
                    near_sdk::serde_json::json!({"bounty_id": bounty_id, "nonce": nonce, "reason": "unknown_bounty"}),
                );
                return;
            }
        };
        let mut submission = match self.submissions.get(&(bounty_id, nonce)) {
            Some(s) => s.clone(),
            None => {
                emit(
                    "stale_callback_ignored",
                    near_sdk::serde_json::json!({"bounty_id": bounty_id, "nonce": nonce, "reason": "unknown_submission"}),
                );
                return;
            }
        };

        // §9.3 / §9.6: late or duplicate callbacks MUST be state-checked first.
        // A delayed callback must NEVER pay a terminal (or already-resolved) bounty.
        if bounty.status != BountyStatus::VerificationPending
            || submission.status != SubmissionStatus::Pending
        {
            emit(
                "stale_callback_ignored",
                near_sdk::serde_json::json!({
                    "bounty_id": bounty_id, "nonce": nonce,
                    "bounty_status": bounty.status, "submission_status": submission.status,
                }),
            );
            return;
        }

        let eligible = env::block_timestamp() <= bounty.deadline;

        // §9.8: nonce echo + pinned-version binding.
        let version_ok = match &output {
            Some(o) => {
                let claimed = o.wasm_sha256.as_ref().or(o.version_key.as_ref());
                match claimed {
                    Some(h) if !h.is_empty() => *h == self.config.verifier_wasm_hash,
                    _ => true, // absent: rely on OutLayer's hash-pinned execution
                }
            }
            None => false,
        };
        let verified = match &output {
            Some(o) => {
                o.verified && o.bounty_id == bounty_id && o.nonce == nonce && version_ok
            }
            None => false,
        };

        if verified && eligible {
            submission.status = SubmissionStatus::Verified;
            bounty.status = BountyStatus::VerificationPassed;
            self.submissions.insert((bounty_id, nonce), submission);
            self.bounties.insert(bounty_id, bounty);
            emit(
                "verification_passed",
                near_sdk::serde_json::json!({"bounty_id": bounty_id, "nonce": nonce}),
            );
            self.start_payout(bounty_id, nonce);
        } else {
            let reason = if !eligible {
                "past_deadline".to_string()
            } else {
                output.map(|o| o.reason).unwrap_or_else(|| "unparseable_result".to_string())
            };
            // Fail-closed: reject and re-open so the real developer can retry
            // (attempts/budget permitting); never pay on ambiguity.
            submission.status = SubmissionStatus::Rejected;
            bounty.status = BountyStatus::Open;
            self.submissions.insert((bounty_id, nonce), submission);
            self.bounties.insert(bounty_id, bounty);
            emit(
                "verification_rejected",
                near_sdk::serde_json::json!({"bounty_id": bounty_id, "nonce": nonce, "reason": reason}),
            );
        }
    }

    // ---- safe payout state machine (§9.2) ----

    /// VerificationPassed -> PayoutPending: enqueue the reward transfer to the
    /// submitter and fire it. The bounty is NOT marked paid until the
    /// transfer-result callback confirms success.
    fn start_payout(&mut self, bounty_id: u64, _nonce: u64) {
        let mut bounty = self
            .bounties
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("bounty not found"));
        assert_eq!(
            bounty.status,
            BountyStatus::VerificationPassed,
            "payout can only start from VerificationPassed"
        );
        let submission = self
            .submissions
            .get(&(bounty_id, _nonce))
            .unwrap_or_else(|| env::panic_str("submission not found"));

        bounty.status = BountyStatus::PayoutPending;
        self.bounties.insert(bounty_id, bounty.clone());
        emit(
            "payout_started",
            near_sdk::serde_json::json!({
                "bounty_id": bounty_id, "to": submission.submitter, "amount": bounty.reward,
            }),
        );
        self.enqueue_transfer(
            bounty_id,
            submission.submitter.clone(),
            bounty.reward.0,
            TransferKind::PayoutReward,
        );
    }

    // ---- retryable transfer ledger (§9.2, §9.7) ----

    /// Create a PendingTransfer record and fire the first attempt.
    fn enqueue_transfer(
        &mut self,
        bounty_id: u64,
        to: AccountId,
        amount: u128,
        kind: TransferKind,
    ) -> u64 {
        let id = self.next_transfer_id;
        self.next_transfer_id += 1;
        self.transfers.insert(
            id,
            PendingTransfer {
                id,
                bounty_id,
                to: to.clone(),
                amount: U128(amount),
                kind: kind.clone(),
                attempts: 0,
                status: TransferStatus::InFlight,
            },
        );
        emit(
            "transfer_enqueued",
            near_sdk::serde_json::json!({"transfer_id": id, "bounty_id": bounty_id, "to": to, "amount": U128(amount), "kind": kind}),
        );
        self.execute_transfer(id);
        id
    }

    fn execute_transfer(&mut self, transfer_id: u64) {
        let mut pt = self
            .transfers
            .get(&transfer_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("transfer not found"));
        pt.attempts += 1;
        pt.status = TransferStatus::InFlight;
        self.transfers.insert(transfer_id, pt.clone());

        // NOTE: intentionally detached — near-sdk creates the receipts in
        // `Drop::drop`; the transfer-result callback reports back.
        #[allow(unused_must_use)]
        Promise::new(pt.to.clone())
            .transfer(NearToken::from_yoctonear(pt.amount.0))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_transfer_result(transfer_id),
            );
    }

    /// Transfer-result callback: confirms funds actually landed.
    #[private]
    pub fn on_transfer_result(&mut self, transfer_id: u64) {
        self.assert_self_caller();
        let result: Result<(), PromiseError> = match env::promise_result_checked(0, 1024) {
            Ok(_) => Ok(()),
            Err(_) => Err(PromiseError::Failed),
        };
        self.handle_transfer_result(transfer_id, result);
    }

    fn handle_transfer_result(
        &mut self,
        transfer_id: u64,
        result: Result<(), PromiseError>,
    ) {
        let mut pt = match self.transfers.get(&transfer_id) {
            Some(t) => t.clone(),
            None => {
                emit(
                    "stale_callback_ignored",
                    near_sdk::serde_json::json!({"transfer_id": transfer_id, "reason": "unknown_transfer"}),
                );
                return;
            }
        };
        // Duplicate delivery guard: only an InFlight transfer can resolve.
        if pt.status != TransferStatus::InFlight {
            emit(
                "stale_callback_ignored",
                near_sdk::serde_json::json!({"transfer_id": transfer_id, "reason": "not_in_flight"}),
            );
            return;
        }

        if result.is_ok() {
            pt.status = TransferStatus::Done;
            self.transfers.insert(transfer_id, pt.clone());
            match pt.kind {
                TransferKind::PayoutReward => {
                    // §9.2: bounty becomes Paid ONLY here, on confirmed transfer.
                    if let Some(mut bounty) = self.bounties.get(&pt.bounty_id).cloned() {
                        if bounty.status == BountyStatus::PayoutPending {
                            bounty.status = BountyStatus::PayoutSucceeded;
                            self.bounties.insert(pt.bounty_id, bounty.clone());
                            emit(
                                "bounty_paid",
                                near_sdk::serde_json::json!({
                                    "bounty_id": pt.bounty_id, "to": pt.to, "amount": pt.amount,
                                }),
                            );
                            // Return the unspent verification budget to the creator.
                            let leftover = bounty
                                .verify_budget
                                .0
                                .saturating_sub(bounty.verify_spent.0);
                            if leftover > 0 {
                                self.enqueue_transfer(
                                    pt.bounty_id,
                                    bounty.creator.clone(),
                                    leftover,
                                    TransferKind::BudgetRefund,
                                );
                            }
                        } else {
                            emit(
                                "stale_callback_ignored",
                                near_sdk::serde_json::json!({"transfer_id": transfer_id, "reason": "bounty_not_payout_pending"}),
                            );
                        }
                    }
                }
                TransferKind::BudgetRefund => {
                    emit(
                        "budget_refunded",
                        near_sdk::serde_json::json!({"transfer_id": transfer_id, "bounty_id": pt.bounty_id, "to": pt.to, "amount": pt.amount}),
                    );
                }
                TransferKind::BountyRefund => {
                    emit(
                        "refund_completed",
                        near_sdk::serde_json::json!({"transfer_id": transfer_id, "bounty_id": pt.bounty_id, "to": pt.to, "amount": pt.amount}),
                    );
                }
            }
        } else {
            // Transfer failed: funds never left the contract. Retain + expose retry.
            pt.status = TransferStatus::Failed;
            self.transfers.insert(transfer_id, pt.clone());
            emit(
                "transfer_failed",
                near_sdk::serde_json::json!({
                    "transfer_id": transfer_id, "bounty_id": pt.bounty_id,
                    "to": pt.to, "amount": pt.amount, "kind": pt.kind,
                    "attempts": pt.attempts,
                }),
            );
            if pt.kind == TransferKind::PayoutReward {
                if let Some(mut bounty) = self.bounties.get(&pt.bounty_id).cloned() {
                    if bounty.status == BountyStatus::PayoutPending {
                        bounty.status = BountyStatus::PayoutFailed;
                        self.bounties.insert(pt.bounty_id, bounty);
                        emit(
                            "payout_failed",
                            near_sdk::serde_json::json!({"bounty_id": pt.bounty_id, "transfer_id": transfer_id}),
                        );
                    }
                }
            }
        }
    }

    /// Retry a failed transfer (bounded). Permissionless — anyone may keep a
    /// stuck payout/refund moving.
    pub fn retry_transfer(&mut self, transfer_id: u64) {
        let pt = self
            .transfers
            .get(&transfer_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("transfer not found"));
        assert_eq!(pt.status, TransferStatus::Failed, "transfer is not in failed state");
        assert!(
            pt.attempts < self.config.max_transfer_attempts,
            "transfer attempts exhausted; the receiver may call recover_transfer"
        );
        // Re-arm a failed payout so the state machine can proceed.
        if pt.kind == TransferKind::PayoutReward {
            if let Some(mut bounty) = self.bounties.get(&pt.bounty_id).cloned() {
                if bounty.status == BountyStatus::PayoutFailed {
                    bounty.status = BountyStatus::PayoutPending;
                    self.bounties.insert(pt.bounty_id, bounty);
                }
            }
        }
        emit(
            "transfer_retried",
            near_sdk::serde_json::json!({"transfer_id": transfer_id, "attempt": pt.attempts + 1}),
        );
        self.execute_transfer(transfer_id);
    }

    /// Explicit recovery (§9.2): once bounded retries are exhausted, the
    /// rightful receiver — and only they — may trigger further attempts,
    /// one per call. Funds are never silently dropped.
    pub fn recover_transfer(&mut self, transfer_id: u64) {
        let pt = self
            .transfers
            .get(&transfer_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("transfer not found"));
        assert_eq!(pt.status, TransferStatus::Failed, "transfer is not in failed state");
        assert!(
            pt.attempts >= self.config.max_transfer_attempts,
            "use retry_transfer first; recovery is for exhausted retries"
        );
        assert_eq!(
            env::predecessor_account_id(),
            pt.to,
            "only the transfer recipient can recover"
        );
        if pt.kind == TransferKind::PayoutReward {
            if let Some(mut bounty) = self.bounties.get(&pt.bounty_id).cloned() {
                if bounty.status == BountyStatus::PayoutFailed {
                    bounty.status = BountyStatus::PayoutPending;
                    self.bounties.insert(pt.bounty_id, bounty);
                }
            }
        }
        emit(
            "transfer_recovered",
            near_sdk::serde_json::json!({"transfer_id": transfer_id, "by": pt.to}),
        );
        self.execute_transfer(transfer_id);
    }

    // ---- timeout (§9.3) ----

    /// If the OutLayer callback never arrives, anyone may resolve the request
    /// after its block-height deadline: submission -> TimedOut, bounty -> Open.
    /// A bounty is NEVER stuck forever waiting for a callback.
    pub fn resolve_timeout(&mut self, bounty_id: u64) {
        let mut bounty = self
            .bounties
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("bounty not found"));
        assert_eq!(
            bounty.status,
            BountyStatus::VerificationPending,
            "bounty is not awaiting verification"
        );
        // The in-flight submission is always the latest nonce.
        let nonce = bounty.submission_count.saturating_sub(1);
        let mut submission = self
            .submissions
            .get(&(bounty_id, nonce))
            .cloned()
            .unwrap_or_else(|| env::panic_str("submission not found"));
        assert_eq!(
            submission.status,
            SubmissionStatus::Pending,
            "submission is not pending"
        );
        assert!(
            env::block_height() > submission.timeout_height,
            "verification timeout not reached yet"
        );

        submission.status = SubmissionStatus::TimedOut;
        bounty.status = BountyStatus::Open;
        self.submissions.insert((bounty_id, nonce), submission);
        self.bounties.insert(bounty_id, bounty);
        emit(
            "verification_timed_out",
            near_sdk::serde_json::json!({"bounty_id": bounty_id, "nonce": nonce}),
        );
    }

    // ---- refund ----

    /// Creator refunds after the deadline (Open or still-verifying), or any
    /// party's funds via cancel. Refund = reward + unspent budget, through the
    /// retryable transfer ledger. A late verification callback after this is a
    /// no-op (§9.3, §9.6): exactly-once, correct party.
    pub fn claim_refund(&mut self, bounty_id: u64) {
        let mut bounty = self
            .bounties
            .get(&bounty_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("bounty not found"));
        assert_eq!(
            env::predecessor_account_id(),
            bounty.creator,
            "only the creator can claim a refund"
        );
        let refundable = matches!(
            bounty.status,
            BountyStatus::Open | BountyStatus::VerificationPending
        );
        assert!(refundable, "bounty is not refundable in its current state");
        assert!(
            env::block_timestamp() > bounty.deadline,
            "refund only available after the deadline"
        );

        bounty.status = BountyStatus::Refunded;
        self.bounties.insert(bounty_id, bounty.clone());

        let refund = bounty
            .reward
            .0
            .saturating_add(bounty.verify_budget.0.saturating_sub(bounty.verify_spent.0));
        emit(
            "refund_initiated",
            near_sdk::serde_json::json!({"bounty_id": bounty_id, "to": bounty.creator, "refund": U128(refund)}),
        );
        self.enqueue_transfer(bounty_id, bounty.creator.clone(), refund, TransferKind::BountyRefund);
    }

    // ---- views ----

    pub fn get_bounty(&self, bounty_id: u64) -> Option<Bounty> {
        self.bounties.get(&bounty_id).cloned()
    }

    pub fn list_bounties(
        &self,
        status: Option<BountyStatus>,
        page: u64,
        limit: u64,
    ) -> Vec<Bounty> {
        let limit = limit.min(LIST_LIMIT_MAX).max(1);
        self.bounties
            .iter()
            .filter(|(_, b)| status.as_ref().map_or(true, |s| &b.status == s))
            .skip((page.saturating_mul(limit)) as usize)
            .take(limit as usize)
            .map(|(_, b)| b.clone())
            .collect()
    }

    pub fn get_submission(&self, bounty_id: u64, nonce: u64) -> Option<Submission> {
        self.submissions.get(&(bounty_id, nonce)).cloned()
    }

    pub fn get_transfer(&self, transfer_id: u64) -> Option<PendingTransfer> {
        self.transfers.get(&transfer_id).cloned()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const OWNER: &str = "owner.testnet";
    const CREATOR: &str = "creator.testnet";
    const DEV_A: &str = "dev-a.testnet";
    const DEV_B: &str = "dev-b.testnet";
    const OUTLAYER: &str = "outlayer.testnet";
    const CONTRACT_ID: &str = "patchpay.testnet";

    fn set_context(predecessor: &str, deposit: u128, ts: u64, height: u64) {
        testing_env!(
            VMContextBuilder::new()
                .predecessor_account_id(predecessor.parse().unwrap())
                .signer_account_id(predecessor.parse().unwrap())
                .current_account_id(CONTRACT_ID.parse().unwrap())
                .attached_deposit(NearToken::from_yoctonear(deposit))
                .block_timestamp(ts)
                .block_height(height)
                .build()
        );
    }

    fn setup() -> Contract {
        set_context(OWNER, 0, 1_000_000_000, 100);
        let mut c = Contract::new(OWNER.parse().unwrap());
        // G3: submit_pr now refuses verification while the verifier hash is the
        // UNSET placeholder, so pin a dummy hash here; the suite then exercises
        // verification with the new precondition satisfied.
        c.set_verifier_wasm_hash("test-verifier-hash".to_string());
        c
    }

    fn bounty_args(reward: u128, budget: u128, deadline: u64) -> CreateBountyArgs {
        CreateBountyArgs {
            title: "Fix the flaky indexer test".to_string(),
            description: "Make the indexer integration test deterministic.".to_string(),
            repo: "acme/widgets".to_string(),
            issue_number: Some(42),
            target_branch: "main".to_string(),
            expected_author: None,
            reward: U128(reward),
            verify_budget: U128(budget),
            deadline,
        }
    }

    fn total_deposit(c: &Contract, reward: u128, budget: u128) -> u128 {
        reward + budget + c.get_config().storage_fee.0
    }

    fn create_bounty(c: &mut Contract, reward: u128, budget: u128, deadline: u64) -> u64 {
        let deposit = total_deposit(c, reward, budget);
        set_context(CREATOR, deposit, 1_000_000_000, 100);
        c.create_bounty(bounty_args(reward, budget, deadline))
    }

    fn submit(c: &mut Contract, submitter: &str, bounty_id: u64, pr: u64) -> u64 {
        set_context(submitter, 0, 1_000_000_000, 100);
        c.submit_pr(bounty_id, pr)
    }

    fn valid_output(bounty_id: u64, nonce: u64) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "bounty_id": bounty_id, "nonce": nonce, "verified": true, "reason": "ok",
            "pr_author": "dev-a", "merge_commit_sha": "abc123", "merged_at": "2026-11-03T00:00:00Z",
            "base_ref": "main",
        })
    }

    fn resolve_ok(c: &mut Contract, bounty_id: u64, nonce: u64, v: near_sdk::serde_json::Value) {
        c.handle_verification_outcome(bounty_id, nonce, Ok(v));
    }

    // ---- create ----

    #[test]
    fn create_bounty_ok() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let budget = ONE_NEAR / 20; // 0.05
        let id = create_bounty(&mut c, reward, budget, 2_000_000_000);
        let b = c.get_bounty(id).unwrap();
        assert_eq!(b.creator.as_str(), CREATOR);
        assert_eq!(b.status, BountyStatus::Open);
        assert_eq!(b.reward.0, reward);
        assert_eq!(b.verify_budget.0, budget);
        assert_eq!(b.verify_spent.0, 0);
        assert_eq!(b.attempts, 0);
        // NOTE: the unit-test mock does not track storage_usage, so
        // storage_bytes is 0 here; on-chain it holds the measured delta.
        // Real size coverage lives in storage_fee_covers_worst_case_record.
    }

    #[test]
    #[should_panic(expected = "attach exactly reward + verify_budget + storage_fee")]
    fn create_bounty_rejects_wrong_deposit() {
        let mut c = setup();
        set_context(CREATOR, ONE_NEAR, 1_000_000_000, 100); // too little
        c.create_bounty(bounty_args(2 * ONE_NEAR, ONE_NEAR / 20, 2_000_000_000));
    }

    #[test]
    #[should_panic(expected = "repo must be")]
    fn create_bounty_rejects_bad_repo() {
        let mut c = setup();
        let mut args = bounty_args(ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        args.repo = "not-a-repo".to_string();
        let deposit = total_deposit(&c, ONE_NEAR, ONE_NEAR / 20);
        set_context(CREATOR, deposit, 1_000_000_000, 100);
        c.create_bounty(args);
    }

    #[test]
    #[should_panic(expected = "deadline must be in the future")]
    fn create_bounty_rejects_past_deadline() {
        let mut c = setup();
        let deposit = total_deposit(&c, ONE_NEAR, ONE_NEAR / 20);
        set_context(CREATOR, deposit, 5_000_000_000, 100);
        c.create_bounty(bounty_args(ONE_NEAR, ONE_NEAR / 20, 1_000_000_000));
    }

    #[test]
    #[should_panic(expected = "reward out of bounds")]
    fn create_bounty_rejects_tiny_reward() {
        let mut c = setup();
        let deposit = total_deposit(&c, 1, ONE_NEAR / 20);
        set_context(CREATOR, deposit, 1_000_000_000, 100);
        c.create_bounty(bounty_args(1, ONE_NEAR / 20, 2_000_000_000));
    }

    #[test]
    fn storage_fee_covers_worst_case_record() {
        // §9.7: the storage fee must cover the staking cost of a maxed-out
        // bounty record. The unit-test mock does not track storage usage, so
        // we measure the Borsh-serialized record size directly (this is what
        // the protocol charges per byte, plus trie overhead covered by margin).
        let c = setup();
        let cfg = c.get_config();
        let worst = Bounty {
            id: u64::MAX,
            creator: CREATOR.parse().unwrap(),
            title: "t".repeat(cfg.max_title_len as usize),
            description: "d".repeat(cfg.max_description_len as usize),
            repo: format!("{}/{}", "o".repeat(64), "n".repeat(128)),
            issue_number: Some(u64::MAX),
            target_branch: "b".repeat(64),
            expected_author: Some("a".repeat(64)),
            reward: U128(u128::MAX),
            verify_budget: U128(u128::MAX),
            verify_spent: U128(u128::MAX),
            deadline: u64::MAX,
            status: BountyStatus::Open,
            submission_count: u64::MAX,
            attempts: u64::MAX,
            storage_bytes: u64::MAX,
        };
        let bytes = near_sdk::borsh::to_vec(&worst).unwrap().len() as u128;
        let cost = bytes * STORAGE_PRICE_YOCTO_PER_BYTE;
        println!(
            "worst-case bounty record: {bytes} bytes -> {cost} yocto (storage_fee {})",
            cfg.storage_fee.0
        );
        assert!(
            cost <= cfg.storage_fee.0,
            "storage fee {} does not cover worst-case cost {} ({} bytes)",
            cfg.storage_fee.0,
            cost,
            bytes
        );
    }

    // ---- cancel ----

    #[test]
    fn cancel_bounty_refunds_creator_via_retryable_transfer() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let budget = ONE_NEAR / 20;
        let id = create_bounty(&mut c, reward, budget, 2_000_000_000);
        set_context(CREATOR, 0, 1_000_000_000, 100);
        c.cancel_bounty(id);
        let b = c.get_bounty(id).unwrap();
        assert_eq!(b.status, BountyStatus::Cancelled);
        let pt = c.get_transfer(0).unwrap();
        assert_eq!(pt.to.as_str(), CREATOR);
        assert_eq!(pt.amount.0, reward + budget);
        assert_eq!(pt.kind, TransferKind::BountyRefund);
        assert_eq!(pt.status, TransferStatus::InFlight);
    }

    #[test]
    #[should_panic(expected = "only the creator can cancel")]
    fn cancel_bounty_rejects_non_creator() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.cancel_bounty(id);
    }

    // ---- submit ----

    #[test]
    fn submit_pr_ok_records_attempt_and_fee() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let fee = c.get_config().verification_fee.0;
        let nonce = submit(&mut c, DEV_A, id, 7);
        assert_eq!(nonce, 0);
        let b = c.get_bounty(id).unwrap();
        assert_eq!(b.status, BountyStatus::VerificationPending);
        assert_eq!(b.attempts, 1);
        assert_eq!(b.verify_spent.0, fee);
        assert_eq!(b.submission_count, 1);
        let s = c.get_submission(id, 0).unwrap();
        assert_eq!(s.submitter.as_str(), DEV_A);
        assert_eq!(s.pr_number, 7);
        assert_eq!(s.status, SubmissionStatus::Pending);
        assert_eq!(s.fee_charged.0, fee);
        assert_eq!(s.timeout_height, 100 + 1800);
    }

    #[test]
    #[should_panic(expected = "bounty deadline has passed")]
    fn submit_pr_rejects_after_deadline() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        set_context(DEV_A, 0, 3_000_000_000, 100); // past deadline
        c.submit_pr(id, 7);
    }

    #[test]
    #[should_panic(expected = "bounty is not open")]
    fn submit_pr_rejects_while_pending() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        submit(&mut c, DEV_A, id, 7);
        set_context(DEV_B, 0, 1_000_000_000, 100);
        c.submit_pr(id, 8); // second submitter blocked while one verification is in flight
    }

    #[test]
    #[should_panic(expected = "verification attempts exhausted")]
    fn submit_pr_enforces_attempt_cap() {
        let mut c = setup();
        // budget covers exactly 3 attempts
        let fee = c.get_config().verification_fee.0;
        let id = create_bounty(&mut c, ONE_NEAR, 3 * fee, 2_000_000_000);
        for pr in [7u64, 8, 9] {
            let nonce = submit(&mut c, DEV_A, id, pr);
            // each attempt rejected -> back to Open
            resolve_ok(&mut c, id, nonce, near_sdk::serde_json::json!({"bounty_id": id, "nonce": nonce, "verified": false, "reason": "not_merged"}));
            assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        }
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.submit_pr(id, 10); // 4th attempt -> panic
    }

    #[test]
    #[should_panic(expected = "verify budget exhausted")]
    fn submit_pr_enforces_budget() {
        let mut c = setup();
        let fee = c.get_config().verification_fee.0;
        // budget for exactly 1 attempt, but cap is 3 -> budget binds first
        let id = create_bounty(&mut c, ONE_NEAR, fee, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, near_sdk::serde_json::json!({"bounty_id": id, "nonce": nonce, "verified": false, "reason": "not_merged"}));
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.submit_pr(id, 8); // budget exhausted -> panic
    }

    // ---- verification callback ----

    #[test]
    #[should_panic(expected = "must come from this contract")]
    fn callback_rejects_wrong_predecessor() {
        let c = setup();
        set_context("mallory.testnet", 0, 1_000_000_000, 100);
        c.assert_self_caller();
    }

    #[test]
    fn callback_accepts_self_predecessor() {
        let c = setup();
        set_context("patchpay.testnet", 0, 1_000_000_000, 100);
        c.assert_self_caller(); // must not panic
    }

    #[test]
    fn verified_outcome_moves_to_payout_pending_not_paid() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let id = create_bounty(&mut c, reward, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // §9.2: NEVER marked paid before the transfer-result callback.
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        let b = c.get_bounty(id).unwrap();
        assert_eq!(b.status, BountyStatus::PayoutPending);
        assert_ne!(b.status, BountyStatus::PayoutSucceeded);
        // payout transfer enqueued to the SUBMITTER (§9.1), InFlight
        let pt = c.get_transfer(0).unwrap();
        assert_eq!(pt.to.as_str(), DEV_A);
        assert_eq!(pt.amount.0, reward);
        assert_eq!(pt.kind, TransferKind::PayoutReward);
        assert_eq!(pt.status, TransferStatus::InFlight);
        let s = c.get_submission(id, nonce).unwrap();
        assert_eq!(s.status, SubmissionStatus::Verified);
    }

    #[test]
    fn payout_confirmed_only_on_transfer_success() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let fee = c.get_config().verification_fee.0;
        let budget = 3 * fee; // leaves 2*fee unspent for the budget-refund check
        let id = create_bounty(&mut c, reward, budget, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        // transfer-result callback: success
        c.handle_transfer_result(0, Ok(()));
        let b = c.get_bounty(id).unwrap();
        assert_eq!(b.status, BountyStatus::PayoutSucceeded);
        let pt = c.get_transfer(0).unwrap();
        assert_eq!(pt.status, TransferStatus::Done);
        // unspent budget refunded to creator via retryable transfer
        let refund = c.get_transfer(1).unwrap();
        assert_eq!(refund.to.as_str(), CREATOR);
        assert_eq!(refund.amount.0, budget - fee);
        assert_eq!(refund.kind, TransferKind::BudgetRefund);
    }

    #[test]
    fn payout_transfer_failure_is_recoverable() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        // transfer fails -> PayoutFailed, funds locked, NOT lost
        c.handle_transfer_result(0, Err(PromiseError::Failed));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutFailed);
        assert_eq!(c.get_transfer(0).unwrap().status, TransferStatus::Failed);
        // bounded retry
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.retry_transfer(0);
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutPending);
        assert_eq!(c.get_transfer(0).unwrap().status, TransferStatus::InFlight);
        assert_eq!(c.get_transfer(0).unwrap().attempts, 2);
        // retry succeeds -> paid
        c.handle_transfer_result(0, Ok(()));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutSucceeded);
    }

    #[test]
    fn duplicate_verification_callback_is_noop() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        let transfers_before = c.next_transfer_id;
        // same (bounty_id, nonce) delivered again -> stale, no-op
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        assert_eq!(c.next_transfer_id, transfers_before, "duplicate callback must not create transfers");
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutPending);
    }

    #[test]
    fn nonce_mismatch_rejects_and_reopens() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // verifier echoes a different nonce -> reject, bounty back to Open
        let mut bad = valid_output(id, nonce);
        bad["nonce"] = near_sdk::serde_json::json!(nonce + 99);
        resolve_ok(&mut c, id, nonce, bad);
        assert_eq!(c.get_submission(id, nonce).unwrap().status, SubmissionStatus::Rejected);
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        assert!(c.get_transfer(0).is_none(), "no payout transfer on nonce mismatch");
    }

    #[test]
    fn version_mismatch_rejects() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // §9.8: result claims a different WASM build than the pinned one
        let mut v = valid_output(id, nonce);
        v["wasm_sha256"] = near_sdk::serde_json::json!("deadbeef");
        resolve_ok(&mut c, id, nonce, v);
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        assert!(c.get_transfer(0).is_none());
    }

    #[test]
    fn expired_during_verification_rejects() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // deadline passes while the TEE works
        set_context(OUTLAYER, 0, 3_000_000_000, 100);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        assert!(c.get_transfer(0).is_none(), "expired bounty must never pay");
    }

    #[test]
    fn unparseable_result_rejects_fail_closed() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, near_sdk::serde_json::json!({"garbage": true}));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        assert!(c.get_transfer(0).is_none());
    }

    #[test]
    fn promise_failure_rejects_fail_closed() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        c.handle_verification_outcome(id, nonce, Err(PromiseError::Failed));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        assert!(c.get_transfer(0).is_none());
    }

    // ---- §9.6 adversarial matrix ----

    #[test]
    fn refund_vs_callback_race_callback_noops_exactly_once() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let budget = ONE_NEAR / 20;
        let fee = c.get_config().verification_fee.0;
        let id = create_bounty(&mut c, reward, budget, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // deadline passes with the verification still in flight; creator refunds
        set_context(CREATOR, 0, 3_000_000_000, 100);
        c.claim_refund(id);
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Refunded);
        let refund = c.get_transfer(0).unwrap();
        assert_eq!(refund.to.as_str(), CREATOR);
        assert_eq!(refund.amount.0, reward + budget - fee);
        // the late OutLayer callback (even verified=true) MUST no-op
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Refunded);
        assert!(c.get_transfer(1).is_none(), "late callback must never pay");
        assert_eq!(c.get_submission(id, nonce).unwrap().status, SubmissionStatus::Pending);
    }

    #[test]
    fn concurrent_submitters_nonce_isolation_only_verified_pays() {
        let mut c = setup();
        let reward = 2 * ONE_NEAR;
        let fee = c.get_config().verification_fee.0;
        let id = create_bounty(&mut c, reward, 3 * fee, 2_000_000_000);
        // dev A submits (nonce 0), verification fails -> Open
        let n0 = submit(&mut c, DEV_A, id, 7);
        assert_eq!(n0, 0);
        resolve_ok(&mut c, id, n0, near_sdk::serde_json::json!({"bounty_id": id, "nonce": n0, "verified": false, "reason": "not_merged"}));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        // dev B submits (nonce 1), verified -> B paid, A never paid
        let n1 = submit(&mut c, DEV_B, id, 9);
        assert_eq!(n1, 1);
        resolve_ok(&mut c, id, n1, valid_output(id, n1));
        c.handle_transfer_result(0, Ok(()));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutSucceeded);
        let pt = c.get_transfer(0).unwrap();
        assert_eq!(pt.to.as_str(), DEV_B, "only the verified submitter is paid");
        assert_eq!(pt.amount.0, reward);
        // exactly one payout transfer exists
        let payouts: Vec<_> = (0..c.next_transfer_id)
            .filter_map(|i| c.get_transfer(i))
            .filter(|t| t.kind == TransferKind::PayoutReward)
            .collect();
        assert_eq!(payouts.len(), 1);
    }

    #[test]
    fn duplicate_transfer_callback_is_noop() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        c.handle_transfer_result(0, Ok(()));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutSucceeded);
        // duplicate delivery of the same transfer result -> no-op
        c.handle_transfer_result(0, Ok(()));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutSucceeded);
        // budget == fee here, so no leftover refund: exactly the payout transfer exists
        assert_eq!(c.next_transfer_id, 1);
    }

    // ---- timeout (§9.3) ----

    #[test]
    #[should_panic(expected = "verification timeout not reached yet")]
    fn resolve_timeout_rejects_too_early() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        submit(&mut c, DEV_A, id, 7);
        set_context(DEV_B, 0, 1_000_000_000, 100 + 1799);
        c.resolve_timeout(id);
    }

    #[test]
    fn resolve_timeout_reopens_stuck_bounty() {
        let mut c = setup();
        let fee = c.get_config().verification_fee.0;
        let id = create_bounty(&mut c, ONE_NEAR, 3 * fee, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        // callback never arrives; anyone resolves after the timeout height
        set_context(DEV_B, 0, 1_000_000_000, 100 + 1801);
        c.resolve_timeout(id);
        assert_eq!(c.get_submission(id, nonce).unwrap().status, SubmissionStatus::TimedOut);
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::Open);
        // developer can resubmit (attempts/budget permitting)
        let n1 = submit(&mut c, DEV_A, id, 8);
        assert_eq!(n1, 1);
    }

    // ---- transfer retry bounds + recovery ----

    #[test]
    fn transfer_retry_bounded_then_receiver_recovers() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        let max = c.get_config().max_transfer_attempts;
        // fail all bounded attempts (1 initial + retries)
        c.handle_transfer_result(0, Err(PromiseError::Failed));
        for _ in 1..max {
            set_context(DEV_B, 0, 1_000_000_000, 100);
            c.retry_transfer(0);
            c.handle_transfer_result(0, Err(PromiseError::Failed));
        }
        assert_eq!(c.get_transfer(0).unwrap().attempts, max);
        // bounded retries exhausted -> retry_transfer now panics
        // (checked below); the RECEIVER can still recover explicitly.
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.recover_transfer(0);
        assert_eq!(c.get_transfer(0).unwrap().status, TransferStatus::InFlight);
        c.handle_transfer_result(0, Ok(()));
        assert_eq!(c.get_bounty(id).unwrap().status, BountyStatus::PayoutSucceeded);
    }

    #[test]
    #[should_panic(expected = "transfer attempts exhausted")]
    fn retry_transfer_rejects_after_bound() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        let max = c.get_config().max_transfer_attempts;
        c.handle_transfer_result(0, Err(PromiseError::Failed));
        for _ in 1..max {
            set_context(DEV_B, 0, 1_000_000_000, 100);
            c.retry_transfer(0);
            c.handle_transfer_result(0, Err(PromiseError::Failed));
        }
        set_context(DEV_B, 0, 1_000_000_000, 100);
        c.retry_transfer(0); // exhausted -> panic
    }

    #[test]
    #[should_panic(expected = "only the transfer recipient can recover")]
    fn recover_transfer_rejects_non_recipient() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        let nonce = submit(&mut c, DEV_A, id, 7);
        resolve_ok(&mut c, id, nonce, valid_output(id, nonce));
        let max = c.get_config().max_transfer_attempts;
        c.handle_transfer_result(0, Err(PromiseError::Failed));
        for _ in 1..max {
            set_context(DEV_B, 0, 1_000_000_000, 100);
            c.retry_transfer(0);
            c.handle_transfer_result(0, Err(PromiseError::Failed));
        }
        set_context(DEV_B, 0, 1_000_000_000, 100); // not the recipient
        c.recover_transfer(0);
    }

    // ---- refund validation ----

    #[test]
    #[should_panic(expected = "refund only available after the deadline")]
    fn claim_refund_rejects_before_deadline() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        set_context(CREATOR, 0, 1_000_000_000, 100);
        c.claim_refund(id);
    }

    #[test]
    #[should_panic(expected = "only the creator can claim a refund")]
    fn claim_refund_rejects_non_creator() {
        let mut c = setup();
        let id = create_bounty(&mut c, ONE_NEAR, ONE_NEAR / 20, 2_000_000_000);
        set_context(DEV_A, 0, 3_000_000_000, 100);
        c.claim_refund(id);
    }

    // ---- owner config: values only, no fund movement ----

    #[test]
    fn owner_can_update_config_values() {
        let mut c = setup();
        set_context(OWNER, 0, 1_000_000_000, 100);
        c.set_verifier_wasm_hash("abc123".to_string());
        assert_eq!(c.get_config().verifier_wasm_hash, "abc123");
        c.set_outlayer_contract("outlayer2.testnet".parse().unwrap());
        assert_eq!(c.get_config().outlayer_contract.as_str(), "outlayer2.testnet");
    }

    #[test]
    #[should_panic(expected = "only the owner can call this")]
    fn non_owner_cannot_update_config() {
        let mut c = setup();
        set_context(DEV_A, 0, 1_000_000_000, 100);
        c.set_verifier_wasm_hash("abc123".to_string());
    }
}
