/**
 * LegalWorkflowPage — единая dashboard для P0.1–P0.4:
 *   Tab 1: Customer Legal  (P0.1) — юридические поля клиента
 *   Tab 2: Deal Pipeline   (P0.2) — 20 стадий + advance
 *   Tab 3: Deposit v2      (P0.3) — required EUR + confirm + forfeit
 *   Tab 4: Contract v2     (P0.4) — lifecycle + upload signed PDF
 *
 * Backend: legal_workflow.py  (/api/legal/*, /api/contracts2/*)
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../../App';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  Scales, IdentificationCard, Coins, FileText,
  CheckCircle, Warning, ArrowsClockwise, FloppyDisk,
  ShieldCheck, Fire, UploadSimple, ArrowRight, Info,
  Trophy, X as IconX,
  Wallet, Bank, Money, Lock, LockOpen, Plus, Receipt,
  CurrencyEur, CheckSquare, XCircle, ListChecks
} from '@phosphor-icons/react';

// ──────────────────────── STATIC HELPERS ─────────────────────────
const STAGE_LABELS = {
  lead: 'Lead',
  qualified: 'Qualified',
  variants_sent: 'Varianty Sent',
  deposit_contract_drafted: 'Deposit Contract Drafted',
  deposit_contract_signed: 'Deposit Contract Signed',
  deposit_paid: 'Deposit Paid',
  searching_at_auction: 'Searching at Auction',
  auction_lost: 'Auction Lost',
  auction_won: 'Auction Won',
  final_contract_sent: 'Final Contract Sent',
  final_contract_signed: 'Final Contract Signed',
  after_win_payment_paid: 'After-Win Payment Paid',
  in_transit_to_rotterdam: 'In Transit → Rotterdam',
  arrived_rotterdam: 'Arrived Rotterdam',
  customs_calculated: 'Customs Calculated',
  final_payment_paid: 'Final Payment Paid',
  in_transit_to_bg: 'In Transit → BG',
  delivered: 'Delivered',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const DEPOSIT_STATUS_COLORS = {
  pending:                   'bg-[#FEF3C7] text-[#D97706]',
  paid_confirmed:            'bg-[#D1FAE5] text-[#059669]',
  refund_pending_voluntary:  'bg-[#E0E7FF] text-[#4F46E5]',
  refund_pending_30d:        'bg-[#FED7AA] text-[#C2410C]',
  refund_approved:           'bg-[#BFDBFE] text-[#1D4ED8]',
  refund_rejected:           'bg-[#FEE2E2] text-[#DC2626]',
  refunded:                  'bg-[#A7F3D0] text-[#065F46]',
  forfeit_pending_teamlead:  'bg-[#FED7AA] text-[#C2410C]',
  forfeit_pending_admin:     'bg-[#FCA5A5] text-[#991B1B]',
  forfeited:                 'bg-[#1F2937] text-white',
};

const LIFECYCLE_COLORS = {
  draft:                  'bg-[#F4F4F5] text-[#71717A]',
  sent_to_client:         'bg-[#E0E7FF] text-[#4F46E5]',
  client_signed:          'bg-[#FEF3C7] text-[#D97706]',
  company_signed_stamped: 'bg-[#DBEAFE] text-[#2563EB]',
  finalized:              'bg-[#D1FAE5] text-[#059669]',
  cancelled:              'bg-[#FEE2E2] text-[#DC2626]',
};

// ───────────────────────── MAIN PAGE ─────────────────────────────
export default function LegalWorkflowPage() {
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') || 'customer_legal';
  const [tab, setTab] = useState(initialTab);
  const [catalog, setCatalog] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [deals, setDeals] = useState([]);

  // Sync tab → URL query
  useEffect(() => {
    if (tab !== params.get('tab')) {
      const next = new URLSearchParams(params);
      next.set('tab', tab);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Sync URL query → tab (so sidebar navigation between ?tab=deal_pipeline /
  // ?tab=deposit_v2 works even when already on this page).
  useEffect(() => {
    const urlTab = params.get('tab');
    if (urlTab && urlTab !== tab) {
      setTab(urlTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    (async () => {
      try {
        const [cat, cust, dl] = await Promise.all([
          axios.get(`${API_URL}/api/legal/catalog`),
          axios.get(`${API_URL}/api/customers?limit=200`),
          axios.get(`${API_URL}/api/deals?limit=200`),
        ]);
        setCatalog(cat.data);
        setCustomers(cust.data?.data || []);
        setDeals(dl.data?.data || []);
      } catch (e) {
        console.error(e);
        toast.error('Не удалось загрузить справочники');
      }
    })();
  }, []);

  const tabs = [
    { id: 'customer_legal', label: 'Customer Legal (P0.1)', icon: IdentificationCard },
    { id: 'deal_pipeline',  label: 'Deal Pipeline (P0.2)',  icon: ArrowsClockwise },
    { id: 'deposit_v2',     label: 'Deposit v2 (P0.3)',     icon: Coins },
    { id: 'contract_v2',    label: 'Contract v2 (P0.4)',    icon: FileText },
    { id: 'financials',     label: 'Financials & Payments (P1.2)', icon: Wallet },
  ];

  return (
    <motion.div
      data-testid="legal-workflow-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        <Scales size={28} weight="duotone" className="text-[#4F46E5]" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#18181B]"
              style={{ fontFamily: 'Mazzard, system-ui, sans-serif' }}>
            Legal &amp; Pipeline Workflow
          </h1>
          <p className="text-sm text-[#71717A]">
            P0.1 Customer Legal · P0.2 Deal Stages · P0.3 Deposit · P0.4 Contracts v2
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#E4E4E7] overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`legal-tab-${t.id}`}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'text-[#4F46E5] border-b-2 border-[#4F46E5]'
                : 'text-[#71717A] hover:text-[#18181B]'
            }`}
          >
            <t.icon size={18} weight="duotone" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[500px]">
        {tab === 'customer_legal' && (
          <CustomerLegalTab customers={customers} />
        )}
        {tab === 'deal_pipeline' && (
          <DealPipelineTab
            deals={deals}
            catalog={catalog}
            onRefresh={async () => {
              const r = await axios.get(`${API_URL}/api/deals?limit=200`);
              setDeals(r.data?.data || []);
            }}
          />
        )}
        {tab === 'deposit_v2' && (
          <DepositV2Tab
            customers={customers}
            deals={deals}
            catalog={catalog}
          />
        )}
        {tab === 'contract_v2' && (
          <ContractV2Tab
            customers={customers}
            deals={deals}
            catalog={catalog}
          />
        )}
        {tab === 'financials' && (
          <FinancialsTab
            customers={customers}
            deals={deals}
          />
        )}
      </div>
    </motion.div>
  );
}

// ════════════════════════ P0.1 TAB ═══════════════════════════════
function CustomerLegalTab({ customers }) {
  const [customerId, setCustomerId] = useState('');
  const [legal, setLegal] = useState(emptyLegal());
  const [validation, setValidation] = useState(null);
  const [saving, setSaving] = useState(false);

  function emptyLegal() {
    return {
      first_name: '', last_name: '', egn: '',
      national_id_no: '', id_card_address: '',
      id_card_issued_by: '', id_card_issue_date: '',
    };
  }

  const load = useCallback(async (id) => {
    if (!id) { setLegal(emptyLegal()); setValidation(null); return; }
    try {
      const [r1, r2] = await Promise.all([
        axios.get(`${API_URL}/api/customers/${id}/legal`),
        axios.get(`${API_URL}/api/customers/${id}/legal/validate`),
      ]);
      setLegal({ ...emptyLegal(), ...(r1.data?.legal || {}) });
      setValidation(r2.data);
    } catch (e) {
      setLegal(emptyLegal());
      setValidation(null);
    }
  }, []);

  useEffect(() => { load(customerId); }, [customerId, load]);

  const save = async () => {
    if (!customerId) return toast.error('Выберите клиента');
    if (!/^\d{10}$/.test(legal.egn)) return toast.error('EGN должен быть ровно 10 цифр');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(legal.id_card_issue_date))
      return toast.error('Дата выдачи в формате YYYY-MM-DD');
    setSaving(true);
    try {
      await axios.put(`${API_URL}/api/customers/${customerId}/legal`, legal);
      toast.success('Legal-поля сохранены');
      await load(customerId);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, opts = {}) => (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
        {label}{!opts.optional && <span className="text-[#DC2626]"> *</span>}
      </label>
      <input
        type={opts.type || 'text'}
        value={legal[key] || ''}
        onChange={(e) => setLegal({ ...legal, [key]: e.target.value })}
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        className="input w-full"
        data-testid={`legal-${key}`}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 section-card">
        <div className="section-title-clean">
          <IdentificationCard size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Юридические поля клиента</span>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
              Клиент <span className="text-[#DC2626]">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="input w-full"
              data-testid="legal-customer-select"
            >
              <option value="">— выбрать клиента —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {(c.firstName || '') + ' ' + (c.lastName || '')} · {c.email || c.phone || c.id}
                </option>
              ))}
            </select>
          </div>

          {customerId && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field('first_name', 'Имя (лат.)', { placeholder: 'Ivan' })}
                {field('last_name',  'Фамилия (лат.)', { placeholder: 'Ivanov' })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field('egn',            'ЕГН (10 цифр)',  { maxLength: 10, placeholder: '9901011234' })}
                {field('national_id_no', '№ личной карты', { placeholder: 'BG1234567' })}
              </div>
              {field('id_card_address', 'Адрес по карте', { placeholder: 'гр. София, ул. ...' })}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field('id_card_issued_by',   'Кем выдана',      { placeholder: 'МВР София' })}
                {field('id_card_issue_date',  'Дата выдачи',     { type: 'date' })}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="btn-primary"
                  data-testid="legal-save-btn"
                >
                  <FloppyDisk size={18} weight="bold" />
                  {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
                <button
                  onClick={() => load(customerId)}
                  className="btn-secondary"
                >
                  Сбросить
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="section-card">
        <div className="section-title-clean">
          <ShieldCheck size={22} weight="duotone" className="text-[#059669]" />
          <span>Готовность к депозитному договору</span>
        </div>

        {!customerId && (
          <p className="text-sm text-[#71717A]">Выберите клиента, чтобы увидеть статус.</p>
        )}

        {customerId && validation && (
          <div className="space-y-4">
            {validation.ready_for_deposit_contract ? (
              <div className="bg-[#D1FAE5] border border-[#059669]/30 rounded-xl p-4">
                <div className="flex items-center gap-2 text-[#059669] font-semibold">
                  <CheckCircle size={22} weight="fill" />
                  Все поля заполнены
                </div>
                <p className="text-sm text-[#047857] mt-2">
                  Можно создавать депозитный договор.
                </p>
              </div>
            ) : (
              <div className="bg-[#FEF3C7] border border-[#D97706]/30 rounded-xl p-4">
                <div className="flex items-center gap-2 text-[#D97706] font-semibold">
                  <Warning size={22} weight="fill" />
                  Не хватает полей
                </div>
                <ul className="text-sm text-[#92400E] mt-2 list-disc pl-5 space-y-1">
                  {validation.missing_fields.map(f => <li key={f}>{f}</li>)}
                </ul>
              </div>
            )}
            <div className="text-xs text-[#71717A] bg-[#F9FAFB] rounded-lg p-3">
              <p className="font-semibold mb-1 text-[#18181B]">Правило:</p>
              Без всех 7 юридических полей API{' '}
              <code className="bg-white px-1.5 py-0.5 rounded border border-[#E4E4E7]">
                POST /api/contracts2 type=deposit
              </code>{' '}
              вернёт <b>422</b>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════ P0.2 TAB ═══════════════════════════════
function DealPipelineTab({ deals, catalog, onRefresh }) {
  const [dealId, setDealId] = useState('');
  const [selected, setSelected] = useState(null);
  const [advancing, setAdvancing] = useState(false);
  // P1.3 auction_won state
  const [showWonModal, setShowWonModal] = useState(false);
  const [wonForm, setWonForm] = useState({
    price_usd: '', auction: 'Copart', lot_number: '',
    auction_fee_eur: '', delivery_eur: '', service_fee_eur: '', fx_usd_to_eur: '',
    note: '',
  });
  const [wonSubmitting, setWonSubmitting] = useState(false);
  const [wonResult, setWonResult] = useState(null);

  useEffect(() => {
    if (!dealId) { setSelected(null); return; }
    const d = deals.find(x => x.id === dealId);
    setSelected(d || null);
  }, [dealId, deals]);

  const stages = catalog?.deal_stages || [];
  const groups = catalog?.deal_stage_groups || [];
  const forwardMap = catalog?.deal_stage_forward || {};
  const auctionDefaults = catalog?.auction_defaults || {};
  const stagesAllowingWin = auctionDefaults.stages_allowing_auction_won
    || ['searching_at_auction', 'auction_lost', 'deposit_paid'];
  const currentStage = selected?.stage || selected?.status || 'lead';
  const allowedTargets = forwardMap[currentStage] || [];
  const currentGroup = groups.find(g => g.stages.includes(currentStage))?.id;
  const canMarkAsWon = !!selected && stagesAllowingWin.includes(currentStage);

  const advance = async (target) => {
    if (!selected) return;
    setAdvancing(true);
    try {
      await axios.post(`${API_URL}/api/deals/${selected.id}/advance`, { to: target });
      toast.success(`Сделка переведена → ${STAGE_LABELS[target] || target}`);
      await onRefresh();
      setDealId(selected.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Переход запрещён');
    } finally {
      setAdvancing(false);
    }
  };

  const openWonModal = () => {
    setWonForm({
      price_usd: '', auction: 'Copart', lot_number: '',
      auction_fee_eur: '', delivery_eur: '', service_fee_eur: '', fx_usd_to_eur: '',
      note: '',
    });
    setWonResult(null);
    setShowWonModal(true);
  };

  const submitAuctionWon = async () => {
    if (!selected) return;
    const priceNum = parseFloat(wonForm.price_usd);
    if (!priceNum || priceNum <= 0) {
      toast.error('Введите hammer price (USD)');
      return;
    }
    if (!wonForm.auction.trim()) {
      toast.error('Введите название аукциона');
      return;
    }
    setWonSubmitting(true);
    try {
      const payload = {
        price_usd: priceNum,
        auction: wonForm.auction.trim(),
      };
      if (wonForm.lot_number.trim()) payload.lot_number = wonForm.lot_number.trim();
      if (wonForm.auction_fee_eur) payload.auction_fee_eur = parseFloat(wonForm.auction_fee_eur);
      if (wonForm.delivery_eur) payload.delivery_eur = parseFloat(wonForm.delivery_eur);
      if (wonForm.service_fee_eur) payload.service_fee_eur = parseFloat(wonForm.service_fee_eur);
      if (wonForm.fx_usd_to_eur) payload.fx_usd_to_eur = parseFloat(wonForm.fx_usd_to_eur);
      if (wonForm.note.trim()) payload.note = wonForm.note.trim();

      const r = await axios.post(
        `${API_URL}/api/legal/deals/${selected.id}/auction/won`,
        payload,
      );
      setWonResult(r.data);
      if (r.data.idempotent) {
        toast.info('Сделка уже отмечена как auction_won — артефакты возвращены');
      } else {
        toast.success(
          `🎉 auction_won! Contract ${r.data.contract.id.slice(0, 16)}…, ` +
          `invoice ${r.data.invoice.id.slice(0, 16)}… (€${r.data.total_eur.toLocaleString()})`
        );
      }
      await onRefresh();
      setDealId(selected.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'auction_won failed');
    } finally {
      setWonSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="section-card">
        <div className="section-title-clean">
          <ArrowsClockwise size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Выбор сделки</span>
        </div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
          Сделка
        </label>
        <select
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
          className="input w-full"
          data-testid="pipeline-deal-select"
        >
          <option value="">— выбрать сделку —</option>
          {deals.map(d => (
            <option key={d.id} value={d.id}>
              {d.title || d.vin || d.id} · {STAGE_LABELS[d.stage || d.status] || (d.stage || d.status)}
            </option>
          ))}
        </select>

        {selected && (
          <div className="mt-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#71717A]">ID</span>
              <span className="font-mono text-xs">{selected.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#71717A]">VIN</span>
              <span className="font-mono text-xs">{selected.vin || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#71717A]">max_bid_usd</span>
              <span className="font-semibold">${(selected.max_bid_usd || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#71717A]">deposit_contract_id</span>
              <span className="font-mono text-xs">{selected.deposit_contract_id || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#71717A]">final_contract_id</span>
              <span className="font-mono text-xs">{selected.final_contract_id || '—'}</span>
            </div>
          </div>
        )}
      </div>

      <div className="lg:col-span-2 section-card">
        <div className="section-title-clean">
          <ArrowRight size={22} weight="duotone" className="text-[#059669]" />
          <span>Pipeline (20 стадий)</span>
        </div>

        {!selected && (
          <p className="text-sm text-[#71717A]">Выберите сделку слева.</p>
        )}

        {selected && (
          <>
            {/* 8 macro groups overview */}
            {groups.length > 0 && (
              <div className="mb-5">
                <div className="text-xs uppercase tracking-wider text-[#71717A] mb-2">
                  Макро-этапы (8 групп)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {groups.map((g, idx) => {
                    const isCur = g.id === currentGroup;
                    const curIdx = groups.findIndex(x => x.id === currentGroup);
                    const isPast = curIdx >= 0 && idx < curIdx;
                    return (
                      <div key={g.id} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                        isCur ? 'bg-[#4F46E5] text-white' :
                        isPast ? 'bg-[#D1FAE5] text-[#059669]' :
                        'bg-[#F4F4F5] text-[#71717A]'
                      }`} data-testid={`macro-group-${g.id}`}>
                        <span className="text-[10px] opacity-70">{idx + 1}.</span>
                        {g.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-xs uppercase tracking-wider text-[#71717A] mb-2">
              Все 20 стадий (детально)
            </div>
            <div className="flex flex-wrap gap-2 mb-6">
              {stages.map(s => {
                const isCur = s === currentStage;
                const isPast = stages.indexOf(s) < stages.indexOf(currentStage);
                return (
                  <span
                    key={s}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                      isCur ? 'bg-[#4F46E5] text-white' :
                      isPast ? 'bg-[#D1FAE5] text-[#059669]' :
                      'bg-[#F4F4F5] text-[#71717A]'
                    }`}
                  >
                    {STAGE_LABELS[s] || s}
                  </span>
                );
              })}
            </div>

            <div className="bg-[#F9FAFB] rounded-xl p-4 mb-4">
              <div className="text-xs uppercase tracking-wider text-[#71717A] mb-1">Текущая стадия</div>
              <div className="text-lg font-bold text-[#18181B]">
                {STAGE_LABELS[currentStage] || currentStage}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-wider text-[#71717A] mb-2">
                Разрешённые переходы →
              </div>
              {allowedTargets.length === 0 ? (
                <p className="text-sm text-[#71717A]">Финальная стадия — переходов нет.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allowedTargets.map(t => (
                    <button
                      key={t}
                      onClick={() => advance(t)}
                      disabled={advancing}
                      data-testid={`advance-to-${t}`}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2
                        ${t === 'cancelled'
                          ? 'bg-[#FEE2E2] hover:bg-[#FCA5A5] text-[#DC2626]'
                          : 'bg-[#4F46E5] hover:bg-[#4338CA] text-white'}`}
                    >
                      <ArrowRight size={14} weight="bold" />
                      {STAGE_LABELS[t] || t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* P1.3 — auction_won big button */}
            {canMarkAsWon && (
              <div className="mt-6 p-4 rounded-xl border-2 border-dashed border-[#F59E0B] bg-gradient-to-br from-[#FFFBEB] to-[#FEF3C7]">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#F59E0B] flex items-center justify-center flex-shrink-0">
                      <Trophy size={22} weight="fill" className="text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-[#92400E]">
                        Auction Event — Mark as WON
                      </div>
                      <div className="text-xs text-[#92400E] opacity-80 mt-1">
                        Атомарно: stage → auction_won, создаст final contract draft
                        и invoice (after_win_package).
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={openWonModal}
                    data-testid="btn-mark-as-won"
                    className="px-5 py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-white text-sm font-bold flex items-center gap-2 shadow-md transition-colors"
                  >
                    <Trophy size={16} weight="fill" />
                    Mark as WON
                  </button>
                </div>
              </div>
            )}

            {selected.stage_history && selected.stage_history.length > 0 && (
              <div className="mt-6">
                <div className="text-xs uppercase tracking-wider text-[#71717A] mb-2">
                  История переходов
                </div>
                <div className="space-y-2 max-h-60 overflow-auto">
                  {[...selected.stage_history].reverse().slice(0, 20).map((h, i) => (
                    <div key={i} className="text-xs bg-[#F9FAFB] rounded-lg p-2 flex items-center gap-2">
                      <span className="text-[#71717A]">{h.at && new Date(h.at).toLocaleString()}</span>
                      <span className="font-mono">{h.from || '—'} → <b>{h.to}</b></span>
                      <span className="text-[#71717A]">· {h.by}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* P1.3 — auction_won modal */}
      {showWonModal && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => !wonSubmitting && setShowWonModal(false)}
          data-testid="auction-won-modal"
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-[#E4E4E7] flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#F59E0B] flex items-center justify-center flex-shrink-0">
                  <Trophy size={22} weight="fill" className="text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#18181B]">Mark as WON</h3>
                  <p className="text-sm text-[#71717A] mt-0.5">
                    Deal <span className="font-mono">{selected.id}</span> ·
                    {' '}{STAGE_LABELS[currentStage] || currentStage}
                  </p>
                </div>
              </div>
              <button
                onClick={() => !wonSubmitting && setShowWonModal(false)}
                className="p-1 rounded-lg hover:bg-[#F4F4F5]"
                data-testid="auction-won-close"
              >
                <IconX size={20} className="text-[#71717A]" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {!wonResult && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-1.5">
                        Hammer price, USD *
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={wonForm.price_usd}
                        onChange={(e) => setWonForm(s => ({ ...s, price_usd: e.target.value }))}
                        className="input w-full"
                        placeholder="15000"
                        data-testid="won-price-usd"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-1.5">
                        Аукцион *
                      </label>
                      <select
                        value={wonForm.auction}
                        onChange={(e) => setWonForm(s => ({ ...s, auction: e.target.value }))}
                        className="input w-full"
                        data-testid="won-auction"
                      >
                        <option value="Copart">Copart</option>
                        <option value="IAA">IAA</option>
                        <option value="Manheim">Manheim</option>
                        <option value="ADESA">ADESA</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-1.5">
                        Lot number
                      </label>
                      <input
                        type="text"
                        value={wonForm.lot_number}
                        onChange={(e) => setWonForm(s => ({ ...s, lot_number: e.target.value }))}
                        className="input w-full"
                        placeholder="LOT-12345"
                        data-testid="won-lot"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-1.5">
                        FX USD→EUR
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={wonForm.fx_usd_to_eur}
                        onChange={(e) => setWonForm(s => ({ ...s, fx_usd_to_eur: e.target.value }))}
                        className="input w-full"
                        placeholder={String(auctionDefaults.default_fx_usd_to_eur || 0.92)}
                        data-testid="won-fx"
                      />
                    </div>
                  </div>

                  <div className="border-t border-[#E4E4E7] pt-4">
                    <div className="text-xs uppercase tracking-wider text-[#71717A] mb-3">
                      Override default fees (опционально)
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-[#71717A] mb-1.5">
                          Auction fee, EUR
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={wonForm.auction_fee_eur}
                          onChange={(e) => setWonForm(s => ({ ...s, auction_fee_eur: e.target.value }))}
                          className="input w-full"
                          placeholder={String(auctionDefaults.auction_fee_eur || 500)}
                          data-testid="won-auction-fee"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#71717A] mb-1.5">
                          Delivery → Rotterdam, EUR
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={wonForm.delivery_eur}
                          onChange={(e) => setWonForm(s => ({ ...s, delivery_eur: e.target.value }))}
                          className="input w-full"
                          placeholder={String(auctionDefaults.delivery_to_rotterdam_eur || 800)}
                          data-testid="won-delivery"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#71717A] mb-1.5">
                          Service fee, EUR
                        </label>
                        <input
                          type="number"
                          step="1"
                          value={wonForm.service_fee_eur}
                          onChange={(e) => setWonForm(s => ({ ...s, service_fee_eur: e.target.value }))}
                          className="input w-full"
                          placeholder={String(auctionDefaults.service_fee_eur || 1000)}
                          data-testid="won-service-fee"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-1.5">
                      Заметка
                    </label>
                    <textarea
                      rows={2}
                      value={wonForm.note}
                      onChange={(e) => setWonForm(s => ({ ...s, note: e.target.value }))}
                      className="input w-full"
                      placeholder="Любой комментарий для истории"
                      data-testid="won-note"
                    />
                  </div>

                  <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-lg p-3 text-xs text-[#0C4A6E] flex gap-2">
                    <Info size={16} weight="duotone" className="flex-shrink-0 mt-0.5" />
                    <div>
                      <b>Что произойдёт:</b> deal.stage → auction_won; final contract
                      создастся в статусе <b>draft</b>; invoice <b>after_win_package</b>
                      создастся в статусе <b>pending</b>; уведомления уйдут клиенту
                      и менеджеру. Все действия идемпотентны — повторный клик
                      не создаст дубли.
                    </div>
                  </div>
                </>
              )}

              {wonResult && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#D1FAE5] border border-[#10B981] flex items-start gap-3">
                    <CheckCircle size={22} weight="fill" className="text-[#059669] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-[#065F46]">
                        {wonResult.idempotent ? 'Уже отмечено как auction_won' : 'auction_won зарегистрирован 🎉'}
                      </div>
                      <div className="text-sm text-[#065F46] opacity-90 mt-1">
                        Total: <b>€{wonResult.total_eur?.toLocaleString()}</b>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between p-3 bg-[#F9FAFB] rounded-lg">
                      <span className="text-[#71717A]">Final contract</span>
                      <span className="font-mono text-xs">{wonResult.contract?.id}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-[#F9FAFB] rounded-lg">
                      <span className="text-[#71717A]">Invoice (after_win_package)</span>
                      <span className="font-mono text-xs">{wonResult.invoice?.id}</span>
                    </div>
                    <div className="flex justify-between p-3 bg-[#F9FAFB] rounded-lg">
                      <span className="text-[#71717A]">Created now?</span>
                      <span className="font-medium">
                        contract: {wonResult.contract_created ? 'YES' : 'no (existing)'} ·
                        {' '}invoice: {wonResult.invoice_created ? 'YES' : 'no (existing)'}
                      </span>
                    </div>
                  </div>
                  <div className="border border-[#E4E4E7] rounded-xl overflow-hidden">
                    <div className="px-4 py-2 bg-[#F4F4F5] text-xs font-semibold uppercase tracking-wider text-[#71717A]">
                      Invoice items
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {(wonResult.items || []).map((it, idx) => (
                          <tr key={idx} className="border-t border-[#E4E4E7]">
                            <td className="px-4 py-2">{it.name}</td>
                            <td className={`px-4 py-2 text-right font-mono ${
                              it.amount < 0 ? 'text-[#059669]' : 'text-[#18181B]'
                            }`}>
                              {it.amount < 0 ? '−' : ''}€{Math.abs(it.amount).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-[#18181B] bg-[#F9FAFB]">
                          <td className="px-4 py-2 font-bold">Total</td>
                          <td className="px-4 py-2 text-right font-mono font-bold">
                            €{wonResult.total_eur?.toLocaleString()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-[#E4E4E7] flex justify-end gap-2">
              {!wonResult && (
                <>
                  <button
                    onClick={() => setShowWonModal(false)}
                    disabled={wonSubmitting}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-[#E4E4E7] hover:bg-[#F4F4F5]"
                    data-testid="won-cancel"
                  >
                    Отмена
                  </button>
                  <button
                    onClick={submitAuctionWon}
                    disabled={wonSubmitting}
                    className="px-5 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                    data-testid="won-submit"
                  >
                    <Trophy size={16} weight="fill" />
                    {wonSubmitting ? 'Обработка…' : 'Зарегистрировать выигрыш'}
                  </button>
                </>
              )}
              {wonResult && (
                <button
                  onClick={() => setShowWonModal(false)}
                  className="px-5 py-2 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white text-sm font-bold"
                  data-testid="won-close"
                >
                  Готово
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════ P0.3 TAB ═══════════════════════════════
function DepositV2Tab({ customers, deals, catalog }) {
  const [customerId, setCustomerId] = useState('');
  const [dealId, setDealId] = useState('');
  const [maxBidUsd, setMaxBidUsd] = useState(0);
  const [fxRate, setFxRate] = useState('');
  const [paidAmount, setPaidAmount] = useState(0);
  const [calc, setCalc] = useState(null);
  const [note, setNote] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [creating, setCreating] = useState(false);

  const rules = catalog?.deposit_rules || {};
  const defaultFx = rules.default_fx_usd_to_eur || 0.92;

  const doCalc = useCallback(async (bid, fx) => {
    if (!bid || bid <= 0) { setCalc(null); return; }
    try {
      const r = await axios.post(`${API_URL}/api/legal/deposit/calculate`, {
        max_bid_usd: Number(bid),
        ...(fx ? { fx_rate_usd_to_eur: Number(fx) } : {}),
      });
      setCalc(r.data);
    } catch (e) {
      setCalc(null);
    }
  }, []);

  useEffect(() => { doCalc(maxBidUsd, fxRate); }, [maxBidUsd, fxRate, doCalc]);

  const loadDeposits = useCallback(async () => {
    if (!customerId) { setDeposits([]); return; }
    try {
      // list by fetching individually: we don't have a list endpoint by customer,
      // but we can query /api/deposits (legacy) and /api/legal/deposits via history.
      // Simpler: fetch customer 360 which includes legal_deposits… but that's legacy.
      // For now, query each known deposit_id stored in the customer doc (if any),
      // otherwise show empty list hint.
      // Fallback: use legacy /api/deposits and filter client-side.
      const r = await axios.get(`${API_URL}/api/deposits?customerId=${customerId}`);
      setDeposits(r.data?.data || []);
    } catch {
      setDeposits([]);
    }
  }, [customerId]);

  useEffect(() => { loadDeposits(); }, [loadDeposits]);

  const create = async () => {
    if (!customerId) return toast.error('Выберите клиента');
    if (!maxBidUsd || maxBidUsd <= 0) return toast.error('Укажите max_bid_usd');
    setCreating(true);
    try {
      const payload = {
        customer_id: customerId,
        deal_id: dealId || null,
        max_bid_usd: Number(maxBidUsd),
        paid_amount_eur: Number(paidAmount) || 0,
        note: note || null,
        ...(fxRate ? { fx_rate_usd_to_eur: Number(fxRate) } : {}),
      };
      const r = await axios.post(`${API_URL}/api/legal/deposits`, payload);
      toast.success(`Депозит создан (${r.data.deposit.id})`);
      setMaxBidUsd(0); setFxRate(''); setPaidAmount(0); setNote('');
      loadDeposits();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Не удалось создать депозит');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT: Create + Calculator */}
      <div className="space-y-6">
        <div className="section-card">
          <div className="section-title-clean">
            <Coins size={22} weight="duotone" className="text-[#D97706]" />
            <span>Калькулятор обязательного депозита</span>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">max_bid_usd</label>
                <input
                  type="number"
                  value={maxBidUsd}
                  onChange={(e) => setMaxBidUsd(parseFloat(e.target.value) || 0)}
                  className="input w-full"
                  data-testid="dep-max-bid"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
                  fx (USD→EUR)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={String(defaultFx)}
                  className="input w-full"
                  data-testid="dep-fx-rate"
                />
              </div>
            </div>
            {calc && (
              <div className="bg-gradient-to-br from-[#FEF3C7] to-[#FDE68A] rounded-xl p-5 border border-[#D97706]/30">
                <div className="text-xs uppercase tracking-wider text-[#92400E] mb-1">
                  required_amount_eur
                </div>
                <div className="text-3xl font-bold text-[#78350F]">
                  € {Number(calc.required_amount_eur).toLocaleString('de-DE', { minimumFractionDigits: 2 })}
                </div>
                <div className="mt-3 text-xs text-[#78350F] space-y-0.5">
                  <div>floor: € {calc.min_floor_eur}</div>
                  <div>10% расчёт: € {Number(calc.pct_eur).toFixed(2)}</div>
                  <div>fx: {calc.fx_rate_usd_to_eur}</div>
                  <div>from_bid: {String(calc.calculated_from_bid)}</div>
                </div>
              </div>
            )}
            <div className="text-xs text-[#71717A] bg-[#F9FAFB] rounded-lg p-3 flex gap-2">
              <Info size={16} className="flex-shrink-0 mt-0.5" />
              <div>
                Правило: если <b>max_bid_usd &gt; ${rules.pct_threshold_usd}</b>,
                required = max(<b>€{rules.min_eur}</b>, {Math.round((rules.pct || 0) * 100)}% × bid × fx).
                Иначе — всегда минимум <b>€{rules.min_eur}</b>.
              </div>
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-title-clean">
            <FloppyDisk size={22} weight="duotone" className="text-[#4F46E5]" />
            <span>Создать депозит</span>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Клиент *</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                      className="input w-full" data-testid="dep-customer">
                <option value="">— выбрать —</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {(c.firstName || '') + ' ' + (c.lastName || '')} · {c.email || c.phone || c.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Сделка (опционально)</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)}
                      className="input w-full" data-testid="dep-deal">
                <option value="">— не привязывать —</option>
                {deals.filter(d => !customerId || d.customerId === customerId).map(d => (
                  <option key={d.id} value={d.id}>{d.title || d.vin || d.id}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
                Оплачено сейчас, EUR (может быть 0)
              </label>
              <input type="number" value={paidAmount}
                     onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)}
                     className="input w-full" data-testid="dep-paid-amount" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Заметка</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                        className="input w-full resize-none" data-testid="dep-note" />
            </div>
            <button onClick={create} disabled={creating || !customerId || !maxBidUsd}
                    className="btn-primary w-full" data-testid="dep-create-btn">
              <Coins size={18} weight="bold" />
              {creating ? 'Создание…' : 'Создать депозит'}
            </button>
          </div>
        </div>
      </div>

      {/* RIGHT: Existing deposits + actions */}
      <div className="section-card">
        <div className="section-title-clean">
          <ShieldCheck size={22} weight="duotone" className="text-[#059669]" />
          <span>Депозиты клиента</span>
        </div>
        {!customerId && (
          <p className="text-sm text-[#71717A]">
            Выберите клиента, чтобы увидеть его депозиты и действия.
          </p>
        )}
        {customerId && (
          <DepositsListForCustomer customerId={customerId} />
        )}
      </div>
    </div>
  );
}

function DepositsListForCustomer({ customerId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Try new /legal/deposits list by customer; backend exposes /legal/deposits/{id} only,
      // so we filter from customer 360 (if available) or from /api/deposits legacy.
      // For P0 we go via legacy endpoint since deposit IDs created via /legal/deposits also get
      // a dual-write; for safety we simply call the dedicated /api/deposits and filter.
      let r = null;
      try {
        r = await axios.get(`${API_URL}/api/customers/${customerId}/360`);
      } catch { r = null; }
      const arr = r?.data?.deposits || [];
      setItems(arr);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { reload(); }, [reload]);

  const confirm = async (id) => {
    try {
      await axios.put(`${API_URL}/api/legal/deposits/${id}/confirm-payment`, {});
      toast.success('Платёж подтверждён · запущен 30-дн. таймер');
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Не удалось подтвердить');
    }
  };
  const forfeitRequest = async (id) => {
    const reason = window.prompt('Причина сгорания депозита:', 'client refused after win');
    if (!reason) return;
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/forfeit/request`, { reason });
      toast.success('Запрошено сгорание → ожидает тимлида');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const forfeitTeamLead = async (id) => {
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/forfeit/teamlead-approve`);
      toast.success('Тимлид подтвердил → ждём admin');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const forfeitAdmin = async (id) => {
    if (!window.confirm('ФИНАЛЬНОЕ сгорание депозита. Действие необратимо. Продолжить?')) return;
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/forfeit/admin-finalize`);
      toast.success('Депозит сгорел');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  // ─── P1.1 Refund actions ────────────────────────────────────────────
  const refundRequest = async (id) => {
    const reason = window.prompt('Причина добровольного возврата:', 'client wants to cancel');
    if (!reason) return;
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/refund/request`, { reason });
      toast.success('Запрос на возврат создан → ожидает admin');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const refundApprove = async (id) => {
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/refund/approve`, { note: '' });
      toast.success('Возврат одобрен → можно execute');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const refundReject = async (id) => {
    const reason = window.prompt('Причина отказа в возврате:', '');
    if (!reason) return;
    try {
      await axios.post(`${API_URL}/api/legal/deposits/${id}/refund/reject`, { reason });
      toast.success('Возврат отклонён');
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const refundExecute = async (id, isStripe) => {
    if (!window.confirm(isStripe
      ? 'Выполнить Stripe Refund?'
      : 'Зафиксировать ручной банковский возврат?')) return;
    const body = isStripe
      ? { method: 'stripe' }
      : { method: 'bank_manual',
          bank_proof_url: window.prompt('URL подтверждения банк-перевода (опц.):', '') || null };
    try {
      const r = await axios.post(`${API_URL}/api/legal/deposits/${id}/refund/execute`, body);
      toast.success(`Возврат выполнен (${r.data.method})`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Ошибка'); }
  };
  const runScanNow = async () => {
    try {
      const r = await axios.post(`${API_URL}/api/legal/refund/scan-now`);
      toast.success(`Cron: promoted=${r.data.promoted} checked=${r.data.checked}`);
      reload();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Только admin'); }
  };

  if (loading) return <p className="text-sm text-[#71717A]">Загрузка…</p>;
  if (!items.length) return (
    <div>
      <button onClick={runScanNow} data-testid="scan-refund-now"
              className="mb-3 text-xs bg-[#4F46E5] text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
        <ArrowsClockwise size={14} weight="bold" /> Run refund cron now (admin)
      </button>
      <p className="text-sm text-[#71717A]">У клиента нет депозитов.</p>
    </div>
  );

  return (
    <div className="space-y-3 max-h-[640px] overflow-auto">
      <div className="flex justify-end">
        <button onClick={runScanNow} data-testid="scan-refund-now"
                className="text-xs bg-[#4F46E5] text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
          <ArrowsClockwise size={14} weight="bold" /> Run refund cron now
        </button>
      </div>
      {items.map(d => {
        const isLegal = !!d.required_amount_eur;
        const status = d.status || 'pending';
        const color = DEPOSIT_STATUS_COLORS[status] || 'bg-[#F4F4F5] text-[#71717A]';
        return (
          <div key={d.id} className="border border-[#E4E4E7] rounded-xl p-4" data-testid={`deposit-item-${d.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="font-semibold text-[#18181B]">#{(d.id || '').slice(-10)}</div>
                <div className="text-xs text-[#71717A]">
                  {d.createdAt && new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
                {status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              {isLegal ? (
                <>
                  <div><span className="text-[#71717A]">required EUR:</span> <b>€{d.required_amount_eur}</b></div>
                  <div><span className="text-[#71717A]">paid EUR:</span> <b>€{d.paid_amount_eur || 0}</b></div>
                  <div><span className="text-[#71717A]">max_bid:</span> <b>${d.max_bid_usd}</b></div>
                  <div><span className="text-[#71717A]">fx:</span> <b>{d.fx_rate_usd_to_eur}</b></div>
                </>
              ) : (
                <>
                  <div><span className="text-[#71717A]">amount:</span> <b>${d.amount || 0}</b></div>
                  <div><span className="text-[#71717A]">legacy</span></div>
                </>
              )}
            </div>
            {d.search_timer_deadline_at && (
              <div className="text-xs bg-[#E0E7FF] text-[#4F46E5] rounded-lg px-3 py-2 mb-3">
                30-дн. дедлайн поиска: <b>{new Date(d.search_timer_deadline_at).toLocaleString()}</b>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {isLegal && status === 'pending' && (
                <button onClick={() => confirm(d.id)}
                        data-testid={`confirm-dep-${d.id}`}
                        className="text-xs bg-[#059669] text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
                  <CheckCircle size={14} weight="bold" /> Confirm payment
                </button>
              )}
              {isLegal && status === 'paid_confirmed' && (
                <>
                  <button onClick={() => refundRequest(d.id)}
                          data-testid={`refund-req-${d.id}`}
                          className="text-xs bg-[#E0E7FF] text-[#4F46E5] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <ArrowsClockwise size={14} weight="bold" /> Voluntary refund
                  </button>
                  <button onClick={() => forfeitRequest(d.id)}
                          data-testid={`forfeit-req-${d.id}`}
                          className="text-xs bg-[#FED7AA] text-[#C2410C] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <Fire size={14} weight="bold" /> Request forfeit
                  </button>
                </>
              )}
              {isLegal && (status === 'refund_pending_30d' || status === 'refund_pending_voluntary') && (
                <>
                  <button onClick={() => refundApprove(d.id)}
                          data-testid={`refund-approve-${d.id}`}
                          className="text-xs bg-[#BFDBFE] text-[#1D4ED8] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <CheckCircle size={14} weight="bold" /> Approve refund
                  </button>
                  <button onClick={() => refundReject(d.id)}
                          data-testid={`refund-reject-${d.id}`}
                          className="text-xs bg-[#FEE2E2] text-[#DC2626] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    Reject refund
                  </button>
                </>
              )}
              {isLegal && status === 'refund_approved' && (
                <>
                  <button onClick={() => refundExecute(d.id, false)}
                          data-testid={`refund-exec-bank-${d.id}`}
                          className="text-xs bg-[#A7F3D0] text-[#065F46] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <CheckCircle size={14} weight="bold" /> Execute (bank manual)
                  </button>
                  <button onClick={() => refundExecute(d.id, true)}
                          data-testid={`refund-exec-stripe-${d.id}`}
                          className="text-xs bg-[#DDD6FE] text-[#5B21B6] px-3 py-1.5 rounded-lg flex items-center gap-1">
                    Execute (Stripe)
                  </button>
                </>
              )}
              {isLegal && status === 'forfeit_pending_teamlead' && (
                <button onClick={() => forfeitTeamLead(d.id)}
                        data-testid={`forfeit-tl-${d.id}`}
                        className="text-xs bg-[#FCA5A5] text-[#991B1B] px-3 py-1.5 rounded-lg flex items-center gap-1">
                  <ShieldCheck size={14} weight="bold" /> Team-lead approve
                </button>
              )}
              {isLegal && status === 'forfeit_pending_admin' && (
                <button onClick={() => forfeitAdmin(d.id)}
                        data-testid={`forfeit-admin-${d.id}`}
                        className="text-xs bg-[#1F2937] text-white px-3 py-1.5 rounded-lg flex items-center gap-1">
                  <Fire size={14} weight="fill" /> Admin finalize
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════ P0.4 TAB ═══════════════════════════════
function ContractV2Tab({ customers, deals, catalog }) {
  const [customerId, setCustomerId] = useState('');
  const [dealId, setDealId] = useState('');
  const [type, setType] = useState('deposit');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const create = async () => {
    if (!customerId) return toast.error('Выберите клиента');
    if (!dealId)     return toast.error('Выберите сделку');
    setCreating(true);
    try {
      const r = await axios.post(`${API_URL}/api/contracts2`, {
        customer_id: customerId, deal_id: dealId, type, notes, items,
      });
      toast.success(`Контракт создан (${r.data.contract.id})`);
      setNotes('');
      setRefresh(x => x + 1);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Не удалось создать');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="section-card">
        <div className="section-title-clean">
          <FileText size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Создать контракт v2</span>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {(catalog?.contract_types || ['deposit','final','purchase']).map(t => (
              <button key={t} onClick={() => setType(t)}
                      data-testid={`ctype-${t}`}
                      className={`px-3 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                        type === t
                          ? 'border-[#4F46E5] bg-[#E0E7FF] text-[#4F46E5]'
                          : 'border-[#E4E4E7] bg-white text-[#71717A] hover:border-[#4F46E5]/40'
                      }`}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Клиент *</label>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                    className="input w-full" data-testid="c2-customer">
              <option value="">— выбрать —</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>
                  {(c.firstName || '') + ' ' + (c.lastName || '')} · {c.email || c.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Сделка *</label>
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}
                    className="input w-full" data-testid="c2-deal">
              <option value="">— выбрать —</option>
              {deals.filter(d => !customerId || d.customerId === customerId).map(d => (
                <option key={d.id} value={d.id}>{d.title || d.vin || d.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">Заметки</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                      className="input w-full resize-none" data-testid="c2-notes" />
          </div>
          <div className="text-xs text-[#71717A] bg-[#F9FAFB] rounded-lg p-3 flex gap-2">
            <Info size={16} className="flex-shrink-0 mt-0.5" />
            <div>
              Для <b>type=deposit</b> клиент должен иметь все 7 юридических
              полей (таб <b>Customer Legal</b>).
            </div>
          </div>
          <button onClick={create} disabled={creating || !customerId || !dealId}
                  className="btn-primary w-full" data-testid="c2-create">
            <FileText size={18} weight="bold" />
            {creating ? 'Создание…' : 'Создать контракт'}
          </button>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title-clean">
          <ArrowsClockwise size={22} weight="duotone" className="text-[#059669]" />
          <span>Контракты сделки</span>
        </div>
        {!dealId ? (
          <p className="text-sm text-[#71717A]">Выберите сделку для списка контрактов.</p>
        ) : (
          <ContractsListForDeal dealId={dealId} catalog={catalog} refreshKey={refresh} />
        )}
      </div>
    </div>
  );
}

function ContractsListForDeal({ dealId, catalog, refreshKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const forwardMap = catalog?.contract_lifecycle_forward || {};

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/contracts2?deal_id=${dealId}&limit=50`);
      setItems(r.data?.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { reload(); }, [reload, refreshKey]);

  const transition = async (id, to) => {
    try {
      await axios.post(`${API_URL}/api/contracts2/${id}/transition`, { to });
      toast.success(`Переведено → ${to}`);
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Переход запрещён');
    }
  };

  const uploadSigned = async (id, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await axios.post(`${API_URL}/api/contracts2/${id}/upload-signed`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Подписанный PDF загружен');
      reload();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Ошибка загрузки');
    }
  };

  if (loading) return <p className="text-sm text-[#71717A]">Загрузка…</p>;
  if (!items.length) return <p className="text-sm text-[#71717A]">Контрактов ещё нет.</p>;

  return (
    <div className="space-y-3 max-h-[640px] overflow-auto">
      {items.map(c => {
        const color = LIFECYCLE_COLORS[c.lifecycle] || 'bg-[#F4F4F5] text-[#71717A]';
        const allowed = forwardMap[c.lifecycle] || [];
        return (
          <div key={c.id} className="border border-[#E4E4E7] rounded-xl p-4" data-testid={`contract-item-${c.id}`}>
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#18181B]">{(c.type || '').toUpperCase()}</span>
                  <span className="font-mono text-xs text-[#71717A]">#{(c.id || '').slice(-10)}</span>
                </div>
                <div className="text-xs text-[#71717A]">
                  {c.created_at && new Date(c.created_at).toLocaleString()}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
                {c.lifecycle}
              </span>
            </div>

            {c.signed_pdf_url && (
              <a href={`${API_URL}${c.signed_pdf_url}`} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 text-xs text-[#4F46E5] underline mb-2">
                <UploadSimple size={14} /> signed PDF
              </a>
            )}

            {allowed.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {allowed.map(t => (
                  <button key={t} onClick={() => transition(c.id, t)}
                          data-testid={`ctr-transition-${c.id}-${t}`}
                          className={`text-xs px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 ${
                            t === 'cancelled'
                              ? 'bg-[#FEE2E2] text-[#DC2626]'
                              : 'bg-[#4F46E5] text-white'
                          }`}>
                    <ArrowRight size={12} weight="bold" />
                    {t}
                  </button>
                ))}
              </div>
            )}

            <label className="inline-flex items-center gap-2 text-xs text-[#4F46E5] cursor-pointer">
              <UploadSimple size={14} />
              <span>Upload signed PDF</span>
              <input type="file" accept="application/pdf" className="hidden"
                     data-testid={`ctr-upload-${c.id}`}
                     onChange={(e) => uploadSigned(c.id, e.target.files?.[0])} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
//   P1.2  FINANCIALS  &  PAYMENTS  TAB
// ════════════════════════════════════════════════════════════════════════

const PAYMENT_METHOD_LABELS = {
  bank: { label: 'Bank', tint: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  stripe: { label: 'Stripe', tint: 'bg-[#E0E7FF] text-[#4F46E5]' },
  cash_off_books: { label: 'Cash 🔴', tint: 'bg-[#FEE2E2] text-[#DC2626]' },
  internal: { label: 'Internal', tint: 'bg-[#F4F4F5] text-[#71717A]' },
  other: { label: 'Other', tint: 'bg-[#FEF3C7] text-[#D97706]' },
};

const PAYMENT_STATUS_TINT = {
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  confirmed: 'bg-[#D1FAE5] text-[#059669]',
  voided: 'bg-[#F4F4F5] text-[#71717A] line-through',
};

const DEAL_PAYMENT_STATUS_TINT = {
  unpaid: 'bg-[#FEE2E2] text-[#DC2626]',
  partial: 'bg-[#FEF3C7] text-[#D97706]',
  paid: 'bg-[#D1FAE5] text-[#059669]',
  overpaid: 'bg-[#DBEAFE] text-[#1D4ED8]',
};

function fmt(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  return `€${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function FinancialsTab({ customers, deals }) {
  const [dealId, setDealId] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const triggerRefresh = () => setRefreshTick(t => t + 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="section-card lg:col-span-1">
        <div className="section-title-clean">
          <ListChecks size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Сделка</span>
        </div>
        <select
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
          data-testid="fin-deal-select"
          className="input w-full"
        >
          <option value="">— выбрать сделку —</option>
          {deals.map(d => (
            <option key={d.id} value={d.id}>
              {(d.title || d.vin || d.id)} · {STAGE_LABELS[d.stage] || d.stage || ''}
            </option>
          ))}
        </select>
        <div className="text-xs text-[#71717A] mt-3 bg-[#F9FAFB] rounded-lg p-3 flex gap-2">
          <Info size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            Здесь видно весь финансовый поток сделки: что должны заплатить
            (breakdown) и что уже пришло (payments). Поля
            <b> cash_off_books </b>помечены красным — это «серые» деньги.
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-6">
        {!dealId ? (
          <div className="section-card text-sm text-[#71717A] text-center py-12">
            Выберите сделку слева чтобы увидеть breakdown и платежи.
          </div>
        ) : (
          <>
            <BreakdownPanel
              dealId={dealId}
              refreshTick={refreshTick}
              onRefresh={triggerRefresh}
            />
            <PaymentsPanel
              dealId={dealId}
              refreshTick={refreshTick}
              onRefresh={triggerRefresh}
            />
          </>
        )}
      </div>
    </div>
  );
}

function BreakdownPanel({ dealId, refreshTick, onRefresh }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState(null);

  const reload = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/legal/deals/${dealId}/financials`);
      setItems(r.data?.data || []);
      setSummary(r.data?.summary || null);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || 'Не удалось загрузить breakdown');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { reload(); }, [reload, refreshTick]);

  const previewFinal = async () => {
    try {
      const tplR = await axios.get(`${API_URL}/api/admin/invoice-templates?kind=final&active=true`);
      const tpl = (tplR.data?.data || [])[0];
      if (!tpl) throw new Error('Нет активного template для kind=final');
      const aw = items.find(i => i.kind === 'after_win');
      const ctx = {};
      if (aw?.auction?.price_eur) ctx.vehicle_price_eur = aw.auction.price_eur;
      const r = await axios.post(
        `${API_URL}/api/admin/invoice-templates/${tpl.id}/preview`,
        { context: ctx, overrides: {} },
      );
      setPreviewData(r.data?.preview);
      setPreviewOpen(true);
    } catch (e) {
      toast.error(e?.response?.data?.detail || e.message || 'Preview failed');
    }
  };

  const generateFinal = async () => {
    setGenerating(true);
    try {
      const r = await axios.post(
        `${API_URL}/api/legal/deals/${dealId}/final-breakdown`,
        { context: {}, overrides: {} },
      );
      if (r.data?.idempotent) {
        toast.info('Final breakdown уже существует');
      } else {
        toast.success('Final breakdown создан');
      }
      setPreviewOpen(false);
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="section-card">
      <div className="flex items-start justify-between mb-4">
        <div className="section-title-clean !mb-0">
          <Receipt size={22} weight="duotone" className="text-[#4F46E5]" />
          <span>Financial Breakdown</span>
        </div>
        {summary?.final?.exists ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-[#F4F4F5] text-[#18181B] flex items-center gap-1">
            <Lock size={14} weight="bold" /> Final locked
          </span>
        ) : (
          <button
            onClick={previewFinal}
            data-testid="fin-preview-final"
            className="btn-primary !px-3 !py-2 !text-xs"
          >
            <Plus size={14} weight="bold" /> Generate Final Costs
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-[#71717A]">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[#71717A]">
          Breakdown'ов ещё нет. После <b>auction_won</b> будет создан after-win
          breakdown автоматически. Final — кнопкой выше.
        </p>
      ) : (
        <div className="space-y-4">
          {items.map(b => (
            <BreakdownCard key={b.id} bd={b} />
          ))}
        </div>
      )}

      {previewOpen && previewData && (
        <PreviewModal
          data={previewData}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={generateFinal}
          confirming={generating}
        />
      )}
    </div>
  );
}

function BreakdownCard({ bd }) {
  const totals = bd.totals || {};
  const items = bd.items || [];
  return (
    <div className="border border-[#E4E4E7] rounded-xl overflow-hidden"
         data-testid={`breakdown-card-${bd.id}`}>
      <div className="bg-[#F9FAFB] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#18181B] uppercase tracking-wide text-sm">
            {bd.kind === 'final' ? '🟣 Final' : '🟦 After-Win'}
          </span>
          <span className="font-mono text-xs text-[#71717A]">#{(bd.id || '').slice(-10)}</span>
          {bd.locked && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#F4F4F5] text-[#18181B] flex items-center gap-1">
              <Lock size={10} weight="bold" /> LOCKED
            </span>
          )}
        </div>
        <div className="text-xs text-[#71717A]">
          {bd.created_at && new Date(bd.created_at).toLocaleString()}
          {bd.fx_rate_snapshot && (
            <span className="ml-2 font-mono">FX {bd.fx_rate_snapshot}</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[#71717A] text-xs uppercase tracking-wide">
              <th className="text-left py-2 font-medium">Item</th>
              <th className="text-right py-2 font-medium">Amount</th>
              <th className="text-center py-2 font-medium">Method</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const meth = PAYMENT_METHOD_LABELS[it.payment_type] || PAYMENT_METHOD_LABELS.other;
              const isCash = it.payment_type === 'cash_off_books';
              const isNeg = Number(it.amount) < 0;
              return (
                <tr key={idx} className={`border-t border-[#F4F4F5] ${isCash ? 'bg-[#FEF2F2]/40' : ''}`}>
                  <td className="py-2 text-[#18181B]">{it.label || it.name || it.key}</td>
                  <td className={`py-2 text-right font-mono font-semibold ${
                    isNeg ? 'text-[#059669]' : isCash ? 'text-[#DC2626]' : 'text-[#18181B]'
                  }`}>{fmt(it.amount)}</td>
                  <td className="py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meth.tint}`}>
                      {meth.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 bg-[#F9FAFB] grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#71717A] font-medium">Total</div>
          <div className="font-mono font-bold text-[#18181B]">
            {fmt(totals.total_all ?? bd.amount)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#059669] font-medium">Official</div>
          <div className="font-mono font-bold text-[#059669]">{fmt(totals.total_official)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#DC2626] font-medium">Cash 🔴</div>
          <div className="font-mono font-bold text-[#DC2626]">{fmt(totals.total_cash)}</div>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ data, onCancel, onConfirm, confirming }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-auto"
           data-testid="fin-preview-modal">
        <div className="px-6 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#18181B]">Preview — Final Breakdown</h3>
          <button onClick={onCancel} className="p-1 hover:bg-[#F4F4F5] rounded">
            <IconX size={18} />
          </button>
        </div>
        <div className="p-6">
          <BreakdownCard bd={{
            id: 'preview', kind: 'final', locked: false,
            items: data.items, totals: data.totals,
            created_at: new Date().toISOString(),
          }} />
          <p className="text-xs text-[#71717A] mt-3 italic">
            Это предварительный расчёт. После подтверждения breakdown будет
            записан в БД с <b>locked=true</b> и больше изменить его нельзя.
          </p>
        </div>
        <div className="px-6 py-4 border-t border-[#E4E4E7] flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary" data-testid="fin-preview-cancel">Cancel</button>
          <button onClick={onConfirm} disabled={confirming}
                  className="btn-primary" data-testid="fin-preview-confirm">
            {confirming ? 'Saving…' : 'Confirm & Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaymentsPanel({ dealId, refreshTick, onRefresh }) {
  const [payments, setPayments] = useState([]);
  const [summary, setSummary] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const reload = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/legal/deals/${dealId}/payments`);
      setPayments(r.data?.payments || []);
      setSummary(r.data?.summary || null);
      setPaymentStatus(r.data?.payment_status || 'unpaid');
    } catch (e) {
      console.error(e);
      setPayments([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => { reload(); }, [reload, refreshTick]);

  const confirmPayment = async (id) => {
    try {
      await axios.post(`${API_URL}/api/legal/payments/${id}/confirm`, {});
      toast.success('Payment confirmed');
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Confirm failed');
    }
  };

  const voidPayment = async (id) => {
    const reason = window.prompt('Причина void платежа?', '');
    if (!reason || reason.length < 2) return;
    try {
      await axios.post(`${API_URL}/api/legal/payments/${id}/void`, { reason });
      toast.success('Payment voided');
      onRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Void failed (admin only)');
    }
  };

  const totalAll = summary?.total_all || 0;
  const paidTotal = summary?.paid_total || 0;
  const remaining = summary?.remaining || 0;
  const progress = totalAll > 0 ? Math.min(100, (paidTotal / totalAll) * 100) : 0;
  const statusTint = DEAL_PAYMENT_STATUS_TINT[paymentStatus] || DEAL_PAYMENT_STATUS_TINT.unpaid;

  return (
    <div className="section-card">
      <div className="flex items-start justify-between mb-4">
        <div className="section-title-clean !mb-0">
          <Wallet size={22} weight="duotone" className="text-[#059669]" />
          <span>Payments</span>
          <span className={`ml-2 px-3 py-1 rounded-full text-xs font-semibold uppercase ${statusTint}`}
                data-testid="fin-payment-status">
            {paymentStatus}
          </span>
        </div>
        <button onClick={() => setShowAdd(true)}
                data-testid="fin-add-payment"
                className="btn-primary !px-3 !py-2 !text-xs">
          <Plus size={14} weight="bold" /> Add Payment
        </button>
      </div>

      <div className="bg-[#F9FAFB] rounded-xl p-4 mb-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#71717A] font-medium">To pay</div>
          <div className="font-mono font-bold text-[#18181B]">{fmt(totalAll)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#059669] font-medium">Paid</div>
          <div className="font-mono font-bold text-[#059669]" data-testid="fin-paid-total">{fmt(paidTotal)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#71717A] font-medium">Remaining</div>
          <div className={`font-mono font-bold ${
            remaining < 0 ? 'text-[#1D4ED8]' : remaining === 0 ? 'text-[#059669]' : 'text-[#DC2626]'
          }`}>{fmt(remaining)}</div>
        </div>
        <div className="col-span-3">
          <div className="h-2 bg-[#E4E4E7] rounded-full overflow-hidden">
            <div className={`h-full transition-all ${
              paymentStatus === 'paid' ? 'bg-[#059669]'
              : paymentStatus === 'overpaid' ? 'bg-[#1D4ED8]'
              : paymentStatus === 'partial' ? 'bg-[#D97706]'
              : 'bg-[#71717A]'
            }`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[#71717A]">Загрузка…</p>
      ) : payments.length === 0 ? (
        <p className="text-sm text-[#71717A]">Платежей ещё нет.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[#71717A] text-xs uppercase tracking-wide border-b border-[#E4E4E7]">
                <th className="text-left py-2 px-2 font-medium">Date</th>
                <th className="text-right py-2 px-2 font-medium">Amount</th>
                <th className="text-center py-2 px-2 font-medium">Method</th>
                <th className="text-center py-2 px-2 font-medium">Status</th>
                <th className="text-center py-2 px-2 font-medium">Proof</th>
                <th className="text-right py-2 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const meth = PAYMENT_METHOD_LABELS[p.method] || PAYMENT_METHOD_LABELS.other;
                const stTint = PAYMENT_STATUS_TINT[p.status] || '';
                const isCash = p.method === 'cash_off_books';
                return (
                  <tr key={p.id}
                      className={`border-b border-[#F4F4F5] ${isCash ? 'bg-[#FEF2F2]/40' : ''} ${
                        p.status === 'voided' ? 'opacity-50' : ''
                      }`}
                      data-testid={`payment-row-${p.id}`}>
                    <td className="py-2 px-2 text-xs text-[#71717A]">
                      {new Date(p.created_at).toLocaleString()}
                    </td>
                    <td className={`py-2 px-2 text-right font-mono font-semibold ${
                      isCash ? 'text-[#DC2626]' : 'text-[#18181B]'
                    }`}>{fmt(p.amount)}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${meth.tint}`}>
                        {meth.label}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${stTint}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      {p.proof_url ? (
                        <a href={p.proof_url} target="_blank" rel="noreferrer"
                           className="text-[#4F46E5] underline text-xs">link</a>
                      ) : <span className="text-[#71717A] text-xs">—</span>}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {p.status === 'pending' && (
                        <button onClick={() => confirmPayment(p.id)}
                                data-testid={`fin-confirm-${p.id}`}
                                className="text-xs px-2.5 py-1 rounded-lg bg-[#059669] text-white font-semibold mr-1">
                          Confirm
                        </button>
                      )}
                      {p.status !== 'voided' && (
                        <button onClick={() => voidPayment(p.id)}
                                data-testid={`fin-void-${p.id}`}
                                className="text-xs px-2.5 py-1 rounded-lg bg-[#FEE2E2] text-[#DC2626] font-semibold">
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <AddPaymentModal
          dealId={dealId}
          onCancel={() => setShowAdd(false)}
          onCreated={() => { setShowAdd(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

function AddPaymentModal({ dealId, onCancel, onCreated }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [proofUrl, setProofUrl] = useState('');
  const [note, setNote] = useState('');
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast.error('Amount must be > 0');
      return;
    }
    setSubmitting(true);
    try {
      const r = await axios.post(`${API_URL}/api/legal/deals/${dealId}/payments`, {
        amount: amt, method, currency: 'EUR',
        proof_url: proofUrl || null,
        note: note || null,
        auto_confirm: autoConfirm,
      });
      const warns = r.data?.warnings || [];
      if (warns.length) {
        toast.warning(warns.join('; '));
      } else {
        toast.success(r.data?.payment?.status === 'confirmed' ? 'Payment confirmed' : 'Payment created (pending)');
      }
      onCreated();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
           data-testid="fin-add-payment-modal">
        <div className="px-6 py-4 border-b border-[#E4E4E7] flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#18181B]">Add Payment</h3>
          <button onClick={onCancel} className="p-1 hover:bg-[#F4F4F5] rounded">
            <IconX size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
              Amount (EUR) *
            </label>
            <input type="number" step="0.01" min="0" value={amount}
                   onChange={(e) => setAmount(e.target.value)}
                   data-testid="fin-pay-amount"
                   className="input w-full" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
              Method *
            </label>
            <div className="grid grid-cols-3 gap-2">
              {['bank', 'stripe', 'cash_off_books'].map(m => {
                const meta = PAYMENT_METHOD_LABELS[m];
                return (
                  <button key={m}
                          type="button"
                          onClick={() => setMethod(m)}
                          data-testid={`fin-method-${m}`}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${
                            method === m
                              ? 'border-[#4F46E5] bg-[#E0E7FF] text-[#4F46E5]'
                              : 'border-[#E4E4E7] bg-white text-[#71717A] hover:border-[#4F46E5]/40'
                          }`}>
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
              Proof URL {method === 'bank' ? '(recommended)' : '(optional)'}
            </label>
            <input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)}
                   data-testid="fin-pay-proof"
                   className="input w-full" placeholder="https://…" />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#71717A] mb-2">
              Note
            </label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                      className="input w-full resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoConfirm}
                   onChange={(e) => setAutoConfirm(e.target.checked)}
                   data-testid="fin-pay-auto-confirm" />
            <span className="text-[#18181B]">Auto-confirm (admin only)</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-[#E4E4E7] flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={submitting || !amount}
                  className="btn-primary" data-testid="fin-pay-submit">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

