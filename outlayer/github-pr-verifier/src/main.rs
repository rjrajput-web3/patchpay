//! PATCHPAY — GitHub PR verifier (OutLayer TEE / WASI P2).
//!
//! Proves, inside OutLayer's Intel TDX trusted execution environment,
//! that a GitHub pull request was actually merged — the trust anchor for
//! the PATCHPAY bounty-escrow contract ("Code ships. Payment follows.").
//!
//! ## Security posture (ARCHITECTURE.md §9 — AUTHORITATIVE)
//! FAIL-CLOSED: any GitHub API error, missing field, wrong type,
//! oversized payload, or ambiguous/uncertain result → `verified:false`
//! with a reason code. Uncertain NEVER pays. No silent defaults: every
//! required field is type-checked against a whitelist and missing data
//! is a hard failure, never an empty string that could pass a check.
//!
//! ## I/O contract
//! Input (JSON on stdin):
//! ```json
//! { "bounty_id": 7, "nonce": 3, "repo": "owner/repo", "pr_number": 42,
//!   "expected_author": "alice",        // string | null
//!   "expected_branch": "main",
//!   "claimant": "alice.testnet",
//!   "deadline_ns": 1792051200000000000 }
//! ```
//! Output (JSON on stdout, <= 900 bytes):
//! ```json
//! { "bounty_id": 7, "nonce": 3, "verified": true, "reason": "ok",
//!   "pr_author": "alice", "merge_commit_sha": "9f3b2a1c...",
//!   "merged_at": "2026-11-01T10:00:00Z", "base_ref": "main" }
//! ```
//! `bounty_id`+`nonce` are echoed verbatim to bind the attestation to
//! the exact request the NEAR contract issued (replay protection,
//! §9.8). `pr_author` (GitHub `user.login`) is ALWAYS recorded (§9.1);
//! the contract pays ONLY the on-chain `submit_pr` caller — never an
//! address taken from PR text. The `Claim: <claimant>` body check is
//! one leg of the binding, not the whole identity proof.
//!
//! ## Checks (in order — first failure wins)
//! Transport/schema layer (always first):
//!  - GitHub unreachable                       → "github_unreachable"
//!  - HTTP != 200                              → "pr_not_found"
//!  - body > 256 KiB                           → "response_too_large"
//!  - malformed JSON / required field missing
//!    or wrong type                            → "bad_github_json"
//! Verdict layer (§9.5 + §9.1):
//!  1. `base.repo.full_name == repo` (exact)   → "wrong_repo"
//!  2. `base.ref == expected_branch`           → "wrong_branch"
//!  3. `user.login == expected_author` (if set)→ "wrong_author"
//!  4. `merged == true`                        → "not_merged"
//!  5. PR body line `Claim: <claimant>` exact  → "claim_not_in_body"
//!     / "claim_mismatch"
//!  6. `merged_at <= deadline` (valid RFC3339) → "past_deadline"
//!     / "bad_merged_at"
//!  7. `merge_commit_sha` 40-char hex          → "missing_merge_sha"
//! All pass → `verified: true, reason: "ok"`.
//!
//! ## Secrets
//! The GitHub token comes from the `GITHUB_TOKEN` environment variable,
//! injected by the OutLayer worker from an on-chain *encrypted* secret
//! bound to this WASM's hash. It is NEVER in code, git, or the image.

/// Max accepted GitHub API response body (§9.5): 256 KiB.
/// A PR payload is ~10–30 KiB; anything bigger is anomalous and is
/// rejected before JSON parsing logic runs.
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// Whitelisted fields we trust from the GitHub response (schema in
/// `parse_pr`). Everything else in the payload is ignored.
#[derive(Debug, Clone)]
struct PrFacts {
    author: String,        // user.login            (recorded always, §9.1)
    base_ref: String,      // base.ref
    base_repo: String,     // base.repo.full_name   (§9.5a — exact repo pin)
    merged: bool,          // merged
    body: String,          // body (string|null → "")
    merge_commit_sha: String, // merge_commit_sha   (§9.5f)
    merged_at: String,     // merged_at (RFC3339)
    merged_at_ns: u64,     // parsed; 0 = invalid  → fail-closed
}

#[derive(Debug, Clone)]
struct Input {
    bounty_id: u64,
    nonce: u64,
    repo: String,
    pr_number: u64,
    expected_author: Option<String>,
    expected_branch: String,
    claimant: String,
    deadline_ns: u64,
}

