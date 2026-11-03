//! Host-side unit tests for the pure logic (parse/verify/emit).
//! The live HTTPS fetch is WASM-only; tests feed fixture bodies.
//! Extended per ARCHITECTURE.md §9 (fail-closed, §9.5/§9.1).
use super::*;

/// Minimal-but-valid GitHub PR JSON fixture. Fields not in the
/// whitelist are ignored by parse_pr.
fn pr_json(author: &str, base_ref: &str, base_repo: &str, merged: bool) -> Vec<u8> {
    format!(
        r#"{{
            "user": {{"login": "{author}"}},
            "base": {{"ref": "{base_ref}", "repo": {{"full_name": "{base_repo}"}}}},
            "merged": {merged},
            "body": "Fixes the widget.\n\nClaim: alice.testnet\n",
            "merge_commit_sha": "9f3b2a1c4d5e6f708192a3b4c5d6e7f8091a2b3c",
            "merged_at": "2026-11-01T10:00:00Z",
            "number": 123, "state": "closed", "title": "Widget fix",
            "head": {{"sha": "deadbeef"}}
        }}"#
    )
    .into_bytes()
}

fn base_input() -> Input {
    Input {
        bounty_id: 7,
        nonce: 3,
        repo: "out-layer/outlayer".to_string(),
        pr_number: 123,
        expected_author: Some("alice".to_string()),
        expected_branch: "main".to_string(),
        claimant: "alice.testnet".to_string(),
        deadline_ns: 9_000_000_000_000_000_000,
    }
}

fn good_pr() -> PrFacts {
    parse_pr(&pr_json("alice", "main", "out-layer/outlayer", true)).unwrap()
}

#[test]
fn happy_path_ok() {
    assert_eq!(verify(&base_input(), &good_pr()), Verdict::Ok);
}

#[test]
fn rejects_repo_mismatch() {
    // §9.5a: base repo must EXACTLY equal the input repo — same PR
    // number on a different repo must never verify.
    let pr = parse_pr(&pr_json("alice", "main", "mallory/evil-fork", true)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_repo"));
    // Case-exact: GitHub full_name is lowercase-canonical; a casing
    // difference is a mismatch.
    let pr = parse_pr(&pr_json("alice", "main", "Out-Layer/Outlayer", true)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_repo"));
}

#[test]
fn rejects_wrong_branch() {
    let pr = parse_pr(&pr_json("alice", "develop", "out-layer/outlayer", true)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_branch"));
}

#[test]
fn rejects_wrong_author() {
    let pr = parse_pr(&pr_json("mallory", "main", "out-layer/outlayer", true)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_author"));
}

#[test]
fn author_check_skipped_when_null() {
    let mut inp = base_input();
    inp.expected_author = None;
    let pr = parse_pr(&pr_json("anyone", "main", "out-layer/outlayer", true)).unwrap();
    assert_eq!(verify(&inp, &pr), Verdict::Ok);
}

#[test]
fn rejects_unmerged() {
    let pr = parse_pr(&pr_json("alice", "main", "out-layer/outlayer", false)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("not_merged"));
}

#[test]
fn rejects_missing_claim_line() {
    let mut raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw.clone()).unwrap().replace("Claim: alice.testnet", "no claim here");
    raw = s.into_bytes();
    let pr = parse_pr(&raw).unwrap();
    assert_eq!(
        verify(&base_input(), &pr),
        Verdict::Fail("claim_not_in_body")
    );
}

#[test]
fn rejects_claim_mismatch_and_prefix_attack() {
    // Claim names a different account → mismatch.
    let raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw).unwrap().replace("Claim: alice.testnet", "Claim: mallory.testnet");
    let pr = parse_pr(&s.into_bytes()).unwrap();
    assert_eq!(
        verify(&base_input(), &pr),
        Verdict::Fail("claim_mismatch")
    );
    // §9.1 hardening: substring "alice.testnet" inside a longer
    // account name must NOT satisfy claimant "alice.testnet".
    let raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw).unwrap().replace("Claim: alice.testnet", "Claim: alice.testnet.evil");
    let pr = parse_pr(&s.into_bytes()).unwrap();
    assert_eq!(
        verify(&base_input(), &pr),
        Verdict::Fail("claim_mismatch")
    );
}

#[test]
fn rejects_past_deadline() {
    let mut inp = base_input();
    inp.deadline_ns = 1; // before any merge
    assert_eq!(verify(&inp, &good_pr()), Verdict::Fail("past_deadline"));
}

#[test]
fn rejects_bad_merged_at_fail_closed() {
    // merged==true but merged_at garbage → uncertain → fail, never pass.
    let raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw).unwrap().replace("2026-11-01T10:00:00Z", "not-a-date");
    let pr = parse_pr(&s.into_bytes()).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("bad_merged_at"));
}

#[test]
fn rejects_missing_or_bad_merge_sha() {
    // empty merge_commit_sha
    let raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw)
        .unwrap()
        .replace("9f3b2a1c4d5e6f708192a3b4c5d6e7f8091a2b3c", "");
    let pr = parse_pr(&s.into_bytes()).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("missing_merge_sha"));
    // non-hex sha
    let raw = pr_json("alice", "main", "out-layer/outlayer", true);
    let s = String::from_utf8(raw)
        .unwrap()
        .replace("9f3b2a1c4d5e6f708192a3b4c5d6e7f8091a2b3c", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
    let pr = parse_pr(&s.into_bytes()).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("missing_merge_sha"));
}

