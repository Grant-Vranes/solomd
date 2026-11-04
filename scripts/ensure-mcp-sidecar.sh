#!/usr/bin/env bash
#
# ensure-mcp-sidecar.sh
#
# `tauri dev` also validates `bundle.externalBin`, so the sidecar binary has to
# exist in app/src-tauri/binaries/ before the dev build starts — unlike
# `tauri build`, which populates it through `beforeBundleCommand`.
#
# This wrapper keeps `pnpm tauri dev` working from a fresh clone without paying
# for a sidecar rebuild on every restart: it only builds when the target-named
# binary is missing (or older than the mcp-server sources).
#
# Usage:
#     scripts/ensure-mcp-sidecar.sh            # build if missing / stale
#     scripts/ensure-mcp-sidecar.sh --force    # always rebuild
#
# Refresh manually after touching mcp-server/:
#     bash scripts/build-mcp-sidecar.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TARGET="${TAURI_ENV_TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
EXE=""
case "$TARGET" in
    *windows*) EXE=".exe" ;;
esac

DEST="$REPO_ROOT/app/src-tauri/binaries/solomd-mcp-$TARGET$EXE"

if [[ "${1:-}" != "--force" && -f "$DEST" ]]; then
    # Rebuild only if mcp-server sources are newer than the staged binary.
    if ! find "$REPO_ROOT/mcp-server/src" "$REPO_ROOT/mcp-server/Cargo.toml" \
            -newer "$DEST" -print -quit 2>/dev/null | grep -q .; then
        exit 0
    fi
    echo "ensure-mcp-sidecar: mcp-server sources changed, rebuilding sidecar"
fi

exec bash "$SCRIPT_DIR/build-mcp-sidecar.sh"
