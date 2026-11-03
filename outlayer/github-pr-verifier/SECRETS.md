# GitHub token — what Rohit must provide (ARCHITECTURE.md §10.1)

The verifier WASM needs a GitHub API token at RUNTIME (never in code).
Without it the verifier falls back to unauthenticated GitHub API access
(60 requests/hour per IP, shared across all OutLayer TEE workers) —
a DoS-on-ourselves risk under load. With the token: 5,000 requests/hour.

## What to create

A **fine-grained personal access token** (PAT) on GitHub:

- **Account:** a dedicated GitHub bot account (e.g. `patchpay-verifier`) is
  cleaner than Rohit's personal account. If he prefers his own account,
  that works too — the token's scope is what matters.
- **Token type:** fine-grained PAT (Settings → Developer settings →
  Personal access tokens → Fine-grained tokens).
- **Permissions:** **public repositories — read-only** (`metadata: read`
  is implied). No other permissions. No write, no secrets, no webhooks.
- **Resource owner:** the token owner's own account (public repos are
  accessible to any fine-grained token with read scope).
- **Expiration:** set 12 months and calendar a rotation. On rotation,
  update the OutLayer secret only — the WASM binary does not change.

## Where to store it

**OutLayer encrypted secrets** (testnet first). The token is stored
encrypted on-chain via the OutLayer dashboard/CLI and injected into the
TEE as the `GITHUB_TOKEN` environment variable. It can be bound to:

- the **project** (`patchpay-verifier` on testnet), or
- this **WASM's SHA256 hash** (tightest binding — a rebuilt binary with
  a different hash cannot read the secret).

Recommended: bind to the WASM hash. The exact CLI/dashboard steps are
documented in the OutLayer repo docs (getting-started → secrets).

## What NEVER to do

- NEVER paste the token into chat, email, a form, or a repo file.
- NEVER commit it to git (this repo, the contract repo, anywhere).
- NEVER bake it into the WASM binary, Docker image, or build logs.
- NEVER hand it to any subagent/worker — Rohit enters it directly in
  the OutLayer dashboard himself (his step, silent until then).

## How the WASM uses it

At runtime the WASM reads `GITHUB_TOKEN` from the environment (injected
by the OutLayer worker from the encrypted secret) and sends it as
`Authorization: Bearer <token>` to `api.github.com`. The token never
appears in stdout, logs, or the attestation output. Local testing uses
no token (fixtures + unauthenticated curl only).
