#!/usr/bin/env node
/**
 * PATCHPAY testnet deploy — Track A.
 *
 * 1. Creates subaccount patchpay.p2deployer.testnet (new keypair, saved BEFORE use;
 *    public key verified against the on-chain full-access key before funding/deploy).
 * 2. Deploys the escrow wasm, runs new({owner}), prints code_hash + tx hashes.
 *
 * Reads the deployer key from ~/workspace/near-p2/.env (600). NEVER commit keys.
 * Usage: node scripts/deploy-testnet.mjs [--wasm path/to/patchpay_escrow.wasm] [--fund 8]
 */
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as nearAPI from "near-api-js";

const { connect, keyStores, KeyPair, utils } = nearAPI;
const HOME = homedir();
const ROOT = join(HOME, "workspace", "patchpay", "repo");
const HIDDEN = join(HOME, "workspace", "patchpay", "hidden");
const RPC = "https://rpc.testnet.fastnear.com";
const NETWORK = "testnet";
const SUBACCOUNT = "patchpay.p2deployer.testnet";

const args = process.argv.slice(2);
const wasmArg = args[args.indexOf("--wasm") + 1];
const fundArg = args[args.indexOf("--fund") + 1];
const FUND_NEAR = fundArg ? Number(fundArg) : 8;

function loadDeployerEnv() {
  const env = readFileSync(join(HOME, "workspace", "near-p2", ".env"), "utf8");
  const get = (k) => {
    const m = env.match(new RegExp(`^${k}=(.+)$`, "m"));
    if (!m) throw new Error(`missing ${k} in near-p2/.env`);
    return m[1].trim();
  };
  return { account: get("NEAR_DEPLOYER_ACCOUNT"), key: get("NEAR_DEPLOYER_KEY") };
}

function findWasm() {
  if (wasmArg && existsSync(wasmArg)) return wasmArg;
  const candidates = [
    join(ROOT, "contracts", "near-escrow", "target", "near", "patchpay_escrow.wasm"),
    join(ROOT, "contracts", "near-escrow", "target", "wasm32-unknown-unknown", "release", "patchpay_escrow.wasm"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("wasm not found — build first (cargo near build). Tried: " + candidates.join(", "));
}

async function main() {
  mkdirSync(HIDDEN, { recursive: true });
  const { account: deployerId, key: deployerKey } = loadDeployerEnv();

  const ks = new keyStores.InMemoryKeyStore();
  await ks.setKey(NETWORK, deployerId, KeyPair.fromString(deployerKey));
  const near = await connect({ networkId: NETWORK, nodeUrl: RPC, keyStore: ks });
  const deployer = await near.account(deployerId);

  const bal = await deployer.getAccountBalance();
  console.log(`deployer ${deployerId}: ${utils.format.formatNearAmount(bal.available)} NEAR available`);

  // --- key-save-verify order: generate + SAVE first, then verify on-chain ---
  const keyPath = join(HIDDEN, "patchpay.testnet.key.json");
  let keyPair;
  if (existsSync(keyPath)) {
    keyPair = KeyPair.fromString(JSON.parse(readFileSync(keyPath, "utf8")).secret_key);
    console.log(`reusing saved keypair at ${keyPath}`);
  } else {
    keyPair = KeyPair.fromRandom("ed25519");
    const pubkey = keyPair.getPublicKey().toString();
    writeFileSync(keyPath, JSON.stringify({ account_id: SUBACCOUNT, secret_key: keyPair.secretKey, public_key: pubkey }, null, 2));
    chmodSync(keyPath, 0o600);
    console.log(`saved NEW keypair to ${keyPath} (600) BEFORE use`);
  }
  const pubkey = keyPair.getPublicKey();

  // --- create subaccount (idempotent-ish: skip if it exists) ---
  let sub;
  try {
    sub = await near.account(SUBACCOUNT);
    await sub.state();
    console.log(`subaccount ${SUBACCOUNT} already exists`);
  } catch {
    console.log(`creating ${SUBACCOUNT} funded with ${FUND_NEAR} NEAR...`);
    const res = await deployer.createAccount(
      SUBACCOUNT, pubkey, utils.format.parseNearAmount(String(FUND_NEAR))
    );
    console.log("create_account tx:", res.transaction.hash);
    sub = await near.account(SUBACCOUNT);
    await ks.setKey(NETWORK, SUBACCOUNT, keyPair);
  }

  // --- VERIFY: on-chain full-access key must equal the saved key's pubkey ---
  const keys = await sub.getAccessKeys();
  const fullKeys = keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key);
  const ok = fullKeys.includes(pubkey.toString());
  console.log("on-chain full-access keys:", fullKeys.join(", "));
  if (!ok) throw new Error("KEY VERIFICATION FAILED: saved pubkey not on-chain — aborting");
  console.log("key verified: saved pubkey matches on-chain full-access key");
  await ks.setKey(NETWORK, SUBACCOUNT, keyPair);
  sub = await near.account(SUBACCOUNT); // rebind with key

  // --- deploy ---
  const wasmPath = findWasm();
  const wasm = readFileSync(wasmPath);
  console.log(`deploying ${wasm.length} bytes from ${wasmPath}...`);
  const deployRes = await sub.deployContract(wasm);
  console.log("deploy tx:", deployRes.transaction.hash);

  // --- init (only if not initialized: probe get_config) ---
  const REAL_VERIFIER_HASH = readFileSync(join(ROOT, "outlayer", "github-pr-verifier", "github-pr-verifier.wasm.sha256"), "utf8").split(/\s+/)[0];
  console.log("Track B verifier WASM SHA256:", REAL_VERIFIER_HASH);

  const contract = new nearAPI.Contract(sub, SUBACCOUNT, {
    viewMethods: ["get_config", "get_owner", "get_bounty"],
    changeMethods: ["new", "set_verifier_wasm_hash", "set_outlayer_contract"],
  });
  let initialized = false;
  try {
    await contract.get_config();
    initialized = true;
    console.log("contract already initialized");
  } catch { /* needs init */ }
  if (!initialized) {
    console.log(`calling new({owner: ${deployerId}})...`);
    const initRes = await contract.new({ owner: deployerId }, "300000000000000", "0");
    console.log("init tx:", initRes.transaction.hash);
  }

  // pin the real Track B verifier hash (owner action)
  let cfg = await contract.get_config();
  if (cfg.verifier_wasm_hash !== REAL_VERIFIER_HASH) {
    console.log(`setting verifier_wasm_hash to the Track B build...`);
    const hashRes = await contract.set_verifier_wasm_hash({ wasm_hash: REAL_VERIFIER_HASH }, "300000000000000", "0");
    console.log("set_verifier_wasm_hash tx:", hashRes.transaction.hash);
    cfg = await contract.get_config();
  } else {
    console.log("verifier_wasm_hash already pinned to the Track B build");
  }
  console.log("config:", JSON.stringify(cfg, null, 2));
  const state = await sub.state();
  console.log("code_hash:", state.code_hash);
  console.log(`\nexplorer: https://testnet.nearblocks.io/address/${SUBACCOUNT}`);
}

main().catch((e) => { console.error("DEPLOY FAILED:", e.message); process.exit(1); });
