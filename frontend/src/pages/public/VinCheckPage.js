import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import { Search } from 'lucide-react';
import { useLang } from '../../i18n';

const API = process.env.REACT_APP_BACKEND_URL || '';

const T = {
  en: {
    home: 'HOME',
    vinCheck: 'VIN CHECK',
    title: 'VIN check',
    placeholder: 'Enter VIN or LOT number',
    submit: 'Check',
    loading: 'Looking up VIN…',
    failed: 'VIN lookup failed',
    result: 'Result',
  },
  bg: {
    home: 'НАЧАЛО',
    vinCheck: 'VIN ПРОВЕРКА',
    title: 'VIN проверка',
    placeholder: 'Въведете VIN или LOT номер',
    submit: 'Провери',
    loading: 'Проверка на VIN…',
    failed: 'Проверката на VIN не успя',
    result: 'Резултат',
  },
};

export default function VinCheckPage() {
  const { lang } = useLang();
  const t = lang === 'bg' ? T.bg : T.en;
  const { vin } = useParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(vin || '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!vin) return;
    setLoading(true); setError(null);
    axios.get(`${API}/api/vin/search/${encodeURIComponent(vin)}`)
      .then((r) => setData(r.data?.data || r.data))
      .catch((e) => setError(e.response?.data?.detail || t.failed))
      .finally(() => setLoading(false));
  }, [vin, t.failed]);

  const submit = (e) => {
    e.preventDefault();
    const v = q.trim(); if (!v) return;
    navigate(`/vin-check/${encodeURIComponent(v)}`);
  };

  return (
    <div data-testid="vin-check-page" className="bg-black min-h-[60vh]">
      <section className="pt-12 pb-20">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <Breadcrumbs items={[{ label: t.home, to: '/' }, { label: t.vinCheck }]} />
          <h1 className="text-[48px] md:text-[80px] font-bold uppercase text-[#FEAE00] mt-10 leading-none">{t.title}</h1>

          <form onSubmit={submit} className="mt-12 flex items-center gap-3 max-w-[640px]">
            <div className="flex-1 flex items-center gap-2 h-12 px-4 border border-[#555452] rounded-lg">
              <Search size={18} className="text-[#5E5E5E]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.placeholder} className="flex-1 bg-transparent outline-none text-[14px] uppercase text-white placeholder:text-[#5E5E5E]" data-testid="vin-check-input" />
            </div>
            <button className="btn-amber h-12" data-testid="vin-check-submit">{t.submit}</button>
          </form>

          {loading && <div className="mt-12 text-[#5E5E5E]">{t.loading}</div>}
          {error && <div className="mt-12 text-red-400">{error}</div>}

          {data && (
            <div className="mt-12 bg-[#1D1D1B] rounded-lg p-8">
              <h2 className="text-[24px] font-bold text-white mb-6">{t.result}</h2>
              <pre className="text-[12px] text-[#FEAE00] whitespace-pre-wrap break-words">{JSON.stringify(data, null, 2)}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
