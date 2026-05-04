"""
security.py — production-grade auth / HMAC / rate-limit for BIBI CRM
====================================================================

Goals
-----
• Close the critical holes found in the security audit:
    1. /api/admin/*            → require_admin dependency
    2. /api/shipments/*        → require_manager_or_admin + shipment owner check
    3. /api/vesselfinder/jobs/*→ require_extension_hmac
    4. CORSMiddleware          → strict origin whitelist (wildcard-aware)
• Enforce JWT_SECRET != default at import time.
• Provide `assert_prod_safe()` which asserts production-safe config.
• Real JWT auth for staff accounts (issue + verify), bcrypt password hashing.
• RBAC + per-shipment ownership check (manager sees only own).

Modes
-----
`AUTH_MODE` env:
    - `strict`   : only valid JWT OR CRM_ADMIN_TOKEN accepted.
    - `legacy`   : also accepts the old demo-token-12345 (transitional).
    - `disabled` : skip auth entirely. **Only for local dev.**

`EXT_SHARED_SECRET` env:
    - Set → HMAC required on extension→backend POSTs.
    - Empty → HMAC verification is a no-op (dev).

HMAC scheme
-----------
    signature = HMAC_SHA256(
        EXT_SHARED_SECRET,
        f"{timestamp}\\n{method}\\n{path}\\n{body_sha256_hex}"
    )

Headers:
    X-Ext-Timestamp:  unix seconds
    X-Ext-Signature:  hex digest
    X-Ext-Client:     optional extension id (for logging)

Timestamp must be within ±HMAC_WINDOW_SEC of server time (replay protection).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional, Set

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError

try:
    import bcrypt as _bcrypt
except ImportError:  # pragma: no cover
    _bcrypt = None  # fallback happens at call site

logger = logging.getLogger("bibi.security")

# ─────────────────────────────────────────────────────────────────────
# Env
# ─────────────────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get("JWT_SECRET", "").strip()
JWT_ALGORITHM = "HS256"
JWT_DEFAULT_PLACEHOLDER = "your-secret-key-change-in-production"
JWT_TTL_HOURS = int(os.environ.get("JWT_TTL_HOURS", "24"))

EXT_SHARED_SECRET = os.environ.get("EXT_SHARED_SECRET", "").strip()
HMAC_WINDOW_SEC = int(os.environ.get("HMAC_WINDOW_SEC", "60"))  # ±60 s default
# Nonce: X-Ext-Nonce header for stronger replay-protection. Soft-launch:
# when ENFORCE_NONCE=0 (default) a missing nonce only emits a warning so the
# current extension build keeps working; duplicate nonces are still rejected.
ENFORCE_NONCE = os.environ.get("ENFORCE_NONCE", "0").strip() in ("1", "true", "yes", "on")

CRM_ADMIN_TOKEN = os.environ.get("CRM_ADMIN_TOKEN", "").strip()

AUTH_MODE = os.environ.get("AUTH_MODE", "legacy").strip().lower()
if AUTH_MODE not in ("strict", "legacy", "disabled"):
    logger.warning(f"[security] unknown AUTH_MODE={AUTH_MODE!r}, falling back to 'legacy'")
    AUTH_MODE = "legacy"

PAYLOAD_DEBUG_STORE = os.environ.get("PAYLOAD_DEBUG_STORE", "0").strip() in ("1", "true", "yes")
BACKEND_VF_SCRAPING = os.environ.get("BACKEND_VF_SCRAPING", "off").strip().lower() in ("on", "1", "true", "yes")

# Allowed legacy token (back-compat) — only honoured in AUTH_MODE=legacy.
LEGACY_DEMO_TOKEN = "demo-token-12345"

CORS_ORIGINS_RAW = os.environ.get("CORS_ORIGINS", "").strip()

# Roles — canonical set is {admin, team_lead, manager, user (customer)}.
# Legacy values (`owner`, `master_admin`, `moderator`) are kept here as
# back-compat aliases so any token or DB row that still carries them keeps
# working without a data migration, but no new code should issue them.
MASTER_ROLES: Set[str] = {"admin", "owner", "master_admin"}
ADMIN_ROLES: Set[str] = {"admin", "owner", "master_admin"}
MANAGER_ROLES: Set[str] = {"admin", "owner", "master_admin", "team_lead", "manager", "moderator"}
STAFF_ROLES: Set[str] = ADMIN_ROLES | MANAGER_ROLES


# ─────────────────────────────────────────────────────────────────────
# CORS parsing (wildcard-aware)
# ─────────────────────────────────────────────────────────────────────

def _origin_tokens() -> list[str]:
    if not CORS_ORIGINS_RAW:
        return []
    return [o.strip().rstrip("/") for o in CORS_ORIGINS_RAW.replace(";", ",").split(",") if o.strip()]


def parse_cors_origins() -> list[str]:
    """Return exact-match origins only (no wildcards, no `*`)."""
    raw = _origin_tokens()
    safe = [o for o in raw if o != "*" and "*" not in o]
    if "*" in raw:
        logger.error("[security] CORS_ORIGINS contains '*' — dropped (use explicit origins or wildcard subdomain)")
    return safe


def parse_cors_origin_regex() -> Optional[str]:
    """Build a single regex from wildcard origins (e.g. `https://*.preview.example.com`).

    Returns None if no wildcard origins configured.
    """
    raw = _origin_tokens()
    wilds = [o for o in raw if "*" in o and o != "*"]
    if not wilds:
        return None
    parts = []
    for o in wilds:
        # Escape everything then replace escaped wildcard back
        esc = re.escape(o).replace(r"\*", r"[^.]+")
        parts.append(f"^{esc}$")
    return "|".join(parts)


# ─────────────────────────────────────────────────────────────────────
# Startup invariants
# ─────────────────────────────────────────────────────────────────────

def assert_prod_safe() -> None:
    """Fail fast if the config is obviously unsafe for production.

    In ``AUTH_MODE=strict`` raises RuntimeError for any of:
        - JWT_SECRET empty or default placeholder
        - EXT_SHARED_SECRET empty
        - CORS contains plain "*"
    """
    problems: list[str] = []
    if not JWT_SECRET or JWT_SECRET == JWT_DEFAULT_PLACEHOLDER:
        problems.append(f"JWT_SECRET is empty or default placeholder ({JWT_DEFAULT_PLACEHOLDER!r})")
    if not EXT_SHARED_SECRET:
        problems.append("EXT_SHARED_SECRET is empty — HMAC protection disabled")
    if "*" in _origin_tokens():
        problems.append("CORS_ORIGINS contains '*' — disallowed with credentials")
    if AUTH_MODE == "disabled":
        problems.append("AUTH_MODE=disabled — all API endpoints are open")

    if not problems:
        logger.info("[security] startup: all invariants ok")
        return

    msg = "[security] startup problems:\n  - " + "\n  - ".join(problems)
    if AUTH_MODE == "strict":
        logger.error(msg)
        raise RuntimeError("Refusing to start in AUTH_MODE=strict with insecure config:\n" + msg)
    logger.warning(msg)


# ─────────────────────────────────────────────────────────────────────
# Password hashing (bcrypt)
# ─────────────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Return bcrypt hash (utf-8 string)."""
    if not plain:
        raise ValueError("empty password")
    if _bcrypt is None:  # pragma: no cover
        raise RuntimeError("bcrypt not installed")
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time bcrypt verify. False on any error."""
    if not plain or not hashed:
        return False
    if _bcrypt is None:  # pragma: no cover
        return False
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────
# JWT factory + verification
# ─────────────────────────────────────────────────────────────────────

def create_jwt(user: Dict[str, Any], ttl_hours: Optional[int] = None) -> str:
    """Sign an HS256 JWT with only the fields we care about.

    Keeps tokens small — we only put id/email/role/managerId/customerId.
    """
    if not JWT_SECRET or JWT_SECRET == JWT_DEFAULT_PLACEHOLDER:
        raise RuntimeError("JWT_SECRET not configured — refusing to issue token")
    ttl = ttl_hours if ttl_hours is not None else JWT_TTL_HOURS
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.get("id") or user.get("email") or "anon"),
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "role": (user.get("role") or "user").lower(),
        "managerId": user.get("managerId"),
        "customerId": user.get("customerId"),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ttl)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


_bearer = HTTPBearer(auto_error=False)


def _verify_jwt(token: str) -> Optional[dict]:
    if not JWT_SECRET or JWT_SECRET == JWT_DEFAULT_PLACEHOLDER:
        return None
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def _check_token(token: Optional[str]) -> Optional[dict]:
    """Return user-like dict on success, None on failure."""
    if not token:
        return None
    token = token.strip()

    # 1) JWT
    payload = _verify_jwt(token)
    if payload:
        return {"source": "jwt", **payload}

    # 2) CRM admin token (server-to-server / ops tool)
    if CRM_ADMIN_TOKEN and hmac.compare_digest(token, CRM_ADMIN_TOKEN):
        return {"source": "crm_admin_token", "role": "owner", "id": "crm_admin"}

    # 3) Legacy demo token
    if AUTH_MODE == "legacy" and hmac.compare_digest(token, LEGACY_DEMO_TOKEN):
        return {"source": "legacy_demo", "role": "owner", "id": "demo"}

    return None


# ─────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────

def _extract_token(creds: Optional[HTTPAuthorizationCredentials], request: Optional[Request]) -> Optional[str]:
    if creds and creds.credentials:
        return creds.credentials
    if request is not None:
        q = request.query_params.get("token")
        if q:
            return q
    return None


async def require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    request: Request = None,
) -> dict:
    """Require ANY authenticated staff user (owner/admin/manager/etc)."""
    if AUTH_MODE == "disabled":
        return {"source": "disabled", "role": "owner", "id": "dev", "email": "dev@local"}

    token = _extract_token(creds, request)
    user = _check_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


async def require_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    request: Request = None,
) -> dict:
    """Require owner / master_admin / admin role."""
    user = await require_user(creds, request)
    role = (user.get("role") or "").lower()
    if role not in ADMIN_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


async def require_master_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    request: Request = None,
) -> dict:
    """Require master_admin / owner role.

    Guards *infrastructure mutation* endpoints:
      - /api/ingestion/admin/parsers/*    (run / stop / configure / scheduler)
      - /api/ingestion/admin/parsers/*/circuit-breaker/reset
      - /api/ext/*                         (HMAC-signed client endpoints)
      - /api/admin/ext-clients/*           (client bootstrap / revoke / rotate)
      - /api/control/debug/probe           (synthetic resolver probe)

    Regular `admin` role stays read-only for these areas — it can still use the
    CRM / staff / deals admin pages but it cannot touch the parser pipeline.
    This keeps the "system runs itself, humans only watch" invariant.
    """
    user = await require_user(creds, request)
    role = (user.get("role") or "").lower()
    if role not in MASTER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Master admin role required for infrastructure control",
        )
    return user


async def require_manager_or_admin(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    request: Request = None,
) -> dict:
    """Require any staff role (owner/admin/manager/team_lead/...)."""
    user = await require_user(creds, request)
    role = (user.get("role") or "").lower()
    if role not in MANAGER_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager or admin role required")
    return user


async def optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[dict]:
    """Dependency that returns the user if credentials are present AND valid, else ``None``."""
    if not creds:
        return None
    return _check_token(creds.credentials)


def is_admin(user: Optional[dict]) -> bool:
    if not user:
        return False
    return (user.get("role") or "").lower() in ADMIN_ROLES


def is_master_admin(user: Optional[dict]) -> bool:
    """True only for `owner` / `master_admin`. Used by UI-oriented helpers
    that need to decide whether to surface infrastructure controls."""
    if not user:
        return False
    return (user.get("role") or "").lower() in MASTER_ROLES


def is_staff(user: Optional[dict]) -> bool:
    if not user:
        return False
    return (user.get("role") or "").lower() in MANAGER_ROLES


async def ensure_shipment_access(db, shipment_id: str, user: dict) -> dict:
    """Fetch shipment and enforce: admin → any; manager → only own (managerId match).

    Returns the shipment doc on success. Raises 404 / 403 otherwise.
    """
    if not shipment_id:
        raise HTTPException(status_code=404, detail="Shipment id required")
    shipment = await db.shipments.find_one({"id": shipment_id}, {"_id": 0})
    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if is_admin(user):
        return shipment
    # manager / team_lead: must own the shipment
    uid = user.get("id")
    if uid and shipment.get("managerId") and shipment["managerId"] == uid:
        return shipment
    raise HTTPException(status_code=403, detail="No access to this shipment")


# ─────────────────────────────────────────────────────────────────────
# HMAC verification — Extension ⇄ Backend
# ─────────────────────────────────────────────────────────────────────

def _hmac_digest(body_sha: str, method: str, path: str, ts: str) -> str:
    msg = f"{ts}\n{method.upper()}\n{path}\n{body_sha}".encode("utf-8")
    return hmac.new(EXT_SHARED_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def compute_hmac(method: str, path: str, body: bytes, ts: Optional[int] = None) -> Dict[str, str]:
    """Helper for tests / build-time signing. Returns dict of headers."""
    if ts is None:
        ts = int(time.time())
    body_sha = hashlib.sha256(body or b"").hexdigest()
    sig = _hmac_digest(body_sha, method, path, str(ts))
    return {"X-Ext-Timestamp": str(ts), "X-Ext-Signature": sig}


# ─── Nonce store hook (set by server.py on startup) ─────────────────
# server.py calls ``register_nonce_verifier(fn)`` where fn is an async
# callable ``(nonce: str, ts: int) → bool`` returning True if the nonce
# was new (accepted), False if a duplicate (replay) was detected.
_nonce_verifier = None  # type: ignore


def register_nonce_verifier(fn) -> None:
    """Plug a nonce-uniqueness verifier at startup."""
    global _nonce_verifier
    _nonce_verifier = fn


# ─── Per-client secret lookup hook (ext_clients registry) ────────────
# server.py calls ``register_client_secret_lookup(fn)`` where fn is an
# async callable ``(client_id: str) → Optional[str]`` returning the
# ACTIVE HMAC secret for the given clientId, or None if unknown/revoked.
# When the hook is set AND X-Ext-Client is present AND resolves to a
# secret — that secret is used instead of the global EXT_SHARED_SECRET.
_client_secret_lookup = None  # type: ignore


def register_client_secret_lookup(fn) -> None:
    global _client_secret_lookup
    _client_secret_lookup = fn


# ─── Optional HMAC-failure audit hook (set by server.py on startup) ──
_hmac_fail_audit = None  # type: ignore


def register_hmac_fail_audit(fn) -> None:
    """Fire-and-forget callable invoked on every HMAC failure.

    Signature: async fn(*, reason, client, method, path, ip) -> None.
    """
    global _hmac_fail_audit
    _hmac_fail_audit = fn


async def _fire_hmac_audit(reason: str, client: Optional[str], request: Request) -> None:
    if not _hmac_fail_audit:
        return
    try:
        ip = request.client.host if request and request.client else None
        await _hmac_fail_audit(
            reason=reason,
            client=client,
            method=request.method,
            path=request.url.path,
            ip=ip,
        )
    except Exception:
        pass


async def require_extension_hmac(
    request: Request,
    x_ext_timestamp: Optional[str] = Header(default=None, alias="X-Ext-Timestamp"),
    x_ext_signature: Optional[str] = Header(default=None, alias="X-Ext-Signature"),
    x_ext_client: Optional[str] = Header(default=None, alias="X-Ext-Client"),
    x_ext_nonce: Optional[str] = Header(default=None, alias="X-Ext-Nonce"),
) -> dict:
    """Enforce HMAC signature on extension POSTs.

    In ``AUTH_MODE=disabled`` OR when ``EXT_SHARED_SECRET`` is empty — no-op (dev).
    Also verifies X-Ext-Nonce uniqueness when a verifier is registered
    (replay-protection on top of the ±HMAC_WINDOW_SEC timestamp check).
    """
    if AUTH_MODE == "disabled":
        return {"verified": False, "reason": "auth_disabled"}
    if not EXT_SHARED_SECRET:
        return {"verified": False, "reason": "secret_not_configured"}

    if not x_ext_timestamp or not x_ext_signature:
        await _fire_hmac_audit("missing_headers", x_ext_client, request)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Ext-Timestamp / X-Ext-Signature",
        )

    try:
        ts_int = int(x_ext_timestamp)
    except ValueError:
        await _fire_hmac_audit("bad_timestamp", x_ext_client, request)
        raise HTTPException(status_code=401, detail="Bad X-Ext-Timestamp")
    now = int(time.time())
    if abs(now - ts_int) > HMAC_WINDOW_SEC:
        await _fire_hmac_audit("timestamp_window", x_ext_client, request)
        raise HTTPException(
            status_code=401,
            detail=f"Timestamp outside ±{HMAC_WINDOW_SEC}s window",
        )

    body = await request.body()
    body_sha = hashlib.sha256(body or b"").hexdigest()

    # Resolve secret: prefer per-client from registry, fall back to global.
    effective_secret = EXT_SHARED_SECRET
    client_source = "global"
    if _client_secret_lookup is not None and x_ext_client:
        try:
            per_client = await _client_secret_lookup(x_ext_client)
        except Exception as e:
            logger.warning(f"[security] ext_client lookup raised: {e}")
            per_client = None
        if per_client is not None:
            if per_client == "__REVOKED__":
                # Explicitly revoked client — reject even if signed correctly
                await _fire_hmac_audit("revoked_client", x_ext_client, request)
                raise HTTPException(status_code=401, detail="Revoked X-Ext-Client")
            effective_secret = per_client
            client_source = "ext_client"
        # else: client id not in registry → fall back to global (soft enrollment)

    msg = f"{x_ext_timestamp}\n{request.method.upper()}\n{request.url.path}\n{body_sha}".encode("utf-8")
    expected = hmac.new(effective_secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, (x_ext_signature or "").strip().lower()):
        logger.warning(
            f"[security] HMAC mismatch on {request.method} {request.url.path} "
            f"from client={x_ext_client!r} source={client_source}"
        )
        await _fire_hmac_audit("signature_mismatch", x_ext_client, request)
        raise HTTPException(status_code=401, detail="Bad X-Ext-Signature")

    # Nonce replay-protection (optional; soft-launch unless ENFORCE_NONCE=1).
    if _nonce_verifier is not None:
        if x_ext_nonce:
            try:
                ok = await _nonce_verifier(x_ext_nonce, ts_int)
            except Exception as e:
                logger.warning(f"[security] nonce verifier raised: {e}")
                ok = True  # do not block on DB failure
            if not ok:
                await _fire_hmac_audit("nonce_replay", x_ext_client, request)
                raise HTTPException(status_code=401, detail="Replayed X-Ext-Nonce")
        elif ENFORCE_NONCE:
            await _fire_hmac_audit("missing_nonce", x_ext_client, request)
            raise HTTPException(status_code=401, detail="Missing X-Ext-Nonce")
        else:
            logger.debug(
                f"[security] HMAC request without X-Ext-Nonce (soft mode) "
                f"client={x_ext_client!r} path={request.url.path}"
            )

    return {"verified": True, "client": x_ext_client, "nonce": x_ext_nonce}


# ─────────────────────────────────────────────────────────────────────
# Rate-limit (slowapi)
# ─────────────────────────────────────────────────────────────────────

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded  # noqa
except ImportError:  # pragma: no cover
    Limiter = None  # type: ignore
    get_remote_address = None  # type: ignore

if Limiter is not None:
    limiter = Limiter(
        key_func=get_remote_address,
        default_limits=["600/minute"],
        headers_enabled=True,
    )
else:
    limiter = None


# ─────────────────────────────────────────────────────────────────────
# Utility: sanitize a list of cookies by whitelist
# ─────────────────────────────────────────────────────────────────────

VF_COOKIE_WHITELIST: Set[str] = {
    "session", "sessionid", "phpsessid", "laravel_session",
    "xsrf-token", "csrftoken", "__secure-auth",
    "cf_clearance", "__cf_bm",
    "lang", "locale",
}


def sanitize_vf_cookies(cookies: list) -> list:
    out = []
    for c in cookies or []:
        if not isinstance(c, dict):
            continue
        name = (c.get("name") or "").strip().lower()
        if not name:
            continue
        if name in VF_COOKIE_WHITELIST:
            out.append(c)
    return out
