import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import BibiSelect from '../ui/BibiSelect';

const API = process.env.REACT_APP_BACKEND_URL || '';

/**
 * CarCalculator — fully functional public calculator wired to
 * POST /api/calculator/calculate and /api/calculator/quote.
 *
 * Inputs (left column):
 *   - VIN / lot number (optional)
 *   - Auction (copart / iaai)
 *   - Vehicle type (sedan / suv / bigSUV / pickup)
 *   - Destination port
 *   - Vehicle price (USD)
 *   - Phone (for lead submission)
 */

const DEFAULTS = {
  vin: '',
  auction: 'copart',
  vehicleType: 'sedan',
  port: 'odessa',
  price: 15000,
};

const FALLBACK_VEHICLE_TYPES = [
  { code: 'sedan', name: 'Sedan' },
  { code: 'suv', name: 'SUV / Crossover' },
  { code: 'bigSUV', name: 'Big SUV / 4x4' },
  { code: 'pickup', name: 'Pickup' },
];

const FALLBACK_PORTS = [
  { code: 'odessa', name: 'Odessa', country: 'UA' },
  { code: 'klaipeda', name: 'Klaipeda', country: 'LT' },
  { code: 'gdansk', name: 'Gdansk', country: 'PL' },
  { code: 'bremerhaven', name: 'Bremerhaven', country: 'DE' },
];

const FALLBACK_AUCTIONS = [
  { code: 'copart', name: 'Copart' },
  { code: 'iaai', name: 'IAAI' },
];

const fmt = (v, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(v) || 0);

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

const DottedRow = ({ label, value, valueClass = 'text-white', bold = false }) => (
  <div className="flex items-baseline gap-3 py-[11px]">
    <span className={`text-[13px] md:text-[15px] text-white whitespace-nowrap ${bold ? 'font-semibold' : ''}`}>
      {label}
    </span>
    <span
      aria-hidden="true"
      className="flex-1 self-end mb-[5px]"
      style={{ borderBottom: '1px dotted rgba(255,255,255,0.28)', height: 1 }}
    />
    <span
      className={`text-[13px] md:text-[15px] font-medium uppercase whitespace-nowrap ${valueClass}`}
    >
      {value}
    </span>
  </div>
);

