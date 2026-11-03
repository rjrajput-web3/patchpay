/**
 * lib/config.ts — single source of truth for contract + network wiring.
 *
 * Deployed: patchpay.p2deployer.testnet (testnet, 2026-11-03).
 * Override via NEXT_PUBLIC_CONTRACT_ACCOUNT in .env.local or Vercel env.
 */

export const NETWORK_ID = process.env.NEXT_PUBLIC_NETWORK_ID || "testnet";

export const CONTRACT_ACCOUNT =
  process.env.NEXT_PUBLIC_CONTRACT_ACCOUNT || "patchpay.p2deployer.testnet";
export const CONTRACT_DEPLOYED = false; // flip to true after a successful deploy

export const OUTLAYER_CONTRACT =
  NETWORK_ID === "mainnet" ? "outlayer.near" : "outlayer.testnet";

// SHA256 of the Track B GitHub-PR-verifier WASM (pinned version_key).
export const VERIFIER_WASM_HASH =
  "b17ae0f6fa374e71b56fe196e2101f6a7528cf0b3a2987e6d440bcd8202801a7";

export const NODE_URL =
  process.env.NEXT_PUBLIC_NODE_URL ||
  (NETWORK_ID === "mainnet"
    ? "https://rpc.mainnet.near.org"
    : "https://rpc.testnet.near.org");

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_EXPLORER_URL ||
  (NETWORK_ID === "mainnet"
    ? "https://nearblocks.io"
    : "https://testnet.nearblocks.io");

export const OUTLAYER_API_URL =
  NETWORK_ID === "mainnet"
    ? "https://api.outlayer.ai"
    : "https://testnet-api.outlayer.ai";

export const explorerTxUrl = (txHash: string) =>
  `${EXPLORER_URL}/txns/${txHash}`;
export const explorerAccountUrl = (accountId: string) =>
  `${EXPLORER_URL}/address/${accountId}`;
export const githubRepoUrl = (repo: string) => `https://github.com/${repo}`;
export const githubPrUrl = (repo: string, pr: number) =>
  `https://github.com/${repo}/pull/${pr}`;
export const githubIssueUrl = (repo: string, issue: number) =>
  `https://github.com/${repo}/issues/${issue}`;