#[test]
fn first_failure_wins_order() {
    // repo mismatch AND wrong branch AND unmerged: repo_mismatch wins.
    let pr = parse_pr(&pr_json("alice", "develop", "mallory/evil", false)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_repo"));
    // branch before author
    let pr = parse_pr(&pr_json("mallory", "develop", "out-layer/outlayer", true)).unwrap();
    assert_eq!(verify(&base_input(), &pr), Verdict::Fail("wrong_branch"));
}

#[test]
fn rejects_oversized_response() {
    // §9.5: >256 KiB rejected before parsing.
    let mut big = pr_json("alice", "main", "out-layer/outlayer", true);
    big.resize(MAX_RESPONSE_BYTES + 1, b'x');
    assert_eq!(parse_pr(&big).unwrap_err(), "response_too_large");
}

#[test]
fn rejects_malformed_json() {
    assert!(parse_pr(b"{not json").is_err());
}

#[test]
fn rejects_missing_or_wrong_typed_required_fields() {
    // missing user.login
    let v: Vec<u8> = br#"{"merged":true,"base":{"ref":"main","repo":{"full_name":"o/r"}}}"#.to_vec();
    assert!(parse_pr(&v).is_err());
    // merged not a bool
    let v: Vec<u8> = br#"{"merged":"yes","user":{"login":"a"},"base":{"ref":"main","repo":{"full_name":"o/r"}}}"#.to_vec();
    assert!(parse_pr(&v).is_err());
    // base.repo.full_name not a string
    let v: Vec<u8> = br#"{"merged":true,"user":{"login":"a"},"base":{"ref":"main","repo":{"full_name":42}}}"#.to_vec();
    assert!(parse_pr(&v).is_err());
    // null body is the documented GitHub empty shape → accepted as ""
    let v: Vec<u8> = br#"{"merged":true,"user":{"login":"a"},"base":{"ref":"main","repo":{"full_name":"o/r"}},"body":null}"#.to_vec();
    let pr = parse_pr(&v).unwrap();
    assert_eq!(pr.body, "");
}

#[test]
fn output_within_900_bytes_and_binds_nonce() {
    let out = emit_json(&base_input(), &Verdict::Ok, Some(&good_pr()));
    assert!(out.len() <= 900, "stdout {} > 900 bytes", out.len());
    assert!(out.contains("\"bounty_id\":7"));
    assert!(out.contains("\"nonce\":3"));
    assert!(out.contains("\"reason\":\"ok\""));
    assert!(out.contains("\"pr_author\":\"alice\"")); // §9.1: always recorded
    assert!(out.contains("\"merge_commit_sha\":\"9f3b2a1c"));
    let out = emit_json(&base_input(), &Verdict::Fail("not_merged"), Some(&good_pr()));
    assert!(out.contains("\"verified\":false"));
    assert!(out.contains("\"reason\":\"not_merged\""));
    assert!(out.len() <= 900);
}

#[test]
fn parse_input_accepts_null_author_and_rejects_bad_repo() {
    let raw = r#"{"bounty_id":1,"nonce":2,"repo":"o/r","pr_number":3,
                 "expected_author":null,"expected_branch":"main",
                 "claimant":"x.testnet","deadline_ns":9}"#;
    let i = parse_input(raw).unwrap();
    assert_eq!(i.expected_author, None);
    for bad in ["o", "o/r/r", "/r", "o/", "o /r", "o/r;"] {
        let raw = format!(
            "{{\"bounty_id\":1,\"nonce\":2,\"repo\":\"{bad}\",\"pr_number\":3,\
              \"expected_author\":null,\"expected_branch\":\"main\",\
              \"claimant\":\"x\",\"deadline_ns\":9}}"
        );
        assert!(parse_input(&raw).is_err(), "repo {bad} must be rejected");
    }
}

#[test]
fn rfc3339_conversion_spot_checks() {
    assert_eq!(rfc3339_to_ns("1970-01-01T00:00:00Z"), 0);
    // 2026-01-01T00:00:00Z == 1767225600 * 1e9 (independent calc)
    assert_eq!(
        rfc3339_to_ns("2026-01-01T00:00:00Z"),
        1_767_225_600_000_000_000
    );
    assert_eq!(rfc3339_to_ns("garbage"), 0);
    assert_eq!(rfc3339_to_ns(""), 0);
    let a = rfc3339_to_ns("2026-11-01T10:00:00Z");
    let b = rfc3339_to_ns("2026-11-01T10:00:00.5Z");
    assert_eq!(b - a, 500_000_000);
}

#[test]
fn parse_input_accepts_deadline_alias() {
    // Track A scaffold sends `deadline`; §4 used `deadline_ns`.
    for raw in [
        r#"{"bounty_id":1,"nonce":2,"repo":"o/r","pr_number":3,
            "expected_author":null,"expected_branch":"main",
            "claimant":"x.testnet","deadline":99}"#,
        r#"{"bounty_id":1,"nonce":2,"repo":"o/r","pr_number":3,
            "expected_author":null,"expected_branch":"main",
            "claimant":"x.testnet","deadline_ns":99}"#,
    ] {
        let i = parse_input(raw).unwrap();
        assert_eq!(i.deadline_ns, 99);
    }
}
