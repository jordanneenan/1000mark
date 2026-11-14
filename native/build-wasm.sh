#!/bin/bash
# Build the shared workloads (native/kernels) as WebAssembly for the browser test: tests/kernels.wasm.
# The file is committed, so the site needs no build step. Rebuild it only with suite changes (never,
# once the suite is frozen) and commit the result.
# Needs the wasm32-unknown-unknown standard library for the installed rustc. With rustup:
#   rustup target add wasm32-unknown-unknown
# Without rustup (Arch's rust package), point WASM_SYSROOT at a sysroot that has it.
set -euo pipefail
cd "$(dirname "$0")"
flags="-C target-feature=+simd128,+bulk-memory -C opt-level=3"
[ -n "${WASM_SYSROOT:-}" ] && flags="$flags --sysroot $WASM_SYSROOT"
RUSTFLAGS="$flags" cargo build --release --locked -p kernels --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/kernels.wasm ../tests/kernels.wasm
ls -l ../tests/kernels.wasm
