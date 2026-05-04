#!/usr/bin/env bash
# build.sh — Package BIBI Vessel Sync extension with a baked-in HMAC secret.
#
# Usage:
#   ./build.sh <EXT_SHARED_SECRET>
#
# Output: dist/bibi-vessel-sync.zip
#
# Behaviour:
#   1. Copies the extension to a temp dir.
#   2. Replaces `"__INJECTED_AT_BUILD__"` with the provided secret in popup.js and
#      background.js (exactly once each — script fails if not found).
#   3. Zips it. The resulting .zip can be loaded as Chrome unpacked or published.
#
# The secret MUST match backend .env EXT_SHARED_SECRET. Do NOT commit the zip
# anywhere public — it effectively IS the secret.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <EXT_SHARED_SECRET>"
  echo "Tip: set a secret via backend .env EXT_SHARED_SECRET, then bake the same one in here."
  exit 1
fi

SECRET="$1"
if [[ ${#SECRET} -lt 16 ]]; then
  echo "ERROR: secret is too short (${#SECRET} chars). Use at least 32 random bytes."
  exit 2
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
DIST_DIR="${SRC_DIR}/dist"
mkdir -p "${DIST_DIR}"

echo "[build] src=${SRC_DIR}"
echo "[build] tmp=${TMP_DIR}"

# Copy (skip build artefacts)
rsync -a --exclude 'dist' --exclude 'build.sh' --exclude 'node_modules' \
  --exclude '.DS_Store' "${SRC_DIR}/" "${TMP_DIR}/"

# Assert placeholder is present before we touch it
if ! grep -q '__INJECTED_AT_BUILD__' "${TMP_DIR}/popup.js"; then
  echo "ERROR: popup.js does not contain placeholder __INJECTED_AT_BUILD__"
  exit 3
fi
if ! grep -q '__INJECTED_AT_BUILD__' "${TMP_DIR}/background.js"; then
  echo "ERROR: background.js does not contain placeholder __INJECTED_AT_BUILD__"
  exit 3
fi

# Escape slashes for sed
SECRET_ESC=$(printf '%s' "$SECRET" | sed -e 's/[\/&]/\\&/g')
sed -i.bak "s/__INJECTED_AT_BUILD__/${SECRET_ESC}/g" "${TMP_DIR}/popup.js" "${TMP_DIR}/background.js"
rm -f "${TMP_DIR}/popup.js.bak" "${TMP_DIR}/background.js.bak"

# Sanity: the placeholder should now be gone
if grep -q '__INJECTED_AT_BUILD__' "${TMP_DIR}/popup.js" "${TMP_DIR}/background.js"; then
  echo "ERROR: placeholder still present after sed"
  exit 4
fi

OUT="${DIST_DIR}/bibi-vessel-sync.zip"
rm -f "${OUT}"
(cd "${TMP_DIR}" && zip -qr "${OUT}" .)

rm -rf "${TMP_DIR}"

echo "[build] ✓ packaged: ${OUT} ($(wc -c < "${OUT}") bytes)"
echo "[build] secret fingerprint: $(printf '%s' "$SECRET" | sha256sum | head -c 16)…"
echo "[build] verify in Chrome: chrome://extensions → Load unpacked / Drag .zip"
