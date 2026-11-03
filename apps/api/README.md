# apps/api — PATCHPAY backend (placeholder)

Minimal placeholder for Track A. Planned responsibilities:

- GitHub token custody (server-side only; PAT stored as an OutLayer encrypted secret,
  never in frontend or repo)
- Repository validation helpers
- Verification request queue / status tracking (MVP can rely on on-chain state only)
- Proof-center data aggregation (attestation links, tx hashes)

No secrets are committed here. See repo-root `.env.example`.
