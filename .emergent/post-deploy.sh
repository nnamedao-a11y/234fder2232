#!/usr/bin/env bash
# ============================================================================
# BIBI Cars — Post-deploy hook
# ----------------------------------------------------------------------------
# Runs after every fresh container creation / GitHub deploy.
#  • Logs everything to /var/log/bibi-bootstrap.log
#  • NEVER blocks supervisor startup — if bootstrap fails the rest of the
#    system still boots; a failed bootstrap is loud but not fatal.
# ============================================================================
set -u
LOG="/var/log/bibi-bootstrap.log"
mkdir -p /var/log 2>/dev/null || true

{
  echo ""
  echo "=========================================================="
  echo " BIBI post-deploy — $(date -Is)"
  echo "=========================================================="
} >> "$LOG" 2>&1

# Run bootstrap, capture exit code, never propagate failure.
if /app/scripts/parser-bootstrap.sh --quiet >> "$LOG" 2>&1; then
  echo "[post-deploy] parser-bootstrap OK ($(date -Is))" >> "$LOG"
  exit 0
else
  EXIT=$?
  echo "[post-deploy] parser-bootstrap FAILED with exit=$EXIT ($(date -Is))" >> "$LOG"
  echo "[post-deploy] system continues to boot via supervisor" >> "$LOG"
  # Still exit 0 so we don't break container boot.
  exit 0
fi
