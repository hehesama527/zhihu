#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

npx pm2 status
echo
echo "[api] $(curl -fsS http://127.0.0.1:8787/health)"
echo "[web] HTTP $(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000)"
