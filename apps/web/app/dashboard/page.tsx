/** app/dashboard/page.tsx — escrow dashboard: totals, payouts, expiries, refunds, tx log. */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Section,
  StatCard,
  EmptyState,
  StatusBadge,
} from "../../components/ui";
import { useWallet } from "../../components/Wallet";
import {
  nearApi,
  ContractNotDeployedError,
  formatNear,
  formatDeadline,
  readLocalTxs,
  shortenHash,
} from "../../lib/near";
import { explorerTxUrl, NETWORK_ID } from "../../lib/config";
import type { Bounty, LocalTx } from "../../lib/types";

const TERMINAL = ["Cancelled", "Refunded", "Expired", "PayoutSucceeded"];

export default function Dashboard() {
  const { accountId } = useWallet();
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTxs, setLocalTxs] = useState<LocalTx[]>([]);

  useEffect(() => {
    nearApi
      .listBounties(null, 0, 200)
      .then(setBounties)
      .catch((e) => {
        if (e instanceof ContractNotDeployedError) setNotDeployed(true);
        else {
          setError(e instanceof Error ? e.message : String(e));
          setBounties([]);
        }
      });
    setLocalTxs(readLocalTxs());
  }, []);

  useEffect(() => {
    setLocalTxs(readLocalTxs(accountId ?? undefined));
  }, [accountId]);

  const stats = useMemo(() => {
    if (!bounties) return null;
    const locked = bounties
      .filter((b) => !TERMINAL.includes(b.status))
      .reduce((acc, b) => acc + BigInt(b.reward), 0n);
    const paid = bounties.filter((b) => b.status === "PayoutSucceeded");
    const paidTotal = paid.reduce((acc, b) => acc + BigInt(b.reward), 0n);
    return {
      total: bounties.length,
      locked,
      pending: bounties.filter((b) =>
        ["VerificationPending", "VerificationPassed", "PayoutPending"].includes(b.status)
      ).length,
      paidCount: paid.length,
      paidTotal,
      expired: bounties.filter((b) => b.status === "Expired").length,
      refunded: bounties.filter((b) => b.status === "Refunded" || b.status === "Cancelled").length,
      failed: bounties.filter((b) => b.status === "PayoutFailed").length,
    };
  }, [bounties]);

  return (
    <Section eyebrow="Escrow dashboard" title="Every yocto, accounted for.">
      {notDeployed ? (
        <EmptyState
          title="The escrow ledger opens after the contract deploys"
          body="All figures on this page are computed live from the escrow contract — totals, locked NEAR, pending verifications, payouts, expiries, and refunds. Nothing is estimated or mocked."
        />
      ) : (
        <>
          {error && (
            <div className="mb-6 rounded-xl border border-red-700/30 bg-red-700/5 px-4 py-3 text-sm text-red-800">
              Could not load escrow data: {error}
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {stats === null ? (
              [0, 1, 2, 3].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-paperdeep" />
              ))
            ) : (
              <>
                <StatCard label="Bounties created" value={stats.total} />
                <StatCard
                  label="Locked in escrow"
                  value={<>{formatNear(stats.locked.toString())} <span className="text-lg text-muted">NEAR</span></>}
                  sub="Rewards held by the contract right now"
                />
                <StatCard label="Pending verification" value={stats.pending} sub="TEE checks in flight" />
                <StatCard
                  label="Paid out"
                  value={<>{formatNear(stats.paidTotal.toString())} <span className="text-lg text-muted">NEAR</span></>}
                  sub={`${stats.paidCount} confirmed payouts`}
                />
                <StatCard label="Expired" value={stats.expired} />
                <StatCard label="Refunded / cancelled" value={stats.refunded} />
                <StatCard label="Payouts failed (retryable)" value={stats.failed} sub="Funds locked, never lost" />
                <StatCard
                  label="Network"
                  value={<span className="font-mono text-2xl">{NETWORK_ID}</span>}
                  sub="testnet — no real funds"
                />
              </>
            )}
          </div>

          {/* Bounty ledger */}
          <h2 className="mb-4 mt-14 font-display text-2xl text-ink">Bounty ledger</h2>
          {bounties === null ? (
            <div className="h-64 animate-pulse rounded-2xl bg-paperdeep" />
          ) : bounties.length === 0 ? (
            <EmptyState
              title="No bounties on the ledger yet"
              body="The first bounty created will appear here with its full status history."
              action={
                <Link href="/bounties/new" className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper">
                  Create a bounty
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white/70 shadow-card">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line font-mono text-xs uppercase tracking-wider text-faint">
                    <th className="px-5 py-3">ID</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Reward</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Deadline</th>
                    <th className="px-5 py-3">Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {bounties.map((b) => (
                    <tr key={b.id} className="transition hover:bg-paperdeep/40">
                      <td className="px-5 py-3 font-mono text-faint">#{b.id}</td>
                      <td className="max-w-[280px] px-5 py-3">
                        <Link href={`/bounties/${b.id}`} className="font-medium text-ink hover:text-accentdeep">
                          {b.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3 font-mono">{formatNear(b.reward)}</td>
                      <td className="px-5 py-3"><StatusBadge status={b.status} /></td>
                      <td className="px-5 py-3 text-muted">{formatDeadline(b.deadline)}</td>
                      <td className="px-5 py-3">
                        {b.submission_count > 0 ? (
                          <Link
                            href={`/proof/${b.id}/${b.submission_count - 1}`}
                            className="font-semibold text-accent underline underline-offset-2"
                          >
                            Proof →
                          </Link>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Local transaction history */}
          <h2 className="mb-4 mt-14 font-display text-2xl text-ink">Your transactions</h2>
          {localTxs.length === 0 ? (
            <p className="text-sm text-muted">
              Transactions you sign in this browser appear here.{" "}
              {!accountId && "Connect your wallet to link them to your account."}
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-white/70 shadow-card">
              {localTxs.map((t) => (
                <li key={t.hash} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="rounded-full bg-paperdeep px-3 py-1 font-mono text-xs text-charcoal">
                    {t.action}
                  </span>
                  {t.bountyId != null && (
                    <Link href={`/bounties/${t.bountyId}`} className="font-mono text-xs text-accent underline underline-offset-2">
                      #{t.bountyId}
                    </Link>
                  )}
                  <a
                    href={explorerTxUrl(t.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-muted underline underline-offset-2 hover:text-accentdeep"
                  >
                    {shortenHash(t.hash)} ↗
                  </a>
                  <span className="ml-auto text-xs text-faint">
                    {new Date(t.ts).toLocaleString("en-GB")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-faint">
            This list is stored in your browser only. Chain truth is always on the
            explorer — every hash above links there.
          </p>
        </>
      )}
    </Section>
  );
}
