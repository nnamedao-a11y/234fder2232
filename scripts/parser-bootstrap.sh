#!/usr/bin/env bash
# ============================================================================
# BIBI Cars — Parser stack bootstrap
# ----------------------------------------------------------------------------
# Idempotent, non-destructive single-command deploy of the entire parser
# stack. Safe to run on a fresh container OR on an already-running system.
#
#   Usage:  /app/scripts/parser-bootstrap.sh
#           /app/scripts/parser-bootstrap.sh --skip-deps     # skip pip/yarn
#           /app/scripts/parser-bootstrap.sh --no-restart    # don't bounce sup
#           /app/scripts/parser-bootstrap.sh --quiet         # less output
#
# Exit codes:
#   0  all green
#   1  required env var missing
#   2  supervisor failed to bring services up
#   3  /api/control/overview health check failed
#   4  required system dependency missing
# ============================================================================
set -u

# ---- args -----------------------------------------------------------------
SKIP_DEPS=0
NO_RESTART=0
QUIET=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps)  SKIP_DEPS=1 ;;
    --no-restart) NO_RESTART=1 ;;
    --quiet)      QUIET=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
  esac
done

# ---- output helpers -------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'; DIM='\033[2m'; NC='\033[0m'
log()  { [[ "$QUIET" == "1" ]] || echo -e "${BLU}[bootstrap]${NC} $*"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YEL}⚠${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*" >&2; }
step() { echo -e "\n${BLU}━ $*${NC}"; }

START_TS=$(date +%s)
LOG_FILE="/var/log/bibi-bootstrap.log"
mkdir -p /var/log 2>/dev/null || true
exec > >(tee -a "$LOG_FILE") 2>&1

log "BIBI Cars parser bootstrap — $(date -Is)"

# ---- 1. host sanity -------------------------------------------------------
step "1/8 Host sanity"
for cmd in python3 pip mongosh supervisorctl curl jq node yarn; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "missing required command: $cmd"
    exit 4
  fi
done
ok "required tooling present"

if ! mongosh --quiet --eval 'db.runCommand({ping:1}).ok' 2>/dev/null | grep -q 1; then
  fail "MongoDB not reachable on default URL"
  exit 4
fi
ok "MongoDB reachable"

# ---- 2. env file ----------------------------------------------------------
step "2/8 /app/backend/.env"
ENV_FILE="/app/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  fail "missing $ENV_FILE"
  exit 1
fi

require_env() {
  local key="$1"
  if ! grep -qE "^${key}=." "$ENV_FILE"; then
    return 1
  fi
  if grep -qE "^${key}=\"?\"?$" "$ENV_FILE"; then
    return 1
  fi
  return 0
}

MISSING=()
for k in MONGO_URL CORS_ORIGINS JWT_SECRET EXT_SHARED_SECRET; do
  if ! require_env "$k"; then
    MISSING+=("$k")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "writing safe defaults for: ${MISSING[*]}"
  for k in "${MISSING[@]}"; do
    case "$k" in
      MONGO_URL)         echo 'MONGO_URL="mongodb://localhost:27017"' >> "$ENV_FILE" ;;
      CORS_ORIGINS)      echo 'CORS_ORIGINS="*"' >> "$ENV_FILE" ;;
      JWT_SECRET)        echo "JWT_SECRET=\"bibi_jwt_$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)\"" >> "$ENV_FILE" ;;
      EXT_SHARED_SECRET) echo "EXT_SHARED_SECRET=\"bibi_ext_$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | head -c 24)\"" >> "$ENV_FILE" ;;
    esac
  done
  ok "defaults written; please review $ENV_FILE before going to production"
else
  ok "all required env vars present"
fi

# ---- 3. Python deps -------------------------------------------------------
step "3/8 Python dependencies"
if [[ "$SKIP_DEPS" == "1" ]]; then
  warn "--skip-deps — skipping pip install"
else
  if cd /app/backend && pip install -q -r requirements.txt 2>&1 | tail -n 5; then
    ok "pip install completed"
  else
    warn "pip install reported issues; backend may still start if cache hot"
  fi
fi

# ---- 4. Playwright browsers ------------------------------------------------
step "4/8 Playwright browsers"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/pw-browsers}"
if ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium* >/dev/null 2>&1; then
  ok "chromium present at $PLAYWRIGHT_BROWSERS_PATH"
