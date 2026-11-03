/** app/page.tsx — landing: cinematic hero, escrow explainer, TEE, payout, FAQ, CTA. */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Section } from "../components/ui";
import { BountyCard, EmptyState, StatusBadge } from "../components/ui";
import { nearApi, ContractNotDeployedError } from "../lib/near";
import type { Bounty } from "../lib/types";

const STEPS = [
  {
    n: "01",
    title: "Lock the bounty in escrow",
    body: "The creator deposits NEAR into the on-chain escrow contract with the reward, the repository, the target branch, and the deadline. Funds are locked by code — not by promises.",
  },
  {
    n: "02",
    title: "Ship the pull request",
    body: "A developer does the work and opens a PR. The PR body carries one claim line — Claim: <their-near-account> — cryptographically binding the PR to the wallet that submitted it.",
  },
  {
    n: "03",
    title: "The merge triggers payment",
    body: "OutLayer's TEE workers verify the actual merge against the bounty's conditions and produce an Intel TDX attestation. The contract validates the result and releases the reward — to the submitter, and only the submitter.",
  },
];

const TEE_CHECKS = [
  "Exact repository — owner and name",
  "Target branch — base.ref must match",
  "Merged == true — server-side GitHub fact",
  "Expected author — when the bounty names one",
  "Claim line — PR body contains Claim: <submitter>",
  "Merge timestamp — within the bounty deadline",
];

const PAYOUT_STATES = [
  { code: "VerificationPassed", text: "The verifier said yes. Payout is queued — the bounty is NOT marked paid yet." },
  { code: "PayoutPending", text: "The reward transfer is in flight, awaiting the transfer-result callback." },
  { code: "PayoutSucceeded", text: "The transfer landed. This is the only state that means “paid”." },
  { code: "PayoutFailed", text: "The transfer failed. Funds stay locked in escrow; anyone can retry. Never silently lost." },
];

const FAQS = [
  {
    q: "Who gets paid?",
    a: "Always the NEAR account that called submit_pr. The payout receiver is never taken from PR body text — the body claim must exactly equal the submitter, or verification fails. Front-running a PR number cannot redirect funds.",
  },
  {
    q: "What does the TEE actually prove?",
    a: "The attestation proves exactly which WASM binary ran, on which input, producing which output, on a genuine Intel TDX worker. It proves what code executed — our verifier's logic is open source and its SHA256 is pinned on-chain so anyone can audit it.",
  },
  {
    q: "What happens if verification fails?",
    a: "The submission is rejected and the bounty returns to Open, so the real developer can resubmit. Each attempt is deducted from the bounty's verification budget, with a hard cap on attempts to prevent griefing.",
  },
  {
    q: "What if the bounty expires?",
    a: "After the deadline, the creator can claim a refund. If a verification is still in flight past its timeout, anyone can resolve the timeout to return the bounty to Open. A bounty is never stuck forever.",
  },
  {
    q: "Do I need a new wallet?",
    a: "No. PATCHPAY connects your existing NEAR wallet — MyNearWallet, Meteor, Sender, HERE, and others. We never create wallets, never import them, and never touch seed phrases or private keys.",
  },
  {
    q: "Is this on mainnet?",
    a: "Not yet. This build runs on NEAR testnet only. No real funds move here. Mainnet deployment requires the owner's explicit approval.",
  },
];

