/** app/proof/[bountyId]/[nonce]/page.tsx — PUBLIC proof center. Read-only, no wallet needed. */
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Section, EmptyState } from "../../../../components/ui";
import {
  nearApi,
  ContractNotDeployedError,
  formatNear,
  formatDeadline,
  shortenHash,
} from "../../../../lib/near";
import {
  VERIFIER_WASM_HASH,
  OUTLAYER_CONTRACT,
  OUTLAYER_API_URL,
  githubRepoUrl,
  githubPrUrl,
  explorerAccountUrl,
  NETWORK_ID,
} from "../../../../lib/config";
import type { Bounty, ContractConfig, Submission } from "../../../../lib/types";

function Row({ k, v, mono = true }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/60 py-3.5 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="shrink-0 text-sm text-muted">{k}</dt>
      <dd className={`text-sm text-ink ${mono ? "font-mono break-all text-right" : "text-right"}`}>{v}</dd>
    </div>
  );
}

export default function ProofCenter() {
  const params = useParams();
  const bountyId = Number(params.bountyId);
  const nonce = Number(params.nonce);

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [config, setConfig] = useState<ContractConfig | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(bountyId) || !Number.isInteger(nonce) || bountyId < 0 || nonce < 0) {
      setNotFound(true);
      return;
    }
    Promise.all([
      nearApi.getBounty(bountyId),
      nearApi.getSubmission(bountyId, nonce),
      nearApi.getConfig(),
    ])
      .then(([b, s, c]) => {
        if (!b || !s) setNotFound(true);
        else {
          setBounty(b);
          setSubmission(s);
          setConfig(c);
        }
      })
      .catch((e) => {
        if (e instanceof ContractNotDeployedError) setNotDeployed(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
  }, [bountyId, nonce]);

  const wasmHash = config?.verifier_wasm_hash || VERIFIER_WASM_HASH;
  const outlayer = config?.outlayer_contract || OUTLAYER_CONTRACT;

  return (
    <Section
      eyebrow="Proof center"
      title={
        <>
          Don't trust. <em className="text-accent">Verify.</em>
        </>
      }
    >
      <p className="mb-10 max-w-2xl text-muted">
        Public and read-only — no wallet needed. Everything below is either read
        live from the escrow contract or independently checkable on GitHub, the
        NEAR explorer, and OutLayer's attestation records.
      </p>

      {notDeployed ? (
        <EmptyState
          title="No proofs exist yet"
          body="The escrow contract is not deployed on this network, so no verification has run. Proofs will appear here after the first verified bounty."
        />
      ) : notFound ? (
        <EmptyState
          title="Proof not found"
          body={`No submission with bounty #${bountyId}, nonce ${nonce} exists on the contract.`}
          action={
            <Link href="/dashboard" className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper">
              Open escrow dashboard
            </Link>
          }
        />
      ) : error ? (
        <EmptyState title="Could not load proof" body={error} />
      ) : !bounty || !submission ? (
        <div className="h-96 animate-pulse rounded-2xl bg-paperdeep" />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          {/* -------------------------------- on-chain record */}
          <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
            <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-moss">
              On-chain record · escrow contract
            </p>
            <dl>
              <Row k="Bounty ID" v={`#${bounty.id}`} />
              <Row k="Title" v={bounty.title} mono={false} />
              <Row
                k="Repository"
                v={
                  <a href={githubRepoUrl(bounty.repo)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                    {bounty.repo} ↗
                  </a>
                }
              />
              <Row
                k="Pull request"
                v={
                  <a href={githubPrUrl(bounty.repo, submission.pr_number)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                    #{submission.pr_number} ↗
                  </a>
                }
              />
              <Row
                k="Submitter (payout receiver)"
                v={
                  <a href={explorerAccountUrl(submission.submitter)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                    {submission.submitter} ↗
                  </a>
                }
              />
              <Row k="Target branch" v={`⎇ ${bounty.target_branch}`} />
              <Row k="Submission nonce" v={String(submission.nonce)} />
              <Row k="Submission status" v={submission.status} />
              <Row
                k="Verification requested at"
                v={formatDeadline(submission.requested_at)}
              />
              <Row k="Reward" v={`${formatNear(bounty.reward)} NEAR`} />
              <Row k="Verification fee charged" v={`${formatNear(submission.fee_charged)} NEAR`} />
              <Row k="Bounty status" v={bounty.status} />
            </dl>
          </div>

          {/* -------------------------------- attestation record */}
          <div className="space-y-8">
            <div className="rounded-2xl border border-line bg-ink p-7 text-paper shadow-card">
              <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-accent">
                Attestation record · OutLayer TEE
              </p>
              <dl>
                <div className="flex flex-col gap-1 border-b border-paper/15 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <dt className="shrink-0 text-sm text-paper/60">Verifier WASM SHA256</dt>
                  <dd className="break-all text-right font-mono text-sm text-paper">{shortenHash(wasmHash, 16)}</dd>
                </div>
                <div className="flex flex-col gap-1 border-b border-paper/15 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <dt className="shrink-0 text-sm text-paper/60">Pinned version</dt>
                  <dd className="text-right font-mono text-sm text-paper">version_key = SHA256 (hash-pinned)</dd>
                </div>
                <div className="flex flex-col gap-1 border-b border-paper/15 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <dt className="shrink-0 text-sm text-paper/60">OutLayer contract</dt>
                  <dd className="text-right font-mono text-sm text-paper">{outlayer}</dd>
                </div>
                <div className="flex flex-col gap-1 border-b border-paper/15 py-3.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                  <dt className="shrink-0 text-sm text-paper/60">Network</dt>
                  <dd className="text-right font-mono text-sm text-paper">{NETWORK_ID}</dd>
                </div>
                <div className="flex flex-col gap-1 py-3.5">
                  <dt className="shrink-0 text-sm text-paper/60">Binding</dt>
                  <dd className="text-right font-mono text-sm text-paper">
                    bounty_id={bountyId} · nonce={nonce}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs leading-relaxed text-paper/55">
                The escrow contract's callback asserts the echoed nonce matches
                the open submission and that the result came from the pinned WASM
                version before any payout. Per-execution artifacts — input SHA256,
                output SHA256, worker identity and TDX measurements, the TDX
                quote, and the request/payout transaction hashes — are verifiable
                independently:
              </p>
              <div className="mt-4 rounded-xl bg-paper/5 p-4 font-mono text-xs leading-relaxed text-paper/80">
                <p className="mb-1 text-paper/50"># verify any execution without an account</p>
                <p>outlayer-verify tx &lt;near-tx-hash&gt;</p>
                <p className="mt-2 text-paper/50"># or inspect in the dashboard</p>
                <p>{OUTLAYER_API_URL.replace("api", "app")}/executions</p>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-paper/55">
                Full hashes (input/output SHA256, merge commit SHA, TDX quote
                reference) are part of the verifier's signed output and the
                execution receipt on the OutLayer contract. This page shows the
                on-chain state; the attestation itself lives on the OutLayer
                execution record — linked here as soon as the first live
                verification runs.
              </p>
            </div>

            <div className="rounded-2xl border border-line bg-white/70 p-7 shadow-card">
              <p className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-faint">Cross-check</p>
              <div className="flex flex-wrap gap-3">
                <a
                  href={githubPrUrl(bounty.repo, submission.pr_number)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:text-accentdeep"
                >
                  GitHub PR ↗
                </a>
                <a
                  href={explorerAccountUrl(submission.submitter)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:text-accentdeep"
                >
                  Submitter on explorer ↗
                </a>
                <Link
                  href={`/bounties/${bounty.id}`}
                  className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-accent hover:text-accentdeep"
                >
                  Bounty detail →
                </Link>
              </div>
              <p className="mt-5 text-xs leading-relaxed text-faint">
                Honest note: the contract stores the submission verdict and the
                pinned WASM hash, but not the verifier's full JSON output
                (merge SHA, reason codes). Those live in the TEE execution
                receipt and the NEP-297 event logs of the callback transaction.
                A future contract upgrade can persist the output hash on-chain.
              </p>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}
