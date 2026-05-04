/**
 * Compare Page (Customer Cabinet)
 * 
 * /cabinet/:customerId/compare
 */

import React from 'react';
import { Scales, Trash, Plus } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCompare } from '../../hooks/useCompare';
import { useLang } from '../../i18n';

export default function ComparePage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { t } = useLang();
  const { resolved, list, loading, remove, clear, count } = useCompare();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-100">
            <Scales size={24} weight="fill" className="text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#18181B]">Порівняння</h1>
            <p className="text-[#71717A]">{count}/3 автомобілів</p>
          </div>
        </div>

        {count > 0 && (
          <button
            onClick={clear}
            className="px-4 py-2 rounded-lg border border-[#E4E4E7] 
                       text-[#71717A] hover:bg-[#F4F4F5] transition-colors"
            data-testid="clear-compare-btn"
          >
            Очистити
          </button>
        )}
      </div>

      {/* Empty State */}
      {!count && (
        <div className="rounded-2xl border-2 border-dashed border-[#E4E4E7] bg-white p-12 text-center">
          <Scales size={48} className="mx-auto mb-4 text-[#D4D4D8]" />
          <h3 className="text-lg font-semibold text-[#18181B] mb-2">
            Немає автомобілів для порівняння
          </h3>
          <p className="text-[#71717A] mb-6">
            Додайте 2-3 автомобілі для порівняння
          </p>
          <button
            onClick={() => navigate(`/cabinet/${customerId}/favorites`)}
            className="px-6 py-3 rounded-xl bg-[#18181B] text-white font-medium hover:bg-[#27272A]"
          >
            Перейти до обраного
          </button>
        </div>
      )}

      {/* Need 2 cars */}
      {count === 1 && (
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-6 text-center">
          <p className="text-amber-700">
            Додайте ще хоча б 1 автомобіль для порівняння
          </p>
        </div>
      )}

      {/* Comparison Table */}
      {count >= 2 && resolved.length >= 2 && (
        <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]" data-testid="compare-table">
              <thead>
                <tr className="border-b bg-[#F9FAFB]">
                  <th className="p-4 text-left font-medium text-[#71717A] w-[180px]">
                    Параметр
                  </th>
                  {resolved.map((item) => (
                    <th key={item.vehicleId} className="p-4 text-left">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-[#18181B]">
                            {item.title || item.vin}
                          </div>
                          <div className="text-xs text-[#A1A1AA] font-normal mt-1">
                            {item.vin}
                          </div>
                        </div>
                        <button
                          onClick={() => remove(item.vehicleId)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[#A1A1AA] 
                                     hover:text-red-500 transition-colors"
                          data-testid={`remove-compare-${item.vehicleId}`}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </th>
                  ))}
                  {count < 3 && (
                    <th className="p-4 w-[200px]">
                      <button
                        onClick={() => navigate(`/cabinet/${customerId}/favorites`)}
                        className="flex items-center gap-2 text-[#A1A1AA] hover:text-[#71717A] 
                                   transition-colors font-normal"
                      >
                        <Plus size={16} />
                        <span>Додати авто</span>
                      </button>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.key} className="border-b hover:bg-[#F9FAFB]">
                    <td className="p-4 font-medium text-[#71717A]">
                      {row.label}
                    </td>
                    {resolved.map((item) => (
                      <td key={item.vehicleId} className="p-4">
                        {row.render 
                          ? row.render(item[row.key]) 
                          : (item[row.key] ?? '—')
                        }
                      </td>
                    ))}
                    {count < 3 && <td className="p-4" />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const COMPARE_ROWS = [
  { key: 'year', label: 'Рік' },
  { key: 'make', label: 'Марка' },
  { key: 'model', label: 'Модель' },
  { 
    key: 'marketPrice', 
    label: 'Ринок',
    render: (v) => v ? `$${v.toLocaleString()}` : '—',
  },
  { 
    key: 'price', 
    label: 'Поточна ціна',
    render: (v) => v ? `$${v.toLocaleString()}` : '—',
  },
  { 
    key: 'maxBid', 
    label: 'Max Bid',
    render: (v) => v ? (
      <span className="font-semibold text-emerald-600">${v.toLocaleString()}</span>
    ) : '—',
  },
  { 
    key: 'finalAllInPrice', 
    label: 'All-in',
    render: (v) => v ? `$${v.toLocaleString()}` : '—',
  },
  { key: 'damage', label: 'Пошкодження' },
  { 
    key: 'mileage', 
    label: 'Пробіг',
    render: (v) => v ? `${v.toLocaleString()} mi` : '—',
  },
  { key: 'location', label: 'Локація' },
  { key: 'saleDate', label: 'Дата аукціону' },
  { 
    key: 'confidence', 
    label: 'Впевненість',
    render: (v) => v ? `${(v * 100).toFixed(0)}%` : '—',
  },
  { 
    key: 'dealStatus', 
    label: 'Статус',
    render: (v) => {
      if (!v) return '—';
      const colors = {
        good_deal: 'text-emerald-600 bg-emerald-50',
        fair_deal: 'text-amber-600 bg-amber-50',
        bad_deal: 'text-red-600 bg-red-50',
      };
      return (
        <span className={`px-2 py-1 rounded-lg text-sm font-medium ${colors[v] || ''}`}>
          {v === 'good_deal' ? 'Хороша' : v === 'fair_deal' ? 'Норм' : 'Погана'}
        </span>
      );
    },
  },
];