function MarketplacePreview() {
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);

  useEffect(() => {
    nearApi
      .listBounties(null, 0, 3)
      .then((b) => setBounties(b))
      .catch((e) => {
        if (e instanceof ContractNotDeployedError) setNotDeployed(true);
        else setBounties([]);
      });
  }, []);

  if (notDeployed) {
    return (
      <EmptyState
        title="The marketplace opens after the contract deploys"
        body="The escrow contract account is reserved but not yet funded or deployed. Live on-chain bounties will appear here — never mock listings."
        action={
          <Link
            href="/bounties/new"
            className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
          >
            Learn how bounties work
          </Link>
        }
      />
    );
  }

  if (bounties === null) {
    return (
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-paperdeep" />
        ))}
      </div>
    );
  }

  if (bounties.length === 0) {
    return (
      <EmptyState
        title="No bounties yet"
        body="The contract is live but no bounties have been created. Be the first to put a bounty in escrow."
        action={
          <Link
            href="/bounties/new"
            className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
          >
            Create a bounty
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-5 md:grid-cols-3">
      {bounties.map((b) => (
        <BountyCard key={b.id} bounty={b} />
      ))}
    </div>
  );
}

export default function Landing() {
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  return (
    <>
      {/* ------------------------------------------------ HERO */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="mx-auto max-w-6xl px-5 pb-20 pt-20 md:pb-28 md:pt-28">
          <p className="rise font-mono text-xs font-semibold uppercase tracking-[0.25em] text-accent">
            GitHub bounty escrow · NEAR testnet
          </p>
          <h1 className="rise rise-1 mt-5 max-w-4xl font-display text-5xl leading-[1.04] tracking-tight text-ink md:text-7xl">
            Code ships.
            <br />
            Payment <em className="not-italic text-accent">follows.</em>
          </h1>
          <p className="rise rise-2 mt-6 max-w-2xl text-lg leading-relaxed text-muted">
            PATCHPAY locks NEAR in an on-chain escrow and releases it only when a
            Trusted Execution Environment verifies that the right pull request was
            actually merged. No chasing invoices. No “the check is in the mail.”
          </p>
          <div className="rise rise-3 mt-9 flex flex-wrap gap-4">
            <Link
              href="/bounties"
              className="rounded-full bg-ink px-8 py-4 text-sm font-semibold text-paper transition hover:bg-charcoal hover:shadow-lift"
            >
              Browse bounties
            </Link>
            <Link
              href="/bounties/new"
              className="rounded-full border border-ink/25 px-8 py-4 text-sm font-semibold text-ink transition hover:border-accent hover:text-accentdeep"
            >
              Create a bounty
            </Link>
          </div>
          <div className="rise rise-4 mt-12 grid grid-cols-3 gap-6 border-t border-line pt-8 md:max-w-2xl">
            {[
              ["On-chain escrow", "Funds locked by contract"],
              ["TEE-verified merges", "Intel TDX attestation"],
              ["One-time payout", "No double-spend, ever"],
            ].map(([t, s]) => (
              <div key={t}>
                <p className="text-sm font-semibold text-ink">{t}</p>
                <p className="mt-1 text-xs text-faint">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ MARKETPLACE PREVIEW */}
      <Section eyebrow="Live board" title="The marketplace, straight from the chain">
        <MarketplacePreview />
        <div className="mt-8 text-center">
          <Link href="/bounties" className="text-sm font-semibold text-accent underline underline-offset-4">
            Open the full marketplace →
          </Link>
        </div>
      </Section>

      {/* ------------------------------------------------ HOW ESCROW WORKS */}
      <div className="border-y border-line bg-paperdeep/50">
        <Section eyebrow="How it works" title="Three steps. Zero trust required.">
          <div className="grid gap-5 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border border-line bg-paper p-7 shadow-card">
                <p className="font-display text-4xl text-accent">{s.n}</p>
                <h3 className="mt-4 font-display text-xl text-ink">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ------------------------------------------------ TEE EXPLAINER */}
      <Section eyebrow="Verification" title="Inside the TEE: what gets checked">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <p className="text-base leading-relaxed text-muted">
              When a developer submits a PR, the escrow contract calls{" "}
              <code className="rounded bg-paperdeep px-1.5 py-0.5 font-mono text-xs">outlayer.testnet</code>{" "}
              with the verifier WASM pinned by SHA256. A worker runs the verifier
              inside Intel TDX, fetches the PR from the GitHub API, and checks
              every condition. The result comes back with an attestation binding
              the exact code, input, and output.
            </p>
            <p className="mt-4 text-base leading-relaxed text-muted">
              The contract then independently re-checks the binding — bounty ID,
              per-submission nonce, eligibility — before any NEAR moves. The
              worker can never move funds itself.
            </p>
            <Link href="/dashboard" className="mt-6 inline-block text-sm font-semibold text-accent underline underline-offset-4">
              Inspect a proof in the public proof center →
            </Link>
          </div>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-white/70 shadow-card">
            {TEE_CHECKS.map((c, i) => (
              <li key={c} className="flex items-center gap-4 px-6 py-4">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss/15 font-mono text-xs font-bold text-moss">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium text-ink">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ------------------------------------------------ PAYOUT FLOW */}
      <div className="border-y border-line bg-ink text-paper">
        <Section eyebrow="Payout flow" title={<span className="text-paper">Paid means <em className="text-accent">confirmed.</em></span>}>
          <div className="grid gap-4 md:grid-cols-4">
            {PAYOUT_STATES.map((p, i) => (
              <div key={p.code} className="relative rounded-2xl border border-paper/15 bg-paper/5 p-6">
                <p className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</p>
                <p className="mt-2 font-mono text-sm font-bold text-paper">{p.code}</p>
                <p className="mt-3 text-sm leading-relaxed text-paper/65">{p.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-sm leading-relaxed text-paper/55">
            The contract never marks a bounty paid before the transfer callback
            confirms the funds landed. If a transfer fails, the bounty enters{" "}
            <code className="font-mono text-xs">PayoutFailed</code> — funds stay
            locked in escrow and the transfer is retried with a bounded attempt
            budget. No silent loss, no stuck-forever.
          </p>
        </Section>
      </div>

      {/* ------------------------------------------------ FAQ */}
      <Section eyebrow="Questions" title="Asked, answered.">
        <div className="divide-y divide-line rounded-2xl border border-line bg-white/70 shadow-card">
          {FAQS.map((f, i) => (
            <div key={f.q}>
              <button
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                aria-expanded={faqOpen === i}
              >
                <span className="font-display text-lg text-ink">{f.q}</span>
                <span className={`shrink-0 font-mono text-accent transition ${faqOpen === i ? "rotate-45" : ""}`}>+</span>
              </button>
              {faqOpen === i && (
                <p className="px-6 pb-6 text-sm leading-relaxed text-muted">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------ CTA */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center md:py-28">
          <h2 className="mx-auto max-w-3xl font-display text-4xl leading-tight text-ink md:text-6xl">
            Put the next merge on the ledger.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-muted">
            Create a bounty in minutes. Your NEAR stays locked until the merge is
            proven — then the developer is paid automatically.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <Link
              href="/bounties/new"
              className="rounded-full bg-accent px-8 py-4 text-sm font-semibold text-white transition hover:bg-accentdeep hover:shadow-lift"
            >
              Create your first bounty
            </Link>
            <Link
              href="/bounties"
              className="rounded-full border border-ink/25 px-8 py-4 text-sm font-semibold text-ink transition hover:border-accent hover:text-accentdeep"
            >
              Find work to do
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