/// The verification verdict. `verify()` is pure (no I/O) so host-side
/// unit tests can drive it with fixtures without a TEE or wasmtime.
#[derive(Debug, PartialEq)]
enum Verdict {
    Ok,
    Fail(&'static str),
}

/// Strict, line-based claim extraction (§9.1): the PR body must contain
/// a line that is exactly `Claim: <claimant>` (whitespace around the
/// value allowed). Substring matching is NOT used — it would let
/// "Claim: alice.testnet.evil" satisfy claimant "alice.testnet".
fn claim_line_matches(body: &str, claimant: &str) -> Option<bool> {
    let mut found_any_claim_line = false;
    for line in body.lines() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix("Claim:") else {
            continue;
        };
        found_any_claim_line = true;
        if rest.trim() == claimant {
            return Some(true);
        }
    }
    if found_any_claim_line {
        Some(false) // claim present but names someone else → mismatch
    } else {
        None // no claim line at all
    }
}

fn verify(inp: &Input, pr: &PrFacts) -> Verdict {
    // (a) exact base-repository pin — the merge must land in the
    // bounty's repo, not any repo that happens to share a PR number.
    if pr.base_repo != inp.repo {
        return Verdict::Fail("wrong_repo");
    }
    // (b) target branch
    if pr.base_ref != inp.expected_branch {
        return Verdict::Fail("wrong_branch");
    }
    // (c) expected GitHub author (when the bounty names one)
    if let Some(expected) = &inp.expected_author {
        if &pr.author != expected {
            return Verdict::Fail("wrong_author");
        }
    }
    // (d) actually merged (covers closed-unmerged, open, draft)
    if !pr.merged {
        return Verdict::Fail("not_merged");
    }
    // (e) anti-front-running leg (§9.1): the body must name exactly
    // the claimant (which the contract sets to the submitter).
    match claim_line_matches(&pr.body, &inp.claimant) {
        Some(true) => {}
        Some(false) => return Verdict::Fail("claim_mismatch"),
        None => return Verdict::Fail("claim_not_in_body"),
    }
    // (f) merged before the deadline — and merged_at must be a real
    // timestamp. Malformed/absent merged_at is "uncertain" → fail.
    if pr.merged_at_ns == 0 {
        return Verdict::Fail("bad_merged_at");
    }
    if pr.merged_at_ns > inp.deadline_ns {
        return Verdict::Fail("past_deadline");
    }
    // (g) merge commit SHA present and well-formed. GitHub always
    // returns a 40-char lowercase hex SHA; anything else is a
    // malformed payload → fail closed (§9.5f).
    if pr.merge_commit_sha.len() != 40
        || !pr.merge_commit_sha.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Verdict::Fail("missing_merge_sha");
    }
    Verdict::Ok
}

/// Parse the stdin JSON into an [`Input`]. Rejects absurd values early
/// so a malformed caller cannot smuggle nonsense into the verdict.
fn parse_input(raw: &str) -> Result<Input, String> {
    let v: serde_json::Value =
        serde_json::from_str(raw.trim()).map_err(|e| format!("parse input: {e}"))?;

    let get_u64 = |k: &str| -> Result<u64, String> {
        v.get(k)
            .and_then(|x| x.as_u64())
            .ok_or_else(|| format!("missing/invalid '{k}'"))
    };
    let get_str = |k: &str| -> Result<String, String> {
        v.get(k)
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("missing/invalid '{k}'"))
    };

    let repo = get_str("repo")?;
    if !repo
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        || repo.matches('/').count() != 1
        || repo.starts_with('/')
        || repo.ends_with('/')
    {
        return Err("invalid 'repo' (want 'owner/repo')".to_string());
    }

    let expected_author = match v.get("expected_author") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        _ => return Err("invalid 'expected_author' (want string|null)".to_string()),
    };

    // Track A scaffold sends `deadline`; §4 spec used `deadline_ns`.
    // Accept either (ns timestamps); prefer `deadline_ns` when both
    // are present. This keeps the WASM robust to the contract's final
    // input_data shape.
    let deadline_ns = v
        .get("deadline_ns")
        .and_then(|x| x.as_u64())
        .or_else(|| v.get("deadline").and_then(|x| x.as_u64()))
        .ok_or_else(|| "missing/invalid 'deadline_ns'/'deadline'".to_string())?;

    Ok(Input {
        bounty_id: get_u64("bounty_id")?,
        nonce: get_u64("nonce")?,
        repo,
        pr_number: get_u64("pr_number")?,
        expected_author,
        expected_branch: get_str("expected_branch")?,
        claimant: get_str("claimant")?,
        deadline_ns,
    })
}

