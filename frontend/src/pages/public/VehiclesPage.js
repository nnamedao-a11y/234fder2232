import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import Breadcrumbs from '../../components/public/Breadcrumbs';
import CatalogFiltersSidebar from '../../components/public/CatalogFiltersSidebar';
import CatalogActiveChips from '../../components/public/CatalogActiveChips';
import CarRowCard from '../../components/public/CarRowCard';
import Pagination from '../../components/public/Pagination';
import HaveAQuestionBlock from '../../components/public/HaveAQuestionBlock';
import ConsultationCTAForm from '../../components/public/ConsultationCTAForm';

const API = process.env.REACT_APP_BACKEND_URL || '';
const PER_PAGE = 6;
const MIN_YEAR = 1990;
const MAX_YEAR = 2026;

/**
 * Detect whether a free-text query looks like a VIN (17 chars), partial VIN
 * (4–16 alphanumerics in ISO-3779 charset) or a LOT number (pure digits).
 * If yes — return the normalized value; if no — return null so we fall back
 * to local catalog filtering.
 */
const detectVinOrLot = (raw) => {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s; // URL routes through result page too
  const clean = s.toUpperCase().replace(/[\s-]/g, '');
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(clean)) return clean; // full VIN
  if (/^[A-HJ-NPR-Z0-9]{4,16}$/.test(clean)) return clean; // partial VIN / lot
  if (/^\d{4,10}$/.test(clean)) return clean; // numeric lot
  return null;
};

export default function VehiclesPage() {
  const [filters, setFilters] = useState({});
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  // Submit handler: VIN / LOT / URL -> redirect to unified result page;
  // otherwise keep filtering the local catalog.
  const onSubmitSearch = (e) => {
    e?.preventDefault?.();
    const target = detectVinOrLot(query);
    if (target) {
      navigate(`/vin/${encodeURIComponent(target)}`);
    }
  };

  // Fetch vehicles whenever filters / page / query change
  useEffect(() => {
    setLoading(true);
    const params = { limit: PER_PAGE, skip: (page - 1) * PER_PAGE };
    if (filters.brand) params.make = filters.brand;
    if (filters.model) params.model = filters.model;
    if (query.trim()) params.q = query.trim();
    axios
      .get(`${API}/api/vehicles`, { params })
      .then((r) => {
        setItems(r.data?.items || []);
        setTotal(r.data?.total || 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [filters, page, query]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [filters, query]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Build active filter chips list dynamically
  const chips = useMemo(() => {
    const arr = [];
    if (filters.brand) {
      arr.push({
        id: `brand-${filters.brand}`,
        label: filters.brand,
        onRemove: () => setFilters({ ...filters, brand: undefined, model: undefined }),
      });
    }
    if (filters.model) {
      arr.push({
        id: `model-${filters.model}`,
        label: filters.model,
        onRemove: () => setFilters({ ...filters, model: undefined }),
      });
    }
    if (filters.yearRange && (filters.yearRange[0] !== MIN_YEAR || filters.yearRange[1] !== MAX_YEAR)) {
      arr.push({
        id: 'year',
        label: `${filters.yearRange[0]}–${filters.yearRange[1]}`,
        onRemove: () => setFilters({ ...filters, yearRange: undefined }),
      });
    }
    if (filters.mileageMin || filters.mileageMax) {
      arr.push({
        id: 'mileage',
        label: `Mileage ${filters.mileageMin || 0}–${filters.mileageMax || '∞'} km`,
        onRemove: () =>
          setFilters({ ...filters, mileageMin: undefined, mileageMax: undefined }),
      });
    }
    (filters.auctions || []).forEach((a) =>
      arr.push({
        id: `auction-${a}`,
        label: a,
        onRemove: () =>
          setFilters({ ...filters, auctions: filters.auctions.filter((x) => x !== a) }),
      })
    );
    (filters.conditions || []).forEach((c) =>
      arr.push({
        id: `cond-${c}`,
        label: c,
        onRemove: () =>
          setFilters({ ...filters, conditions: filters.conditions.filter((x) => x !== c) }),
      })
    );
    (filters.fuels || []).forEach((f) =>
      arr.push({
        id: `fuel-${f}`,
        label: f,
        onRemove: () =>
          setFilters({ ...filters, fuels: filters.fuels.filter((x) => x !== f) }),
      })
    );
    (filters.damages || []).forEach((d) =>
      arr.push({
        id: `dmg-${d}`,
        label: d,
        onRemove: () =>
          setFilters({ ...filters, damages: filters.damages.filter((x) => x !== d) }),
      })
    );
    return arr;
  }, [filters]);

  return (
    <div data-testid="catalog-page" className="text-white">
      <section className="bg-black pt-12 pb-20">
        <div className="max-w-[1920px] mx-auto px-6 md:px-10 lg:px-[60px] xl:px-[100px]">
          {/* Top row: Breadcrumbs + Search */}
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <Breadcrumbs items={[{ label: 'HOME', to: '/' }, { label: 'CATALOG' }]} />
            <form
              onSubmit={onSubmitSearch}
              className="flex items-center h-11 w-full md:w-[380px] xl:w-[420px] border border-[#FEAE00]/50 rounded bg-[#0F0F0F] focus-within:border-[#FEAE00] transition-colors"
              data-testid="catalog-search-form"
            >
              <button
                type="submit"
                aria-label="Search"
                className="ml-4 text-[#FEAE00] hover:brightness-125 flex-shrink-0"
                data-testid="catalog-search-submit"
              >
                <Search size={16} />
              </button>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by VIN or lot number"
                className="flex-1 bg-transparent border-0 px-3 text-[13px] text-white placeholder-[#6A6A6A] focus:outline-none min-w-0"
                data-testid="catalog-search-input"
                autoComplete="off"
                spellCheck={false}
              />
            </form>
          </div>

          <h1
            className="font-bold uppercase text-white mt-10 leading-none"
            style={{ fontSize: 'clamp(40px, 5vw, 72px)' }}
          >
            Catalog
          </h1>

          <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] xl:grid-cols-[340px_1fr] gap-6 lg:gap-8 mt-12 items-start">
            <CatalogFiltersSidebar filters={filters} setFilters={setFilters} />

            <div className="min-w-0">
              {/* Top action row */}
              <div className="flex items-center justify-between mb-6 lg:mb-8 flex-wrap gap-4">
                <CatalogActiveChips
                  chips={chips}
                  total={total}
                  onReset={() => setFilters({})}
                />
                <button
                  type="button"
                  className="text-[13px] uppercase underline text-[#FEAE00] hover:brightness-110 shrink-0"
                  data-testid="catalog-open-filters"
                >
                  Filter +
                </button>
              </div>

              {loading && (
                <div className="text-[#5E5E5E] py-20 text-center">Loading vehicles…</div>
              )}
              {!loading && items.length === 0 && (
                <div
                  className="text-[#5E5E5E] py-20 text-center"
                  data-testid="catalog-empty"
                >
                  No vehicles found
                </div>
              )}

              <div className="flex flex-col gap-5">
                {items.map((v, i) => (
                  <CarRowCard key={v.vin || v._id || i} v={v} idx={i} />
                ))}
              </div>

              {pages > 1 && (
                <div className="mt-12">
                  <Pagination page={page} pages={pages} onChange={setPage} />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Free consultation form */}
      <ConsultationCTAForm />

      {/* Have a question contact card */}
      <section className="bg-black pb-20">
        <div className="max-w-[1920px] mx-auto px-6 lg:px-[100px]">
          <HaveAQuestionBlock />
        </div>
      </section>
    </div>
  );
}
