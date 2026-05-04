/**
 * Chrome Extension — Unified install + troubleshooting page (v4.1).
 *
 * The old v3.0/v4.0 page (Copart cookie-sync, bid.cars cookies, carfast
 * troubleshooting) was REMOVED. This page documents the clean multi-source
 * agent that replaces it.
 */

import React, { useEffect, useState } from 'react';
import {
  Download,
  CheckCircle,
  Browser,
  Plugs,
  Lightning,
  Robot,
  Copy,
  Check,
  Warning,
} from '@phosphor-icons/react';
import axios from 'axios';
import { AgentHealthChip } from '../components/AgentHealthChip';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Separator } from '../components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const SOURCES = [
  { id: 'poctra',             label: 'poctra.com',             role: 'CF · INDEX' },
  { id: 'carsfromwest',       label: 'carsfromwest.com',       role: 'CF · INDEX' },
  { id: 'autoauctionhistory', label: 'autoauctionhistory.com', role: 'CF · INDEX' },
  { id: 'salvagebid',         label: 'salvagebid.com',         role: 'CF · LIVE'  },
];

const ChromeExtensionPage = () => {
  const [copied, setCopied] = useState(false);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.get(`${API_URL}/api/extension/info`);
        if (!cancelled) setInfo(r.data);
      } catch (_) { /* ok */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleDownload = async () => {
    try {
      toast.info('Готую ZIP...');
      const res = await axios.get(`${API_URL}/api/extension/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bibi-cars-extension.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast.success(`Завантажено ${(blob.size / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error('[ext-download]', err);
      toast.error(`Помилка завантаження: ${err?.response?.status || err.message}`);
    }
  };

  const copyToClipboard = (text, label = 'Скопійовано') => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success(label);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtSize = (b) => {
    if (!b) return '~18 KB';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const backendUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://your-backend.example.com';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Chrome Extension
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            BIBI Cars Parser <span className="font-mono">v{info?.version || '4.1.0'}</span> ·
            Multi-source Cloudflare-bypass agent
          </p>
        </div>
        <AgentHealthChip />
      </div>

      <Tabs defaultValue="download" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="download">Скачати та встановити</TabsTrigger>
          <TabsTrigger value="features">Можливості</TabsTrigger>
          <TabsTrigger value="troubleshooting">Усунення проблем</TabsTrigger>
        </TabsList>

        {/* ─── DOWNLOAD ─────────────────────────────────────────── */}
        <TabsContent value="download" className="space-y-6">
          <Card data-testid="extension-download-card">
            <CardHeader>
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Browser size={24} weight="duotone" />
                    Chrome Extension v4.1
                  </CardTitle>
                  <CardDescription className="mt-2 max-w-xl">
                    Чистий multi-source агент. Працює з 4 джерелами:
                    poctra, carsfromwest, autoauctionhistory, salvagebid.
                    Старий потік Copart / bid.cars / carfast прибрано в v4.1 —
                    саме він спричиняв JSON-помилки в попередніх версіях.
                  </CardDescription>
                  <p className="mt-3 text-xs font-mono text-muted-foreground">
                    Розмір ZIP: {fmtSize(info?.file_size)} · 16 файлів · без legacy
                  </p>
                </div>
                <Button
                  onClick={handleDownload}
                  size="lg"
                  data-testid="download-extension-button"
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Download className="mr-2" size={18} />
                  Скачати ZIP
                </Button>
              </div>
            </CardHeader>
          </Card>

          {/* Install steps */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightning size={20} weight="duotone" />
                Інсталяція (3 хв)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 list-decimal list-inside text-sm">
                <li>Скачайте ZIP за кнопкою вище.</li>
                <li>Розпакуйте архів у будь-яку зручну папку.</li>
                <li>
                  Відкрийте{' '}
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                    chrome://extensions/
                  </code>{' '}
                  у Chrome.
                </li>
                <li>
                  Увімкніть <strong>«Режим розробника»</strong> (top-right).
                </li>
                <li>
                  Натисніть <strong>«Завантажити розпаковане»</strong> та
                  виберіть розпаковану папку.
                </li>
                <li>Клікніть на іконку BIBI у тулбарі — відкриється popup.</li>
                <li>
                  У popup введіть:
                  <ul className="mt-2 ml-6 list-disc space-y-1.5 text-xs">
                    <li>
                      <strong>Backend URL</strong> —
                      <span className="inline-flex items-center gap-1.5 ml-1">
                        <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                          {backendUrl}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(backendUrl, 'Backend URL скопійовано')}
                          className="text-emerald-600 hover:text-emerald-700"
                          title="Скопіювати"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </span>
                    </li>
                    <li>
                      <strong>Client label</strong> — будь-яка назва (напр. <code>owner-laptop</code>)
                    </li>
                    <li>
                      <strong>HMAC секрет</strong> —{' '}
                      {info?.hmac_secret ? (
                        <span className="inline-flex items-center gap-1.5 ml-1">
                          <code
                            className="bg-muted px-1.5 py-0.5 rounded font-mono"
                            data-testid="hmac-secret-value"
                          >
                            {info.hmac_secret}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(info.hmac_secret, 'HMAC секрет скопійовано')
                            }
                            className="text-emerald-600 hover:text-emerald-700"
                            title="Скопіювати"
                            data-testid="copy-hmac-secret"
                          >
                            <Copy size={14} />
                          </button>
                        </span>
                      ) : (
                        <>
                          значення{' '}
                          <code className="bg-muted px-1 rounded font-mono">
                            EXT_SHARED_SECRET
                          </code>{' '}
                          з{' '}
                          <code className="bg-muted px-1 rounded font-mono">
                            backend/.env
                          </code>
                        </>
                      )}
                    </li>
                  </ul>
                </li>
                <li>
                  Натисніть <strong>«Зберегти»</strong> для кожного поля.
                  Розширення авто-зареєструється на бекенді (
                  <code className="bg-muted px-1 rounded font-mono">
                    /api/ext/register
                  </code>
                  ) та почне відправляти heartbeat кожні 60 с.
                </li>
              </ol>

              <Alert className="mt-5 bg-emerald-50 border-emerald-200">
                <CheckCircle size={16} className="text-emerald-600" />
                <AlertDescription className="text-sm text-emerald-900">
                  Після успішного підключення на сторінці{' '}
                  <a href="/admin/parser" className="underline font-semibold">
                    /admin/parser
                  </a>{' '}
                  з'явиться 1 online client з last seen ≤ 5 c і 4 Cloudflare
                  джерела вийдуть із критичного стану.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── FEATURES ──────────────────────────────────────────── */}
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Robot size={20} weight="duotone" />
                Архітектура v4.1 — single-purpose агент
              </CardTitle>
              <CardDescription>
                Backend керує логікою, extension лише добуває дані з
                Cloudflare-protected сторінок.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted rounded-lg p-4 font-mono text-xs leading-relaxed">
                Backend → /api/ext/jobs (poll)
                <br />
                Extension → opens hidden tab on supported domain
                <br />
                Site parser → parses DOM → POSTs to /api/ext/observation
                <br />
                Backend → caches result → resolves VIN → returns to caller
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Plugs size={16} weight="duotone" />
                  Підтримувані джерела
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {SOURCES.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2.5 rounded-lg border bg-background"
                    >
                      <div className="flex items-center gap-2.5">
                        <CheckCircle size={16} weight="fill" className="text-emerald-500" />
                        <span className="text-sm font-medium">{s.label}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {s.role}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="font-semibold text-sm mb-2">Що нового в v4.1</h3>
                <ul className="text-sm space-y-1.5 list-disc list-inside text-muted-foreground">
                  <li>
                    Видалено legacy: content_copart*, content_bidcars,
                    content_carfast (5 файлів, ~32 KB).
                  </li>
                  <li>
                    Прибрано фантомні API виклики до{' '}
                    <code className="bg-muted px-1 rounded text-xs">
                      /api/copart/*
                    </code>{' '}
                    та{' '}
                    <code className="bg-muted px-1 rounded text-xs">
                      /api/bidcars/*
                    </code>{' '}
                    — тепер вони повертають 410 Gone.
                  </li>
                  <li>Popup переписано — лише статуси 4 джерел та конфіг.</li>
                  <li>HMAC-підпис observation payload-ів зберігся.</li>
                  <li>Розмір зменшено з 29 KB до ~18 KB.</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TROUBLESHOOTING ───────────────────────────────────── */}
        <TabsContent value="troubleshooting" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Warning size={20} weight="duotone" />
                Часті проблеми
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              <div>
                <p className="font-semibold mb-1">1. Popup нічого не показує</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>Перезавантажте extension у chrome://extensions/.</li>
                  <li>
                    Переконайтесь що Backend URL вказано правильно і збережено
                    кнопкою.
                  </li>
                  <li>
                    Відкрийте Inspect views → background, перевірте логи
                    реєстрації.
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1">2. На /admin/parser 0 clients</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>
                    Перевірте що значення HMAC секрету збігається з{' '}
                    <code className="bg-muted px-1 rounded font-mono text-xs">
                      EXT_SHARED_SECRET
                    </code>{' '}
                    у backend/.env.
                  </li>
                  <li>
                    У Network tab background-сторінки повинні бути POST на{' '}
                    <code className="bg-muted px-1 rounded font-mono text-xs">
                      /api/ext/heartbeat
                    </code>{' '}
                    кожні 60 с (200 OK).
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-1">
                  3. JSON parse error «Unexpected non-whitespace…»
                </p>
                <p className="text-muted-foreground ml-2">
                  У вас все ще встановлено стара версія розширення (v3.x або
                  v4.0). Видаліть її в chrome://extensions та встановіть ZIP з
                  цієї сторінки.
                </p>
              </div>

              <div>
                <p className="font-semibold mb-1">
                  4. 410 Gone на старих endpoint-ах
                </p>
                <p className="text-muted-foreground ml-2">
                  Це не помилка — це навмисна поведінка v4.1: legacy маршрути{' '}
                  <code className="bg-muted px-1 rounded font-mono text-xs">
                    /api/copart/*
                  </code>
                  ,{' '}
                  <code className="bg-muted px-1 rounded font-mono text-xs">
                    /api/bidcars/*
                  </code>
                  ,{' '}
                  <code className="bg-muted px-1 rounded font-mono text-xs">
                    /api/carfast/*
                  </code>{' '}
                  повертають JSON 410 Gone, щоб старі клієнти явно бачили що
                  потрібно оновитись.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChromeExtensionPage;