/// Field-type-strict extraction from the GitHub `GET
/// /repos/{o}/{r}/pulls/{n}` response. ONLY whitelisted fields are
/// read; required fields that are missing or wrongly typed make the
/// whole payload invalid ("bad_github_json") — never silent defaults.
/// GitHub returns `body: null` for empty bodies; that documented shape
/// is accepted as "". `user.login` and `base.*` fields are REQUIRED
/// because the verdict depends on them (§9.5 fail-closed).
fn parse_pr(raw: &[u8]) -> Result<PrFacts, String> {
    if raw.len() > MAX_RESPONSE_BYTES {
        return Err("response_too_large".to_string());
    }
    let v: serde_json::Value =
        serde_json::from_slice(raw).map_err(|_| "bad_github_json".to_string())?;

    let str_field = |path: &[&str]| -> Result<String, String> {
        let mut cur = &v;
        for p in path {
            cur = cur
                .get(*p)
                .ok_or_else(|| format!("bad_github_json: missing '{}'", path.join(".")))?;
        }
        cur.as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("bad_github_json: '{}' not a string", path.join(".")))
    };

    let merged = v
        .get("merged")
        .and_then(|x| x.as_bool())
        .ok_or_else(|| "bad_github_json: 'merged' not a bool".to_string())?;

    // body may be null (GitHub's documented empty-body shape).
    let body = match v.get("body") {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return Err("bad_github_json: 'body' not a string".to_string()),
    };

    let merged_at = match v.get("merged_at") {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return Err("bad_github_json: 'merged_at' not a string".to_string()),
    };
    let merge_commit_sha = match v.get("merge_commit_sha") {
        None | Some(serde_json::Value::Null) => String::new(),
        Some(serde_json::Value::String(s)) => s.clone(),
        _ => return Err("bad_github_json: 'merge_commit_sha' not a string".to_string()),
    };

    let merged_at_ns = if merged_at.is_empty() {
        0
    } else {
        rfc3339_to_ns(&merged_at)
    };

    Ok(PrFacts {
        author: str_field(&["user", "login"])?,
        base_ref: str_field(&["base", "ref"])?,
        base_repo: str_field(&["base", "repo", "full_name"])?,
        merged,
        body,
        merge_commit_sha,
        merged_at,
        merged_at_ns,
    })
}

/// Convert GitHub's RFC3339 timestamp ("2026-11-01T10:00:00Z",
/// sometimes with fractional seconds) to nanoseconds since the unix
/// epoch. Malformed/missing → 0, which `verify()` treats as
/// "uncertain" and fails closed with "bad_merged_at" — never as a
/// pass (a zero timestamp would otherwise sneak under the deadline).
fn rfc3339_to_ns(s: &str) -> u64 {
    fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }
    let t = s.trim_end_matches('Z');
    let (date, time) = match t.split_once('T') {
        Some(x) => x,
        None => return 0,
    };
    let dp: Vec<&str> = date.split('-').collect();
    let tp: Vec<&str> = time.split(':').collect();
    if dp.len() != 3 || tp.len() != 3 {
        return 0;
    }
    let (y, mo, d) = (
        dp[0].parse::<i64>().unwrap_or(0),
        dp[1].parse::<i64>().unwrap_or(0),
        dp[2].parse::<i64>().unwrap_or(0),
    );
    let (hh, mm) = (
        tp[0].parse::<i64>().unwrap_or(0),
        tp[1].parse::<i64>().unwrap_or(0),
    );
    let (ss, frac_ns): (i64, i64) = match tp[2].split_once('.') {
        Some((s, f)) => {
            let f = format!("{:0<9}", f);
            (
                s.parse::<i64>().unwrap_or(0),
                f[..9.min(f.len())].parse::<i64>().unwrap_or(0),
            )
        }
        None => (tp[2].parse::<i64>().unwrap_or(0), 0),
    };
    if y < 1970 {
        return 0;
    }
    let days = days_from_civil(y, mo, d);
    (days * 86400 + hh * 3600 + mm * 60 + ss) as u64 * 1_000_000_000 + frac_ns as u64
}

