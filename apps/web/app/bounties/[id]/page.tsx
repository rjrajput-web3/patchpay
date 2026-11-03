/** app/bounties/[id]/page.tsx — bounty detail: full bounty, payout-state timeline, actions. */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Section,
  StatusBadge,
  ReviewModal,
  EmptyState,
  StatCard,
  TxProgress,
  ContractLoading,
  type ReviewRow,
} from "../../../components/ui";
import { useWallet } from "../../../components/Wallet";
import { useToasts } from "../../../components/Toasts";
import {
  nearApi,
  ContractNotDeployedError,
  formatNear,
  formatDeadline,
  deadlinePassed,
  timeLeft,
  logLocalTx,
} from "../../../lib/near";
import {
  CONTRACT_ACCOUNT,
  githubRepoUrl,
  githubPrUrl,
  githubIssueUrl,
  explorerAccountUrl,
} from "../../../lib/config";
import type { Bounty, BountyStatus, ContractConfig, Submission } from "../../../lib/types";

const GAS = {
  submit: "150000000000000", // cross-contract call to OutLayer
  cancel: "60000000000000",
  refund: "80000000000000",
  retry: "80000000000000",
  timeout: "60000000000000",
};

// ---------------------------------------------------------------------------
// Payout retry box — asks for the transfer id honestly. The contract exposes
// get_transfer(id) but no list view, so the id must come from the payout
// transaction on the explorer (known gap, documented for Track A).
// ---------------------------------------------------------------------------
function PayoutRetryBox({
  bounty,
  accountId,
  submitter,
  onReview,
  onConnect,
}: {
  bounty: Bounty;
  accountId: string | null;
  submitter?: string;
  onReview: (transferId: number) => void;
  onConnect: () => void;
}) {
  const [transferId, setTransferId] = useState("");
  return (
    <div className="mt-5 rounded-xl border border-red-700/30 bg-red-700/5 p-4 text-sm text-red-900">
      <strong>The payout transfer failed.</strong> Funds are still locked in
      escrow — nothing was lost.
      <p className="mt-2 text-xs leading-relaxed text-red-800/80">
        Find the transfer ID in the payout transaction on the NEAR explorer
        (the contract's <code className="font-mono">transfer_id</code> from the
        verification-result receipt), then retry below.
      </p>
      {accountId ? (
        <div className="mt-3 flex gap-2">
          <input
            value={transferId}
            onChange={(e) => setTransferId(e.target.value)}
            placeholder="transfer id, e.g. 3"
            inputMode="numeric"
            className="w-40 rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink"
          />
          <button
            disabled={!/^\d+$/.test(transferId)}
            onClick={() => onReview(Number(transferId))}
            className="rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40"
          >
            Review retry →
          </button>
        </div>
      ) : (
        <button onClick={onConnect} className="mt-3 font-semibold underline underline-offset-2">
          Connect a wallet to retry →
        </button>
      )}
      {submitter && (
        <p className="mt-2 font-mono text-xs text-red-800/70">
          receiver: {submitter} · amount: {formatNear(bounty.reward)} NEAR
        </p>
      )}
    </div>
  );
}

// Payout timeline derived honestly from the contract status (§9.2).
function payoutSteps(status: BountyStatus): { code: string; state: "done" | "active" | "todo" | "failed" }[] {
  const order = ["VerificationPassed", "PayoutPending", "PayoutSucceeded"] as const;
  const idx: Record<string, number> = {
    Open: -1,
    VerificationPending: -1,
    VerificationPassed: 0,
    PayoutPending: 1,
    PayoutSucceeded: 2,
    PayoutFailed: 1, // failed at the PayoutPending step
    Cancelled: -2,
    Refunded: -2,
    Expired: -2,
  };
  const at = idx[status] ?? -1;
  if (at === -2) return [];
  return order.map((code, i) => ({
    code,
    state:
      status === "PayoutFailed" && code === "PayoutPending"
        ? "failed"
        : i < at
        ? "done"
        : i === at
        ? "active"
        : "todo",
  }));
}

