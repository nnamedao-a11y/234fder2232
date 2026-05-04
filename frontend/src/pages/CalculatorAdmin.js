/**
 * Calculator Admin Page
 * 
 * Повна панель керування ставками, комісіями та hidden fee
 * Master Admin може міняти всі параметри без коду
 * 
 * Updates:
 * - Live Preview перенесено вгору
 * - Блоки можуть згортатись/розгортатись
 * - Профіль в режимі перегляду з можливістю редагування
 */

import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_URL } from '../App';
import { toast } from 'sonner';
import { useLang } from '../i18n';
import CustomSelect from '../components/ui/CustomSelect';
import { 
  Gear, 
  Calculator, 
  Truck, 
  Anchor, 
  Airplane,
  CurrencyDollar,
  Eye,
  EyeSlash,
  FloppyDisk,
  Trash,
  Plus,
  ArrowsClockwise,
  ChartLine,
  CaretDown,
  CaretUp,
  PencilSimple,
  X
} from '@phosphor-icons/react';
import { motion, AnimatePresence } from 'framer-motion';

const CalculatorAdmin = () => {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // Data states
  const [profile, setProfile] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [auctionRules, setAuctionRules] = useState([]);
  const [stats, setStats] = useState(null);
  
  // Collapsible states - all collapsed by default
  const [expandedSections, setExpandedSections] = useState({
    profile: false,
    usaInland: false,
    ocean: false,
    euDelivery: false,
    auctionRules: false
  });
  
  // Profile editing mode
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedProfile, setEditedProfile] = useState(null);
  
  // Preview state
  const [previewInput, setPreviewInput] = useState({
    price: 15000,
    port: 'NJ',
    vehicleType: 'sedan'
  });
  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    loadAllData();
  }, []);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [profileRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/api/calculator/config/profile`),
        axios.get(`${API_URL}/api/calculator/admin/stats`)
      ]);
      
      setProfile(profileRes.data);
      setEditedProfile(profileRes.data);
      setStats(statsRes.data);
      
      if (profileRes.data?.code) {
        const [routesRes, rulesRes] = await Promise.all([
          axios.get(`${API_URL}/api/calculator/config/routes/${profileRes.data.code}`),
          axios.get(`${API_URL}/api/calculator/config/auction-fees/${profileRes.data.code}`)
        ]);
        setRoutes(routesRes.data);
        setAuctionRules(rulesRes.data);
      }
    } catch (err) {
      toast.error('Помилка завантаження даних');
    } finally {
      setLoading(false);
    }
  };

  // Group routes by type
  const groupedRoutes = useMemo(() => {
    return {
      usa_inland: routes.filter(r => r.rateType === 'usa_inland'),
      ocean: routes.filter(r => r.rateType === 'ocean'),
      eu_delivery: routes.filter(r => r.rateType === 'eu_delivery')
    };
  }, [routes]);

  // Start editing profile
  const startEditingProfile = () => {
    setEditedProfile({...profile});
    setIsEditingProfile(true);
    setExpandedSections(prev => ({...prev, profile: true}));
  };

  // Cancel editing
  const cancelEditingProfile = () => {
    setEditedProfile(profile);
    setIsEditingProfile(false);
  };

  // Save profile
  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await axios.patch(`${API_URL}/api/calculator/config/profile`, editedProfile);
      setProfile(res.data);
      setEditedProfile(res.data);
      setIsEditingProfile(false);
      toast.success('Профіль збережено');
    } catch (err) {
      toast.error('Помилка збереження профілю');
    } finally {
      setSaving(false);
    }
  };

  // Save route rate
  const saveRoute = async (route) => {
    try {
      const res = await axios.post(`${API_URL}/api/calculator/config/routes`, route);
      setRoutes(prev => {
        const idx = prev.findIndex(r => r._id === res.data._id);
        if (idx >= 0) {
          const clone = [...prev];
          clone[idx] = res.data;
          return clone;
        }
        return [...prev, res.data];
      });
      toast.success('Ставку збережено');
    } catch (err) {
      toast.error('Помилка збереження ставки');
    }
  };

  // Delete route
  const deleteRoute = async (id) => {
    if (!window.confirm('Видалити цю ставку?')) return;
    try {
      await axios.delete(`${API_URL}/api/calculator/config/routes/${id}`);
      setRoutes(prev => prev.filter(r => r._id !== id));
      toast.success('Ставку видалено');
    } catch (err) {
      toast.error('Помилка видалення');
    }
  };

  // Save auction rule
  const saveAuctionRule = async (rule) => {
    try {
      const res = await axios.post(`${API_URL}/api/calculator/config/auction-fees`, rule);
      setAuctionRules(prev => {
        const idx = prev.findIndex(r => r._id === res.data._id);
        if (idx >= 0) {
          const clone = [...prev];
          clone[idx] = res.data;
          return clone.sort((a, b) => a.minBid - b.minBid);
        }
        return [...prev, res.data].sort((a, b) => a.minBid - b.minBid);
      });
      toast.success('Правило збережено');
    } catch (err) {
      toast.error('Помилка збереження правила');
    }
  };

  // Delete auction rule
  const deleteAuctionRule = async (id) => {
    if (!window.confirm('Видалити це правило?')) return;
    try {
      await axios.delete(`${API_URL}/api/calculator/config/auction-fees/${id}`);
      setAuctionRules(prev => prev.filter(r => r._id !== id));
      toast.success('Правило видалено');
    } catch (err) {
      toast.error('Помилка видалення');
    }
  };

  // Run preview calculation
  const runPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/calculator/calculate`, previewInput);
      setPreviewResult(res.data);
    } catch (err) {
      toast.error('Помилка розрахунку');
    } finally {
      setPreviewLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#18181B] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-[#71717A]">Завантаження...</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div 
      className="space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      data-testid="calculator-admin-page"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]" style={{ fontFamily: 'Mazzard, Mazzard H, Mazzard M, system-ui, sans-serif' }}>
            Налаштування калькулятора
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            Керування ставками, комісіями та hidden fee
          </p>
        </div>
        <button
          onClick={loadAllData}
          className="flex items-center gap-2 px-4 py-2 border border-[#E4E4E7] rounded-xl hover:bg-[#F4F4F5] transition-colors"
          data-testid="refresh-btn"
        >
          <ArrowsClockwise size={18} />
          Оновити
        </button>
      </div>

      {/* Stats - compact */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard icon={ChartLine} label="Розрахунків" value={stats.totalQuotes} compact />
          <StatCard icon={CurrencyDollar} label="Сума" value={`$${(stats.totalQuotedValue/1000).toFixed(0)}k`} compact />
          <StatCard icon={Gear} label="Профілів" value={stats.profiles} compact />
          <StatCard icon={Calculator} label="Активний" value={stats.activeProfile} compact />
        </div>
      )}

      {/* Live Preview - MOVED TO TOP */}
      <div className="card p-4 space-y-4 bg-gradient-to-r from-[#F0FDF4] to-[#ECFDF5] border-[#86EFAC]" data-testid="preview-section">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#059669] rounded-lg">
            <Eye size={20} className="text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-[#18181B]">Live Preview</h2>
            <p className="text-xs text-[#71717A]">Тестовий розрахунок з поточними налаштуваннями</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <NumberField 
            label="Ціна авто ($)" 
            value={previewInput.price} 
            onChange={(v) => setPreviewInput({...previewInput, price: v})}
          />
          <CustomSelect
            label="Порт"
            value={previewInput.port}
            onChange={(val) => setPreviewInput({...previewInput, port: val})}
            options={[
              { value: 'NJ', label: 'New Jersey' },
              { value: 'GA', label: 'Georgia' },
              { value: 'TX', label: 'Texas' },
              { value: 'CA', label: 'California' },
            ]}
            testId="preview-port"
          />
          <CustomSelect
            label="Тип авто"
            value={previewInput.vehicleType}
            onChange={(val) => setPreviewInput({...previewInput, vehicleType: val})}
            options={[
              { value: 'sedan', label: 'Sedan' },
              { value: 'suv', label: 'SUV' },
              { value: 'bigSUV', label: 'Big SUV' },
              { value: 'pickup', label: 'Pickup' },
            ]}
            testId="preview-vehicle-type"
          />
          <div className="flex items-end">
            <button
              onClick={runPreview}
              disabled={previewLoading}
              className="btn-primary w-full flex items-center justify-center gap-2"
              data-testid="run-preview-btn"
            >
              <Calculator size={18} />
              {previewLoading ? 'Розрахунок...' : 'Розрахувати'}
            </button>
          </div>
        </div>

        {previewResult && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-[#86EFAC]">
            {/* Client View */}
            <div className="bg-white border border-[#E4E4E7] rounded-xl p-3">
              <h3 className="font-semibold text-[#18181B] mb-2 flex items-center gap-2 text-sm">
                <Eye size={14} />
                Client View
              </h3>
              <div className="space-y-1 text-sm max-h-[150px] overflow-y-auto">
                {previewResult.formattedBreakdown?.map((item, i) => (
                  <div key={i} className="flex justify-between py-0.5 border-b border-[#F4F4F5]">
                    <span className="text-[#71717A] text-xs">{item.label}</span>
                    <span className="font-medium text-xs">${item.value?.toLocaleString()}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t-2 border-[#18181B] flex justify-between items-center">
                <span className="font-semibold text-sm">Клієнт бачить:</span>
                <span className="font-bold text-lg text-[#059669]" data-testid="preview-visible-total">
                  ${previewResult.totals?.visible?.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Manager View */}
            <div className="bg-[#F5F3FF] border border-[#7C3AED] rounded-xl p-3">
              <h3 className="font-semibold text-[#18181B] mb-2 flex items-center gap-2 text-sm">
                <EyeSlash size={14} className="text-[#7C3AED]" />
                Manager View
              </h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between py-0.5">
                  <span className="text-[#71717A] text-xs">Visible Total</span>
                  <span className="font-medium text-xs">${previewResult.totals?.visible?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-[#71717A] text-xs">Hidden Fee</span>
                  <span className="font-medium text-[#7C3AED] text-xs">+${previewResult.hiddenBreakdown?.hiddenFee?.toLocaleString()}</span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t-2 border-[#7C3AED] flex justify-between items-center">
                <span className="font-semibold text-sm">Менеджер:</span>
                <span className="font-bold text-lg text-[#7C3AED]" data-testid="preview-internal-total">
                  ${previewResult.totals?.internal?.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 p-1.5 bg-white rounded-lg">
                <div className="flex justify-between text-xs">
                  <span className="text-[#71717A]">Margin:</span>
                  <span className="font-semibold text-[#059669]">
                    ${previewResult.margin?.controllableMargin?.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Profile Settings - COLLAPSIBLE with EDIT MODE */}
      {profile && (
        <CollapsibleSection
          title="Налаштування профілю"
          subtitle={`${profile.name} • ${profile.destinationCountry}`}
          icon={Gear}
          isExpanded={expandedSections.profile}
          onToggle={() => toggleSection('profile')}
          headerAction={
            !isEditingProfile && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEditingProfile();
                }}
                className="p-2 hover:bg-[#F4F4F5] rounded-lg transition-colors"
                title="Редагувати"
              >
                <PencilSimple size={16} className="text-[#71717A]" />
              </button>
            )
          }
        >
          {isEditingProfile ? (
            // Edit Mode
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                <InputField 
                  label="Назва профілю" 
                  value={editedProfile?.name || ''} 
                  onChange={(v) => setEditedProfile({...editedProfile, name: v})}
                />
                <InputField 
                  label="Країна" 
                  value={editedProfile?.destinationCountry || ''} 
                  onChange={(v) => setEditedProfile({...editedProfile, destinationCountry: v})}
                />
                <InputField 
                  label="Валюта" 
                  value={editedProfile?.currency || ''} 
                  onChange={(v) => setEditedProfile({...editedProfile, currency: v})}
                />
                <NumberField 
                  label="Insurance Rate (%)" 
                  value={(editedProfile?.insuranceRate || 0) * 100} 
                  onChange={(v) => setEditedProfile({...editedProfile, insuranceRate: v / 100})}
                />
                <NumberField 
                  label="USA Handling Fee ($)" 
                  value={editedProfile?.usaHandlingFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, usaHandlingFee: v})}
                />
                <NumberField 
                  label="Bank Fee ($)" 
                  value={editedProfile?.bankFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, bankFee: v})}
                />
                <NumberField 
                  label="EU Port Handling ($)" 
                  value={editedProfile?.euPortHandlingFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, euPortHandlingFee: v})}
                />
                <NumberField 
                  label="Company Fee ($)" 
                  value={editedProfile?.companyFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, companyFee: v})}
                />
                <NumberField 
                  label="Customs Rate (%)" 
                  value={(editedProfile?.customsRate || 0) * 100} 
                  onChange={(v) => setEditedProfile({...editedProfile, customsRate: v / 100})}
                />
                <NumberField 
                  label="Documentation Fee ($)" 
                  value={editedProfile?.documentationFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, documentationFee: v})}
                />
                <NumberField 
                  label="Title Fee ($)" 
                  value={editedProfile?.titleFee || 0} 
                  onChange={(v) => setEditedProfile({...editedProfile, titleFee: v})}
                />
              </div>

              {/* Hidden Fees Section */}
              <div className="pt-3 border-t border-[#E4E4E7]">
                <h3 className="font-medium text-[#18181B] mb-3 flex items-center gap-2 text-sm">
                  <EyeSlash size={16} className="text-[#7C3AED]" />
                  Hidden Fees (Margin Control)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <NumberField 
                    label="Поріг ціни ($)" 
                    value={editedProfile?.hiddenFeeThreshold || 5000} 
                    onChange={(v) => setEditedProfile({...editedProfile, hiddenFeeThreshold: v})}
                  />
                  <NumberField 
                    label="Fee нижче порогу ($)" 
                    value={editedProfile?.hiddenFeeUnder || 700} 
                    onChange={(v) => setEditedProfile({...editedProfile, hiddenFeeUnder: v})}
                  />
                  <NumberField 
                    label="Fee вище порогу ($)" 
                    value={editedProfile?.hiddenFeeOver || 1400} 
                    onChange={(v) => setEditedProfile({...editedProfile, hiddenFeeOver: v})}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2"
                  data-testid="save-profile-btn"
                >
                  <FloppyDisk size={16} />
                  {saving ? 'Збереження...' : 'Зберегти'}
                </button>
                <button
                  onClick={cancelEditingProfile}
                  className="px-4 py-2 border border-[#E4E4E7] rounded-xl hover:bg-[#F4F4F5] flex items-center gap-2"
                >
                  <X size={16} />
                  Скасувати
                </button>
              </div>
            </div>
          ) : (
            // View Mode - Compact display
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                <ViewField label="Назва" value={profile.name} />
                <ViewField label="Країна" value={profile.destinationCountry} />
                <ViewField label="Валюта" value={profile.currency} />
                <ViewField label="Insurance" value={`${(profile.insuranceRate * 100).toFixed(1)}%`} />
                <ViewField label="USA Handling" value={`$${profile.usaHandlingFee}`} />
                <ViewField label="Bank Fee" value={`$${profile.bankFee}`} />
                <ViewField label="EU Port" value={`$${profile.euPortHandlingFee}`} />
                <ViewField label="Company Fee" value={`$${profile.companyFee}`} />
                <ViewField label="Customs" value={`${(profile.customsRate * 100).toFixed(1)}%`} />
                <ViewField label="Documentation" value={`$${profile.documentationFee}`} />
                <ViewField label="Title Fee" value={`$${profile.titleFee}`} />
              </div>
              <div className="pt-2 border-t border-[#E4E4E7]">
                <p className="text-xs text-[#71717A] mb-2">Hidden Fees:</p>
                <div className="flex gap-4 flex-wrap">
                  <span className="text-sm">Поріг: <strong>${profile.hiddenFeeThreshold}</strong></span>
                  <span className="text-sm">Нижче: <strong className="text-[#059669]">${profile.hiddenFeeUnder}</strong></span>
                  <span className="text-sm">Вище: <strong className="text-[#7C3AED]">${profile.hiddenFeeOver}</strong></span>
                </div>
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {/* USA Inland Rates - COLLAPSIBLE */}
      <CollapsibleSection
        title="USA Inland Delivery"
        subtitle={`${groupedRoutes.usa_inland.length} ставок`}
        icon={Truck}
        isExpanded={expandedSections.usaInland}
        onToggle={() => toggleSection('usaInland')}
      >
        <RateSectionContent
          rates={groupedRoutes.usa_inland}
          profileCode={profile?.code}
          rateType="usa_inland"
          onSave={saveRoute}
          onDelete={deleteRoute}
          locationField="originCode"
        />
      </CollapsibleSection>

      {/* Ocean Rates - COLLAPSIBLE */}
      <CollapsibleSection
        title="Ocean Freight"
        subtitle={`${groupedRoutes.ocean.length} ставок`}
        icon={Anchor}
        isExpanded={expandedSections.ocean}
        onToggle={() => toggleSection('ocean')}
      >
        <RateSectionContent
          rates={groupedRoutes.ocean}
          profileCode={profile?.code}
          rateType="ocean"
          onSave={saveRoute}
          onDelete={deleteRoute}
          locationField="originCode"
        />
      </CollapsibleSection>

      {/* EU Delivery Rates - COLLAPSIBLE */}
      <CollapsibleSection
        title="EU Delivery"
        subtitle={`${groupedRoutes.eu_delivery.length} ставок`}
        icon={Airplane}
        isExpanded={expandedSections.euDelivery}
        onToggle={() => toggleSection('euDelivery')}
      >
        <RateSectionContent
          rates={groupedRoutes.eu_delivery}
          profileCode={profile?.code}
          rateType="eu_delivery"
          onSave={saveRoute}
          onDelete={deleteRoute}
          locationField="destinationCode"
        />
      </CollapsibleSection>

      {/* Auction Fee Rules - COLLAPSIBLE */}
      <CollapsibleSection
        title="Auction Fee Rules"
        subtitle={`${auctionRules.length} правил`}
        icon={CurrencyDollar}
        isExpanded={expandedSections.auctionRules}
        onToggle={() => toggleSection('auctionRules')}
      >
        <div className="overflow-x-auto">
          <table className="table-premium w-full min-w-[400px]" data-testid="auction-rules-table">
            <thead>
              <tr>
                <th>Min ($)</th>
                <th>Max ($)</th>
                <th>Fee ($)</th>
                <th className="text-right">Дії</th>
              </tr>
            </thead>
            <tbody>
              {auctionRules.map(rule => (
                <AuctionRuleRow
                  key={rule._id}
                  rule={rule}
                  profileCode={profile?.code}
                  onSave={saveAuctionRule}
                  onDelete={deleteAuctionRule}
                />
              ))}
              <NewAuctionRuleRow
                profileCode={profile?.code}
                onSave={saveAuctionRule}
              />
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
    </motion.div>
  );
};

