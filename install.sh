#!/usr/bin/env bash
# Thin shim — real installer is scripts/install.ts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun "${SCRIPT_DIR}/scripts/install.ts" "$@"
