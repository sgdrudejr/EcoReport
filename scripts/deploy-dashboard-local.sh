#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_DIR="$ROOT_DIR/dashboard"
INSTALL_MODE="${LOCAL_DASHBOARD_INSTALL_MODE:-auto}"
CUSTOM_DEPLOY_CMD="${LOCAL_DASHBOARD_DEPLOY_CMD:-}"

log() {
  echo "[local-dashboard-deploy] $1"
}

run_default_install_if_needed() {
  if [[ "$INSTALL_MODE" == "never" ]]; then
    log "dependency install skipped (LOCAL_DASHBOARD_INSTALL_MODE=never)"
    return 0
  fi

  if [[ "$INSTALL_MODE" == "always" || ! -d "$DASHBOARD_DIR/node_modules" ]]; then
    log "installing dashboard dependencies"
    npm --prefix "$DASHBOARD_DIR" ci
    return 0
  fi

  log "using existing dashboard/node_modules"
}

run_default_deploy() {
  run_default_install_if_needed
  log "building dashboard"
  npm --prefix "$DASHBOARD_DIR" run build
}

if [[ -n "$CUSTOM_DEPLOY_CMD" ]]; then
  log "running custom deploy command"
  (
    cd "$ROOT_DIR"
    eval "$CUSTOM_DEPLOY_CMD"
  )
else
  run_default_deploy
fi

log "local dashboard deploy completed"
