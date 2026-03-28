#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

mkdir -p .runlogs

"${ROOT_DIR}/scripts/ensure-humanizer-skill.sh"

npm ci
npm run build
npm run db:init -w @zhihu-mvp/api
npx pm2 startOrReload ecosystem.config.cjs --update-env
npx pm2 save

"${ROOT_DIR}/scripts/prod-status.sh"
