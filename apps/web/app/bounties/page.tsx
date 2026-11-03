/** app/bounties/page.tsx — marketplace: search / filter / sort, contract data only. */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Section, BountyCard, EmptyState, inputCls, StatusBadge } from "../../components/ui";
import { nearApi, ContractNotDeployedError, formatNear } from "../../lib/near";
import type { Bounty, BountyStatus } from "../../lib/types";

const FILTERS: { key: string; label: string; statuses: BountyStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "open", label: "Open", statuses: ["Open"] },
  { key: "active", label: "In verification", statuses: ["VerificationPending", "VerificationPassed", "PayoutPending"] },
  { key: "paid", label: "Paid", statuses: ["PayoutSucceeded"] },
  { key: "closed", label: "Closed", statuses: ["Cancelled", "Refunded", "Expired", "PayoutFailed"] },
];

type SortKey = "newest" | "reward-high" | "reward-low" | "deadline";

export default function Marketplace() {
  const [bounties, setBounties] = useState<Bounty[] | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("newest");

  useEffect(() => {
    nearApi
      .listBounties(null, 0, 100)
      .then(setBounties)
      .catch((e) => {
        if (e instanceof ContractNotDeployedError) setNotDeployed(true);
        else {
          setError(e instanceof Error ? e.message : String(e));
          setBounties([]);
        }
      });
  }, []);

  const visible = useMemo(() => {
    if (!bounties) return null;
    const f = FILTERS.find((x) => x.key === filter);
    let out = bounties;
    if (f?.statuses) out = out.filter((b) => f.statuses!.includes(b.status));
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.repo.toLowerCase().includes(q) ||
          String(b.id).includes(q)
      );
    }
    out = [...out];
    switch (sort) {
      case "newest":
        out.sort((a, b) => b.id - a.id);
        break;
      case "reward-high":
        out.sort((a, b) => Number(BigInt(b.reward) - BigInt(a.reward)));
        break;
      case "reward-low":
        out.sort((a, b) => Number(BigInt(a.reward) - BigInt(b.reward)));
        break;
      case "deadline":
        out.sort((a, b) => a.deadline - b.deadline);
        break;
    }
    return out;
  }, [bounties, query, filter, sort]);

  return (
    <Section eyebrow="Marketplace" title="Bounties with real money behind them.">
      {notDeployed ? (
        <EmptyState
          title="Contract not deployed yet"
          body="The escrow contract account is reserved but not yet deployed. This marketplace renders only live on-chain data — it will populate automatically after deployment. No mock listings, ever."
          action={
            <Link
              href="/bounties/new"
              className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
            >
              How creating a bounty works
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, description, repo, or bounty #…"
              className={`${inputCls} md:max-w-sm`}
              aria-label="Search bounties"
            />
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    filter === f.key
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-white/60 text-muted hover:border-faint"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`${inputCls} md:ml-auto md:w-auto`}
              aria-label="Sort bounties"
            >
              <option value="newest">Newest first</option>
              <option value="reward-high">Reward: high → low</option>
              <option value="reward-low">Reward: low → high</option>
              <option value="deadline">Ending soonest</option>
            </select>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-700/30 bg-red-700/5 px-4 py-3 text-sm text-red-800">
              Could not load bounties: {error}
            </div>
          )}

          {visible === null ? (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-64 animate-pulse rounded-2xl bg-paperdeep" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              title="No bounties match"
              body={
                bounties && bounties.length > 0
                  ? "Try clearing the search or choosing a different filter."
                  : "The contract is live but no bounties exist yet. Create the first one."
              }
              action={
                <Link
                  href="/bounties/new"
                  className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal"
                >
                  Create a bounty
                </Link>
              }
            />
          ) : (
            <>
              <p className="mb-4 font-mono text-xs text-faint">
                {visible.length} {visible.length === 1 ? "bounty" : "bounties"} · live from the escrow contract
              </p>
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                {visible.map((b) => (
                  <BountyCard key={b.id} bounty={b} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}