/// Serialize the result. Kept under OutLayer's 900-byte stdout limit
/// by construction: all fields are short fixed-format scalars.
fn emit_json(inp: &Input, verdict: &Verdict, pr: Option<&PrFacts>) -> String {
    let (verified, reason) = match verdict {
        Verdict::Ok => (true, "ok".to_string()),
        Verdict::Fail(r) => (false, r.to_string()),
    };
    let (author, sha, merged_at, base_ref) = match pr {
        Some(p) => (
            p.author.as_str(),
            p.merge_commit_sha.as_str(),
            p.merged_at.as_str(),
            p.base_ref.as_str(),
        ),
        None => ("", "", "", ""),
    };
    format!(
        "{{\"bounty_id\":{},\"nonce\":{},\"verified\":{},\"reason\":\"{}\",\
         \"pr_author\":\"{}\",\"merge_commit_sha\":\"{}\",\
         \"merged_at\":\"{}\",\"base_ref\":\"{}\"}}",
        inp.bounty_id, inp.nonce, verified, reason, author, sha, merged_at, base_ref
    )
}

/// Emit an early-error verdict (bad input, transport failure, HTTP
/// non-200, oversized/bad JSON) — always JSON, always flushed, always
/// `verified: false`.
fn emit_error(inp: Option<&Input>, code: &str) {
    let (bid, nonce) = inp.map(|i| (i.bounty_id, i.nonce)).unwrap_or((0, 0));
    let out = format!(
        "{{\"bounty_id\":{bid},\"nonce\":{nonce},\"verified\":false,\
         \"reason\":\"{code}\",\"pr_author\":\"\",\"merge_commit_sha\":\"\",\
         \"merged_at\":\"\",\"base_ref\":\"\"}}"
    );
    use std::io::Write;
    let mut so = std::io::stdout().lock();
    let _ = so.write_all(out.as_bytes());
    let _ = so.flush();
}

#[cfg(target_arch = "wasm32")]
fn fetch_pr(inp: &Input) -> Result<(u16, Vec<u8>), String> {
    // Base URL is pinned to https://api.github.com in production.
    // `GITHUB_API_BASE` exists ONLY so the HTTP layer can be tested
    // locally against a mock server (see scripts/test_local.sh) —
    // the PATCHPAY OutLayer deployment never sets it, and the
    // OutLayer worker injects env solely from encrypted project
    // secrets. A wrong host here can only produce verified:false
    // (the wrong_repo check pins base.repo.full_name to the request).
    let base = std::env::var("GITHUB_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.github.com".to_string());
    let base = base.trim_end_matches('/');
    let url = format!("{base}/repos/{}/pulls/{}", inp.repo, inp.pr_number);
    let token = std::env::var("GITHUB_TOKEN").ok().filter(|t| !t.is_empty());

    // NOTE: no explicit timeout — `wasi-http-client = "0.2"` only
    // exposes `connect_timeout` (TCP handshake), not response wait.
    // The worker's outer `max_execution_seconds` bounds total latency.
    let mut req = wasi_http_client::Client::new()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "patchpay-verifier");
    if let Some(t) = token {
        let auth = format!("Bearer {t}");
        req = req.header("Authorization", auth.as_str());
    }
    let resp = req
        .send()
        .map_err(|e| format!("github request failed: {e}"))?;
    let status = resp.status();
    let body = resp
        .body()
        .map_err(|e| format!("read github body: {e}"))?;
    Ok((status, body))
}

// Non-wasm stub: the same `main` shape compiles on the host so
// `cargo test` exercises parse/verify/emit logic with fixtures.
// (fetch is replaced by fixture bodies in tests.)
#[cfg(not(target_arch = "wasm32"))]
fn fetch_pr(_inp: &Input) -> Result<(u16, Vec<u8>), String> {
    Err("host build: no live fetch; use fixtures".to_string())
}

fn main() {
    use std::io::{Read, Write};

    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        emit_error(None, "bad_input");
        eprintln!("read stdin: {e}");
        return;
    }
    let inp = match parse_input(&input) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("{e}");
            emit_error(None, "bad_input");
            return;
        }
    };

    let (status, body) = match fetch_pr(&inp) {
        Ok(x) => x,
        Err(e) => {
            eprintln!("{e}");
            emit_error(Some(&inp), "github_unreachable");
            return;
        }
    };
    if status != 200 {
        emit_error(Some(&inp), "pr_not_found");
        return;
    }
    let pr = match parse_pr(&body) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}");
            // Normalize to the clean reason enum (parse_pr may add
            // field-path detail for logs; the contract sees the code).
            let code = if e == "response_too_large" {
                "response_too_large"
            } else {
                "bad_github_json"
            };
            emit_error(Some(&inp), code);
            return;
        }
    };
    let verdict = verify(&inp, &pr);
    let out = emit_json(&inp, &verdict, Some(&pr));
    let mut so = std::io::stdout().lock();
    let _ = so.write_all(out.as_bytes());
    let _ = so.flush();
}

#[cfg(test)]
mod tests;
