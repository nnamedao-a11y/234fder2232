/**
 * AutomationExceptionsPage — Phase E UI
 * =====================================
 *
 * Surface low-confidence resolver hits & transfer rejects in a single
 * table so managers can approve (Confirm) or dismiss (Reject) each one.
 *
 * Columns: VIN · Container · Current Vessel · Candidate · Reason · Confidence · Actions.
 * Status filters: pending (default) · confirmed · rejected · all.
 * Refreshes every 30 s + after every action.
 *
 * Endpoints used:
 *   GET  /api/admin/identity/exceptions?status_filter=...
 *   POST /api/admin/identity/exceptions/{id}/confirm
 *   POST /api/admin/identity/exceptions/{id}/reject
 *   GET  /api/admin/identity/exceptions/count  (for badge elsewhere)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';

const API =
  process.env.REACT_APP_BACKEND_URL ||
  import.meta?.env?.REACT_APP_BACKEND_URL ||
  '';

const STATUS_TABS = [
  { id: 'pending', label: 'Очікують', color: '#f59e0b' },
  { id: 'confirmed', label: 'Підтверджено', color: '#10b981' },
  { id: 'rejected', label: 'Відхилено', color: '#ef4444' },
  { id: 'all', label: 'Всі', color: '#64748b' },
];

const KIND_LABELS = {
  low_confidence_vessel: 'Низька впевненість (vessel)',
  transfer_rejected: 'Перевалку відхилено',
};

const REASON_LABELS = {
  low_confidence: 'Confidence < 0.75',
  teleport: 'Судно "телепортувало"',
  progress_regression: 'Прогрес відкотився',
  low_confidence_vessel: 'Confidence < 0.85',
};

function fmtConfidence(v) {
  if (v == null) return '—';
  const pct = Math.round(Number(v) * 100);
  let color = '#94a3b8';
  if (pct >= 85) color = '#10b981';
  else if (pct >= 50) color = '#f59e0b';
  else color = '#ef4444';
  return (
    <span
      style={{
        background: color,
        color: '#fff',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {pct}%
    </span>
  );
}

function authHeaders() {
  const t = localStorage.getItem('auth_token') || localStorage.getItem('token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export default function AutomationExceptionsPage() {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [counts, setCounts] = useState({ pending: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await axios.get(
        `${API}/api/admin/identity/exceptions?status_filter=${status}&limit=100`,
        { headers: authHeaders() },
      );
      setItems(r.data.items || []);
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  const loadCount = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/api/admin/identity/exceptions/count`, {
        headers: authHeaders(),
      });
      setCounts({ pending: r.data.pending || 0 });
    } catch {}
  }, []);

  useEffect(() => {
    load();
    loadCount();
  }, [load, loadCount]);

  useEffect(() => {
    const t = setInterval(() => {
      load();
      loadCount();
    }, 30000);
    return () => clearInterval(t);
  }, [load, loadCount]);

  const confirmOne = async (id) => {
    setActingId(id);
    try {
      await axios.post(
        `${API}/api/admin/identity/exceptions/${id}/confirm`,
        {},
        { headers: authHeaders() },
      );
      toast.success('Підтверджено — система виконала дію');
      await load();
      await loadCount();
    } catch (e) {
      toast.error(`Помилка: ${e.response?.data?.detail || e.message}`);
    } finally {
      setActingId(null);
    }
  };

  const rejectOne = async (id) => {
    setActingId(id);
    try {
      await axios.post(
        `${API}/api/admin/identity/exceptions/${id}/reject`,
        {},
        { headers: authHeaders() },
      );
      toast('Відхилено', { icon: '🚫' });
      await load();
      await loadCount();
    } catch (e) {
      toast.error(`Помилка: ${e.response?.data?.detail || e.message}`);
    } finally {
      setActingId(null);
    }
  };

  const summary = useMemo(() => {
    const by = { low: 0, medium: 0, high: 0 };
    for (const it of items) {
      const c = (it.data || {}).finalConfidence ?? (it.data?.vessel?.confidence) ?? 0;
      if (c >= 0.85) by.high++;
      else if (c >= 0.5) by.medium++;
      else by.low++;
    }
    return by;
  }, [items]);

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 28, color: '#1e293b' }}>Центр виключень</h1>
          <div style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>
            Resolver + Transfer detector · {counts.pending} очікують дії
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setStatus(t.id)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: status === t.id ? `2px solid ${t.color}` : '1px solid #cbd5e1',
                background: status === t.id ? `${t.color}20` : '#fff',
                color: status === t.id ? t.color : '#334155',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            color: '#991b1b',
          }}
        >
          Помилка: {error}
        </div>
      )}

      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}
          data-testid="exceptions-table"
        >
          <thead style={{ background: '#f8fafc' }}>
            <tr>
              <Th>VIN</Th>
              <Th>Контейнер</Th>
              <Th>Поточне судно</Th>
              <Th>Кандидат</Th>
              <Th>Причина</Th>
              <Th>Confidence</Th>
              <Th>Коли</Th>
              <Th>Дії</Th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                  Завантаження…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                  {status === 'pending' ? '✨ Черга порожня — автоматика впоралась сама' : 'Немає записів'}
                </td>
              </tr>
            )}
            {items.map((it) => {
              const sh = it.shipment || {};
              const data = it.data || {};
              const candName =
                data.newName ||
                (data.vessel && data.vessel.value && data.vessel.value.name) ||
                (data.vessel && data.vessel.name) ||
                '—';
              const candMmsi =
                data.newMmsi ||
                (data.vessel && data.vessel.value && data.vessel.value.mmsi) ||
                (data.vessel && data.vessel.mmsi) ||
                null;
              const conf =
                data.finalConfidence ??
                data.confidence ??
                (data.vessel && data.vessel.confidence) ??
                null;
              const cur = sh.currentVessel || {};
              const reasonKey = it.reason || it.kind;
              return (
                <tr key={it._id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <Td>
                    <code style={{ fontSize: 12 }}>{sh.vin || '—'}</code>
                  </Td>
                  <Td>
                    <code style={{ fontSize: 12 }}>{sh.container || '—'}</code>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{cur.name || '—'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      MMSI {cur.mmsi || '—'}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600, color: '#0ea5e9' }}>{candName}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      MMSI {candMmsi || '—'}
                    </div>
                  </Td>
                  <Td>
                    <div>{KIND_LABELS[it.kind] || it.kind}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {REASON_LABELS[reasonKey] || reasonKey || '—'}
                    </div>
                  </Td>
                  <Td>{fmtConfidence(conf)}</Td>
                  <Td>
                    <span style={{ fontSize: 12, color: '#64748b' }}>
                      {it.createdAt ? new Date(it.createdAt).toLocaleString() : '—'}
                    </span>
                  </Td>
                  <Td>
                    {it.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          data-testid={`confirm-${it._id}`}
                          disabled={actingId === it._id}
                          onClick={() => confirmOne(it._id)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid #10b981',
                            background: '#10b981',
                            color: '#fff',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          ✓ Підтвердити
                        </button>
                        <button
                          data-testid={`reject-${it._id}`}
                          disabled={actingId === it._id}
                          onClick={() => rejectOne(it._id)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            color: '#475569',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          ✕ Відхилити
                        </button>
                      </div>
                    ) : (
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: it.status === 'confirmed' ? '#d1fae5' : '#fee2e2',
                          color: it.status === 'confirmed' ? '#047857' : '#991b1b',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {it.status}
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, color: '#64748b', fontSize: 13 }}>
        Legend — Confidence: <span style={{ color: '#ef4444' }}>low {summary.low}</span> ·{' '}
        <span style={{ color: '#f59e0b' }}>medium {summary.medium}</span> ·{' '}
        <span style={{ color: '#10b981' }}>high {summary.high}</span>
      </div>
    </div>
  );
}

function Th({ children }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '12px 14px',
        fontSize: 12,
        fontWeight: 600,
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }) {
  return <td style={{ padding: '12px 14px' }}>{children}</td>;
}
