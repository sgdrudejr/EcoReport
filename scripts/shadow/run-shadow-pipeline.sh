#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cd "$ROOT_DIR"

echo "== Shadow Stage 0: chunk index =="
node scripts/build-report-chunk-index.js "$@"

echo "== Shadow Stage 1: evidence extracts =="
node scripts/build-stage1-shadow-extracts.js "$@"

echo "== Shadow Stage 2: topic buckets =="
node scripts/build-stage2-shadow-topic-buckets.js "$@"

echo "== Shadow Stage 3: final insights =="
node scripts/build-stage3-shadow-final-insights.js "$@"
