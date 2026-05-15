#!/usr/bin/env bash
# Keep the EcoReport dashboard available for local review.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec npm --prefix "$ROOT_DIR/dashboard" run dev
