/** lib/near.ts — read-only NEAR access via near-api-js + tx helpers. */
"use client";

import { providers, utils } from "near-api-js";
import {
  CONTRACT_ACCOUNT,
  CONTRACT_DEPLOYED,
  EXPLORER_URL,
  NODE_URL,
} from "./config";
import type {
  Bounty,
  ContractConfig,
  LocalTx,
  PendingTransfer,
  Submission,
} from "./types";

let provider: providers.JsonRpcProvider | null = null;

function rpc(): providers.JsonRpcProvider {
  if (!provider) provider = new providers.JsonRpcProvider({ url: NODE_URL });
  return provider;
}

export class ContractNotDeployedError extends Error {
  constructor() {
    super(
      "The PATCHPAY escrow contract is not deployed on this network yet. " +
        "The marketplace will populate after deployment."
    );
    this.name = "ContractNotDeployedError";
  }
}

function isMissingAccount(err: unknown): boolean {
  const msg = String(err && (err as Error).message ? (err as Error).message : err);
  return (
    /does not exist|account .*?not found|not found/i.test(msg) ||
    /"error"\s*:\s*"[^"]*(does not exist|not found)/i.test(msg)
  );
}

function decode<T>(res: unknown): T {
  const r = res as { result?: number[] };
  if (!r || !r.result) throw new Error("Empty RPC response");
  return JSON.parse(Buffer.from(r.result).toString("utf-8")) as T;
}

async function view<T>(method: string, args: Record<string, unknown>): Promise<T> {
  if (!CONTRACT_DEPLOYED) throw new ContractNotDeployedError();
  try {
    const res = await rpc().query({
      request_type: "call_function",
      account_id: CONTRACT_ACCOUNT,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      finality: "optimistic",
    });
    return decode<T>(res);
  } catch (err) {
    if (isMissingAccount(err)) throw new ContractNotDeployedError();
    throw err;
  }
}

export const nearApi = {
  getBounty: (bounty_id: number) => view<Bounty | null>("get_bounty", { bounty_id }),
  listBounties: (status?: string | null, page = 0, limit = 50) =>
    view<Bounty[]>("list_bounties", { status: status ?? null, page, limit }),
  getSubmission: (bounty_id: number, nonce: number) =>
    view<Submission | null>("get_submission", { bounty_id, nonce }),
  getTransfer: (transfer_id: number) =>
    view<PendingTransfer | null>("get_transfer", { transfer_id }),
  getConfig: () => view<ContractConfig>("get_config", {}),

  /** Native NEAR balance of an account (for the wallet chip). */
  async getAccountBalance(accountId: string): Promise<string | null> {
    try {
      const res = await rpc().query({
        request_type: "view_account",
        account_id: accountId,
        finality: "optimistic",
      });
      const a = res as { amount?: string };
      return a.amount ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Poll a transaction hash until it reaches finality (or fails / times out).
   * Returns the final outcome. Throws on failure or timeout.
   */
  async waitForTx(
    txHash: string,
    accountId: string,
    opts: { timeoutMs?: number; intervalMs?: number } = {}
  ): Promise<providers.FinalExecutionOutcome> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const intervalMs = opts.intervalMs ?? 3_000;
    const started = Date.now();
    for (;;) {
      try {
        const outcome = await rpc().txStatus(txHash, accountId, "INCLUDED_FINAL");
        const status = (outcome as { status?: unknown }).status;
        if (status && typeof status === "object" && "SuccessValue" in status) {
          return outcome;
        }
        if (status && typeof status === "object" && "Failure" in status) {
          const f = status as { Failure?: unknown };
          throw new Error(
            "Transaction failed: " + JSON.stringify(f.Failure).slice(0, 500)
          );
        }
      } catch (e) {
        if (
          e instanceof Error &&
          (e.message.includes("Transaction failed") || e.message.includes("Final"))
        ) {
          throw e;
        }
        // txStatus throws while the tx is unknown — keep polling.
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          "Transaction not finalized within 2 minutes. Check it on the explorer: " +
            `${EXPLORER_URL}/txns/${txHash}`
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatNear(yocto: string | number, digits = 4): string {
  try {
    return utils.format.formatNearAmount(String(yocto), digits);
  } catch {
    return "0";
  }
}

export function parseNear(amount: string): string | null {
  try {
    const y = utils.format.parseNearAmount(amount);
    return y;
  } catch {
    return null;
  }
}

export function formatDeadline(ns: number): string {
  const ms = ns / 1_000_000;
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function deadlinePassed(ns: number): boolean {
  return Date.now() > ns / 1_000_000;
}

export function timeLeft(ns: number): string {
  const diff = ns / 1_000_000 - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export function shortenHash(h: string, n = 10): string {
  if (h.length <= n * 2 + 3) return h;
  return `${h.slice(0, n)}…${h.slice(-n)}`;
}

// ---------------------------------------------------------------------------
// Local transaction log (this browser only — chain truth is on the explorer)
// ---------------------------------------------------------------------------

const TX_KEY = "patchpay:local-txs";

export function logLocalTx(tx: Omit<LocalTx, "ts">): void {
  try {
    const raw = localStorage.getItem(TX_KEY);
    const arr: LocalTx[] = raw ? JSON.parse(raw) : [];
    arr.unshift({ ...tx, ts: Date.now() });
    localStorage.setItem(TX_KEY, JSON.stringify(arr.slice(0, 100)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function readLocalTxs(accountId?: string): LocalTx[] {
  try {
    const raw = localStorage.getItem(TX_KEY);
    const arr: LocalTx[] = raw ? JSON.parse(raw) : [];
    return accountId ? arr.filter((t) => t.accountId === accountId) : arr;
  } catch {
    return [];
  }
}

export { CONTRACT_ACCOUNT };
