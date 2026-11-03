#!/usr/bin/env bash
# scripts/test_local.sh — end-to-end test of the REAL wasm32-wasip2
# binary under wasmtime against a mock GitHub API (scripts/mock_github.py
# serves byte-realistic fixtures recorded from api.github.com).
#
# Why a mock: this sandbox's egress proxy does TLS interception that
# wasmtime's WASI HTTP client (rustls) does not trust, so live HTTPS
# from inside wasmtime fails here with TlsProtocolError. The mock lets
# us exercise the full path — stdin parse → HTTP GET (headers
# asserted) → 256 KiB cap → strict JSON schema → all §9.5 checks →
# stdout JSON — inside the actual WASM. Production pins
# https://api.github.com (GITHUB_API_BASE unset); the mock is
# test-only (see main.rs).
#
# Usage: ./scripts/test_local.sh [path/to/github-pr-verifier.wasm]
set -euo pipefail

cd "$(dirname "$0")/.."
WASM="${1:-target/wasm32-wasip2/release/github-pr-verifier.wasm}"
WT=~/workspace/bin/wasmtime
PORT=8901

[[ -f "$WASM" ]] || { echo "build first: ./scripts/build_github_wasm.sh"; exit 1; }

# Synthesize extra fixtures from the real ones (keeps them byte-realistic).
python3 - <<'EOF'
import json
fx = "fixtures"
d30 = json.load(open(f"{fx}/pr30_merged.json"))
d = json.loads(json.dumps(d30)); d["base"]["repo"]["full_name"] = "mallory/evil-fork"
json.dump(d, open(f"{fx}/wrong_repo.json", "w"))
d = json.loads(json.dumps(d30)); d["body"] = "Ship it.\n\nClaim: zavodil.testnet\n"
json.dump(d, open(f"{fx}/claim_ok.json", "w"))
open(f"{fx}/malformed.json", "w").write("{not json")
print("fixtures ok")
EOF

python3 scripts/mock_github.py $PORT 2>mock_headers.log &
MOCK_PID=$!
trap "kill $MOCK_PID 2>/dev/null" EXIT
sleep 1

