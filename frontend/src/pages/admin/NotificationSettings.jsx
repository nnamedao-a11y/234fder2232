import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../../i18n';
import { 
  Bell, 
  TelegramLogo, 
  Envelope, 
  SpeakerHigh,
  SpeakerSlash,
  ArrowClockwise,
  CheckCircle,
  Warning,
  Fire,
  Lightning
} from '@phosphor-icons/react';
import { toast } from 'sonner';

const API_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

// Event types with labels
const EVENT_TYPES = [
  { key: 'lead.created', labelKey: 'newLead', icon: Fire, defaultSound: 'lead' },
  { key: 'invoice.overdue', labelKey: 'invoiceOverdue', icon: Warning, defaultSound: 'alert' },
  { key: 'invoice.created', labelKey: 'invoiceCreated', icon: Bell, defaultSound: 'payment' },
  { key: 'shipment.stalled', labelKey: 'shipmentStalled', icon: Warning, defaultSound: 'shipment' },
  { key: 'shipment.no_tracking', labelKey: 'shipmentNoTracking', icon: Warning, defaultSound: 'shipment' },
  { key: 'payment.failed', labelKey: 'paymentFailed', icon: Warning, defaultSound: 'payment' },
  { key: 'payment.received', labelKey: 'paymentReceived', icon: CheckCircle, defaultSound: 'success' },
  { key: 'contract.signed', labelKey: 'contractSigned', icon: CheckCircle, defaultSound: 'success' },
  { key: 'staff.session_suspicious', labelKey: 'suspiciousSession', icon: Lightning, defaultSound: 'alert' },
  { key: 'manager.inactive', labelKey: 'managerInactive', icon: Warning, defaultSound: 'alert' },
  { key: 'deal.status_changed', labelKey: 'dealStatusChanged', icon: Bell, defaultSound: null },
];

