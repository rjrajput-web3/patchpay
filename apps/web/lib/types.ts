/** lib/types.ts — mirrors contracts/near-escrow/src/lib.rs state. */

export type BountyStatus =
  | "Open"
  | "VerificationPending"
  | "VerificationPassed"
  | "PayoutPending"
  | "PayoutSucceeded"
  | "PayoutFailed"
  | "Cancelled"
  | "Refunded"
  | "Expired";

export type SubmissionStatus = "Pending" | "Verified" | "Rejected" | "TimedOut";

export type TransferKind = "PayoutReward" | "BudgetRefund" | "BountyRefund";
export type TransferStatus = "InFlight" | "Done" | "Failed";

export interface Bounty {
  id: number;
  creator: string;
  title: string;
  description: string;
  repo: string; // "owner/repo"
  issue_number: number | null;
  target_branch: string;
  expected_author: string | null;
  reward: string; // yoctoNEAR (U128 serialized as string)
  verify_budget: string;
  verify_spent: string;
  deadline: number; // ns timestamp
  status: BountyStatus;
  submission_count: number;
  attempts: number;
  storage_bytes: number;
}

export interface Submission {
  bounty_id: number;
  submitter: string; // payout receiver — ALWAYS the submit_pr caller
  pr_number: number;
  nonce: number;
  status: SubmissionStatus;
  requested_at: number;
  timeout_height: number;
  fee_charged: string;
}

export interface PendingTransfer {
  id: number;
  bounty_id: number;
  to: string;
  amount: string;
  kind: TransferKind;
  attempts: number;
  status: TransferStatus;
}

export interface ContractConfig {
  outlayer_contract: string;
  verifier_wasm_hash: string;
  verification_fee: string;
  min_reward: string;
  max_reward: string;
  min_verify_budget: string;
  max_verification_attempts: number;
  verification_timeout_blocks: number;
  max_transfer_attempts: number;
  storage_fee: string;
  max_title_len: number;
  max_description_len: number;
}

export interface CreateBountyArgs {
  title: string;
  description: string;
  repo: string;
  issue_number: number | null;
  target_branch: string;
  expected_author: string | null;
  reward: string;
  verify_budget: string;
  deadline: number;
}

/** Local log of this browser's signed transactions (not chain data). */
export interface LocalTx {
  hash: string;
  accountId: string;
  action: string;
  bountyId: number | null;
  ts: number;
}