export default function BountyDetail() {
  const params = useParams();
  const id = Number(params.id);
  const { accountId, setWalletModalOpen, signAndSend } = useWallet();
  const { push } = useToasts();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [config, setConfig] = useState<ContractConfig | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [notDeployed, setNotDeployed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [review, setReview] = useState<{
    title: string;
    rows: ReviewRow[];
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<{ hash: string; account: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id < 0) {
      setNotFound(true);
      return;
    }
    try {
      const [b, cfg] = await Promise.all([nearApi.getBounty(id), nearApi.getConfig()]);
      if (!b) {
        setNotFound(true);
        return;
      }
      setBounty(b);
      setConfig(cfg);
      // Load all submissions by nonce (nonce = 0..submission_count-1).
      const subs: Submission[] = [];
      for (let n = 0; n < b.submission_count; n++) {
        const s = await nearApi.getSubmission(id, n);
        if (s) subs.push(s);
      }
      setSubmissions(subs.reverse());
    } catch (e) {
      if (e instanceof ContractNotDeployedError) setNotDeployed(true);
      else setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    title: string,
    rows: ReviewRow[],
    confirmLabel: string,
    methodName: string,
    args: Record<string, unknown>,
    gas: string,
    deposit: string,
    actionLabel: string
  ) {
    if (!accountId) {
      setWalletModalOpen(true);
      return;
    }
    setReview({
      title,
      rows,
      confirmLabel,
      run: async () => {
        setBusy(true);
        try {
          const hash = await signAndSend({
            methodName,
            args,
            gas,
            deposit,
            actionLabel,
            bountyId: id,
          });
          logLocalTx({ hash, accountId: accountId!, action: methodName, bountyId: id });
          setReview(null);
          setTx({ hash, account: accountId!, label: methodName });
          push({ kind: "success", title: "Transaction sent", body: "Waiting for on-chain confirmation." });
          setTimeout(() => void load(), 15000);
        } finally {
          setBusy(false);
        }
      },
    });
  }

  if (notDeployed) {
    return (
      <Section eyebrow={`Bounty #${id}`} title="Contract not deployed yet">
        <EmptyState
          title="No on-chain data to show"
          body="The escrow contract is not deployed on this network yet. Bounty details will render live from the contract after deployment."
        />
      </Section>
    );
  }
  if (notFound) {
    return (
      <Section eyebrow="Bounty" title="Not found">
        <EmptyState
          title={`Bounty #${id} does not exist`}
          body="It may have been a wrong link. The marketplace lists every live bounty."
          action={
            <Link href="/bounties" className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper">
              Back to marketplace
            </Link>
          }
        />
      </Section>
    );
  }
  if (loadError) {
    return (
      <Section eyebrow={`Bounty #${id}`} title="Could not load">
        <EmptyState title="Something went wrong" body={loadError} />
      </Section>
    );
  }
  if (!bounty) {
    return (
      <Section eyebrow={`Bounty #${id}`} title="Loading bounty">
        <ContractLoading what="this bounty" />
      </Section>
    );
  }

  const isCreator = accountId === bounty.creator;
  const expired = deadlinePassed(bounty.deadline);
  const budgetLeft = BigInt(bounty.verify_budget) - BigInt(bounty.verify_spent);
  const maxAttempts = config?.max_verification_attempts ?? 0;
  const steps = payoutSteps(bounty.status);

  const actionRow = (label: string, value: React.ReactNode, mono = false): ReviewRow => ({ label, value, mono });

  return (
    <Section eyebrow={`Bounty #${bounty.id}`} title={bounty.title}>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={bounty.status} />
        <span className="font-mono text-xs text-faint">
          {expired ? "deadline passed" : timeLeft(bounty.deadline)}
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* ------------------------------------------------ main column */}
        <div className="space-y-8 lg:col-span-2">
          <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
            <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-faint">Task</h2>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-charcoal">
              {bounty.description}
            </p>
            <div className="mt-6 grid gap-3 border-t border-line pt-6 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs text-faint">Repository</p>
                <a href={githubRepoUrl(bounty.repo)} target="_blank" rel="noreferrer"
                  className="font-mono font-semibold text-accent underline underline-offset-2">
                  {bounty.repo} ↗
                </a>
              </div>
              <div>
                <p className="text-xs text-faint">Target branch</p>
                <p className="font-mono font-semibold text-ink">⎇ {bounty.target_branch}</p>
              </div>
              <div>
                <p className="text-xs text-faint">Issue</p>
                {bounty.issue_number != null ? (
                  <a href={githubIssueUrl(bounty.repo, bounty.issue_number)} target="_blank" rel="noreferrer"
                    className="font-mono font-semibold text-accent underline underline-offset-2">
                    #{bounty.issue_number} ↗
                  </a>
                ) : (
                  <p className="text-muted">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-faint">Expected author</p>
                <p className="font-mono font-semibold text-ink">
                  {bounty.expected_author ?? "any developer"}
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Creator</p>
                <a href={explorerAccountUrl(bounty.creator)} target="_blank" rel="noreferrer"
                  className="break-all font-mono text-xs font-semibold text-accent underline underline-offset-2">
                  {bounty.creator} ↗
                </a>
              </div>
              <div>
                <p className="text-xs text-faint">Deadline</p>
                <p className="font-semibold text-ink">{formatDeadline(bounty.deadline)}</p>
              </div>
            </div>
          </div>

          {/* ---------------- payout state machine (§9.2) */}
          {steps.length > 0 && (
            <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
              <h2 className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-faint">
                Payout state — from the contract
              </h2>
              <ol className="space-y-4">
                {steps.map((s) => (
                  <li key={s.code} className="flex items-center gap-4">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                        s.state === "done"
                          ? "bg-moss text-white"
                          : s.state === "active"
                          ? "bg-accent text-white"
                          : s.state === "failed"
                          ? "bg-red-700 text-white"
                          : "border border-line text-faint"
                      }`}
                    >
                      {s.state === "done" ? "✓" : s.state === "failed" ? "!" : "·"}
                    </span>
                    <div>
                      <p className="flex items-center gap-2 font-mono text-sm font-bold text-ink">
                        {s.code}
                        {s.state === "active" && (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            current
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {s.code === "VerificationPassed" && "Verifier said yes. Payout queued — not paid yet."}
                        {s.code === "PayoutPending" && "Reward transfer in flight, awaiting transfer-result callback."}
                        {s.code === "PayoutSucceeded" && "Transfer confirmed on-chain. The developer is paid."}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              {bounty.status === "PayoutFailed" && (
                <PayoutRetryBox
                  bounty={bounty}
                  accountId={accountId}
                  submitter={submissions.find((s) => s.status === "Verified")?.submitter}
                  onReview={(transferId) =>
                    runAction(
                      "Retry payout transfer",
                      [
                        actionRow("Bounty", `#${bounty.id}`),
                        actionRow("Transfer ID", String(transferId), true),
                        actionRow(
                          "Receiver",
                          submissions.find((s) => s.status === "Verified")?.submitter ?? "—",
                          true
                        ),
                        actionRow("Amount", `${formatNear(bounty.reward)} NEAR`),
                        actionRow("Signing as", accountId ?? "—", true),
                      ],
                      "Sign & retry payout",
                      "retry_transfer",
                      { transfer_id: transferId },
                      GAS.retry,
                      "0",
                      "Retry payout"
                    )
                  }
                  onConnect={() => setWalletModalOpen(true)}
                />
              )}
            </div>
          )}

          {/* ---------------- submissions */}
          <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
            <h2 className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-faint">
              Submissions ({submissions.length})
            </h2>
            {submissions.length === 0 ? (
              <p className="text-sm text-muted">
                No submissions yet. {bounty.status === "Open" && "Do the work, open a PR, and submit it."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {submissions.map((s) => (
                  <li key={s.nonce} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-4">
                    <span className="font-mono text-xs text-faint">nonce {s.nonce}</span>
                    <a href={githubPrUrl(bounty.repo, s.pr_number)} target="_blank" rel="noreferrer"
                      className="font-mono text-sm font-semibold text-accent underline underline-offset-2">
                      PR #{s.pr_number} ↗
                    </a>
                    <span className="break-all font-mono text-xs text-muted">{s.submitter}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        s.status === "Verified"
                          ? "bg-moss/10 text-moss"
                          : s.status === "Pending"
                          ? "bg-accent/10 text-accentdeep"
                          : "bg-faint/10 text-faint"
                      }`}
                    >
                      {s.status}
                    </span>
                    <Link
                      href={`/proof/${bounty.id}/${s.nonce}`}
                      className="ml-auto text-xs font-semibold text-accent underline underline-offset-2"
                    >
                      Proof →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {tx && (
            <TxProgress hash={tx.hash} accountId={tx.account} label={tx.label} />
          )}
        </div>

        {/* ------------------------------------------------ side column */}
        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-ink p-7 text-paper shadow-card">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-paper/50">Reward (locked)</p>
            <p className="mt-2 font-display text-4xl">
              {formatNear(bounty.reward)} <span className="text-lg text-paper/60">NEAR</span>
            </p>
            <div className="mt-5 space-y-2 border-t border-paper/15 pt-5 text-sm">
              <div className="flex justify-between">
                <span className="text-paper/60">Verification budget</span>
                <span className="font-mono">{formatNear(bounty.verify_budget)} <span className="text-paper/40">NEAR</span></span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Budget spent</span>
                <span className="font-mono">{formatNear(bounty.verify_spent)} <span className="text-paper/40">NEAR</span></span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Budget left</span>
                <span className="font-mono text-accent">{formatNear(budgetLeft.toString())} <span className="text-paper/40">NEAR</span></span>
              </div>
              <div className="flex justify-between">
                <span className="text-paper/60">Attempts used</span>
                <span className="font-mono">
                  {bounty.attempts}{maxAttempts ? ` / ${maxAttempts}` : ""}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {bounty.status === "Open" && !expired && (
              <Link
                href={`/bounties/${bounty.id}/submit`}
                className="block rounded-full bg-accent px-6 py-4 text-center text-sm font-semibold text-white transition hover:bg-accentdeep hover:shadow-lift"
              >
                Submit a pull request →
              </Link>
            )}
            {bounty.status === "Open" && expired && (
              <p className="rounded-xl border border-line bg-paperdeep/60 px-4 py-3 text-sm text-muted">
                Deadline passed — no new submissions. The creator may refund.
              </p>
            )}
            {isCreator && bounty.status === "Open" && (
              <button
                onClick={() =>
                  runAction(
                    "Cancel bounty",
                    [
                      actionRow("Bounty", `#${bounty.id} — ${bounty.title}`),
                      actionRow("Refund to you", `${formatNear(bounty.reward)} NEAR reward + ${formatNear(budgetLeft.toString())} NEAR unused budget`),
                      actionRow("Signing as", accountId ?? "—", true),
                      actionRow("Contract", CONTRACT_ACCOUNT, true),
                    ],
                    "Sign & cancel bounty",
                    "cancel_bounty",
                    { bounty_id: bounty.id },
                    GAS.cancel,
                    "0",
                    "Cancel bounty"
                  )
                }
                className="block w-full rounded-full border border-line px-6 py-3.5 text-center text-sm font-semibold text-ink transition hover:bg-white"
              >
                Cancel bounty & refund
              </button>
            )}
            {isCreator && expired && (bounty.status === "Open" || bounty.status === "VerificationPending") && (
              <button
                onClick={() =>
                  runAction(
                    "Claim refund",
                    [
                      actionRow("Bounty", `#${bounty.id} — ${bounty.title}`),
                      actionRow("Refund to you", `${formatNear(bounty.reward)} NEAR reward + ${formatNear(budgetLeft.toString())} NEAR unused budget`),
                      actionRow("Deadline was", formatDeadline(bounty.deadline)),
                      actionRow("Signing as", accountId ?? "—", true),
                    ],
                    "Sign & claim refund",
                    "claim_refund",
                    { bounty_id: bounty.id },
                    GAS.refund,
                    "0",
                    "Claim refund"
                  )
                }
                className="block w-full rounded-full border border-clay/40 px-6 py-3.5 text-center text-sm font-semibold text-clay transition hover:bg-clay/5"
              >
                Claim refund (deadline passed)
              </button>
            )}
            {bounty.status === "VerificationPending" && (
              <button
                onClick={() =>
                  runAction(
                    "Resolve timed-out verification",
                    [
                      actionRow("Bounty", `#${bounty.id} — ${bounty.title}`),
                      actionRow("Effect", "Marks the stuck submission TimedOut and returns the bounty to Open"),
                      actionRow("Signing as", accountId ?? "—", true),
                    ],
                    "Sign & resolve timeout",
                    "resolve_timeout",
                    { bounty_id: bounty.id },
                    GAS.timeout,
                    "0",
                    "Resolve timeout"
                  )
                }
                className="block w-full rounded-full border border-line px-6 py-3.5 text-center text-sm font-semibold text-ink transition hover:bg-white"
              >
                Resolve stuck verification
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white/70 p-6">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-faint">Bounty facts</p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Bounty ID</dt><dd className="font-mono text-ink">#{bounty.id}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Storage bytes</dt><dd className="font-mono text-ink">{bounty.storage_bytes}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Submissions</dt><dd className="font-mono text-ink">{bounty.submission_count}</dd></div>
            </dl>
          </div>
        </div>
      </div>

      <ReviewModal
        open={review !== null}
        title={review?.title ?? ""}
        rows={review?.rows ?? []}
        onConfirm={() => void review?.run()}
        onClose={() => !busy && setReview(null)}
        confirmLabel={review?.confirmLabel ?? "Sign & send"}
        busy={busy}
      />
    </Section>
  );
}
