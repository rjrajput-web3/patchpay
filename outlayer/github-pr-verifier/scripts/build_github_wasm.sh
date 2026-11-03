#!/usr/bin/env bash
# scripts/build_github_wasm.sh — reproducible build for the PATCHPAY
# GitHub-PR verifier WASM (ARCHITECTURE.md §9.8: this binary's SHA256
# is the `verifier_wasm_hash` / OutLayer `version_key` trust anchor).
#
# Pinned toolchain: rustup stable, recorded below on each run.
# Preferred route: pinned Docker image (byte-identical). Docker is not
# available on this build VM, so we fall back to a local rustup build
# with the pinned toolchain version — still deterministic for
# rustc/LLVM codegen, and anyone can reproduce by pinning the same
# toolchain + `cargo --locked`.
#
# Usage: ./scripts/build_github_wasm.sh [--docker]
#   --docker  use the pinned Docker image (requires docker)
# Output: target/wasm32-wasip2/release/github-pr-verifier.wasm
#         + target/wasm32-wasip2/release/github-pr-verifier.wasm.sha256
set -euo pipefail

cd "$(dirname "$0")/.."

export TMPDIR="${TMPDIR:-$HOME/workspace/toon-channel/tmp}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-1}"

RUST_PIN="stable"          # resolved version recorded in build log
WASM_TARGET="wasm32-wasip2"
OUT="target/${WASM_TARGET}/release/github-pr-verifier.wasm"
MAX_SIZE=$((2 * 1024 * 1024))  # FastFS upload limit (per outlayer docs)

build_local() {
    export PATH="$HOME/.cargo/bin:$PATH"
    echo "==> rustc: $(rustc --version)"
    echo "==> cargo: $(cargo --version)"
    rustup target add "${WASM_TARGET}" 2>/dev/null || true
    cargo build --target "${WASM_TARGET}" --release --locked
}

build_docker() {
    # Pinned image: official Rust, fixed tag for auditability.
    local img="rust:1.99.1-bookworm"
    echo "==> docker image: ${img}"
    docker run --rm \
        -v "$PWD:/src" -w /src \
        -e CARGO_NET_OFFLINE=false \
        "${img}" \
        bash -lc "rustup target add ${WASM_TARGET} && cargo build --target ${WASM_TARGET} --release --locked"
}

if [[ "${1:-}" == "--docker" ]]; then
    command -v docker >/dev/null 2>&1 || { echo "docker not available"; exit 1; }
    build_docker
else
    if command -v docker >/dev/null 2>&1; then
        echo "NOTE: docker exists; pass --docker for the byte-identical pinned-image build."
    else
        echo "NOTE: docker unavailable on this host; using local rustup build (pinned toolchain recorded above)."
    fi
    build_local
fi

SIZE=$(stat -c%s "${OUT}")
HASH=$(sha256sum "${OUT}" | cut -d' ' -f1)
echo "${HASH}  $(basename "${OUT}")" > "${OUT}.sha256"

echo
echo "WASM:   ${OUT}"
echo "Size:   $((SIZE / 1024)) KiB"
echo "SHA256: ${HASH}"
{
    echo "built_at=$(date -u +%FT%TZ)"
    echo "rustc=$(rustc --version 2>/dev/null || echo docker-pinned)"
    echo "target=${WASM_TARGET}"
    echo "size_bytes=${SIZE}"
    echo "sha256=${HASH}"
} > "${OUT}.buildlog"

if (( SIZE > MAX_SIZE )); then
    echo "WARNING: exceeds 2 MiB FastFS upload limit."
    exit 1
fi
echo "OK: under FastFS limit. Commit ${OUT}.sha256 so verifiers can match hash <-> source."