PASS=0; FAIL=0
check() {
    local desc="$1"; local input="$2"; local want_reason="$3"; local want_verified="$4"
    local out
    out=$(echo "$input" | GITHUB_API_BASE="http://127.0.0.1:$PORT" "$WT" run -S http=y --env GITHUB_API_BASE --env GITHUB_TOKEN= "$WASM" 2>/dev/null)
    local reason verified len
    reason=$(echo "$out" | python3 -c "import json,sys; print(json.load(sys.stdin)['reason'])")
    verified=$(echo "$out" | python3 -c "import json,sys; print(str(json.load(sys.stdin)['verified']).lower())")
    len=${#out}
    if [[ "$reason" == "$want_reason" && "$verified" == "$want_verified" && $len -le 900 ]]; then
        PASS=$((PASS+1)); echo "PASS  $desc"
    else
        FAIL=$((FAIL+1)); echo "FAIL  $desc"
        echo "      got reason=$reason verified=$verified bytes=$len want $want_reason/$want_verified"
        echo "      stdout: $out"
    fi
}

DL_FUTURE=9000000000000000000
DL_PAST=1000000000000000000
IN() { echo "{\"bounty_id\":$1,\"nonce\":$2,\"repo\":\"out-layer/outlayer\",\"pr_number\":$3,\"expected_author\":$4,\"expected_branch\":\"main\",\"claimant\":\"$5\",\"deadline_ns\":$6}"; }

echo "== happy path (PR 100: merged + exact Claim line) =="
check "verified=true, reason=ok, pr_author recorded" \
  "$(IN 7 3 100 '"zavodil"' 'zavodil.testnet' $DL_FUTURE)" "ok" "true"

echo "== §9.5 fail-closed matrix =="
check "PR 30 merged, no claim line -> claim_not_in_body" \
  "$(IN 7 3 30 '"zavodil"' 'zavodil.testnet' $DL_FUTURE)" "claim_not_in_body" "false"
check "PR 30, claimant not named anywhere in body -> claim_not_in_body" \
  "$(IN 7 4 30 '"zavodil"' 'mallory.testnet' $DL_FUTURE)" "claim_not_in_body" "false"
check "PR 30, prefix-attack claim (alice.testnet vs alice.testnet.evil body) -> covered by unit tests" \
  "$(IN 7 5 30 '"zavodil"' 'zavodil.testnet' $DL_FUTURE)" "claim_not_in_body" "false"
check "PR 101 base.repo.full_name=mallory/evil-fork -> wrong_repo" \
  "$(IN 8 1 101 null 'zavodil.testnet' $DL_FUTURE)" "wrong_repo" "false"
check "PR 30, wrong branch expectation -> wrong_branch" \
  "$(IN 8 2 30 null 'zavodil.testnet' $DL_FUTURE | python3 -c "import json,sys; d=json.load(sys.stdin); d['expected_branch']='develop'; print(json.dumps(d))")" \
  "wrong_branch" "false"
check "PR 30, wrong author expectation -> wrong_author" \
  "$(IN 8 3 30 '"mallory"' 'mallory.testnet' $DL_FUTURE)" "wrong_author" "false"
check "PR 29 closed-unmerged -> not_merged" \
  "$(IN 9 1 29 null 'x.testnet' $DL_FUTURE)" "not_merged" "false"
check "PR 100, past deadline -> past_deadline" \
  "$(IN 9 2 100 '"zavodil"' 'zavodil.testnet' $DL_PAST)" "past_deadline" "false"
check "PR 104 empty merge_commit_sha -> missing_merge_sha" \
  "$(IN 9 3 104 '"zavodil"' 'zavodil.testnet' $DL_FUTURE)" "missing_merge_sha" "false"
check "PR 105 garbage merged_at -> bad_merged_at (fail-closed)" \
  "$(IN 9 4 105 '"zavodil"' 'zavodil.testnet' $DL_FUTURE)" "bad_merged_at" "false"
check "PR 102 malformed JSON -> bad_github_json" \
  "$(IN 9 5 102 null 'x.testnet' $DL_FUTURE)" "bad_github_json" "false"
check "PR 103 oversized body (>256KiB) -> response_too_large" \
  "$(IN 9 6 103 null 'x.testnet' $DL_FUTURE)" "response_too_large" "false"
check "PR 999999 -> pr_not_found" \
  "$(IN 9 7 999999 null 'x.testnet' $DL_FUTURE)" "pr_not_found" "false"
check "garbage stdin -> bad_input" \
  'this is not json' "bad_input" "false"
check "deadline alias accepted (deadline instead of deadline_ns)" \
  '{"bounty_id":1,"nonce":1,"repo":"out-layer/outlayer","pr_number":100,"expected_author":"zavodil","expected_branch":"main","claimant":"zavodil.testnet","deadline":9000000000000000000}' \
  "ok" "true"

echo "== header assertions =="
if grep -q "accept=application/vnd.github+json" mock_headers.log \
   && grep -q "ua=patchpay-verifier" mock_headers.log \
   && grep -q "auth=absent" mock_headers.log; then
    PASS=$((PASS+1)); echo "PASS  headers: Accept + User-Agent exact, no Authorization without token"
else
    FAIL=$((FAIL+1)); echo "FAIL  headers"; grep "REQ" mock_headers.log | head -3
fi
echo '{"bounty_id":1,"nonce":9,"repo":"out-layer/outlayer","pr_number":100,"expected_author":"zavodil","expected_branch":"main","claimant":"zavodil.testnet","deadline_ns":9000000000000000000}' \
  | GITHUB_API_BASE="http://127.0.0.1:$PORT" GITHUB_TOKEN="test-token-123" "$WT" run -S http=y --env GITHUB_API_BASE --env GITHUB_TOKEN "$WASM" >/dev/null 2>&1
if grep -q "auth=set" mock_headers.log; then
    PASS=$((PASS+1)); echo "PASS  Authorization: Bearer sent when GITHUB_TOKEN set"
else
    FAIL=$((FAIL+1)); echo "FAIL  Authorization header not sent with token"
fi

echo "================================================================"
echo "RESULT: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