else
  if [[ "$SKIP_DEPS" == "1" ]]; then
    warn "--skip-deps but no chromium; installing anyway (one-time cost)"
  fi
  log "installing chromium..."
  python3 -m playwright install chromium 2>&1 | tail -n 5 || warn "playwright install reported issues"
fi

# ---- 5. Frontend deps -----------------------------------------------------
step "5/8 Frontend dependencies"
if [[ "$SKIP_DEPS" == "1" ]]; then
  warn "--skip-deps — skipping yarn install"
elif [[ -d /app/frontend/node_modules ]]; then
  ok "node_modules already populated (use --no-cache to force reinstall)"
else
  log "yarn install (~60s)..."
  cd /app/frontend && yarn install --silent 2>&1 | tail -n 3 || warn "yarn install reported issues"
  ok "yarn install complete"
fi

# ---- 6. Restart supervised services ---------------------------------------
step "6/8 Supervisor services"
if [[ "$NO_RESTART" == "1" ]]; then
  warn "--no-restart — leaving services as-is"
else
  sudo supervisorctl restart backend frontend 2>/dev/null || supervisorctl restart backend frontend || {
    fail "supervisor restart failed"
    exit 2
  }
  ok "backend & frontend restart issued"
fi

# ---- 7. Health check (poll 30s) -------------------------------------------
step "7/8 Health check"
DEADLINE=$(( $(date +%s) + 30 ))
HEALTH_OK=0
while [[ $(date +%s) -lt $DEADLINE ]]; do
  if curl -sfm 3 http://localhost:8001/api/system/health >/dev/null 2>&1 \
     && curl -sfm 3 http://localhost:8001/api/control/overview >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [[ "$HEALTH_OK" == "1" ]]; then
  ok "backend responding (/api/system/health, /api/control/overview)"
else
  fail "backend health check failed after 30s"
  fail "check: tail -n 100 /var/log/supervisor/backend.err.log"
  exit 3
fi

# ---- 8. Source warm-up ----------------------------------------------------
step "8/8 Source warm-up + status"
OVERVIEW=$(curl -sfm 5 http://localhost:8001/api/control/overview 2>/dev/null)
if [[ -n "$OVERVIEW" ]]; then
  STATUS=$(echo "$OVERVIEW" | jq -r '.system.label')
  REASON=$(echo "$OVERVIEW" | jq -r '.system.reason')
  PRIM_UP=$(echo "$OVERVIEW" | jq -r '.system.primary_up | length')
  PRIM_DOWN=$(echo "$OVERVIEW" | jq -r '.system.primary_down | length')
  EXT=$(echo "$OVERVIEW" | jq -r '.extension.online')

  case "$STATUS" in
    OK)       echo -e "  ${GREEN}●${NC} system: ${GREEN}OK${NC} — $REASON" ;;
    PARTIAL)  echo -e "  ${YEL}●${NC} system: ${YEL}PARTIAL${NC} — $REASON" ;;
    DEGRADED) echo -e "  ${RED}●${NC} system: ${RED}DEGRADED${NC} — $REASON" ;;
    *)        echo -e "  ${DIM}●${NC} system: $STATUS — $REASON" ;;
  esac
  echo -e "     ${DIM}primary up: $PRIM_UP · primary down: $PRIM_DOWN · extension online: $EXT${NC}"
else
  warn "could not fetch /api/control/overview for warm-up"
fi

# Reset stuck circuit breakers if any
curl -sfm 3 -X POST http://localhost:8001/api/parser/self-heal >/dev/null 2>&1 \
  && ok "circuit breakers reset (idempotent self-heal)" \
  || warn "self-heal endpoint not reachable (older build?)"

# ---- summary --------------------------------------------------------------
ELAPSED=$(( $(date +%s) - START_TS ))
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Parser bootstrap complete in ${ELAPSED}s${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  CRM:        http://localhost:3000 (or REACT_APP_BACKEND_URL via ingress)"
echo "  API base:   http://localhost:8001/api"
echo "  Health:     curl http://localhost:8001/api/system/health"
echo "  Overview:   curl http://localhost:8001/api/control/overview | jq"
echo "  Self-heal:  curl -X POST http://localhost:8001/api/parser/self-heal"
echo "  Docs:       /app/docs/parser/README.md"
echo "  Log:        $LOG_FILE"
exit 0