const FieldInput = ({ label, value, onChange, placeholder, type = 'text', testId, suffix }) => (
  <div className="mb-5">
    <label className="block text-[12px] uppercase tracking-wider text-[#8A8A8A] mb-2">{label}</label>
    <div className="relative">
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        type={type}
        data-testid={testId}
        className="w-full h-12 bg-transparent border border-[#555452] rounded px-4 pr-14 text-[14px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-[#FEAE00]"
      />
      {suffix ? (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] uppercase tracking-wider text-[#FEAE00] pointer-events-none">
          {suffix}
        </span>
      ) : null}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export const CarCalculator = ({ vehicle, initialVin = '', initialPrice = null }) => {
  // Config
  const [ports, setPorts] = useState(FALLBACK_PORTS);
  const [vehicleTypes, setVehicleTypes] = useState(FALLBACK_VEHICLE_TYPES);
  const [auctions, setAuctions] = useState(FALLBACK_AUCTIONS);

  // Form
  const [vin, setVin] = useState(initialVin || vehicle?.vin || '');
  const [auction, setAuction] = useState(vehicle?.auction || DEFAULTS.auction);
  const [vehicleType, setVehicleType] = useState(vehicle?.vehicleType || DEFAULTS.vehicleType);
  const [port, setPort] = useState(DEFAULTS.port);
  const [price, setPrice] = useState(
    initialPrice != null
      ? String(initialPrice)
      : vehicle?.price
        ? String(vehicle.price)
        : String(DEFAULTS.price)
  );
  const [phone, setPhone] = useState('');
  const [brand, setBrand] = useState(vehicle?.title || vehicle?.make || '');

  // Calc state
  const [calc, setCalc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingQuote, setSavingQuote] = useState(false);
  const [lastQuoteId, setLastQuoteId] = useState(null);
  const abortRef = useRef(null);

  // Load options from backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/api/calculator/ports`);
        if (cancelled || !data?.success) return;
        if (Array.isArray(data.ports) && data.ports.length) setPorts(data.ports);
        if (Array.isArray(data.vehicleTypes) && data.vehicleTypes.length) setVehicleTypes(data.vehicleTypes);
        if (Array.isArray(data.auctions) && data.auctions.length) setAuctions(data.auctions);
        const def = (data.ports || []).find((p) => p.default) || (data.ports || [])[0];
        if (def?.code) setPort((prev) => prev || def.code);
      } catch (_) {
        /* silent — keep fallbacks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced calc on any input change
  const recalc = useCallback(async () => {
    const numericPrice = Number(String(price).replace(/[^0-9.]/g, '')) || 0;
    if (numericPrice <= 0) {
      setCalc(null);
      return;
    }
    try {
      setLoading(true);
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const { data } = await axios.post(
        `${API}/api/calculator/calculate`,
        { price: numericPrice, port, auction, vehicleType, vin: vin || null },
        { signal: ctrl.signal }
      );
      if (data?.success && data.calculation) setCalc(data.calculation);
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return;
    } finally {
      setLoading(false);
    }
  }, [price, port, auction, vehicleType, vin]);

  useEffect(() => {
    const t = setTimeout(recalc, 300);
    return () => clearTimeout(t);
  }, [recalc]);

  // Derived
  const currency = calc?.currency || 'USD';
  const total = calc?.total ?? 0;
  const vehiclePrice = calc?.vehiclePrice ?? 0;
  const auctionTotal = calc?.auctionTotal ?? 0;
  const deliveryTotal = calc?.deliveryTotal ?? 0;
  const breakdown = useMemo(() => (Array.isArray(calc?.breakdown) ? calc.breakdown : []), [calc]);

  // Build options for BibiSelect
  const auctionOptions = useMemo(
    () => auctions.map((a) => ({ value: a.code, label: a.name })),
    [auctions]
  );
  const vehicleTypeOptions = useMemo(
    () => vehicleTypes.map((v) => ({ value: v.code, label: v.name })),
    [vehicleTypes]
  );
  const portOptions = useMemo(
    () =>
      ports.map((p) => ({
        value: p.code,
        label: p.name,
        hint: p.country || undefined,
      })),
    [ports]
  );

  // Actions
  const saveQuote = async () => {
    if (!calc) {
      toast.error('Nothing to save — enter vehicle price first');
      return;
    }
    try {
      setSavingQuote(true);
      const { data } = await axios.post(`${API}/api/calculator/quote`, {
        vin: vin || null,
        price: vehiclePrice,
        port,
        auction,
        vehicleType,
        scenario: 'standard',
        calculation: calc,
      });
      if (data?.success && data?.quote?.id) {
        setLastQuoteId(data.quote.id);
        toast.success('Quote saved');
      } else {
        toast.error('Quote was not saved');
      }
    } catch (_) {
      toast.error('Could not save quote');
    } finally {
      setSavingQuote(false);
    }
  };

  const submitLead = async () => {
    if (!phone.trim()) {
      toast.error('Enter phone number');
      return;
    }
    if (!calc) {
      toast.error('Calculate first, then submit');
      return;
    }
    try {
      setSubmitting(true);
      let quoteId = lastQuoteId;
      if (!quoteId) {
        try {
          const { data } = await axios.post(`${API}/api/calculator/quote`, {
            vin: vin || null,
            price: vehiclePrice,
            port,
            auction,
            vehicleType,
            scenario: 'standard',
            calculation: calc,
          });
          if (data?.success) quoteId = data?.quote?.id || null;
          if (quoteId) setLastQuoteId(quoteId);
        } catch (_) {
          /* ignore */
        }
      }
      await axios.post(`${API}/api/public/leads/quick`, {
        name: 'Calculator Lead',
        phone,
        desiredCar: brand || vehicle?.title || vin || '',
        budget: String(total),
        source: 'calculator',
        quoteId,
        calculation: calc,
      });
      toast.success('Request sent — we will contact you shortly');
      setPhone('');
    } catch (_) {
      toast.error('Could not send request');
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setVin('');
    setBrand('');
    setPrice(String(DEFAULTS.price));
    setAuction(DEFAULTS.auction);
    setVehicleType(DEFAULTS.vehicleType);
    setPort(DEFAULTS.port);
    setLastQuoteId(null);
  };

  return (
    <section
      className="bg-[#1D1D1B] rounded-lg px-6 py-12 md:px-16 md:py-16"
      data-testid="car-calculator"
    >
      <div className="flex items-center justify-between mb-10 gap-4 flex-wrap">
        <h3 className="text-[28px] md:text-[40px] font-bold text-white">Car calculator</h3>
        <div className="flex items-center gap-3 text-[12px] uppercase tracking-wider text-[#8A8A8A]">
          {loading ? (
            <span className="inline-flex items-center gap-2 text-[#FEAE00]">
              <Loader2 size={14} className="animate-spin" /> Calculating…
            </span>
          ) : (
            <span>Live update · USD</span>
          )}
          <button
            type="button"
            onClick={reset}
            className="underline underline-offset-4 hover:text-[#FEAE00]"
            data-testid="calc-reset"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-24">
        {/* ==================== LEFT COLUMN ==================== */}
        <div className="flex flex-col">
          <FieldInput
            label="VIN / Lot number"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            placeholder="e.g. 1FTFW1E50NFB12345"
            testId="calc-vin"
          />

          <div className="grid grid-cols-2 gap-4">
            <BibiSelect
              label="Auction"
              value={auction}
              onChange={setAuction}
              options={auctionOptions}
              testId="calc-auction"
            />
            <BibiSelect
              label="Vehicle type"
              value={vehicleType}
              onChange={setVehicleType}
              options={vehicleTypeOptions}
              testId="calc-vehicle-type"
            />
          </div>

          <div className="mt-5">
            <BibiSelect
              label="Destination port"
              value={port}
              onChange={setPort}
              options={portOptions}
              testId="calc-port"
            />
          </div>

          <div className="mt-5">
            <FieldInput
              label="Vehicle price"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="15000"
              type="text"
              testId="calc-price"
              suffix="USD"
            />
          </div>

          {/* Summary */}
          <div className="mt-2 border-t border-[#3a3a38] pt-5">
            <DottedRow label="Vehicle price" value={fmt(vehiclePrice, currency)} />
            <DottedRow label="Auction fees" value={fmt(auctionTotal, currency)} />
            <DottedRow label="Delivery & services" value={fmt(deliveryTotal, currency)} />
            <div className="flex items-baseline gap-3 py-[14px]">
              <span className="text-[14px] md:text-[15px] text-white whitespace-nowrap">Car in Bulgaria</span>
              <span
                aria-hidden="true"
                className="flex-1 self-end mb-[5px]"
                style={{ borderBottom: '1px dotted rgba(255,255,255,0.35)', height: 1 }}
              />
              <span
                className="text-[18px] md:text-[22px] font-bold uppercase text-[#FEAE00] whitespace-nowrap"
                data-testid="calc-total"
              >
                {fmt(total, currency)}
              </span>
            </div>
          </div>

          {/* CTA save quote */}
          <button
            type="button"
            onClick={saveQuote}
            disabled={savingQuote || !calc}
            className="btn-amber w-full mt-6 h-[52px] disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="calc-submit"
          >
            {savingQuote ? 'Saving…' : 'Save & get complete calculation'}
          </button>

          {lastQuoteId ? (
            <div className="mt-3 text-[12px] text-[#8A8A8A]">
              Quote saved:{' '}
              <span className="text-[#FEAE00] font-mono" data-testid="calc-quote-id">
                {lastQuoteId}
              </span>
            </div>
          ) : null}

          {/* Phone */}
          <label className="block text-[14px] text-white mt-10 mb-3">
            Your phone number<span className="text-[#FEAE00]">*</span>
          </label>
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2 pr-3 border-r border-[#555452] h-6">
              <span
                className="inline-block w-6 h-4 rounded-sm overflow-hidden"
                aria-label="Bulgaria"
                style={{
                  background:
                    'linear-gradient(to bottom, #FFFFFF 0%, #FFFFFF 33.33%, #00966E 33.33%, #00966E 66.66%, #D62612 66.66%, #D62612 100%)',
                }}
              />
            </div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+359 ..."
              type="tel"
              className="w-full h-12 bg-transparent border border-[#555452] rounded pl-[70px] pr-4 text-[14px] text-white placeholder-[#6A6A6A] focus:outline-none focus:border-[#FEAE00]"
              data-testid="calc-phone"
            />
          </div>
          <button
            type="button"
            onClick={submitLead}
            disabled={submitting}
            className="w-full mt-4 h-[52px] border border-[#FEAE00] text-[#FEAE00] text-[13px] uppercase tracking-[0.2em] font-semibold hover:bg-[#FEAE00] hover:text-black transition-colors rounded disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="calc-lead-submit"
          >
            {submitting ? 'Sending…' : 'Request a callback'}
          </button>

          <button
            type="button"
            className="mt-10 self-start text-[13px] md:text-[14px] font-medium uppercase underline text-[#FEAE00] hover:brightness-110 tracking-wider"
            data-testid="calc-find-similar"
            onClick={() => {
              window.location.href = '/catalog';
            }}
          >
            Find similar car
          </button>
        </div>

        {/* ==================== RIGHT COLUMN — BREAKDOWN ==================== */}
        <div className="flex flex-col">
          <div className="text-[12px] uppercase tracking-[0.2em] text-[#FEAE00] mb-4">
            [ turnkey breakdown ]
          </div>
          {breakdown.length === 0 ? (
            <div className="text-[14px] text-[#8A8A8A] italic py-10">
              Enter a vehicle price to see the full turnkey breakdown.
            </div>
          ) : (
            breakdown.map((row) => (
              <DottedRow key={row.key} label={row.label} value={fmt(row.value, currency)} />
            ))
          )}

          {breakdown.length > 0 ? (
            <div className="mt-8 pt-6 border-t border-[#3a3a38]">
              <DottedRow
                label="Total (car in Bulgaria)"
                value={fmt(total, currency)}
                valueClass="text-[#FEAE00] text-[18px] md:text-[20px]"
                bold
              />
              <p className="mt-3 text-[11px] uppercase tracking-wider text-[#6A6A6A]">
                Indicative estimate. Final price is locked by a manager after VIN verification.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default CarCalculator;
