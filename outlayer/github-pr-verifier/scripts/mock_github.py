#!/usr/bin/env python3
"""Mock GitHub API for local WASM tests (scripts/test_local.sh).

Serves byte-realistic fixtures recorded from api.github.com
(see fixtures/*.json) on the same path shape:
    GET /repos/{owner}/{repo}/pulls/{n}

PR-number routing (all under out-layer/outlayer unless noted):
  30   -> pr30_merged.json          (merged, zavodil, main, NO Claim line)
  27   -> pr27_merged.json          (merged, zavodil, main, body w/o Claim)
  29   -> pr29_closed_unmerged.json (closed, merged=false)
  100  -> claim_ok.json             (merged + exact 'Claim: zavodil.testnet')
  101  -> wrong_repo.json           (base.repo.full_name = mallory/evil-fork)
  102  -> malformed.json            (not JSON at all)
  103  -> oversized body            (>256 KiB of 'x' -> response_too_large)
  104  -> no_merge_sha.json         (merged, but merge_commit_sha empty)
  105  -> bad_merged_at.json        (merged, merged_at garbage)
  999999 -> 404                     (pr_not_found)
  anything else -> 404

Logs request headers to stderr so tests can assert the exact
Accept/User-Agent/Authorization headers the WASM sends.
"""
import http.server
import json
import os
import sys

FX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures")


def load(name):
    with open(os.path.join(FX, name), "rb") as f:
        return f.read()


ROUTES = {
    30: ("pr30_merged.json", 200),
    27: ("pr27_merged.json", 200),
    29: ("pr29_closed_unmerged.json", 200),
}


def body_for(pr):
    if pr in ROUTES:
        return load(ROUTES[pr][0]), 200
    if pr == 100:
        return load("claim_ok.json"), 200
    if pr == 101:
        return load("wrong_repo.json"), 200
    if pr == 102:
        return b"{not json", 200
    if pr == 103:
        return b"x" * (257 * 1024), 200
    if pr == 104:
        d = json.loads(load("pr30_merged.json").decode())
        d["merge_commit_sha"] = ""
        d["body"] = "ok\n\nClaim: zavodil.testnet\n"
        return json.dumps(d).encode(), 200
    if pr == 105:
        d = json.loads(load("pr30_merged.json").decode())
        d["merged_at"] = "not-a-date"
        d["body"] = "ok\n\nClaim: zavodil.testnet\n"
        return json.dumps(d).encode(), 200
    return b'{"message":"Not Found"}', 404


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parts = self.path.strip("/").split("/")
        pr = None
        if len(parts) == 5 and parts[0] == "repos" and parts[3] == "pulls":
            try:
                pr = int(parts[4])
            except ValueError:
                pr = None
        sys.stderr.write(
            f"REQ {self.path} accept={self.headers.get('Accept')} "
            f"ua={self.headers.get('User-Agent')} "
            f"auth={'set' if self.headers.get('Authorization') else 'absent'}\n"
        )
        sys.stderr.flush()
        if pr is None:
            body, code = b'{"message":"Not Found"}', 404
        else:
            body, code = body_for(pr)
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8901
    http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
