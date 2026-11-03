/** components/Header.tsx + Footer */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./Wallet";

const NAV = [
  { href: "/bounties", label: "Marketplace" },
  { href: "/bounties/new", label: "Create bounty" },
  { href: "/dashboard", label: "Escrow" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="PATCHPAY home">
          <img src="/logo.svg" alt="PATCHPAY" className="h-9 w-auto" />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`text-sm font-medium transition hover:text-accentdeep ${
                pathname === n.href || pathname.startsWith(n.href + "/")
                  ? "text-ink"
                  : "text-muted"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <ConnectButton compact />
      </div>
      <nav className="flex gap-6 overflow-x-auto border-t border-line/60 px-5 py-2 md:hidden" aria-label="Mobile">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`whitespace-nowrap text-sm font-medium ${
              pathname === n.href ? "text-ink" : "text-muted"
            }`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="flex items-center gap-3 font-display text-2xl">
            <img src="/logo-icon.svg" alt="PATCHPAY logo" className="h-8 w-8" />
            <span>PATCH<span className="text-accent">PAY</span></span>
          </p>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-paper/60">
            Code ships. Payment follows. GitHub bounties held in NEAR escrow,
            released only when a TEE-verified merge proves the work landed.
          </p>
          <p className="mt-4 font-mono text-xs text-paper/40">
            Built for NEAR “Build Beyond Boundaries” · testnet
          </p>
        </div>
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-paper/50">Product</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/bounties" className="text-paper/75 hover:text-paper">Marketplace</Link></li>
            <li><Link href="/bounties/new" className="text-paper/75 hover:text-paper">Create bounty</Link></li>
            <li><Link href="/dashboard" className="text-paper/75 hover:text-paper">Escrow dashboard</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-paper/50">Verify</p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/dashboard" className="text-paper/75 hover:text-paper">Proof center</Link></li>
            <li>
              <a href="https://github.com/rjrajput-web3/patchpay" target="_blank" rel="noreferrer" className="text-paper/75 hover:text-paper">
                GitHub repo ↗
              </a>
            </li>
            <li>
              <a href="https://app.outlayer.ai/docs/getting-started" target="_blank" rel="noreferrer" className="text-paper/75 hover:text-paper">
                OutLayer docs ↗
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-5 text-xs text-paper/40 md:flex-row md:items-center md:justify-between">
          <span>© 2026 PATCHPAY. Testnet build — no real funds.</span>
          <span>Attestations via OutLayer TEE · settlement on NEAR</span>
        </div>
      </div>
    </footer>
  );
}
