/** components/ui.tsx — shared PATCHPAY UI primitives (brand system). */
"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CONTRACT_ACCOUNT, CONTRACT_DEPLOYED, NETWORK_ID } from "../lib/config";
import { formatNear, formatDeadline, deadlinePassed } from "../lib/near";
import type { Bounty, BountyStatus } from "../lib/types";

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export function DeployBanner() {
  if (CONTRACT_DEPLOYED) return null;
  return (
    <div className="border-b border-line bg-paperdeep">
      <div className="mx-auto max-w-6xl px-5 py-3 text-sm text-charcoal">
        <strong className="font-semibold">Testnet contract not deployed yet.</strong>{" "}
        The escrow contract account{" "}
        <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs">
          {CONTRACT_ACCOUNT}
        </code>{" "}
        is reserved; the marketplace will populate with real on-chain bounties
        after deployment. Nothing here is mock data.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge — honest payout-state machine (§9.2)
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<BountyStatus, { label: string; cls: string }> = {
  Open: { label: "Open", cls: "bg-moss/10 text-moss border-moss/30" },
  VerificationPending: {
    label: "Verifying",
    cls: "bg-accent/10 text-accentdeep border-accent/40",
  },
  VerificationPassed: {
    label: "Verified — payout queued",
    cls: "bg-accent/10 text-accentdeep border-accent/40",
  },
  PayoutPending: { label: "Payout pending", cls: "bg-accent/15 text-accentdeep border-accent/50" },
  PayoutSucceeded: { label: "Paid", cls: "bg-ink text-paper border-ink" },
  PayoutFailed: { label: "Payout failed — retryable", cls: "bg-red-700/10 text-red-800 border-red-700/30" },
  Cancelled: { label: "Cancelled", cls: "bg-faint/10 text-faint border-faint/30" },
  Refunded: { label: "Refunded", cls: "bg-faint/10 text-faint border-faint/30" },
  Expired: { label: "Expired", cls: "bg-faint/10 text-faint border-faint/30" },
};

export function StatusBadge({ status }: { status: BountyStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${s.cls}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bounty card
// ---------------------------------------------------------------------------

export function BountyCard({ bounty }: { bounty: Bounty }) {
  return (
    <Link
      href={`/bounties/${bounty.id}`}
      className="group flex flex-col rounded-2xl border border-line bg-white/70 p-6 shadow-card transition hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs text-faint">#{bounty.id}</span>
        <StatusBadge status={bounty.status} />
      </div>
      <h3 className="mt-3 font-display text-xl leading-snug text-ink transition group-hover:text-accentdeep">
        {bounty.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">
        {bounty.description}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-faint">
        <span>{bounty.repo}</span>
        <span>⎇ {bounty.target_branch}</span>
        {bounty.issue_number != null && <span>issue #{bounty.issue_number}</span>}
      </div>
      <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
        <div>
          <div className="font-display text-2xl text-ink">
            {formatNear(bounty.reward)}{" "}
            <span className="text-sm text-muted">NEAR</span>
          </div>
          <div className="text-xs text-faint">
            {deadlinePassed(bounty.deadline)
              ? "deadline passed"
              : `due ${formatDeadline(bounty.deadline)}`}
          </div>
        </div>
        <span className="text-sm font-semibold text-accent transition group-hover:translate-x-1">
          View →
        </span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Section({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mx-auto max-w-6xl px-5 py-16 md:py-24 ${className}`}>
      {eyebrow && (
        <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          {eyebrow}
        </p>
      )}
      {title && (
        <h2 className="mb-8 max-w-3xl font-display text-3xl leading-tight text-ink md:text-5xl">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white/70 p-6 shadow-card">
      <p className="font-mono text-xs uppercase tracking-[0.15em] text-faint">{label}</p>
      <p className="mt-2 font-display text-3xl text-ink md:text-4xl">{value}</p>
      {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-white/50 px-6 py-16 text-center">
      <p className="mx-auto max-w-md font-display text-2xl text-ink">{title}</p>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">
        {label} {required && <span className="text-accent">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-white/80 px-4 py-3 text-sm text-ink placeholder:text-faint outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

// ---------------------------------------------------------------------------
// Review modal — shown before EVERY state-changing action (spec requirement)
// ---------------------------------------------------------------------------

export interface ReviewRow {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

export function ReviewModal({
  open,
  title,
  rows,
  depositLine,
  onConfirm,
  onClose,
  confirmLabel = "Sign & send",
  busy = false,
}: {
  open: boolean;
  title: string;
  rows: ReviewRow[];
  depositLine?: string;
  onConfirm: () => void;
  onClose: () => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close review" className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-paper shadow-lift">
        <div className="border-b border-line px-6 py-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Review before signing</p>
          <h2 className="mt-1 font-display text-2xl text-ink">{title}</h2>
        </div>
        <dl className="space-y-3 px-6 py-5">
          {rows.map((r, i) => (
            <div key={i} className="flex items-start justify-between gap-4 border-b border-line/60 pb-3 last:border-0 last:pb-0">
              <dt className="shrink-0 text-sm text-muted">{r.label}</dt>
              <dd className={`text-right text-sm font-medium text-ink ${r.mono ? "font-mono break-all" : ""}`}>
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
        {depositLine && (
          <div className="mx-6 mb-4 rounded-xl bg-paperdeep px-4 py-3 text-sm text-charcoal">
            <strong>Deposit attached:</strong> {depositLine}
          </div>
        )}
        <div className="flex gap-3 border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-full border border-line px-5 py-3 text-sm font-semibold text-ink transition hover:bg-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal disabled:opacity-50"
          >
            {busy ? "Waiting for wallet…" : confirmLabel}
          </button>
        </div>
        <p className="px-6 pb-5 text-center text-xs text-faint">
          Nothing is sent until you approve the transaction inside your own wallet.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tx progress — polls the tx hash to finality
// ---------------------------------------------------------------------------

export function TxProgress({
  hash,
  accountId,
  label,
}: {
  hash: string;
  accountId: string;
  label: string;
}) {
  const [state, setState] = useState<"pending" | "final" | "failed">("pending");
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    import("../lib/near").then(({ nearApi }) => {
      nearApi
        .waitForTx(hash, accountId)
        .then(() => !cancelled && setState("final"))
        .catch((e: Error) => {
          if (!cancelled) {
            setState("failed");
            setError(e.message);
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, [hash, accountId]);

  const explorer = `${NETWORK_ID === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${hash}`;

  return (
    <div className="rounded-xl border border-line bg-white/70 px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            state === "final" ? "bg-green-500" : state === "failed" ? "bg-red-500" : "animate-pulse bg-accent"
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {label}:{" "}
            {state === "final"
              ? "confirmed on-chain"
              : state === "failed"
              ? "failed"
              : "awaiting finality…"}
          </p>
          <p className="truncate font-mono text-xs text-faint">{hash}</p>
          {error && <p className="mt-1 break-words text-xs text-red-800">{error}</p>}
        </div>
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs font-semibold text-accent underline underline-offset-2"
        >
          Explorer ↗
        </a>
      </div>
    </div>
  );
}
