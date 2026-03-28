#!/usr/bin/env bash

set -euo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"

if [[ -n "${HUMANIZER_SKILL_PATH:-}" ]]; then
  if [[ -f "${HUMANIZER_SKILL_PATH}" ]]; then
    echo "[humanizer] found ${HUMANIZER_SKILL_PATH}"
    exit 0
  fi

  echo "[humanizer] HUMANIZER_SKILL_PATH is set but missing: ${HUMANIZER_SKILL_PATH}" >&2
  echo "[humanizer] Place humanizer-zh at that path or unset HUMANIZER_SKILL_PATH before deploying." >&2
  exit 1
fi

SKILL_PATH="${CODEX_HOME_DIR}/skills/humanizer-zh/SKILL.md"

if [[ -f "${SKILL_PATH}" ]]; then
  echo "[humanizer] found ${SKILL_PATH}"
  exit 0
fi

INSTALLER="${CODEX_HOME_DIR}/skills/.system/skill-installer/scripts/install-skill-from-github.py"

if [[ ! -f "${INSTALLER}" ]]; then
  echo "[humanizer] missing installer at ${INSTALLER}" >&2
  echo "[humanizer] Install humanizer-zh manually, then rerun deployment." >&2
  exit 1
fi

mkdir -p "${CODEX_HOME_DIR}/skills"
python3 "${INSTALLER}" --repo op7418/Humanizer-zh --path . --name humanizer-zh --ref main --method download

if [[ ! -f "${SKILL_PATH}" ]]; then
  echo "[humanizer] install finished but ${SKILL_PATH} is still missing." >&2
  exit 1
fi

echo "[humanizer] installed ${SKILL_PATH}"
