/** app/bounties/new/page.tsx — create bounty form + REVIEW SCREEN before signing. */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Section,
  Field,
  inputCls,
  ReviewModal,
  EmptyState,
  type ReviewRow,
} from "../../../components/ui";
import { useWallet } from "../../../components/Wallet";
import { useToasts } from "../../../components/Toasts";
import {
  nearApi,
  ContractNotDeployedError,
  formatNear,
  parseNear,
  logLocalTx,
} from "../../../lib/near";
import { TxProgress } from "../../../components/ui";
import type { ContractConfig, CreateBountyArgs } from "../../../lib/types";
import { CONTRACT_ACCOUNT } from "../../../lib/config";

const GAS_CREATE = "80000000000000"; // 80 TGas

export default function CreateBounty() {
  const router = useRouter();
  const { accountId, setWalletModalOpen, signAndSend } = useWallet();
  const { push } = useToasts();

  const [config, setConfig] = useState<ContractConfig | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repo, setRepo] = useState("");
  const [issueNumber, setIssueNumber] = useState("");
  const [targetBranch, setTargetBranch] = useState("main");
  const [expectedAuthor, setExpectedAuthor] = useState("");
  const [reward, setReward] = useState("");
  const [verifyBudget, setVerifyBudget] = useState("");
  const [deadline, setDeadline] = useState("");
  const [conditions, setConditions] = useState("");

  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<{ hash: string; account: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    nearApi
      .getConfig()
      .then(setConfig)
      .catch((e) => {
        if (e instanceof ContractNotDeployedError) setNotDeployed(true);
      });
  }, []);

  function validate(): string[] {
    const errs: string[] = [];
    if (title.trim().length < 8) errs.push("Title needs at least 8 characters.");
    if (description.trim().length < 30)
      errs.push("Description needs at least 30 characters — developers decide on this.");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim()))
      errs.push("Repository must look like owner/repo.");
    if (issueNumber.trim() && !/^\d+$/.test(issueNumber.trim()))
      errs.push("Issue number must be a positive integer.");
    if (!targetBranch.trim()) errs.push("Target branch is required (e.g. main).");
    const rewardYocto = parseNear(reward.trim());
    if (!rewardYocto || BigInt(rewardYocto) <= 0n)
      errs.push("Reward must be a positive NEAR amount.");
    const budgetYocto = parseNear(verifyBudget.trim());
    if (!budgetYocto || BigInt(budgetYocto) <= 0n)
      errs.push("Verification budget must be a positive NEAR amount.");
    if (config) {
      if (rewardYocto && BigInt(rewardYocto) < BigInt(config.min_reward))
        errs.push(`Reward is below the contract minimum of ${formatNear(config.min_reward)} NEAR.`);
      if (rewardYocto && BigInt(rewardYocto) > BigInt(config.max_reward))
        errs.push(`Reward exceeds the contract maximum of ${formatNear(config.max_reward)} NEAR.`);
      if (budgetYocto && BigInt(budgetYocto) < BigInt(config.min_verify_budget))
        errs.push(
          `Verification budget is below the minimum of ${formatNear(config.min_verify_budget)} NEAR.`
        );
    }
    const dl = new Date(deadline).getTime();
    if (!deadline || Number.isNaN(dl)) errs.push("Pick a submission deadline.");
    else if (dl <= Date.now() + 3600_000)
      errs.push("Deadline must be at least 1 hour in the future.");
    return errs;
  }

  function buildArgs(): CreateBountyArgs {
    const dlNs = new Date(deadline).getTime() * 1_000_000;
    const fullDescription = conditions.trim()
      ? `${description.trim()}\n\n## Acceptance conditions\n${conditions.trim()}`
      : description.trim();
    return {
      title: title.trim(),
      description: fullDescription,
      repo: repo.trim(),
      issue_number: issueNumber.trim() ? Number(issueNumber.trim()) : null,
      target_branch: targetBranch.trim(),
      expected_author: expectedAuthor.trim() ? expectedAuthor.trim() : null,
      reward: parseNear(reward.trim())!,
      verify_budget: parseNear(verifyBudget.trim())!,
      deadline: dlNs,
    };
  }

  function totalDeposit(args: CreateBountyArgs): string {
    const storage = config ? BigInt(config.storage_fee) : 0n;
    return (BigInt(args.reward) + BigInt(args.verify_budget) + storage).toString();
  }

  function openReview() {
    if (!accountId) {
      setWalletModalOpen(true);
      return;
    }
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) {
      push({ kind: "error", title: "Fix the form first", body: errs[0] });
      return;
    }
    setReviewOpen(true);
  }

  async function confirmCreate() {
    const args = buildArgs();
    const deposit = totalDeposit(args);
    setBusy(true);
    try {
      const hash = await signAndSend({
        methodName: "create_bounty",
        args,
        gas: GAS_CREATE,
        deposit,
        actionLabel: "Create bounty",
      });
      logLocalTx({ hash, accountId: accountId!, action: "create_bounty", bountyId: null });
      setReviewOpen(false);
      setTx({ hash, account: accountId! });
      push({ kind: "success", title: "Bounty transaction sent", body: "Waiting for on-chain confirmation." });
    } catch {
      // toast already pushed inside signAndSend
    } finally {
      setBusy(false);
    }
  }

  const reviewRows: ReviewRow[] = (() => {
    if (!reviewOpen) return [];
    const args = buildArgs();
    const rows: ReviewRow[] = [
      { label: "Title", value: args.title },
      { label: "Repository", value: args.repo, mono: true },
      { label: "Target branch", value: args.target_branch, mono: true },
      {
        label: "Issue",
        value: args.issue_number != null ? `#${args.issue_number}` : "—",
        mono: true,
      },
      { label: "Expected author", value: args.expected_author ?? "any developer", mono: true },
      { label: "Reward (locked)", value: `${formatNear(args.reward)} NEAR` },
      { label: "Verification budget", value: `${formatNear(args.verify_budget)} NEAR` },
      {
        label: "Deadline",
        value: new Date(args.deadline / 1_000_000).toLocaleString("en-GB"),
      },
      { label: "Signing as", value: accountId ?? "—", mono: true },
      { label: "Contract", value: CONTRACT_ACCOUNT, mono: true },
    ];
    return rows;
  })();

  return (
    <Section eyebrow="New bounty" title="Put the work — and the money — on record.">
      {notDeployed ? (
        <EmptyState
          title="Bounty creation unlocks after the contract deploys"
          body="The escrow contract is not deployed on this network yet, so no deposit transaction can be signed. The form below shows exactly what a bounty contains — come back after deployment to publish."
        />
      ) : tx ? (
        <div className="mx-auto max-w-2xl space-y-6">
          <TxProgress hash={tx.hash} accountId={tx.account} label="create_bounty" />
          <div className="rounded-2xl border border-line bg-white/70 p-6 shadow-card">
            <p className="font-display text-xl text-ink">Bounty submitted to the chain.</p>
            <p className="mt-2 text-sm text-muted">
              Once the transaction confirms, your bounty appears in the marketplace
              with the reward locked in escrow.
            </p>
            <div className="mt-5 flex gap-3">
              <Link
                href="/bounties"
                className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
              >
                View marketplace
              </Link>
              <button
                onClick={() => setTx(null)}
                className="rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition hover:bg-white"
              >
                Create another
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form
          className="mx-auto grid max-w-3xl gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            openReview();
          }}
        >
          {errors.length > 0 && (
            <div className="rounded-xl border border-red-700/30 bg-red-700/5 px-5 py-4">
              <p className="text-sm font-semibold text-red-800">Please fix:</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Bounty title" required>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls}
              placeholder="Fix the pagination bug in the orders API" maxLength={120} />
          </Field>

          <Field label="Detailed task description" required
            hint="What exactly needs to change, how it will be judged, test expectations. This is what developers work from.">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} min-h-[140px]`}
              placeholder="Describe the task, the expected behavior, and how the fix will be verified…" maxLength={4000} />
          </Field>

          <div className="grid gap-6 md:grid-cols-2">
            <Field label="GitHub repository" required hint="Format: owner/repo (public repo).">
              <input value={repo} onChange={(e) => setRepo(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="acme/widgets" />
            </Field>
            <Field label="Issue number" hint="Optional — links the bounty to a GitHub issue.">
              <input value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="42" inputMode="numeric" />
            </Field>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Required target branch" required hint="The PR must target this branch.">
              <input value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="main" />
            </Field>
            <Field label="Expected developer (GitHub)" hint="Optional — only this GitHub user can claim the bounty.">
              <input value={expectedAuthor} onChange={(e) => setExpectedAuthor(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="octocat" />
            </Field>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <Field label="Reward (NEAR)" required hint="Locked in escrow on creation.">
              <input value={reward} onChange={(e) => setReward(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="25" inputMode="decimal" />
            </Field>
            <Field label="Verification budget (NEAR)" required
              hint={`Covers TEE execution fees. ${config ? `Min ${formatNear(config.min_verify_budget)}.` : ""} Unused budget is refunded.`}>
              <input value={verifyBudget} onChange={(e) => setVerifyBudget(e.target.value)} className={`${inputCls} font-mono`}
                placeholder="2" inputMode="decimal" />
            </Field>
            <Field label="Submission deadline" required hint="After this, no new submissions; you may refund.">
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Acceptance conditions"
            hint="Optional — merged into the bounty description. Be specific: what counts as done?">
            <textarea value={conditions} onChange={(e) => setConditions(e.target.value)} className={`${inputCls} min-h-[100px]`}
              placeholder="- All existing tests pass&#10;- New unit test covers the fixed behavior&#10;- No new dependencies" maxLength={2000} />
          </Field>

          <div className="rounded-2xl border border-line bg-paperdeep/60 p-6 text-sm leading-relaxed text-charcoal">
            <p className="font-semibold text-ink">What happens when you continue:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>You review every field on the next screen.</li>
              <li>You approve <strong>one</strong> transaction in your wallet: the reward + verification budget + storage fee move into the escrow contract.</li>
              <li>The bounty goes live on the marketplace as <strong>Open</strong>.</li>
            </ol>
          </div>

          <button
            type="submit"
            className="rounded-full bg-ink px-8 py-4 text-sm font-semibold text-paper transition hover:bg-charcoal hover:shadow-lift"
          >
            {accountId ? "Review bounty →" : "Connect wallet to continue →"}
          </button>
        </form>
      )}

      <ReviewModal
        open={reviewOpen}
        title="Review bounty"
        rows={reviewRows}
        depositLine={
          reviewOpen
            ? `${formatNear(totalDeposit(buildArgs()))} NEAR → ${CONTRACT_ACCOUNT}`
            : undefined
        }
        onConfirm={confirmCreate}
        onClose={() => !busy && setReviewOpen(false)}
        confirmLabel="Sign & create bounty"
        busy={busy}
      />
    </Section>
  );
}
