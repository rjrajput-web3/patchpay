/**
 * components/Wallet.tsx — @near-wallet-selector integration.
 *
 * External wallets ONLY (MyNearWallet, Meteor, Sender, HERE, …).
 * Hard bans honored: no wallet creation, no import, no seed/private-key
 * input or storage, no custodial signing, no auto-sign. Every state-changing
 * action goes through a review screen, then signAndSendTransaction, then an
 * explicit user approval inside their own wallet.
 */
"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import type {
  AccountState,
  WalletSelector,
  WalletSelectorState,
} from "@near-wallet-selector/core";
import { WalletSelectorProvider } from "@near-wallet-selector/react-hook";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupSender } from "@near-wallet-selector/sender";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { CONTRACT_ACCOUNT, NETWORK_ID, explorerAccountUrl } from "../lib/config";
import { nearApi, formatNear } from "../lib/near";
import { useToasts } from "./Toasts";

interface WalletContextValue {
  selector: WalletSelector | null;
  accounts: AccountState[];
  accountId: string | null;
  balance: string | null; // yoctoNEAR
  walletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;
  signIn: (walletId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Wrap a state-changing call: runs the review UI, then signs. */
  signAndSend: (args: {
    methodName: string;
    args: object;
    gas: string;
    deposit: string;
    actionLabel: string;
    bountyId?: number | null;
  }) => Promise<string>; // resolves with the tx hash
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletSetup");
  return ctx;
}

function Inner({ children }: { children: React.ReactNode }) {
  const { push } = useToasts();
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [state, setState] = useState<WalletSelectorState | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setupWalletSelector({
      network: NETWORK_ID as "testnet" | "mainnet",
      modules: [
        setupMyNearWallet(),
        setupMeteorWallet(),
        setupSender(),
        setupHereWallet(),
      ],
    }).then((sel) => {
      if (cancelled) return;
      setSelector(sel);
      setState(sel.store.getState());
      const sub = sel.store.observable.subscribe((s) => setState(s));
      return () => sub.unsubscribe();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const accounts = state?.accounts ?? [];
  const accountId = accounts.length > 0 ? accounts[0].accountId : null;

  useEffect(() => {
    if (!accountId) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    nearApi.getAccountBalance(accountId).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const signIn = useCallback(
    async (walletId: string) => {
      if (!selector) return;
      try {
        const wallet = await selector.wallet(walletId);
        await (
          wallet as unknown as {
            signIn: (p: { contractId: string }) => Promise<void>;
          }
        ).signIn({ contractId: CONTRACT_ACCOUNT });
        setWalletModalOpen(false);
        push({ kind: "success", title: "Wallet connected" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/reject|cancel|declined|closed/i.test(msg)) {
          push({ kind: "info", title: "Connection cancelled", body: "No wallet was connected." });
        } else {
          push({ kind: "error", title: "Connection failed", body: msg.slice(0, 300) });
        }
        throw err;
      }
    },
    [selector, push]
  );

  const signOut = useCallback(async () => {
    if (!selector) return;
    try {
      const wallet = await selector.wallet();
      await wallet.signOut();
      push({ kind: "info", title: "Wallet disconnected" });
    } catch (err) {
      push({
        kind: "error",
        title: "Disconnect failed",
        body: err instanceof Error ? err.message : String(err),
      });
    }
  }, [selector, push]);

  const signAndSend = useCallback(
    async (args: {
      methodName: string;
      args: object;
      gas: string;
      deposit: string;
      actionLabel: string;
      bountyId?: number | null;
    }): Promise<string> => {
      if (!selector || !accountId) {
        throw new Error("Connect your wallet first.");
      }
      const wallet = await selector.wallet();
      try {
        const outcome = await wallet.signAndSendTransaction({
          signerId: accountId,
          receiverId: CONTRACT_ACCOUNT,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: args.methodName,
                args: args.args,
                gas: args.gas,
                deposit: args.deposit,
              },
            },
          ],
        });
        // signAndSendTransaction resolves with the tx hash (string) in v8.
        const hash =
          typeof outcome === "string"
            ? outcome
            : (outcome as { transaction?: { hash?: string } })?.transaction?.hash ??
              "";
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/reject|cancel|declined|denied|user/i.test(msg)) {
          push({
            kind: "info",
            title: "Transaction rejected",
            body: "You declined the transaction in your wallet. Nothing was sent.",
          });
        } else {
          push({
            kind: "error",
            title: `${args.actionLabel} failed to send`,
            body: msg.slice(0, 300),
          });
        }
        throw err;
      }
    },
    [selector, accountId, push]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      selector,
      accounts,
      accountId,
      balance,
      walletModalOpen,
      setWalletModalOpen,
      signIn,
      signOut,
      signAndSend,
    }),
    [selector, accounts, accountId, balance, walletModalOpen, signIn, signOut, signAndSend]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

/** Top-level wrapper: react-hook provider (official standard) + our context. */
export function WalletSetup({ children }: { children: React.ReactNode }) {
  return (
    <WalletSelectorProvider
      config={{
        network: NETWORK_ID as "testnet" | "mainnet",
        modules: [
          setupMyNearWallet(),
          setupMeteorWallet(),
          setupSender(),
          setupHereWallet(),
        ],
      }}
    >
      <Inner>
        {children}
        <WalletModal />
      </Inner>
    </WalletSelectorProvider>
  );
}

// ---------------------------------------------------------------------------
// Wallet connection modal (a MODAL, not a page — per spec §13 correction)
// ---------------------------------------------------------------------------

function WalletModal() {
  const { selector, walletModalOpen, setWalletModalOpen, signIn, accountId, signOut } =
    useWallet();
  const modules = selector?.store.getState().modules ?? [];

  if (!walletModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
    >
      <button
        aria-label="Close"
        className="absolute inset-0 bg-ink/50 backdrop-blur-[2px]"
        onClick={() => setWalletModalOpen(false)}
      />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-paper shadow-lift">
        <div className="border-b border-line px-6 py-5">
          <h2 className="font-display text-2xl text-ink">Connect wallet</h2>
          <p className="mt-1 text-sm text-muted">
            Use your <strong className="text-ink">existing</strong> NEAR wallet on{" "}
            {NETWORK_ID}. PATCHPAY never creates, imports, or stores wallets or keys.
          </p>
        </div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-6 py-5">
          {modules.map((m) => (
            <button
              key={m.id}
              onClick={() => signIn(m.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-white/60 px-4 py-3 text-left transition hover:-translate-y-px hover:border-accent hover:shadow-card"
            >
              {m.metadata.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={m.metadata.iconUrl}
                  alt=""
                  className="h-8 w-8 rounded-lg"
                  width={32}
                  height={32}
                />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paperdeep font-display text-lg text-accent">
                  {m.metadata.name.slice(0, 1)}
                </span>
              )}
              <span className="flex-1">
                <span className="block text-sm font-semibold text-ink">
                  {m.metadata.name}
                </span>
                <span className="block text-xs text-faint">
                  {m.type === "injected" ? "Browser extension" : "Web / mobile wallet"}
                </span>
              </span>
              <span className="text-faint">→</span>
            </button>
          ))}
          {modules.length === 0 && (
            <p className="text-sm text-muted">Loading wallets…</p>
          )}
        </div>
        <div className="border-t border-line bg-paperdeep/60 px-6 py-4">
          <p className="text-xs leading-relaxed text-faint">
            Signing happens only when <em>you</em> approve a transaction inside your
            own wallet. No seed phrases. No private keys. Ever.
          </p>
          {accountId && (
            <button
              onClick={() => {
                setWalletModalOpen(false);
                void signOut();
              }}
              className="mt-3 text-xs font-semibold text-clay underline underline-offset-2"
            >
              Disconnect {accountId}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header connect button + account chip
// ---------------------------------------------------------------------------

export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { accountId, balance, setWalletModalOpen, signOut } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!accountId) {
    return (
      <button
        onClick={() => setWalletModalOpen(true)}
        className={
          compact
            ? "rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-charcoal"
            : "rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper transition hover:bg-charcoal hover:shadow-card"
        }
      >
        Connect wallet
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-full border border-line bg-white/70 py-1.5 pl-1.5 pr-4 shadow-card transition hover:shadow-lift"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent font-mono text-xs font-bold text-white">
          {accountId.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-left leading-tight">
          <span className="block max-w-[140px] truncate font-mono text-xs font-semibold text-ink">
            {accountId}
          </span>
          <span className="block text-[11px] text-faint">
            {balance !== null ? `${formatNear(balance)} NEAR` : "…"}
            {" · "}
            {NETWORK_ID}
          </span>
        </span>
      </button>
      {menuOpen && (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-paper shadow-lift" role="menu">
            <a
              href={explorerAccountUrl(accountId)}
              target="_blank"
              rel="noreferrer"
              className="block px-4 py-2.5 text-sm text-ink hover:bg-paperdeep"
            >
              View on explorer ↗
            </a>
            <button
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              className="block w-full px-4 py-2.5 text-left text-sm text-clay hover:bg-paperdeep"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
