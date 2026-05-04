/**
 * History Page (Customer Cabinet)
 * 
 * /cabinet/:customerId/history
 */

import React, { useState } from 'react';
import { FileText, MagnifyingGlass, Info } from '@phosphor-icons/react';
import { useNavigate, useParams } from 'react-router-dom';
import { useHistoryQuota } from '../../hooks/useHistoryQuota';
import { useLang } from '../../i18n';
import HistoryButton from '../../components/engagement/HistoryButton';
import HistoryReportCard from '../../components/engagement/HistoryReportCard';

export default function HistoryPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { t } = useLang();
  const { quota, loading: quotaLoading, reload: reloadQuota } = useHistoryQuota();
  const [vin, setVin] = useState('');
  const [report, setReport] = useState(null);

  const handleVinChange = (e) => {
    setVin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  };

  const isValidVin = vin.length === 17;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 rounded-xl bg-[#F4F4F5]">
          <FileText size={24} weight="fill" className="text-[#71717A]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]">Перевірка VIN</h1>
          <p className="text-[#71717A]">Детальний звіт по історії авто</p>
        </div>
      </div>

      {/* Quota Info */}
      {!quotaLoading && quota && (
        <div className="rounded-xl bg-[#F4F4F5] p-4 flex items-center justify-between" data-testid="quota-info">
          <div className="text-[#71717A]">
            Доступно безкоштовних звітів: <strong className="text-[#18181B]">{quota.freeRemaining}</strong> з {quota.freeReportsLimit}
          </div>
          {quota.isRestricted && (
            <span className="px-3 py-1 rounded-lg bg-red-100 text-red-600 text-sm">
              Доступ обмежено
            </span>
          )}
        </div>
      )}

      {/* VIN Input */}
      <div className="rounded-2xl border border-[#E4E4E7] bg-white p-6 space-y-4">
        <div className="relative">
          <MagnifyingGlass 
            size={20} 
            className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A1A1AA]" 
          />
          <input
            type="text"
            value={vin}
            onChange={handleVinChange}
            placeholder="Введіть VIN (17 символів)"
            maxLength={17}
            className="w-full pl-12 pr-20 py-4 rounded-xl border border-[#E4E4E7] 
                       focus:border-[#18181B] focus:ring-2 focus:ring-[#F4F4F5] 
                       outline-none transition-all text-lg font-mono"
            data-testid="vin-input"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#A1A1AA] text-sm">
            {vin.length}/17
          </span>
        </div>

        {isValidVin && (
          <HistoryButton 
            vin={vin}
            quota={quota}
            onLoaded={setReport}
            onQuotaChange={reloadQuota}
            size="lg"
          />
        )}

        {!isValidVin && vin.length > 0 && (
          <p className="text-amber-600 text-sm">
            VIN повинен містити рівно 17 символів
          </p>
        )}
      </div>

      {/* Report */}
      {report && <HistoryReportCard report={report} />}

      {/* Info */}
      {!report && (
        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-6">
          <div className="flex items-start gap-3">
            <Info size={24} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">
                Що включає звіт?
              </h3>
              <ul className="space-y-2 text-blue-800 text-sm">
                <li>• Історія ДТП та пошкоджень</li>
                <li>• Кількість власників</li>
                <li>• Перевірка одометра</li>
                <li>• Проблеми з титулом</li>
                <li>• Історія аукціонів</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
