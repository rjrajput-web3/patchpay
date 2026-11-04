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
    <header className="sticky top-0 z-50 px-3 pt-3 md:px-5">
      <div className="mx-auto max-w-6xl rounded-full bg-gradient-to-r from-[#35D6FF] via-[#3b4a8f] to-[#7865FF] p-[1.5px] shadow-[0_0_36px_rgba(53,214,255,0.22)]">
        <div className="flex h-16 items-center justify-between rounded-full bg-[#0B1020]/95 px-4 backdrop-blur md:px-6">
          <Link href="/" className="flex shrink-0 items-center" aria-label="PATCHPAY home">
            <img src="/logo.svg" alt="PATCHPAY" className="h-9 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
            {NAV.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative text-sm font-medium transition hover:text-white ${
                    active ? "text-[#35D6FF]" : "text-white/65"
                  }`}
                >
                  {n.label}
                  {active && (
                    <span className="absolute -bottom-[21px] left-0 right-0 h-[2.5px] rounded-full bg-[#35D6FF] shadow-[0_0_12px_rgba(53,214,255,0.9)]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="flex shrink-0 items-center gap-3">
            <a
              href="https://github.com/rjrajput-web3/patchpay"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/75 transition hover:border-white/40 hover:text-white lg:flex"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              GitHub
            </a>
            <ConnectButton dark />
          </div>
        </div>
      </div>
      <nav className="mx-auto mt-2 flex max-w-6xl gap-6 overflow-x-auto rounded-full bg-[#0B1020]/90 px-6 py-2.5 backdrop-blur md:hidden" aria-label="Mobile">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`whitespace-nowrap text-sm font-medium ${
              pathname === n.href ? "text-[#35D6FF]" : "text-white/65"
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
            <span>PATCH<span className="bg-gradient-to-r from-[#35D6FF] to-[#7865FF] bg-clip-text text-transparent">PAY</span></span>
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
