/** app/bounties/[id]/submit/page.tsx — submit PR + claim-line instructions + status tracker. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Section,
  Field,
  inputCls,
  ReviewModal,
  EmptyState,
  TxProgress,
  type ReviewRow,
} from "../../../../components/ui";
import { useWallet } from "../../../../components/Wallet";
import { useToasts } from "../../../../components/Toasts";
import {
  nearApi,
  ContractNotDeployedError,
  formatNear,
  formatDeadline,
  deadlinePassed,
  logLocalTx,
} from "../../../../lib/near";
import { CONTRACT_ACCOUNT, githubPrUrl } from "../../../../lib/config";
import type { Bounty, Submission } from "../../../../lib/types";

const GAS_SUBMIT = "150000000000000"; // 150 TGas — cross-contract call to OutLayer

export default function SubmitPr() {
  const params = useParams();
  const id = Number(params.id);
  const { accountId, setWalletModalOpen, signAndSend } = useWallet();
  const { push } = useToasts();

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const [prNumber, setPrNumber] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Verification status tracker: after submit, poll the submission nonce.
  const [tracked, setTracked] = useState<{
    nonce: number;
    pr: number;
    txHash: string;
    account: string;
  } | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const b = await nearApi.getBounty(id);
      if (!b) setNotFound(true);
      else setBounty(b);
    } catch (e) {
      if (e instanceof ContractNotDeployedError) setNotDeployed(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  const startTracking = useCallback(
    (nonce: number, pr: number, txHash: string, account: string) => {
      setTracked({ nonce, pr, txHash, account });
      const poll = async () => {
        try {
          const s = await nearApi.getSubmission(id, nonce);
          if (s) {
            setSubmission(s);
            if (s.status !== "Pending") {
              if (pollRef.current) clearInterval(pollRef.current);
              if (s.status === "Verified") {
                push({
                  kind: "success",
                  title: "Verification passed",
                  body: `PR #${pr} verified. The payout transfer is now in flight — watch the bounty page.`,
                });
              } else if (s.status === "Rejected") {
                push({
                  kind: "error",
                  title: "Verification failed",
                  body: "The PR did not satisfy the bounty conditions. The bounty is Open again — check the reason and resubmit if you can fix it.",
                });
              } else {
                push({ kind: "info", title: "Verification timed out", body: "The bounty returned to Open." });
              }
            }
          }
        } catch {
          /* keep polling */
        }
      };
      void poll();
      pollRef.current = setInterval(poll, 8000);
    },
    [id, push]
  );

  function openReview() {
    if (!accountId) {
      setWalletModalOpen(true);
      return;
    }
    if (!bounty) return;
    if (!/^\d+$/.test(prNumber.trim()) || Number(prNumber) <= 0) {
      push({ kind: "error", title: "Enter a valid PR number", body: "e.g. 123" });
      return;
    }
    if (deadlinePassed(bounty.deadline)) {
      push({ kind: "error", title: "Deadline passed", body: "This bounty no longer accepts submissions." });
      return;
    }
    if (bounty.status !== "Open") {
      push({ kind: "error", title: "Bounty is not open", body: `Current status: ${bounty.status}` });
      return;
    }
    setReviewOpen(true);
  }

  async function confirmSubmit() {
    if (!bounty || !accountId) return;
    const pr = Number(prNumber.trim());
    // The nonce for the new submission = current submission_count.
    const expectedNonce = bounty.submission_count;
    setBusy(true);
    try {
      const hash = await signAndSend({
        methodName: "submit_pr",
        args: { bounty_id: id, pr_number: pr },
        gas: GAS_SUBMIT,
        deposit: "0",
        actionLabel: "Submit PR",
        bountyId: id,
      });
      logLocalTx({ hash, accountId, action: "submit_pr", bountyId: id });
      setReviewOpen(false);
      push({
        kind: "success",
        title: "PR submitted",
        body: "The contract has called the TEE verifier. Tracking verification status below.",
      });
      startTracking(expectedNonce, pr, hash, accountId);
    } catch {
      // toast already pushed
    } finally {
      setBusy(false);
    }
  }

  const claimLine = accountId ? `Claim: ${accountId}` : "Claim: <your-near-account>";

  const reviewRows: ReviewRow[] = bounty
    ? [
        { label: "Bounty", value: `#${bounty.id} — ${bounty.title}` },
        { label: "Repository", value: bounty.repo, mono: true },
        { label: "PR number", value: `#${prNumber.trim()}`, mono: true },
        { label: "Required claim line in PR body", value: claimLine, mono: true },
        {
          label: "Payout goes to",
          value: accountId ?? "—",
          mono: true,
        },
        {
          label: "What happens next",
          value: "The contract calls the TEE verifier; the result arrives as an on-chain callback. No fee is charged to you.",
        },
      ]
    : [];

  return (
    <Section eyebrow={`Bounty #${id}`} title="Submit your pull request.">
      {notDeployed || notFound || !bounty ? (
        <EmptyState
          title={notDeployed ? "Contract not deployed yet" : notFound ? "Bounty not found" : "Loading…"}
          body={
            notDeployed
              ? "Submissions open after the escrow contract deploys."
              : notFound
              ? "Check the marketplace for live bounties."
              : "Fetching bounty data from the contract."
          }
        />
      ) : tracked ? (
        <div className="mx-auto max-w-2xl space-y-6">
          <TxProgress hash={tracked.txHash} accountId={tracked.account} label="submit_pr" />
          <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
            <div className="flex items-center gap-4">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full font-mono text-sm font-bold ${
                  !submission || submission.status === "Pending"
                    ? "animate-pulse bg-accent text-white"
                    : submission.status === "Verified"
                    ? "bg-moss text-white"
                    : "bg-faint text-white"
                }`}
              >
                {!submission || submission.status === "Pending" ? "…" : submission.status === "Verified" ? "✓" : "×"}
              </span>
              <div>
                <p className="font-display text-xl text-ink">
                  {!submission || submission.status === "Pending"
                    ? "Verification in progress"
                    : submission.status === "Verified"
                    ? "Verified — payout queued"
                    : `Submission ${submission.status.toLowerCase()}`}
                </p>
                <p className="font-mono text-xs text-faint">
                  bounty #{id} · nonce {tracked.nonce} · PR #{tracked.pr}
                </p>
              </div>
            </div>
            <ol className="mt-6 space-y-3 text-sm">
              {[
                ["Submitted", "Your submit_pr transaction is on-chain."],
                ["TEE verification", "OutLayer workers check the PR inside Intel TDX (usually under a minute)."],
                ["Callback", "The result returns to the escrow contract via an on-chain callback."],
                ["Payout", "On success, the reward transfers to your wallet — the submitter."],
              ].map(([t, d], i) => {
                const done =
                  i === 0 ||
                  (submission?.status !== "Pending" && submission != null && i <= 2) ||
                  (submission?.status === "Verified" && i <= 3);
                return (
                  <li key={t} className="flex gap-3">
                    <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${done ? "bg-moss" : "bg-line"}`} />
                    <span>
                      <strong className="text-ink">{t}.</strong>{" "}
                      <span className="text-muted">{d}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/bounties/${id}`}
                className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
              >
                Watch the bounty →
              </Link>
              <Link
                href={`/proof/${id}/${tracked.nonce}`}
                className="rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition hover:bg-white"
              >
                Open proof page
              </Link>
            </div>
            <p className="mt-4 text-xs text-faint">
              This page polls the contract every 8 seconds. You can leave and come
              back — the submission state lives on-chain.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-5">
          <form
            className="space-y-6 lg:col-span-3"
            onSubmit={(e) => {
              e.preventDefault();
              openReview();
            }}
          >
            <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
              <Field label="Pull request number" required
                hint={`The PR in ${bounty.repo} that implements this bounty.`}>
                <input
                  value={prNumber}
                  onChange={(e) => setPrNumber(e.target.value)}
                  className={`${inputCls} font-mono`}
                  placeholder="123"
                  inputMode="numeric"
                />
              </Field>
              {prNumber.trim() && /^\d+$/.test(prNumber.trim()) && (
                <a
                  href={githubPrUrl(bounty.repo, Number(prNumber.trim()))}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-sm font-semibold text-accent underline underline-offset-2"
                >
                  Open {bounty.repo}#{prNumber.trim()} on GitHub ↗
                </a>
              )}
              <div className="mt-5 flex items-center justify-between border-t border-line pt-5 text-sm">
                <span className="text-muted">Reward on success</span>
                <span className="font-display text-xl text-ink">{formatNear(bounty.reward)} NEAR</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-muted">Deadline</span>
                <span className="text-ink">{formatDeadline(bounty.deadline)}</span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-full bg-accent px-8 py-4 text-sm font-semibold text-white transition hover:bg-accentdeep hover:shadow-lift"
            >
              {accountId ? "Review submission →" : "Connect wallet to continue →"}
            </button>
          </form>

          {/* Claim-line instructions */}
          <aside className="lg:col-span-2">
            <div className="rounded-2xl border border-accent/40 bg-accent/5 p-7">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-accentdeep">Required</p>
              <h2 className="mt-2 font-display text-xl text-ink">The claim line</h2>
              <p className="mt-3 text-sm leading-relaxed text-charcoal">
                Your PR body must contain <strong>exactly</strong> this line, or
                verification fails. It binds the PR to your wallet — the payout
                can only ever go to the account that submits.
              </p>
              <div className="mt-4 rounded-xl bg-ink p-4">
                <code className="break-all font-mono text-sm text-paper">{claimLine}</code>
              </div>
              {!accountId && (
                <p className="mt-3 text-xs text-muted">
                  Connect your wallet first — the claim must equal your exact NEAR
                  account ID.
                </p>
              )}
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(claimLine).then(
                    () => push({ kind: "success", title: "Claim line copied" }),
                    () => push({ kind: "error", title: "Copy failed", body: "Select and copy the line manually." })
                  );
                }}
                className="mt-4 rounded-full border border-accent/50 px-5 py-2.5 text-sm font-semibold text-accentdeep transition hover:bg-accent/10"
              >
                Copy claim line
              </button>
              <div className="mt-6 border-t border-accent/25 pt-5">
                <p className="mb-3 text-sm font-semibold text-ink">The verifier will check:</p>
                <ul className="space-y-2 text-sm text-charcoal">
                  <li>✓ PR is merged into <code className="font-mono text-xs">{bounty.target_branch}</code></li>
                  <li>✓ Repository is exactly <code className="font-mono text-xs">{bounty.repo}</code></li>
                  {bounty.expected_author && (
                    <li>✓ PR author is <code className="font-mono text-xs">{bounty.expected_author}</code></li>
                  )}
                  <li>✓ Claim line matches the submitter</li>
                  <li>✓ Merge happened before the deadline</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      )}

      <ReviewModal
        open={reviewOpen}
        title="Review submission"
        rows={reviewRows}
        onConfirm={confirmSubmit}
        onClose={() => !busy && setReviewOpen(false)}
        confirmLabel="Sign & submit PR"
        busy={busy}
      />
    </Section>
  );
}
