#!/usr/bin/env bash
# ============================================================================
# BIBI Cars — Smoke test for the parser stack
# ----------------------------------------------------------------------------
# Quick assertions that everything wired up after a deploy. Read-only,
# non-destructive. Returns exit 0 on full pass, otherwise the count of failed
# checks.
# ============================================================================
set -u
BASE="${BIBI_API:-http://localhost:8001}"
FAILED=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YEL='\033[1;33m'; NC='\033[0m'
ok()  { echo -e "  ${GREEN}✓${NC} $*"; }
bad() { echo -e "  ${RED}✗${NC} $*"; FAILED=$((FAILED + 1)); }

check_status() {
  local label="$1" path="$2" want="$3"
  local code
  code=$(curl -sfm 5 -o /dev/null -w '%{http_code}' "$BASE$path" || echo 0)
  if [[ "$code" == "$want" ]]; then ok "$label → $code"; else bad "$label → $code (expected $want)"; fi
}

echo "BIBI smoke test against $BASE"
echo ""

echo "━ Public health"
check_status "/api/system/health"      /api/system/health      200
check_status "/api/control/overview"   /api/control/overview   200
check_status "/api/extension/info"     /api/extension/info     200
check_status "/api/extension/download" /api/extension/download 200
check_status "/api/parser/circuits"    /api/parser/circuits    200

echo ""
echo "━ Parser self-heal (idempotent POST)"
code=$(curl -sfm 5 -X POST -o /dev/null -w '%{http_code}' "$BASE/api/parser/self-heal" || echo 0)
if [[ "$code" == "200" ]]; then ok "/api/parser/self-heal → 200"; else bad "/api/parser/self-heal → $code"; fi

echo ""
echo "━ Calculator (sanity — should be isolated from parser)"
check_status "/api/calculator/ports"   /api/calculator/ports   200

echo ""
echo "━ System status"
OV=$(curl -sfm 5 "$BASE/api/control/overview" 2>/dev/null)
if [[ -n "$OV" ]]; then
  STATUS=$(echo "$OV" | jq -r '.system.label')
  PRIM=$(echo "$OV" | jq -r '.system.primary_up | length')
  case "$STATUS" in
    OK|PARTIAL) ok "system status: $STATUS · primary up: $PRIM" ;;
    DEGRADED)   bad "system status: DEGRADED · primary up: $PRIM (no primaries available)" ;;
    *)          bad "unknown system status: $STATUS" ;;
  esac
else
  bad "could not fetch overview"
fi

echo ""
if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}ALL CHECKS PASSED${NC}"
  exit 0
else
  echo -e "${RED}$FAILED CHECK(S) FAILED${NC}"
  exit $FAILED
fi
