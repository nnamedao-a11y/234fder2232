/**
 * Parser Settings — slim v4.1 page.
 *
 * The legacy v3 settings (Carfast V4.0 cookie proxy, bid.cars/Copart session
 * status panels, /api/carfast/* and /api/bidcars/* probes) was removed.
 * This page now focuses on three things only:
 *   1. Download the cleaned BIBI Cars Parser Extension (v4.1).
 *   2. Show install instructions.
 *   3. Link to the live Parser Control Center at /admin/parser.
 */

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import {
  Download,
  ArrowSquareOut,
  CheckCircle,
  Browser,
  Plugs,
  Lightning,
  Database,
  Pulse,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const SOURCES = [
  { id: 'poctra',             label: 'poctra.com',             role: 'CF · INDEX' },
  { id: 'carsfromwest',       label: 'carsfromwest.com',       role: 'CF · INDEX' },
  { id: 'autoauctionhistory', label: 'autoauctionhistory.com', role: 'CF · INDEX' },
  { id: 'salvagebid',         label: 'salvagebid.com',         role: 'CF · LIVE'  },
];

export default function ParserSettings() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/extension/info`);
        if (!cancelled) setInfo(r.data);
      } catch (_) {
        // Backend may be paused; fall back to static defaults below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const triggerDownload = () => {
    const link = document.createElement('a');
    link.href = '/bibi-cars-extension.zip';
    link.download = 'bibi-cars-extension.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Завантаження розпочато');
  };

  const fmtSize = (b) => {
    if (!b) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#18181B]">Parser Settings</h1>
        <p className="text-sm text-[#71717A] mt-1">
          BIBI Cars Parser Extension — Cloudflare-bypass collector. Чисте
          v4.1 видання без legacy Copart/bid.cars/carfast.
        </p>
      </div>

      {/* Download card */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white border border-emerald-200 flex items-center justify-center flex-shrink-0">
              <Browser size={24} weight="duotone" className="text-emerald-700" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#18181B]">
                {info?.name || 'BIBI Cars Parser'}{' '}
                <span className="text-sm font-mono text-emerald-700">
                  v{info?.version || '4.1.0'}
                </span>
              </h2>
              <p className="text-sm text-[#52525B] mt-1">
                {info?.description ||
                  'Cloudflare-bypass extension for the multi-source resolver.'}
              </p>
              <p className="text-xs text-[#71717A] mt-2 font-mono">
                {loading
                  ? 'Перевірка…'
                  : info?.file_exists
                  ? `ZIP розмір: ${fmtSize(info.file_size)} · готовий до завантаження`
                  : 'ZIP розмір: ~18 KB · готовий до завантаження'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={triggerDownload}
            className="px-5 py-3 rounded-lg bg-emerald-600 text-white font-semibold flex items-center gap-2 hover:bg-emerald-700 shadow-sm flex-shrink-0"
            data-testid="download-extension-btn"
          >
            <Download size={18} weight="bold" />
            Скачати ZIP
          </button>
        </div>
      </div>

      {/* Supported sources */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h3 className="text-base font-semibold text-[#18181B] flex items-center gap-2">
          <Plugs size={18} weight="duotone" /> Підтримувані джерела
        </h3>
        <p className="text-xs text-[#71717A] mt-1 mb-4">
          Чотири Cloudflare-protected джерела, які агент відкриває автоматично.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SOURCES.map((s) => (
            <div
              key={s.id}
              className="p-3 rounded-xl border border-[#E4E4E7] flex items-center justify-between"
              data-testid={`src-${s.id}`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle size={18} weight="fill" className="text-emerald-500" />
                <div>
                  <p className="text-sm font-semibold text-[#18181B]">
                    {s.label}
                  </p>
                  <p className="text-[10px] font-mono text-[#71717A] tracking-wider">
                    {s.role}
                  </p>
                </div>
              </div>
              <a
                href={`https://${s.label}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#71717A] hover:text-[#18181B]"
                title="Відкрити сайт"
              >
                <ArrowSquareOut size={16} />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Install steps */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h3 className="text-base font-semibold text-[#18181B] flex items-center gap-2">
          <Lightning size={18} weight="duotone" /> Інсталяція (3 хв)
        </h3>
        <ol className="mt-4 space-y-2.5 text-sm text-[#3F3F46]">
          {(info?.installation || [
            '1. Завантажте ZIP файл',
            '2. Розпакуйте архів',
            '3. Відкрийте chrome://extensions/',
            '4. Увімкніть "Режим розробника"',
            "5. Натисніть 'Завантажити розпаковане'",
            '6. Виберіть розпаковану папку',
            '7. У popup розширення введіть Backend URL та EXT_SHARED_SECRET',
          ]).map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-2.5 leading-relaxed"
            >
              <span className="text-emerald-600 font-mono font-bold">→</span>
              <span>{step.replace(/^\d+\.\s*/, '')}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <a
          href="/admin/parser"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:border-[#18181B] transition-colors group"
        >
          <Pulse
            size={20}
            weight="duotone"
            className="text-[#71717A] group-hover:text-[#18181B]"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#18181B]">Parser Control</p>
            <p className="text-xs text-[#71717A]">Live health · alerts · sources</p>
          </div>
          <ArrowSquareOut size={14} className="text-[#D4D4D8]" />
        </a>
        <a
          href="/admin/parser/logs"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:border-[#18181B] transition-colors group"
        >
          <Database
            size={20}
            weight="duotone"
            className="text-[#71717A] group-hover:text-[#18181B]"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#18181B]">Parser Logs</p>
            <p className="text-xs text-[#71717A]">Останні події ingestion</p>
          </div>
          <ArrowSquareOut size={14} className="text-[#D4D4D8]" />
        </a>
        <a
          href="/admin/parser?tab=extension"
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#E4E4E7] hover:border-[#18181B] transition-colors group"
        >
          <Browser
            size={20}
            weight="duotone"
            className="text-[#71717A] group-hover:text-[#18181B]"
          />
          <div className="flex-1">
            <p className="text-sm font-semibold text-[#18181B]">
              Chrome Extension
            </p>
            <p className="text-xs text-[#71717A]">Встановлення + troubleshoot</p>
          </div>
          <ArrowSquareOut size={14} className="text-[#D4D4D8]" />
        </a>
      </div>

      {/* Deprecation note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <p className="font-semibold">⚠ Legacy: видалено в v4.1</p>
        <p className="mt-1 text-xs leading-relaxed">
          Cookie-sync flow для <code>copart.com</code>, <code>bid.cars</code>,{' '}
          <code>carfast.express</code> повністю прибрано. Endpoint-и{' '}
          <code>/api/copart/*</code>, <code>/api/bidcars/*</code>,{' '}
          <code>/api/carfast/*</code> повертають{' '}
          <code className="font-mono">410 Gone</code>. Якщо щось все ще
          намагається їх дернути — це старий клієнт; оновіть до v4.1+.
        </p>
      </div>
    </div>
  );
}
