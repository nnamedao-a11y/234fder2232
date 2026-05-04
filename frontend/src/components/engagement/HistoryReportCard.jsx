/**
 * HistoryReportCard Component
 * 
 * Відображення history report
 */

import React from 'react';
import { 
  Car, 
  User, 
  Warning, 
  Speedometer, 
  Certificate,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';

export default function HistoryReportCard({ report }) {
  if (!report) return null;

  const data = report.normalizedData || {};
  const hasIssues = (data.accidentHistory?.length > 0) || 
                    (data.titleIssues?.length > 0) || 
                    (data.odometerFlags?.length > 0);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
      {/* Header */}
      <div className={`px-6 py-4 ${hasIssues ? 'bg-amber-50' : 'bg-emerald-50'}`}>
        <div className="flex items-center gap-3">
          {hasIssues ? (
            <Warning size={24} weight="fill" className="text-amber-500" />
          ) : (
            <CheckCircle size={24} weight="fill" className="text-emerald-500" />
          )}
          <div>
            <h3 className="font-semibold text-lg">
              {hasIssues ? 'Знайдено проблеми' : 'Чиста історія'}
            </h3>
            <p className="text-sm text-zinc-500">VIN: {report.vin}</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard 
            icon={<User size={20} />}
            label="Власників"
            value={data.ownersCount ?? '—'}
          />
          <StatCard 
            icon={<Warning size={20} />}
            label="ДТП"
            value={data.accidentHistory?.length ?? 0}
            warning={data.accidentHistory?.length > 0}
          />
          <StatCard 
            icon={<Certificate size={20} />}
            label="Title"
            value={data.titleIssues?.length ? 'Проблеми' : 'Чистий'}
            warning={data.titleIssues?.length > 0}
          />
          <StatCard 
            icon={<Speedometer size={20} />}
            label="Одометр"
            value={data.odometerFlags?.length ? 'Флаги' : 'OK'}
            warning={data.odometerFlags?.length > 0}
          />
        </div>

        {/* Detailed Sections */}
        {data.accidentHistory?.length > 0 && (
          <DetailSection 
            title="Історія ДТП" 
            items={data.accidentHistory}
            warning
          />
        )}

        {data.titleIssues?.length > 0 && (
          <DetailSection 
            title="Проблеми з Title" 
            items={data.titleIssues}
            warning
          />
        )}

        {data.odometerFlags?.length > 0 && (
          <DetailSection 
            title="Проблеми з одометром" 
            items={data.odometerFlags}
            warning
          />
        )}

        {data.damageHistory?.length > 0 && (
          <DetailSection 
            title="Історія пошкоджень" 
            items={data.damageHistory}
          />
        )}

        {/* Meta */}
        <div className="pt-4 border-t text-sm text-zinc-500">
          <div className="flex justify-between">
            <span>Провайдер: {report.provider}</span>
            <span>Оновлено: {new Date(report.createdAt).toLocaleDateString('uk-UA')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, warning }) {
  return (
    <div className={`
      rounded-xl p-4 
      ${warning ? 'bg-amber-50 border border-amber-200' : 'bg-zinc-50'}
    `}>
      <div className={`mb-2 ${warning ? 'text-amber-500' : 'text-zinc-400'}`}>
        {icon}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

function DetailSection({ title, items, warning }) {
  return (
    <div className={`
      rounded-xl p-4
      ${warning ? 'bg-amber-50 border border-amber-200' : 'bg-zinc-50'}
    `}>
      <h4 className={`font-medium mb-3 ${warning ? 'text-amber-700' : 'text-zinc-700'}`}>
        {title}
      </h4>
      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm">
            {warning ? (
              <XCircle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
            ) : (
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 mt-2 flex-shrink-0" />
            )}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