// Collapsible Section Component
const CollapsibleSection = ({ title, subtitle, icon: Icon, isExpanded, onToggle, headerAction, children }) => (
  <div className="card overflow-hidden" data-testid={`section-${title.toLowerCase().replace(/\s/g, '-')}`}>
    <button
      onClick={onToggle}
      className="w-full p-4 flex items-center justify-between hover:bg-[#FAFAFA] transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-[#F4F4F5] rounded-lg">
          <Icon size={18} className="text-[#18181B]" />
        </div>
        <div className="text-left">
          <h2 className="font-semibold text-[#18181B] text-sm">{title}</h2>
          <p className="text-xs text-[#71717A]">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {headerAction}
        {isExpanded ? (
          <CaretUp size={18} className="text-[#71717A]" />
        ) : (
          <CaretDown size={18} className="text-[#71717A]" />
        )}
      </div>
    </button>
    <AnimatePresence>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="p-4 pt-0 border-t border-[#E4E4E7]">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// Stat Card Component - compact version
const StatCard = ({ icon: Icon, label, value, compact }) => (
  <div className={`kpi-card ${compact ? 'p-3' : ''}`}>
    <div className="flex items-center gap-2">
      <Icon size={compact ? 16 : 24} weight="duotone" className="text-[#18181B]" />
      <div>
        <div className={`font-bold text-[#18181B] ${compact ? 'text-base' : 'text-xl'}`}>{value}</div>
        <div className="text-xs text-[#71717A]">{label}</div>
      </div>
    </div>
  </div>
);

// View Field Component (read-only)
const ViewField = ({ label, value }) => (
  <div className="bg-[#F4F4F5] rounded-lg px-3 py-2">
    <div className="text-[10px] text-[#71717A] uppercase tracking-wider">{label}</div>
    <div className="font-medium text-sm text-[#18181B]">{value}</div>
  </div>
);

// Input Field Component
const InputField = ({ label, value, onChange }) => (
  <div>
    <label className="block text-xs font-medium text-[#71717A] uppercase tracking-wider mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
    />
  </div>
);

// Number Field Component
const NumberField = ({ label, value, onChange }) => (
  <div>
    <label className="block text-xs font-medium text-[#71717A] uppercase tracking-wider mb-1">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="input"
    />
  </div>
);

// Rate Section Content Component
const RateSectionContent = ({ rates, profileCode, rateType, onSave, onDelete, locationField }) => {
  const vehicleTypes = [
    { value: 'sedan', label: 'Sedan' },
    { value: 'suv', label: 'SUV' },
    { value: 'bigSUV', label: 'Big SUV' },
    { value: 'pickup', label: 'Pickup' }
  ];
  const [newRate, setNewRate] = useState({ location: '', vehicleType: 'sedan', amount: 0 });

  const addNewRate = () => {
    if (!newRate.location || !newRate.amount) {
      toast.error('Заповніть всі поля');
      return;
    }
    onSave({
      profileCode,
      rateType,
      [locationField]: newRate.location,
      vehicleType: newRate.vehicleType,
      amount: newRate.amount
    });
    setNewRate({ location: '', vehicleType: 'sedan', amount: 0 });
  };

  return (
    <div className="overflow-x-auto">
      <table className="table-premium w-full min-w-[450px]">
        <thead>
          <tr>
            <th>{locationField === 'originCode' ? 'Port' : 'Destination'}</th>
            <th>Vehicle Type</th>
            <th>Amount ($)</th>
            <th className="text-right">Дії</th>
          </tr>
        </thead>
        <tbody>
          {rates.map(rate => (
            <RateRow
              key={rate._id}
              rate={rate}
              profileCode={profileCode}
              rateType={rateType}
              locationField={locationField}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
          {/* New Rate Row */}
          <tr className="bg-[#F4F4F5]">
            <td>
              <input
                type="text"
                value={newRate.location}
                onChange={(e) => setNewRate({...newRate, location: e.target.value})}
                placeholder="NJ, GA..."
                className="input w-full max-w-[80px]"
              />
            </td>
            <td className="overflow-visible">
              <CustomSelect
                value={newRate.vehicleType}
                onChange={(val) => setNewRate({...newRate, vehicleType: val})}
                options={vehicleTypes}
                placeholder="Sedan"
              />
            </td>
            <td>
              <input
                type="number"
                value={newRate.amount}
                onChange={(e) => setNewRate({...newRate, amount: Number(e.target.value)})}
                className="input w-full max-w-[80px]"
              />
            </td>
            <td>
              <button
                onClick={addNewRate}
                className="p-2 bg-[#18181B] text-white rounded-lg hover:bg-[#27272A]"
              >
                <Plus size={14} />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Rate Row Component
const RateRow = ({ rate, profileCode, rateType, locationField, onSave, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [editedAmount, setEditedAmount] = useState(rate.amount);

  const handleSave = () => {
    onSave({
      ...rate,
      profileCode,
      rateType,
      amount: editedAmount
    });
    setEditing(false);
  };

  return (
    <tr>
      <td className="font-mono text-sm">{rate[locationField] || '—'}</td>
      <td className="text-sm">{rate.vehicleType}</td>
      <td>
        {editing ? (
          <input
            type="number"
            value={editedAmount}
            onChange={(e) => setEditedAmount(Number(e.target.value))}
            className="input w-20"
            autoFocus
          />
        ) : (
          <span className="font-medium text-sm">${rate.amount?.toLocaleString()}</span>
        )}
      </td>
      <td>
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <button onClick={handleSave} className="p-1.5 bg-[#059669] text-white rounded-lg">
              <FloppyDisk size={12} />
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="p-1.5 hover:bg-[#F4F4F5] rounded-lg">
              <Gear size={12} className="text-[#71717A]" />
            </button>
          )}
          <button onClick={() => onDelete(rate._id)} className="p-1.5 hover:bg-[#FEE2E2] rounded-lg">
            <Trash size={12} className="text-[#DC2626]" />
          </button>
        </div>
      </td>
    </tr>
  );
};

// Auction Rule Row Component
const AuctionRuleRow = ({ rule, profileCode, onSave, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [editedFee, setEditedFee] = useState(rule.fee);

  const handleSave = () => {
    onSave({
      ...rule,
      profileCode,
      fee: editedFee
    });
    setEditing(false);
  };

  return (
    <tr>
      <td className="font-mono text-sm">${rule.minBid?.toLocaleString()}</td>
      <td className="font-mono text-sm">${rule.maxBid?.toLocaleString()}</td>
      <td>
        {editing ? (
          <input
            type="number"
            value={editedFee}
            onChange={(e) => setEditedFee(Number(e.target.value))}
            className="input w-20"
            autoFocus
          />
        ) : (
          <span className="font-medium text-[#D97706] text-sm">${rule.fee?.toLocaleString()}</span>
        )}
      </td>
      <td>
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <button onClick={handleSave} className="p-1.5 bg-[#059669] text-white rounded-lg">
              <FloppyDisk size={12} />
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="p-1.5 hover:bg-[#F4F4F5] rounded-lg">
              <Gear size={12} className="text-[#71717A]" />
            </button>
          )}
          <button onClick={() => onDelete(rule._id)} className="p-1.5 hover:bg-[#FEE2E2] rounded-lg">
            <Trash size={12} className="text-[#DC2626]" />
          </button>
        </div>
      </td>
    </tr>
  );
};

// New Auction Rule Row Component
const NewAuctionRuleRow = ({ profileCode, onSave }) => {
  const [newRule, setNewRule] = useState({ minBid: 0, maxBid: 0, fee: 0 });

  const handleAdd = () => {
    if (!newRule.maxBid || !newRule.fee) {
      toast.error('Заповніть всі поля');
      return;
    }
    onSave({
      profileCode,
      ...newRule
    });
    setNewRule({ minBid: 0, maxBid: 0, fee: 0 });
  };

  return (
    <tr className="bg-[#F4F4F5]">
      <td>
        <input
          type="number"
          value={newRule.minBid}
          onChange={(e) => setNewRule({...newRule, minBid: Number(e.target.value)})}
          className="input w-full"
          placeholder="0"
        />
      </td>
      <td>
        <input
          type="number"
          value={newRule.maxBid}
          onChange={(e) => setNewRule({...newRule, maxBid: Number(e.target.value)})}
          className="input w-full"
          placeholder="999"
        />
      </td>
      <td>
        <input
          type="number"
          value={newRule.fee}
          onChange={(e) => setNewRule({...newRule, fee: Number(e.target.value)})}
          className="input w-full"
          placeholder="0"
        />
      </td>
      <td>
        <button
          onClick={handleAdd}
          className="p-1.5 bg-[#059669] text-white rounded-lg hover:bg-[#047857]"
        >
          <Plus size={14} />
        </button>
      </td>
    </tr>
  );
};

export default CalculatorAdmin;
