"""
BIBI Cars — Notification "central nervous system"
==================================================

Architecture (no-surprises version):

    business logic
         │
         │  bus.emit("order_started", {...ctx})
         ▼
    ┌────────────┐
    │  EventBus  │  (simple async fan-out, in-process)
    └─────┬──────┘
          │
          ▼
    NotificationService
          │
          │  1. load enabled rule for the event
          │  2. for each target (customer / manager / team_lead / master_admin):
          │       resolve recipient(s) → render template in recipient's language →
          │       dispatch via enabled channels
          │
    ┌─────┼──────┬───────────────────┐
    ▼     ▼      ▼                   ▼
  Email  In-App  (telegram, sms)  future stubs

Templates + rules live in Mongo so master_admin edits them from the UI.
Defaults are seeded in code on the first boot.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Optional

logger = logging.getLogger("bibi.notifications")

# ── event catalogue ────────────────────────────────────────────────────
EVENT_INVOICE_SENT        = "invoice_sent"
EVENT_PAYMENT_CONFIRMED   = "payment_confirmed"
EVENT_ORDER_STARTED       = "order_started"
EVENT_ORDER_FINISHED      = "order_finished"
EVENT_PAYMENT_REMINDER    = "payment_reminder"
EVENT_PROVIDER_TIER_CHANGED = "provider_tier_changed"

ALL_EVENTS = [
    EVENT_INVOICE_SENT,
    EVENT_PAYMENT_CONFIRMED,
    EVENT_ORDER_STARTED,
    EVENT_ORDER_FINISHED,
    EVENT_PAYMENT_REMINDER,
    EVENT_PROVIDER_TIER_CHANGED,
]

EVENT_TITLES = {
    EVENT_INVOICE_SENT:      {"ua": "Надіслано рахунок",       "en": "Invoice sent"},
    EVENT_PAYMENT_CONFIRMED: {"ua": "Оплату підтверджено",     "en": "Payment confirmed"},
    EVENT_ORDER_STARTED:     {"ua": "Замовлення в роботі",     "en": "Order started"},
    EVENT_ORDER_FINISHED:    {"ua": "Замовлення завершено",    "en": "Order completed"},
    EVENT_PAYMENT_REMINDER:  {"ua": "Нагадування про оплату",  "en": "Payment reminder"},
    EVENT_PROVIDER_TIER_CHANGED: {"ua": "Зміна рівня виконавця", "en": "Provider tier changed"},
}

AUDIENCES = ("customer", "manager", "team_lead", "master_admin")
CHANNELS  = ("email", "in_app")
LANGUAGES = ("ua", "en")

# ── simple async event bus ─────────────────────────────────────────────
class EventBus:
    def __init__(self) -> None:
        self._handlers: Dict[str, List[Callable[[Dict[str, Any]], Awaitable[None]]]] = {}

    def on(self, event: str, handler: Callable[[Dict[str, Any]], Awaitable[None]]) -> None:
        self._handlers.setdefault(event, []).append(handler)

    async def emit(self, event: str, payload: Dict[str, Any]) -> None:
        handlers = list(self._handlers.get(event, []))
        if not handlers:
            logger.debug("[bus] no handlers for %s", event)
            return
        for h in handlers:
            try:
                # fire-and-forget; any handler exception is isolated
                asyncio.create_task(_safe(h, event, payload))
            except RuntimeError:
                # no running loop -> run inline
                try:
                    await h(payload)
                except Exception:
                    logger.exception("[bus] handler for %s failed (sync path)", event)


async def _safe(handler, event: str, payload: Dict[str, Any]):
    try:
        await handler(payload)
    except Exception:
        logger.exception("[bus] handler for %s failed", event)


bus = EventBus()


# ── channels ───────────────────────────────────────────────────────────
class EmailChannel:
    """Email dispatcher — dry-run by default, Resend-ready.

    Turn on real delivery by setting RESEND_API_KEY (+ optionally
    RESEND_FROM / RESEND_REPLY_TO) in backend/.env.
    Every dry-run send is recorded in the `email_outbox` collection so
    admins can see what WOULD have been sent.
    """

    def __init__(self, db):
        self.db = db
        self.provider = "resend" if os.environ.get("RESEND_API_KEY") else "dry_run"
        self.api_key = os.environ.get("RESEND_API_KEY")
        self.from_addr = os.environ.get("RESEND_FROM", "BIBI Cars <no-reply@bibi.cars>")
        self.reply_to = os.environ.get("RESEND_REPLY_TO")

    async def send(self, *, to: str, subject: str, html: str, text: str = "",
                   event: str = "", context: Dict[str, Any] | None = None) -> Dict[str, Any]:
        record = {
            "id": str(uuid.uuid4()),
            "to": to,
            "subject": subject,
            "html": html,
            "text": text,
            "provider": self.provider,
            "event": event,
            "context": context or {},
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if self.provider == "dry_run":
            record["status"] = "dry_run"
            logger.info("[email/dry_run] %s → %s | event=%s", subject, to, event)
            await self.db.email_outbox.insert_one(record)
            return {"ok": True, "mode": "dry_run", "id": record["id"]}

        # Resend
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": self.from_addr,
                        "to": [to],
                        "subject": subject,
                        "html": html,
                        **({"text": text} if text else {}),
                        **({"reply_to": self.reply_to} if self.reply_to else {}),
                    },
                )
            record["status"] = "sent" if r.status_code < 300 else "failed"
            record["provider_response"] = r.json() if r.content else {}
            record["provider_status"] = r.status_code
        except Exception as e:
            record["status"] = "failed"
            record["provider_error"] = str(e)
            logger.exception("[email/resend] send failed")

        try:
            await self.db.email_outbox.insert_one(record)
        except Exception:
            logger.exception("[email] outbox insert failed")
        return {"ok": record["status"] == "sent", "mode": "resend", "id": record["id"]}


class InAppChannel:
    """In-app notification = one document per recipient user in `notifications`."""

    def __init__(self, db, sio=None):
        self.db = db
        self.sio = sio

    async def send(self, *, user_id: str, title: str, message: str, event: str,
                   severity: str = "info", meta: Dict[str, Any] | None = None,
                   sound_key: Optional[str] = None) -> Dict[str, Any]:
        if not user_id:
            return {"ok": False, "error": "user_id required"}
        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "id": f"notif_{int(datetime.now(timezone.utc).timestamp()*1000)}_{uuid.uuid4().hex[:6]}",
            "userId": user_id,
            "type": event,
            "event": event,
            "title": title,
            "message": message,
            "severity": severity,
            "meta": meta or {},
            "soundKey": sound_key or _default_sound(event),
            "read": False,
            "isRead": False,
            "created_at": now,
            "createdAt": now,
        }
        await self.db.notifications.insert_one(doc)
        doc.pop("_id", None)
        # Live push via socket.io (frontend uses /notifications room already)
        if self.sio:
            try:
                await self.sio.emit("notification", doc, namespace="/notifications")
            except Exception:
                logger.exception("[in_app] socket emit failed")
        return {"ok": True, "id": doc["id"]}


def _default_sound(event: str) -> str:
    return {
        EVENT_PAYMENT_CONFIRMED: "payment",
        EVENT_ORDER_FINISHED:    "success",
        EVENT_PAYMENT_REMINDER:  "alert",
    }.get(event, "alert")


# ── template rendering ─────────────────────────────────────────────────
_TOKEN = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


def render(text: str, context: Dict[str, Any]) -> str:
    """Very small {{ path.to.value }} renderer — no eval, no surprises."""
    if not text:
        return ""

    def _resolve(path: str) -> str:
        cur: Any = context
        for part in path.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            elif cur is not None and hasattr(cur, part):
                cur = getattr(cur, part)
            else:
                return ""
            if cur is None:
                return ""
        return str(cur)

    return _TOKEN.sub(lambda m: _resolve(m.group(1)), text)


def money(amount, currency: str = "USD") -> str:
    try:
        a = float(amount or 0)
    except Exception:
        a = 0
    return f"{a:,.2f} {(currency or 'USD').upper()}"


# ── defaults (seeded on boot) ──────────────────────────────────────────
# NOTE: edit in /admin/settings/email-templates — these are just seeds.
DEFAULT_TEMPLATES = [
    # ── INVOICE SENT ──────────────────────────────────────────────
    {
        "event": EVENT_INVOICE_SENT,
        "audience": "customer",
        "lang": "ua",
        "subject": "Новий рахунок №{{ invoice.id }} · {{ invoice.total_fmt }}",
        "html": """
            <h2 style="color:#18181B">Вітаємо, {{ customer.name }}!</h2>
            <p>Ваш менеджер {{ manager.name }} сформував рахунок <b>{{ invoice.id }}</b> на суму <b>{{ invoice.total_fmt }}</b>.</p>
            <p>Ви можете сплатити його за посиланням або зв'язатися з менеджером для уточнень.</p>
            <p style="margin-top:24px;color:#71717A">— команда BIBI Cars</p>
        """,
        "text_template": "Привіт, {{ customer.name }}! Рахунок {{ invoice.id }} на {{ invoice.total_fmt }} готовий до оплати.",
    },
    {
        "event": EVENT_INVOICE_SENT,
        "audience": "customer",
        "lang": "en",
        "subject": "New invoice #{{ invoice.id }} · {{ invoice.total_fmt }}",
        "html": """
            <h2>Hi {{ customer.name }},</h2>
            <p>Your manager {{ manager.name }} has issued invoice <b>{{ invoice.id }}</b> for <b>{{ invoice.total_fmt }}</b>.</p>
            <p>You can pay it via the link or contact your manager for details.</p>
            <p style="margin-top:24px;color:#71717A">— BIBI Cars team</p>
        """,
        "text_template": "Hi {{ customer.name }}! Invoice {{ invoice.id }} for {{ invoice.total_fmt }} is ready for payment.",
    },
    # ── PAYMENT CONFIRMED ────────────────────────────────────────
    {
        "event": EVENT_PAYMENT_CONFIRMED,
        "audience": "customer",
        "lang": "ua",
        "subject": "Оплату прийнято · {{ invoice.id }}",
        "html": """
            <h2 style="color:#059669">Дякуємо, {{ customer.name }}!</h2>
            <p>Ми отримали вашу оплату за рахунком <b>{{ invoice.id }}</b> на суму <b>{{ invoice.total_fmt }}</b>.</p>
            <p>Команда BIBI Cars вже почала роботу над вашим замовленням. Статус можна відслідковувати в особистому кабінеті.</p>
        """,
    },
    {
        "event": EVENT_PAYMENT_CONFIRMED,
        "audience": "customer",
        "lang": "en",
        "subject": "Payment received · {{ invoice.id }}",
        "html": """
            <h2 style="color:#059669">Thank you, {{ customer.name }}!</h2>
            <p>We have received your payment for invoice <b>{{ invoice.id }}</b>, amount <b>{{ invoice.total_fmt }}</b>.</p>
            <p>BIBI Cars team is starting to work on your order. You can track the progress in your cabinet.</p>
        """,
    },
    {
        "event": EVENT_PAYMENT_CONFIRMED,
        "audience": "manager",
        "lang": "ua",
        "subject": "[inApp] Оплата по {{ invoice.id }}",
        "html": "Клієнт {{ customer.name }} оплатив {{ invoice.total_fmt }} — замовлення створено.",
    },
    {
        "event": EVENT_PAYMENT_CONFIRMED,
        "audience": "manager",
        "lang": "en",
        "subject": "[inApp] Payment on {{ invoice.id }}",
        "html": "Customer {{ customer.name }} paid {{ invoice.total_fmt }} — order created.",
    },
    # ── ORDER STARTED ────────────────────────────────────────────
    {
        "event": EVENT_ORDER_STARTED,
        "audience": "customer",
        "lang": "ua",
        "subject": "Замовлення {{ order.id }} в роботі",
        "html": """
            <h2>Замовлення в роботі 🚀</h2>
            <p>Ми почали виконувати послуги за рахунком <b>{{ invoice.id }}</b>.</p>
            <p>Кількість етапів: {{ order.steps_total }}. Дивіться прогрес у особистому кабінеті.</p>
        """,
    },
    {
        "event": EVENT_ORDER_STARTED,
        "audience": "customer",
        "lang": "en",
        "subject": "Order {{ order.id }} in progress",
        "html": """
            <h2>Your order is in progress 🚀</h2>
            <p>We started executing services from invoice <b>{{ invoice.id }}</b>.</p>
            <p>Total steps: {{ order.steps_total }}. Track status in your cabinet.</p>
        """,
    },
    {
        "event": EVENT_ORDER_STARTED,
        "audience": "manager",
        "lang": "ua",
        "subject": "[inApp] Нове замовлення {{ order.id }}",
        "html": "Запустилось замовлення {{ order.id }} — {{ order.steps_total }} кроків.",
    },
    {
        "event": EVENT_ORDER_STARTED,
        "audience": "manager",
        "lang": "en",
        "subject": "[inApp] New order {{ order.id }}",
        "html": "Order {{ order.id }} started — {{ order.steps_total }} steps.",
    },
    # ── ORDER FINISHED ───────────────────────────────────────────
    {
        "event": EVENT_ORDER_FINISHED,
        "audience": "customer",
        "lang": "ua",
        "subject": "Замовлення {{ order.id }} виконано ✓",
        "html": """
            <h2>Готово!</h2>
            <p>Ваше замовлення <b>{{ order.id }}</b> успішно виконано. Дякуємо, що обрали BIBI Cars.</p>
        """,
    },
    {
        "event": EVENT_ORDER_FINISHED,
        "audience": "customer",
        "lang": "en",
        "subject": "Order {{ order.id }} completed ✓",
        "html": """
            <h2>Done!</h2>
            <p>Your order <b>{{ order.id }}</b> has been completed. Thank you for choosing BIBI Cars.</p>
        """,
    },
    {
        "event": EVENT_ORDER_FINISHED,
        "audience": "manager",
        "lang": "ua",
        "subject": "[inApp] Замовлення {{ order.id }} виконано",
        "html": "Всі кроки завершено. Клієнт: {{ customer.name }}.",
    },
    {
        "event": EVENT_ORDER_FINISHED,
        "audience": "manager",
        "lang": "en",
        "subject": "[inApp] Order {{ order.id }} finished",
        "html": "All steps completed. Customer: {{ customer.name }}.",
    },
    # ── PAYMENT REMINDER ─────────────────────────────────────────
    {
        "event": EVENT_PAYMENT_REMINDER,
        "audience": "customer",
        "lang": "ua",
        "subject": "Нагадування про оплату · {{ invoice.id }}",
        "html": """
            <h2>Нагадуємо про оплату</h2>
            <p>Рахунок <b>{{ invoice.id }}</b> на суму <b>{{ invoice.total_fmt }}</b> ще не сплачений.</p>
            <p>Будь ласка, оплатіть якомога швидше — або зв'яжіться з менеджером, якщо потрібна допомога.</p>
        """,
    },
    {
        "event": EVENT_PAYMENT_REMINDER,
        "audience": "customer",
        "lang": "en",
        "subject": "Payment reminder · {{ invoice.id }}",
        "html": """
            <h2>Friendly reminder</h2>
            <p>Invoice <b>{{ invoice.id }}</b> for <b>{{ invoice.total_fmt }}</b> is still unpaid.</p>
            <p>Please settle it at your earliest convenience, or contact your manager if you need help.</p>
        """,
    },
    {
        "event": EVENT_PAYMENT_REMINDER,
        "audience": "manager",
        "lang": "ua",
        "subject": "[inApp] Нагадування надіслано · {{ invoice.id }}",
        "html": "Клієнту {{ customer.name }} відправлено нагадування щодо {{ invoice.total_fmt }}.",
    },
    {
        "event": EVENT_PAYMENT_REMINDER,
        "audience": "manager",
        "lang": "en",
        "subject": "[inApp] Reminder dispatched · {{ invoice.id }}",
        "html": "Reminder sent to {{ customer.name }} for {{ invoice.total_fmt }}.",
    },
    # ── PROVIDER TIER CHANGED ─────────────────────────────────────
    {
        "event": EVENT_PROVIDER_TIER_CHANGED,
        "audience": "manager",
        "lang": "ua",
        "subject": "[inApp] Твій рівень змінився · {{ new_tier }} (score {{ score }})",
        "html": "{{ message_ua }} · score {{ score }} · {{ prev_tier }} → {{ new_tier }}",
    },
    {
        "event": EVENT_PROVIDER_TIER_CHANGED,
        "audience": "manager",
        "lang": "en",
        "subject": "[inApp] Your tier changed · {{ new_tier }} (score {{ score }})",
        "html": "{{ message_en }} · score {{ score }} · {{ prev_tier }} → {{ new_tier }}",
    },
    {
        "event": EVENT_PROVIDER_TIER_CHANGED,
        "audience": "master_admin",
        "lang": "ua",
        "subject": "[inApp] Менеджер {{ manager.name }} — {{ prev_tier }} → {{ new_tier }}",
        "html": "Менеджер {{ manager.name }} ({{ manager.email }}) {{ prev_tier }} → <b>{{ new_tier }}</b>, score {{ score }}.",
    },
    {
        "event": EVENT_PROVIDER_TIER_CHANGED,
        "audience": "master_admin",
        "lang": "en",
        "subject": "[inApp] Manager {{ manager.name }} — {{ prev_tier }} → {{ new_tier }}",
        "html": "Manager {{ manager.name }} ({{ manager.email }}) moved {{ prev_tier }} → <b>{{ new_tier }}</b>, score {{ score }}.",
    },
]


# Default routing rules — which audiences / channels get each event
DEFAULT_RULES = [
    {
        "event": EVENT_INVOICE_SENT,
        "enabled": True,
        "targets": [
            {"audience": "customer", "channels": ["email"]},
        ],
    },
    {
        "event": EVENT_PAYMENT_CONFIRMED,
        "enabled": True,
        "targets": [
            {"audience": "customer", "channels": ["email"]},
            {"audience": "manager",  "channels": ["in_app"]},
        ],
    },
    {
        "event": EVENT_ORDER_STARTED,
        "enabled": True,
        "targets": [
            {"audience": "customer", "channels": ["email"]},
            {"audience": "manager",  "channels": ["in_app"]},
        ],
    },
    {
        "event": EVENT_ORDER_FINISHED,
        "enabled": True,
        "targets": [
            {"audience": "customer", "channels": ["email"]},
            {"audience": "manager",  "channels": ["in_app"]},
        ],
    },
    {
        "event": EVENT_PAYMENT_REMINDER,
        "enabled": True,
        "targets": [
            {"audience": "customer", "channels": ["email"]},
            {"audience": "manager",  "channels": ["in_app"]},
        ],
    },
    {
        "event": EVENT_PROVIDER_TIER_CHANGED,
        "enabled": True,
        "targets": [
            {"audience": "manager",     "channels": ["in_app"]},
            {"audience": "master_admin","channels": ["in_app"]},
        ],
    },
]


# ── NotificationService ────────────────────────────────────────────────
class NotificationService:
    def __init__(self, db, sio=None):
        self.db = db
        self.email = EmailChannel(db)
        self.in_app = InAppChannel(db, sio)

    async def seed_defaults(self) -> None:
        """Insert default rules + templates if collections are empty.
        Idempotent — will never overwrite user edits."""
        if await self.db.notification_rules.count_documents({}) == 0:
            docs = []
            for r in DEFAULT_RULES:
                docs.append({
                    "id": f"rule_{r['event']}",
                    **r,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            if docs:
                await self.db.notification_rules.insert_many(docs)
                logger.info("[notif] seeded %d notification rules", len(docs))

        if await self.db.email_templates.count_documents({}) == 0:
            docs = []
            for t in DEFAULT_TEMPLATES:
                docs.append({
                    "id": f"tpl_{t['event']}_{t['audience']}_{t['lang']}",
                    **t,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
            if docs:
                await self.db.email_templates.insert_many(docs)
                logger.info("[notif] seeded %d email templates", len(docs))

    async def get_rule(self, event: str) -> Dict[str, Any]:
        r = await self.db.notification_rules.find_one({"event": event}, {"_id": 0})
        if r:
            return r
        # fallback to compiled default
        for d in DEFAULT_RULES:
            if d["event"] == event:
                return {"id": f"rule_{event}", **d, "created_at": None}
        return {"event": event, "enabled": False, "targets": []}

    async def get_template(self, event: str, audience: str, lang: str) -> Dict[str, Any]:
        # Try exact match → fallback (lang: ua → en)
        for ll in (lang, "ua", "en"):
            t = await self.db.email_templates.find_one(
                {"event": event, "audience": audience, "lang": ll}, {"_id": 0},
            )
            if t:
                return t
        # Generic defaults from code
        for d in DEFAULT_TEMPLATES:
            if d["event"] == event and d["audience"] == audience and d["lang"] in ("ua", "en"):
                return d
        return {"subject": event, "html": event, "text_template": ""}

    async def _resolve_recipients(self, audience: str, ctx: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Return list of recipient dicts: {email, name, lang, user_id}."""
        recs: List[Dict[str, Any]] = []
        customer = ctx.get("customer") or {}
        manager = ctx.get("manager") or {}
        invoice = ctx.get("invoice") or {}
        order = ctx.get("order") or {}

        if audience == "customer":
            email = customer.get("email") or ctx.get("customerEmail") or invoice.get("customerEmail")
            if email:
                recs.append({
                    "email": email,
                    "name": customer.get("name") or customer.get("firstName") or "",
                    "lang": (customer.get("lang") or customer.get("language") or "ua").lower()[:2],
                    "user_id": customer.get("id") or invoice.get("customerId") or order.get("customerId"),
                })
        elif audience == "manager":
            mid = manager.get("id") or invoice.get("managerId") or order.get("managerId")
            memail = manager.get("email") or invoice.get("managerEmail") or order.get("managerEmail")
            if mid or memail:
                recs.append({
                    "email": memail,
                    "name": manager.get("name") or memail or "",
                    "lang": (manager.get("lang") or "ua").lower()[:2],
                    "user_id": mid,
                })
        elif audience == "team_lead":
            async for u in self.db.users.find({"role": {"$in": ["team_lead"]}}, {"_id": 0}):
                recs.append({
                    "email": u.get("email"),
                    "name": u.get("name") or u.get("email") or "",
                    "lang": (u.get("lang") or "ua").lower()[:2],
                    "user_id": u.get("id") or u.get("_id"),
                })
        elif audience == "master_admin":
            async for u in self.db.users.find({"role": {"$in": ["master_admin", "owner", "admin"]}}, {"_id": 0}):
                recs.append({
                    "email": u.get("email"),
                    "name": u.get("name") or u.get("email") or "",
                    "lang": (u.get("lang") or "ua").lower()[:2],
                    "user_id": u.get("id") or u.get("_id"),
                })
        return recs

    async def dispatch(self, event: str, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Central dispatch: rule → audiences → channels → render → send."""
        rule = await self.get_rule(event)
        if not rule.get("enabled", True):
            logger.info("[notif] rule for %s disabled — skipping", event)
            return {"event": event, "skipped": True, "reason": "disabled"}

        # enrich context with convenience formatting
        ctx = dict(ctx or {})
        invoice = ctx.get("invoice") or {}
        if invoice and "total_fmt" not in invoice:
            invoice["total_fmt"] = money(invoice.get("total") or invoice.get("amount"), invoice.get("currency"))
            ctx["invoice"] = invoice
        order = ctx.get("order") or {}
        if order and "steps_total" not in order:
            order["steps_total"] = len(order.get("steps") or [])
            ctx["order"] = order
        customer = ctx.get("customer") or {}
        if customer and not customer.get("name"):
            customer["name"] = (customer.get("firstName") or customer.get("email") or "клієнт").strip()
            ctx["customer"] = customer

        sent = []
        for target in rule.get("targets", []):
            audience = target.get("audience")
            channels = set(target.get("channels", []))
            if not audience or not channels:
                continue
            recipients = await self._resolve_recipients(audience, ctx)
            for r in recipients:
                lang = r.get("lang") or "ua"
                tpl = await self.get_template(event, audience, lang)
                subject = render(tpl.get("subject") or event, ctx)
                html = render(tpl.get("html") or "", ctx)
                text = render(tpl.get("text_template") or "", ctx)

                if "email" in channels and r.get("email"):
                    await self.email.send(
                        to=r["email"], subject=subject, html=html, text=text,
                        event=event, context={"recipient": r},
                    )
                    sent.append({"audience": audience, "channel": "email", "to": r["email"]})
                if "in_app" in channels and r.get("user_id"):
                    await self.in_app.send(
                        user_id=r["user_id"],
                        title=subject,
                        message=_html_to_text(html),
                        event=event,
                        meta={"link": _default_link(event, ctx)},
                    )
                    sent.append({"audience": audience, "channel": "in_app", "user": r["user_id"]})
        return {"event": event, "sent": sent, "total": len(sent)}


def _html_to_text(html: str) -> str:
    """Dumb HTML → text stripper (good enough for in-app previews)."""
    if not html:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:240]


def _default_link(event: str, ctx: Dict[str, Any]) -> str:
    invoice = ctx.get("invoice") or {}
    order = ctx.get("order") or {}
    customer = ctx.get("customer") or {}
    customer_id = customer.get("id") or invoice.get("customerId") or order.get("customerId")

    # Manager/team in-app notifications → their own pages
    if event in (EVENT_PAYMENT_CONFIRMED, EVENT_ORDER_STARTED, EVENT_ORDER_FINISHED):
        if order.get("id"):
            return f"/manager/orders?focus={order['id']}"
        return "/manager/orders"
    if event == EVENT_INVOICE_SENT and invoice.get("id"):
        return f"/manager/invoices?focus={invoice['id']}"
    if event == EVENT_PAYMENT_REMINDER:
        if invoice.get("id"):
            return f"/manager/invoices?focus={invoice['id']}"
        return "/manager/invoices"
    return ""


# ── runtime singletons (wired up by server.py on startup) ─────────────
service: NotificationService | None = None


def init(db, sio=None) -> NotificationService:
    global service
    service = NotificationService(db, sio)
    # All business events flow through `service.dispatch`.
    async def _handler(payload):
        event = payload.pop("__event", None)
        if not event:
            return
        await service.dispatch(event, payload)
    # Register the same handler for every event
    for ev in ALL_EVENTS:
        bus.on(ev, _handler_for(ev))
    return service


def _handler_for(event: str):
    async def _h(payload):
        if service is None:
            return
        await service.dispatch(event, payload)
    return _h


async def emit(event: str, payload: Dict[str, Any]) -> None:
    """Sugar wrapper — used from server.py business logic."""
    await bus.emit(event, payload)
