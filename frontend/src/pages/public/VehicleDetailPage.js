import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { Heart, GitCompare } from 'lucide-react';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import CarGallery from '../../components/public/CarGallery';
import CarCalculator from '../../components/public/CarCalculator';
import HaveAQuestionBlock from '../../components/public/HaveAQuestionBlock';

const API = process.env.REACT_APP_BACKEND_URL || '';

const Row = ({ label, value }) => (
  <div className="grid grid-cols-[110px_1fr] gap-4 py-2">
    <span className="text-[14px] text-white capitalize">{label}</span>
    <span className="text-[14px] font-bold uppercase text-[#FEAE00]">{value || '—'}</span>
  </div>
);

export default function VehicleDetailPage() {
  const { id } = useParams();
  const [v, setV] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/api/vehicles/${encodeURIComponent(id)}`)
      .then((r) => setV(r.data?.data || r.data))
      .catch(() => setV(null))
      .finally(() => setLoading(false));
  }, [id]);

  const title = v?.title || `${v?.year || ''} ${v?.make || ''} ${v?.model || ''}`.trim() || 'Vehicle';

  return (
    <div data-testid="single-car-page" className="bg-black">
      <section className="pt-12 pb-16">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <Breadcrumbs items={[{ label: 'HOME', to: '/' }, { label: 'CATALOG', to: '/catalog' }, { label: title }]} />
          <div className="flex items-start justify-between gap-6 mt-10">
            <h1 className="text-[36px] md:text-[64px] font-bold text-white leading-tight" data-testid="single-car-title">{title}</h1>
            <div className="flex items-center gap-4 flex-shrink-0">
              <button className="w-10 h-10 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors" aria-label="Compare"><GitCompare size={16} /></button>
              <button className="w-10 h-10 rounded-full border border-[#FEAE00] flex items-center justify-center text-[#FEAE00] hover:bg-[#FEAE00] hover:text-black transition-colors" aria-label="Favorite"><Heart size={16} /></button>
            </div>
          </div>

          {loading && <div className="py-32 text-center text-[#5E5E5E]">Loading…</div>}

          {!loading && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-8 mt-12">
              <CarGallery images={v?.images} />
              <div className="bg-[#1D1D1B] rounded-lg p-8 md:p-12 flex flex-col">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <h2 className="text-[18px] font-semibold text-white capitalize">Car information</h2>
                  <div className="px-4 h-9 border border-[#FEAE00] rounded flex items-center text-[14px] font-semibold uppercase text-[#FEAE00]" data-testid="car-status-traded">Traded</div>
                </div>
                <div className="border-b border-[#555452] my-4" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div>
                    <Row label="Model" value={v?.model} />
                    <Row label="Year" value={v?.year} />
                    <Row label="Mileage" value={v?.odometer ? `${v.odometer.toLocaleString()} km` : '—'} />
                    <Row label="Engine" value={v?.engine_size || '2.5 L 4'} />
                    <Row label="Fuel Type" value={v?.fuel_type || 'Gasoline'} />
                  </div>
                  <div>
                    <Row label="Tx" value={v?.transmission || 'Automatic'} />
                    <Row label="Body Type" value={v?.body_type || 'SUV'} />
                    <Row label="Condition" value={v?.condition} />
                    <Row label="Damage" value={v?.damage_primary} />
                  </div>
                </div>
                <h2 className="text-[18px] font-semibold text-white capitalize mt-10">Auction details</h2>
                <div className="border-b border-[#555452] my-4" />
                <Row label="LOT" value={v?.lot_number} />
                <Row label="VIN" value={v?.vin} />
                <Row label="Auction" value={v?.auction_name || v?.source} />
                <Row label="Updated" value={v?.updated_at ? new Date(v.updated_at).toLocaleString() : '—'} />
                <button className="btn-amber mt-auto self-center mt-10" data-testid="single-car-exact-cost">EXACT COST IN BULGARIA</button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Calculator */}
      <section className="bg-black pb-16">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <CarCalculator vehicle={v} />
          <div className="text-center mt-12">
            <Link to="/catalog" className="text-[16px] uppercase underline text-[#FEAE00] hover:brightness-110" data-testid="go-back-to-catalog">Go back to catalog</Link>
          </div>
        </div>
      </section>

      {/* Have a question */}
      <section className="bg-black py-16">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <HaveAQuestionBlock />
        </div>
      </section>
    </div>
  );
}