const ChannelToggle = ({ enabled, onChange, icon: Icon, label }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
      enabled 
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
        : 'bg-zinc-50 border-zinc-200 text-zinc-400'
    }`}
  >
    <Icon size={18} weight={enabled ? 'fill' : 'regular'} />
    <span className="text-sm font-medium">{label}</span>
  </button>
);

const SeverityBadge = ({ severity }) => {
  const config = {
    info: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Info' },
    warning: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Warning' },
    critical: { bg: 'bg-red-100', text: 'text-red-700', label: 'Critical' },
  };
  const c = config[severity] || config.info;
  
  return (
    <span className={`${c.bg} ${c.text} px-2 py-0.5 rounded-full text-xs font-medium`}>
      {c.label}
    </span>
  );
};

export default function NotificationSettings() {
  const { t } = useLang();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadRules();
  }, []);

  const loadRules = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/notifications/rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      // Merge with EVENT_TYPES to ensure all are shown
      const rulesMap = {};
      (res.data || []).forEach(r => { rulesMap[r.eventType] = r; });
      
      const merged = EVENT_TYPES.map(et => ({
        eventType: et.key,
        labelKey: et.labelKey,
        icon: et.icon,
        isActive: rulesMap[et.key]?.isActive ?? true,
        severity: rulesMap[et.key]?.severity || 'info',
        channels: rulesMap[et.key]?.channels || {
          inApp: true,
          telegram: false,
          sound: et.defaultSound !== null,
          email: false,
        },
        soundKey: rulesMap[et.key]?.soundKey || et.defaultSound,
        debounceMinutes: rulesMap[et.key]?.debounceMinutes || 10,
        targetRoles: rulesMap[et.key]?.targetRoles || ['manager', 'team_lead'],
      }));
      
      setRules(merged);
    } catch (err) {
      console.error('Failed to load rules:', err);
      toast.error(t('loadError') || 'Failed to load notification rules');
    } finally {
      setLoading(false);
    }
  };

  const updateRule = async (eventType, updates) => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      await axios.patch(
        `${API_URL}/api/notifications/rules/${encodeURIComponent(eventType)}`,
        updates,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      
      setRules(prev => prev.map(r => 
        r.eventType === eventType ? { ...r, ...updates } : r
      ));
      
      toast.success(t('saved') || 'Saved');
    } catch (err) {
      console.error('Failed to update rule:', err);
      toast.error(t('saveError') || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (eventType, channel, value) => {
    const rule = rules.find(r => r.eventType === eventType);
    if (!rule) return;
    
    updateRule(eventType, {
      channels: { ...rule.channels, [channel]: value },
    });
  };

  const toggleActive = (eventType, isActive) => {
    updateRule(eventType, { isActive });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-zinc-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="notification-settings">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{t('notificationSettings') || 'Notification Settings'}</h1>
          <p className="text-zinc-500">{t('configureNotificationChannels') || 'Configure notification channels per event'}</p>
        </div>
        <button
          onClick={loadRules}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 
                     transition-colors text-sm font-medium disabled:opacity-50"
        >
          <ArrowClockwise size={16} className={loading ? 'animate-spin' : ''} />
          {t('refresh') || 'Refresh'}
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-blue-600" />
          <span className="text-sm text-zinc-600">{t('inAppNotifications') || 'In-App'}</span>
        </div>
        <div className="flex items-center gap-2">
          <TelegramLogo size={18} className="text-sky-500" />
          <span className="text-sm text-zinc-600">Telegram</span>
        </div>
        <div className="flex items-center gap-2">
          <SpeakerHigh size={18} className="text-violet-600" />
          <span className="text-sm text-zinc-600">{t('sound') || 'Sound'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Envelope size={18} className="text-emerald-600" />
          <span className="text-sm text-zinc-600">Email</span>
        </div>
      </div>

      {/* Rules List */}
      <div className="space-y-4">
        {rules.map((rule) => {
          const RuleIcon = rule.icon;
          
          return (
            <div
              key={rule.eventType}
              className={`p-6 rounded-2xl border transition-all ${
                rule.isActive 
                  ? 'bg-white border-zinc-200' 
                  : 'bg-zinc-50 border-zinc-100 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${
                    rule.severity === 'critical' ? 'bg-red-100' :
                    rule.severity === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
                  }`}>
                    <RuleIcon size={20} className={
                      rule.severity === 'critical' ? 'text-red-600' :
                      rule.severity === 'warning' ? 'text-amber-600' : 'text-blue-600'
                    } weight="duotone" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-zinc-900">
                      {t(rule.labelKey) || rule.eventType}
                    </h3>
                    <p className="text-sm text-zinc-500">{rule.eventType}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <SeverityBadge severity={rule.severity} />
                  <button
                    onClick={() => toggleActive(rule.eventType, !rule.isActive)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      rule.isActive ? 'bg-emerald-500' : 'bg-zinc-300'
                    }`}
                  >
                    <span 
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                        rule.isActive ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Channels */}
              <div className="flex flex-wrap gap-3">
                <ChannelToggle
                  enabled={rule.channels.inApp}
                  onChange={(v) => toggleChannel(rule.eventType, 'inApp', v)}
                  icon={Bell}
                  label="CRM"
                />
                <ChannelToggle
                  enabled={rule.channels.telegram}
                  onChange={(v) => toggleChannel(rule.eventType, 'telegram', v)}
                  icon={TelegramLogo}
                  label="Telegram"
                />
                <ChannelToggle
                  enabled={rule.channels.sound}
                  onChange={(v) => toggleChannel(rule.eventType, 'sound', v)}
                  icon={rule.channels.sound ? SpeakerHigh : SpeakerSlash}
                  label={t('sound') || 'Sound'}
                />
                <ChannelToggle
                  enabled={rule.channels.email}
                  onChange={(v) => toggleChannel(rule.eventType, 'email', v)}
                  icon={Envelope}
                  label="Email"
                />
              </div>

              {/* Sound Selection (if sound enabled) */}
              {rule.channels.sound && (
                <div className="mt-4 pt-4 border-t border-zinc-100">
                  <label className="text-sm text-zinc-500 block mb-2">{t('soundKey') || 'Sound'}</label>
                  <select
                    value={rule.soundKey || 'alert'}
                    onChange={(e) => updateRule(rule.eventType, { soundKey: e.target.value })}
                    className="px-3 py-2 rounded-xl border border-zinc-200 text-sm"
                  >
                    <option value="lead">🔥 Lead</option>
                    <option value="payment">💳 Payment</option>
                    <option value="shipment">🚢 Shipment</option>
                    <option value="alert">⚠️ Alert</option>
                    <option value="success">✅ Success</option>
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
