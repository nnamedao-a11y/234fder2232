/**
 * Integrations Admin Page
 * 
 * Керування всіма зовнішніми інтеграціями:
 * - Stripe, DocuSign, Ringostat, Telegram, Viber, Email, Shipping
 * - Test connections
 * - Enable/disable
 * - Health status
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { useLang } from '../../i18n';
import {
  CreditCard,
  Phone,
  Mail,
  Brain,
  LogIn,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Settings,
  Eye,
  EyeOff,
  TestTube,
  Power,
  Activity,
} from 'lucide-react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const PROVIDER_CONFIG = {
  google_oauth: {
    name: 'Google Sign-In',
    icon: LogIn,
    color: '#4285F4',
    description: 'Customer cabinet login via Google Identity Services (direct, no intermediate screens).',
    fields: [
      { key: 'clientId', label: 'Google Client ID', type: 'text', placeholder: 'xxxxx.apps.googleusercontent.com' },
      { key: 'clientSecret', label: 'Client Secret (optional, kept private)', type: 'password' },
    ],
    settings: [],
  },
  stripe: {
    name: 'Stripe',
    icon: CreditCard,
    color: '#635BFF',
    description: 'Real card payments + Apple Pay / Google Pay / Link / Klarna / Crypto. Master-admin sees every charge in /admin/payments.',
    fields: [
      { key: 'publishableKey', label: 'Publishable Key', type: 'text', placeholder: 'pk_test_… or pk_live_…' },
      { key: 'secretKey', label: 'Secret Key', type: 'password', placeholder: 'sk_test_… or sk_live_…' },
      { key: 'restrictedKey', label: 'Restricted Key (optional)', type: 'password', placeholder: 'rk_test_… or rk_live_…' },
      { key: 'webhookSecret', label: 'Webhook Secret (optional)', type: 'password', placeholder: 'whsec_… (set after configuring /api/stripe/webhook)' },
    ],
    settings: [
      {
        key: 'currency', label: 'Default currency', type: 'select',
        options: ['USD', 'EUR', 'UAH', 'BGN', 'GBP', 'PLN', 'RON', 'CZK', 'CHF', 'CAD'],
      },
      {
        key: 'automaticPaymentMethods', label: 'Automatic Payment Methods', type: 'toggle',
        help: 'Recommended. Stripe auto-renders methods enabled in Dashboard + wallets (Apple Pay / Google Pay / Link) based on browser & locale.',
      },
      {
        key: 'enabledMethods', label: 'Payment methods', type: 'methods-grid',
        help: 'Each method must also be activated in Stripe Dashboard → Settings → Payment methods. Apple Pay / Google Pay use the Card method type plus wallet activation.',
        groups: [
          { title: 'Cards & Wallets', methods: [
            { value: 'card',       label: 'Cards',      hint: 'Visa, Mastercard, Amex, Discover',     accent: '#635BFF', icon: '💳' },
            { value: 'apple_pay',  label: 'Apple Pay',  hint: 'One-tap on Safari / iOS',              accent: '#000',    icon: '' },
            { value: 'google_pay', label: 'Google Pay', hint: 'One-tap on Chrome / Android',          accent: '#4285F4', icon: '🅖' },
            { value: 'link',       label: 'Link',       hint: 'Stripe one-click checkout',            accent: '#00D924', icon: '🔗' },
          ]},
          { title: 'Buy Now, Pay Later', methods: [
            { value: 'klarna',            label: 'Klarna',            hint: 'Pay in 4',           accent: '#FFB3C7', icon: 'K' },
            { value: 'afterpay_clearpay', label: 'Afterpay / Clearpay', hint: 'Pay in 4',         accent: '#B2FCE4', icon: 'A' },
            { value: 'cashapp',           label: 'Cash App Pay',      hint: 'USD only',           accent: '#00D632', icon: '$' },
          ]},
          { title: 'Crypto', methods: [
            { value: 'crypto', label: 'Crypto (USDC)', hint: 'Stripe Crypto onramp / stablecoin', accent: '#F7931A', icon: '₿' },
          ]},
          { title: 'Bank debits & local methods', methods: [
            { value: 'us_bank_account', label: 'US Bank (ACH)',    hint: 'USA',         accent: '#0F62FE' },
            { value: 'sepa_debit',      label: 'SEPA Direct Debit', hint: 'EU',          accent: '#3B82F6' },
            { value: 'ideal',           label: 'iDEAL',            hint: 'Netherlands', accent: '#CC0066' },
            { value: 'bancontact',      label: 'Bancontact',       hint: 'Belgium',     accent: '#005498' },
            { value: 'p24',             label: 'Przelewy24',       hint: 'Poland',      accent: '#D40028' },
            { value: 'blik',            label: 'BLIK',             hint: 'Poland',      accent: '#000' },
            { value: 'alipay',          label: 'Alipay',           hint: 'China',       accent: '#1677FF' },
            { value: 'wechat_pay',      label: 'WeChat Pay',       hint: 'China',       accent: '#07C160' },
          ]},
        ],
      },
      {
        key: 'checkoutMode', label: 'Checkout UI', type: 'select',
        options: ['hosted', 'embedded'],
        help: 'hosted = redirect to Stripe page · embedded = inline on your site',
      },
      {
        key: 'captureMethod', label: 'Capture method', type: 'select',
        options: ['automatic', 'manual'],
        help: 'automatic = charge on confirm · manual = authorize first, capture later',
      },
      { key: 'statementDescriptor', label: 'Statement descriptor', type: 'text', placeholder: 'BIBI CARS', help: 'Up to 22 characters shown on customer card statement.' },
      {
        key: 'billingAddressCollection', label: 'Billing address', type: 'select',
        options: ['auto', 'required'],
      },
      { key: 'phoneNumberCollection', label: 'Collect phone number', type: 'toggle' },
      { key: 'allowPromotionCodes',    label: 'Allow promo codes',    type: 'toggle' },
      { key: 'successUrl', label: 'Success URL', type: 'text', placeholder: '/cabinet/payment/success' },
      { key: 'cancelUrl',  label: 'Cancel URL',  type: 'text', placeholder: '/cabinet/payment/cancel' },
    ],
  },
  ringostat: {
    name: 'Ringostat',
    icon: Phone,
    color: '#00D4AA',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
      { key: 'projectId', label: 'Project ID', type: 'text' },
    ],
    settings: [],
  },
  email: {
    name: 'Email (SMTP)',
    icon: Mail,
    color: '#EA4335',
    fields: [
      { key: 'smtpHost', label: 'SMTP Host', type: 'text' },
      { key: 'smtpPort', label: 'SMTP Port', type: 'text' },
      { key: 'smtpLogin', label: 'Login', type: 'text' },
      { key: 'smtpPassword', label: 'Password', type: 'password' },
    ],
    settings: [
      { key: 'senderEmail', label: 'Sender Email', type: 'text' },
    ],
  },
  openai: {
    name: 'OpenAI',
    icon: Brain,
    color: '#10A37F',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password' },
    ],
    settings: [
      { key: 'model', label: 'Model', type: 'select', options: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'] },
    ],
  },
};

const STATUS_COLORS = {
  ok: 'bg-green-100 text-green-800',
  degraded: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-800',
  not_configured: 'bg-gray-100 text-gray-500',
};

const STATUS_ICONS = {
  ok: Check,
  degraded: AlertTriangle,
  failed: X,
  unknown: Activity,
  not_configured: Settings,
};

export default function IntegrationsPage() {
  const { t } = useLang();
  const [configs, setConfigs] = useState([]);
  const [health, setHealth] = useState({});
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);
  const [expandedProvider, setExpandedProvider] = useState(null);
  const [editMode, setEditMode] = useState({});
  const [editValues, setEditValues] = useState({});
  const [showPasswords, setShowPasswords] = useState({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [configsRes, healthRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/integrations`),
        axios.get(`${API_URL}/api/admin/integrations/health`),
      ]);
      setConfigs(configsRes.data);
      setHealth(healthRes.data);
    } catch (error) {
      toast.error('Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async (provider) => {
    setTesting(provider);
    try {
      const res = await axios.post(`${API_URL}/api/admin/integrations/${provider}/test`);
      if (res.data.success) {
        toast.success(`${PROVIDER_CONFIG[provider]?.name}: ${res.data.message}`);
      } else {
        toast.error(`${PROVIDER_CONFIG[provider]?.name}: ${res.data.message}`);
      }
      await loadData();
    } catch (error) {
      toast.error(`Test failed: ${error.message}`);
    } finally {
      setTesting(null);
    }
  };

  const toggleEnabled = async (provider, currentState) => {
    try {
      await axios.post(`${API_URL}/api/admin/integrations/${provider}/toggle`, {
        isEnabled: !currentState,
      });
      toast.success(`${PROVIDER_CONFIG[provider]?.name} ${!currentState ? 'enabled' : 'disabled'}`);
      await loadData();
    } catch (error) {
      toast.error('Failed to toggle integration');
    }
  };

  const saveConfig = async (provider) => {
    const values = editValues[provider];
    if (!values) return;

    try {
      // Special handling for Ringostat
      if (provider === 'ringostat') {
        await axios.post(`${API_URL}/api/admin/integrations/ringostat/configure`, {
          api_key: values.credentials?.apiKey || '',
          project_id: values.credentials?.projectId || '',
          extension_mapping: values.settings?.extensionMapping || {}
        });
      } else {
        await axios.patch(`${API_URL}/api/admin/integrations/${provider}`, {
          credentials: values.credentials,
          settings: values.settings,
          mode: values.mode,
        });
      }
      
      toast.success(`${PROVIDER_CONFIG[provider]?.name} saved`);
      setEditMode({ ...editMode, [provider]: false });
      await loadData();
    } catch (error) {
      toast.error('Failed to save configuration');
    }
  };

  const getConfigByProvider = (provider) => {
    return configs.find(c => c.provider === provider) || {
      provider,
      credentials: {},
      settings: {},
      mode: 'disabled',
      isEnabled: false,
    };
  };

  const startEdit = (provider) => {
    const config = getConfigByProvider(provider);
    setEditValues({
      ...editValues,
      [provider]: {
        credentials: { ...config.credentials },
        settings: { ...config.settings },
        mode: config.mode,
      },
    });
    setEditMode({ ...editMode, [provider]: true });
  };

  /** Has the provider got at least ONE credential value entered? */
  const hasCreds = (provider) => {
    const c = getConfigByProvider(provider).credentials || {};
    return Object.values(c).some((v) => typeof v === 'string' && v.length > 0);
  };

  /** Open a row + enter edit mode if there are no creds yet. */
  const openProvider = (provider) => {
    setExpandedProvider(provider);
    if (!hasCreds(provider) && !editMode[provider]) {
      // Use a microtask delay so the row mounts before we mutate editValues
      setTimeout(() => startEdit(provider), 0);
    }
  };

  /** Test button click — if creds missing, redirect user to the form
   *  instead of just toasting an error. */
  const handleTestClick = (provider) => {
    if (!hasCreds(provider)) {
      toast.info(`${PROVIDER_CONFIG[provider]?.name}: enter your keys first.`);
      openProvider(provider);
      return;
    }
    testConnection(provider);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('integrationsTitle')}</h1>
          <p className="text-gray-500 mt-1">{t('integrationsSubtitle')}</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          <RefreshCw className="w-4 h-4" />
          {t('refresh')}
        </button>
      </div>

      {/* Health Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {Object.entries(health).map(([provider, data]) => {
          const config = PROVIDER_CONFIG[provider];
          if (!config || config.hidden) return null;
          const StatusIcon = STATUS_ICONS[data.status] || Activity;
          const Icon = config.icon;
          
          return (
            <button
              type="button"
              key={provider}
              onClick={() => {
                openProvider(provider);
                // Smooth scroll to the row
                setTimeout(() => {
                  const el = document.getElementById(`integration-row-${provider}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 60);
              }}
              className={`text-left p-4 rounded-xl border transition-all hover:border-blue-400 hover:shadow-sm ${data.isEnabled ? 'border-gray-200' : 'border-gray-100 opacity-70'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-5 h-5" style={{ color: config.color }} />
                <span className="font-medium text-sm">{config.name}</span>
              </div>
              <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${STATUS_COLORS[data.status]}`}>
                <StatusIcon className="w-3 h-3" />
                {data.status}
              </div>
            </button>
          );
        })}
      </div>

      {/* Integration Cards */}
      <div className="space-y-4">
        {Object.entries(PROVIDER_CONFIG).filter(([, c]) => !c.hidden).map(([provider, config]) => {
          const integrationConfig = getConfigByProvider(provider);
          const healthData = health[provider] || {};
          const isExpanded = expandedProvider === provider;
          const isEditing = editMode[provider];
          const Icon = config.icon;
          const StatusIcon = STATUS_ICONS[healthData.status] || Activity;

          return (
            <div
              key={provider}
              id={`integration-row-${provider}`}
              className={`bg-white rounded-xl border ${integrationConfig.isEnabled ? 'border-gray-200' : 'border-gray-100'}`}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between p-4 cursor-pointer"
                onClick={() => isExpanded ? setExpandedProvider(null) : openProvider(provider)}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${config.color}20` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: config.color }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{config.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[healthData.status]}`}>
                        <StatusIcon className="w-3 h-3" />
                        {healthData.status}
                      </span>
                      {integrationConfig.mode && (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          integrationConfig.mode === 'live' ? 'bg-green-100 text-green-800' :
                          integrationConfig.mode === 'sandbox' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {integrationConfig.mode}
                        </span>
                      )}
                      {!hasCreds(provider) && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200">
                          Click to configure
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleTestClick(provider); }}
                    disabled={testing === provider}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                    title="Test Connection"
                  >
                    {testing === provider ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleEnabled(provider, integrationConfig.isEnabled); }}
                    className={`p-2 rounded-lg ${integrationConfig.isEnabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                    title={integrationConfig.isEnabled ? 'Disable' : 'Enable'}
                  >
                    <Power className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="border-t border-gray-100 p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-medium text-gray-700">Configuration</h4>
                    {!isEditing ? (
                      <button
                        onClick={() => startEdit(provider)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditMode({ ...editMode, [provider]: false })}
                          className="text-sm text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveConfig(provider)}
                          className="text-sm text-green-600 hover:text-green-800 font-medium"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Credentials */}
                  <div className="space-y-3 mb-4">
                    <p className="text-xs font-medium text-gray-500 uppercase">Credentials</p>
                    {config.fields.map((field) => (
                      <div key={field.key} className="flex items-center gap-2">
                        <label className="w-32 text-sm text-gray-600">{field.label}</label>
                        {isEditing ? (
                          <div className="flex-1 flex items-center gap-2">
                            {field.type === 'textarea' ? (
                              <textarea
                                className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
                                rows={3}
                                value={editValues[provider]?.credentials?.[field.key] || ''}
                                onChange={(e) => setEditValues({
                                  ...editValues,
                                  [provider]: {
                                    ...editValues[provider],
                                    credentials: {
                                      ...editValues[provider]?.credentials,
                                      [field.key]: e.target.value,
                                    },
                                  },
                                })}
                              />
                            ) : (
                              <input
                                type={field.type === 'password' && !showPasswords[`${provider}_${field.key}`] ? 'password' : 'text'}
                                className="flex-1 px-3 py-2 border rounded-lg text-sm font-mono"
                                value={editValues[provider]?.credentials?.[field.key] || ''}
                                onChange={(e) => setEditValues({
                                  ...editValues,
                                  [provider]: {
                                    ...editValues[provider],
                                    credentials: {
                                      ...editValues[provider]?.credentials,
                                      [field.key]: e.target.value,
                                    },
                                  },
                                })}
                              />
                            )}
                            {field.type === 'password' && (
                              <button
                                type="button"
                                onClick={() => setShowPasswords({
                                  ...showPasswords,
                                  [`${provider}_${field.key}`]: !showPasswords[`${provider}_${field.key}`],
                                })}
                                className="p-2 text-gray-400 hover:text-gray-600"
                              >
                                {showPasswords[`${provider}_${field.key}`] ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="flex-1 text-sm font-mono text-gray-800 bg-gray-50 px-3 py-2 rounded-lg">
                            {integrationConfig.credentials?.[field.key] || '—'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Settings */}
                  {config.settings.length > 0 && (
                    <div className="space-y-3 mb-4">
                      <p className="text-xs font-medium text-gray-500 uppercase">Settings</p>
                      {config.settings.map((setting) => {
                        const currentVal = isEditing
                          ? editValues[provider]?.settings?.[setting.key]
                          : integrationConfig.settings?.[setting.key];
                        const updateSetting = (newVal) => setEditValues({
                          ...editValues,
                          [provider]: {
                            ...editValues[provider],
                            settings: {
                              ...editValues[provider]?.settings,
                              [setting.key]: newVal,
                            },
                          },
                        });
                        return (
                        <div key={setting.key} className={`flex ${setting.type === 'multiselect' ? 'flex-col items-stretch' : 'items-center'} gap-2`}>
                          <label className={`${setting.type === 'multiselect' ? 'block mb-1' : 'w-32'} text-sm text-gray-600`}>
                            {setting.label}
                          </label>
                          {isEditing ? (
                            setting.type === 'select' ? (
                              <select
                                className="flex-1 px-3 py-2 border rounded-lg text-sm"
                                value={currentVal || ''}
                                onChange={(e) => updateSetting(e.target.value)}
                              >
                                <option value="">— select —</option>
                                {setting.options?.map((opt) => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : setting.type === 'toggle' ? (
                              <button
                                type="button"
                                onClick={() => updateSetting(!currentVal)}
                                className={`w-12 h-6 rounded-full transition-colors ${currentVal ? 'bg-green-500' : 'bg-gray-300'}`}
                              >
                                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${currentVal ? 'translate-x-6' : 'translate-x-0.5'}`} />
                              </button>
                            ) : setting.type === 'multiselect' ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {setting.options?.map((opt) => {
                                  const optVal = typeof opt === 'string' ? opt : opt.value;
                                  const optLabel = typeof opt === 'string' ? opt : opt.label;
                                  const arr = Array.isArray(currentVal) ? currentVal : [];
                                  const checked = arr.includes(optVal);
                                  return (
                                    <label key={optVal} className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer transition-colors ${checked ? 'bg-blue-50 border-blue-300' : 'border-gray-200 hover:bg-gray-50'}`}>
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => updateSetting(checked ? arr.filter(v => v !== optVal) : [...arr, optVal])}
                                        className="rounded border-gray-300"
                                      />
                                      <span className="flex-1">{optLabel}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : setting.type === 'methods-grid' ? (
                              <div className="space-y-4 w-full">
                                {(setting.groups || []).map((grp) => (
                                  <div key={grp.title}>
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{grp.title}</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                      {grp.methods.map((m) => {
                                        const obj = (currentVal && typeof currentVal === 'object' && !Array.isArray(currentVal)) ? currentVal : {};
                                        const checked = !!obj[m.value];
                                        return (
                                          <label
                                            key={m.value}
                                            className={`flex items-start gap-3 p-3 border-2 rounded-xl text-sm cursor-pointer transition-all ${checked ? 'border-[#635BFF] bg-[#635BFF]/5 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => updateSetting({ ...obj, [m.value]: !checked })}
                                              className="mt-1 rounded border-gray-300"
                                            />
                                            <div
                                              className="w-9 h-9 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
                                              style={{ backgroundColor: `${m.accent}15`, color: m.accent }}
                                            >
                                              {m.icon || m.label.charAt(0)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                              <div className="font-semibold text-gray-900">{m.label}</div>
                                              <div className="text-xs text-gray-500">{m.hint}</div>
                                            </div>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <input
                                type={setting.type || 'text'}
                                className="flex-1 px-3 py-2 border rounded-lg text-sm"
                                placeholder={setting.placeholder || ''}
                                value={currentVal || ''}
                                onChange={(e) => updateSetting(e.target.value)}
                              />
                            )
                          ) : (
                            setting.type === 'methods-grid' ? (
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(currentVal || {}).filter(([, v]) => v).map(([k]) => (
                                  <span key={k} className="px-2 py-1 rounded-md bg-[#635BFF]/10 text-[#635BFF] text-xs font-medium">{k}</span>
                                ))}
                                {!Object.values(currentVal || {}).some(Boolean) && (
                                  <span className="text-sm text-gray-500">— none —</span>
                                )}
                              </div>
                            ) : setting.type === 'toggle' ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${currentVal ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {currentVal ? 'Enabled' : 'Disabled'}
                              </span>
                            ) : (
                            <span className="flex-1 text-sm text-gray-800">
                              {Array.isArray(currentVal)
                                ? (currentVal.length ? currentVal.join(', ') : '—')
                                : String(currentVal ?? '—')}
                            </span>
                            )
                          )}
                          {setting.help && isEditing && (
                            <p className="text-xs text-gray-500 mt-1 col-span-full">{setting.help}</p>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Mode Selection */}
                  {isEditing && (
                    <div className="flex items-center gap-2 mt-4 pt-4 border-t">
                      <label className="w-32 text-sm text-gray-600">Mode</label>
                      <select
                        className="px-3 py-2 border rounded-lg text-sm"
                        value={editValues[provider]?.mode || 'disabled'}
                        onChange={(e) => setEditValues({
                          ...editValues,
                          [provider]: {
                            ...editValues[provider],
                            mode: e.target.value,
                          },
                        })}
                      >
                        <option value="disabled">Disabled</option>
                        <option value="sandbox">Sandbox</option>
                        <option value="live">Live</option>
                      </select>
                    </div>
                  )}

                  {/* Last Check Info */}
                  {healthData.lastCheck && (
                    <div className="mt-4 pt-4 border-t text-xs text-gray-500">
                      Last checked: {new Date(healthData.lastCheck).toLocaleString()}
                      {healthData.error && (
                        <span className="block text-red-500 mt-1">Error: {healthData.error}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
