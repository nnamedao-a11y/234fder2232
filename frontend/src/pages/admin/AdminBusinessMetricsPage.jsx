/**
 * Admin Business Metrics
 *
 *   /admin/business-metrics
 *
 * Shows exactly 3 KPIs requested by product spec:
 *   - conversion     (paid invoices / sent invoices)
 *   - avg_order_time (avg hours between order created_at → completedAt)
 *   - repeat_rate    (customers with 2+ orders / total customers)
 *
 * Data comes from GET /api/admin/metrics.
 */
import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  ChartLine,
  CurrencyCircleDollar,
  Clock,
  ArrowsClockwise,
  UsersThree,
  ArrowClockwise,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

const fmtPct = (v) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
const fmtHours = (v) => {
  if (v === null || v === undefined) return '—';
  if (v < 1) return `${Math.round(v * 60)} хв`;
  if (v < 24) return `${v.toFixed(1)} год`;
  return `${(v / 24).toFixed(1)} дн`;
};

const MetricCard = ({ icon: Icon, title, value, subtitle, color = 'indigo' }) => {
  const palette = {
    indigo: 'bg-indigo-50 text-indigo-600 ring-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
  }[color];
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm" data-testid={`metric-card-${color}`}>
      <div className="flex items-start justify-between">
        <div className={`p-3 rounded-xl ring-1 ${palette}`}>
          <Icon size={24} weight="bold" />
        </div>
      </div>
      <div className="mt-4">
        <h3 className="text-4xl font-bold text-zinc-900 tracking-tight" data-testid={`metric-value-${color}`}>{value}</h3>
        <p className="text-sm font-medium text-zinc-600 mt-2">{title}</p>
        {subtitle && <p className="text-xs text-zinc-400 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
};

export default function AdminBusinessMetricsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const r = await axios.get(`${API_URL}/api/admin/metrics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(r.data);
    } catch (e) {
      console.error(e);
      toast.error('Не вдалось завантажити метрики');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const t = setInterval(fetchMetrics, 60 * 1000); // refresh every minute
    return () => clearInterval(t);
  }, [fetchMetrics]);

  const m = data?.metrics;

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="admin-business-metrics-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            <ChartLine size={28} weight="bold" className="text-indigo-600" />
            Бізнес-метрики
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Три ключові показники керованості: конверсія, швидкість виконання, повторність.
          </p>
        </div>
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-sm font-medium text-zinc-700 disabled:opacity-50"
          data-testid="metrics-refresh-btn"
        >
          <ArrowClockwise size={16} className={loading ? 'animate-spin' : ''} />
          Оновити
        </button>
      </div>

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-zinc-200 p-6 h-40 animate-pulse"
            />
          ))}
        </div>
      )}

      {m && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              icon={CurrencyCircleDollar}
              title="Конверсія рахунків"
              value={fmtPct(m.conversion?.value)}
              subtitle={`${m.conversion?.paid ?? 0} оплачено з ${m.conversion?.sent ?? 0} надісланих`}
              color="emerald"
            />
            <MetricCard
              icon={Clock}
              title="Середній час виконання"
              value={fmtHours(m.avg_order_time?.value_hours)}
              subtitle={`по ${m.avg_order_time?.completed_orders ?? 0} завершених замовленнях`}
              color="indigo"
            />
            <MetricCard
              icon={UsersThree}
              title="Повторність клієнтів"
              value={fmtPct(m.repeat_rate?.value)}
              subtitle={`${m.repeat_rate?.repeat_customers ?? 0} повторних з ${m.repeat_rate?.total_customers ?? 0} клієнтів`}
              color="amber"
            />
          </div>

          <div className="mt-8 text-xs text-zinc-400">
            Оновлено: {new Date(data.generated_at).toLocaleString()}
          </div>

          <div className="mt-2 bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-xs text-zinc-500 leading-relaxed">
            <div><b>Conversion</b> = paid invoices / sent invoices (усі, що вийшли з драфту).</div>
            <div><b>Avg order time</b> = середнє (completedAt − created_at) по всіх замовленнях зі статусом <code>completed</code>.</div>
            <div><b>Repeat rate</b> = клієнти з 2+ замовленнями / загальна кількість клієнтів з хоча б одним замовленням.</div>
          </div>
        </>
      )}
    </div>
  );
}
