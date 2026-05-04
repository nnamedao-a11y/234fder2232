/**
 * AdminInfoPage — site-wide info / legal content editor
 *
 * Слідує дизайн-система адмінки:
 *   • світла тема, біла картка, border #E4E4E7
 *   • текст #18181B / muted #71717A
 *   • кнопки rounded-lg, таби з нижнім підкресленням
 *
 * Контент:
 *   • Privacy Policy / Terms of Use / Cookie Policy / Conditions (rich-text EN+BG)
 *   • Footer settings (контакти, соцмережі, Viber community)
 *   • Cookie consent banner copy (EN+BG)
 *
 * API: GET /api/site-info, PUT /api/admin/site-info
 */
import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import {
  ShieldCheck,
  FileText,
  Cookie,
  ListChecks,
  PhoneCall,
  Globe,
  FloppyDisk,
  ArrowsClockwise,
  CheckCircle,
} from '@phosphor-icons/react';

const API_URL = process.env.REACT_APP_BACKEND_URL || '';

const POLICY_TABS = [
  { id: 'privacy',    label: 'Privacy Policy', icon: ShieldCheck },
  { id: 'terms',      label: 'Terms of Use',   icon: FileText },
  { id: 'cookies',    label: 'Cookie Policy',  icon: Cookie },
  { id: 'conditions', label: 'Conditions',     icon: ListChecks },
];

const ALL_TABS = [
  ...POLICY_TABS,
  { id: 'header',        label: 'Header',        icon: PhoneCall },
  { id: 'footer',        label: 'Footer',        icon: PhoneCall },
  { id: 'cookie_banner', label: 'Cookie Banner', icon: Cookie },
];

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'bg', label: 'Български' },
];

const SOCIALS = [
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/your-page' },
  { key: 'facebook',  label: 'Facebook',  placeholder: 'https://facebook.com/your-page' },
  { key: 'telegram',  label: 'Telegram',  placeholder: 'https://t.me/your-channel' },
  { key: 'tiktok',    label: 'TikTok',    placeholder: 'https://tiktok.com/@your-page' },
  { key: 'whatsapp',  label: 'WhatsApp',  placeholder: 'https://wa.me/359XXXXXXXXX' },
  { key: 'viber',     label: 'Viber',     placeholder: 'viber://chat?number=%2B359XXXXXXXXX' },
];

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link', 'blockquote'],
    [{ align: [] }],
    ['clean'],
  ],
};

function Block({ title, description, children, footer }) {
  return (
    <div className="bg-white border border-[#E4E4E7] rounded-2xl">
      {(title || description) && (
        <div className="px-5 pt-5 pb-4">
          {title && <h2 className="font-semibold text-[#18181B] text-[15px]">{title}</h2>}
          {description && <p className="text-[12.5px] text-[#71717A] mt-1 leading-relaxed">{description}</p>}
        </div>
      )}
      <div className="px-5 pb-5">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-[#F4F4F5] bg-[#FAFAFA] rounded-b-2xl text-[12px] text-[#71717A]">{footer}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-[#52525B] mb-1.5 uppercase tracking-wider">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] text-[#A1A1AA] mt-1">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full bg-white border border-[#E4E4E7] rounded-lg px-3.5 h-10 text-[14px] text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#18181B] focus:ring-2 focus:ring-[#18181B]/10 transition-all';

const textareaCls =
  'w-full bg-white border border-[#E4E4E7] rounded-lg px-3.5 py-2.5 text-[14px] text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none focus:border-[#18181B] focus:ring-2 focus:ring-[#18181B]/10 transition-all resize-y';

export default function AdminInfoPage() {
  const [tab, setTab] = useState('privacy');
  const [activeLang, setActiveLang] = useState('en');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/api/site-info`);
      setData(r.data);
      setDirty(false);
    } catch {
      toast.error('Не вдалося завантажити налаштування');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updatePolicy = (key, lang, field, value) => {
    setData((prev) => ({
      ...prev,
      policies: {
        ...(prev?.policies || {}),
        [key]: {
          ...(prev?.policies?.[key] || {}),
          [lang]: {
            ...(prev?.policies?.[key]?.[lang] || {}),
            [field]: value,
          },
        },
      },
    }));
    setDirty(true);
  };

  const updateFooter = (path, value) => {
    setData((prev) => {
      const next = { ...(prev || {}) };
      next.footer = { ...(prev?.footer || {}) };
      const segments = path.split('.');
      let cur = next.footer;
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        cur[seg] = { ...(cur[seg] || {}) };
        cur = cur[seg];
      }
      cur[segments[segments.length - 1]] = value;
      return next;
    });
    setDirty(true);
  };

  const updateBanner = (field, value) => {
    setData((prev) => ({
      ...prev,
      cookie_banner: { ...(prev?.cookie_banner || {}), [field]: value },
    }));
    setDirty(true);
  };

  const updateHeader = (field, value) => {
    setData((prev) => ({
      ...prev,
      header: { ...(prev?.header || {}), [field]: value },
    }));
    setDirty(true);
  };

  // Read social as object {enabled, url} regardless of whether stored as flat string or object
  const readSocial = (key) => {
    const v = data?.footer?.socials?.[key];
    if (!v) return { enabled: false, url: '' };
    if (typeof v === 'string') return { enabled: !!v, url: v };
    return { enabled: !!v.enabled, url: v.url || '' };
  };

  const updateSocial = (key, patch) => {
    const cur = readSocial(key);
    const next = { ...cur, ...patch };
    updateFooter(`socials.${key}`, next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await axios.put(
        `${API_URL}/api/admin/site-info`,
        {
          policies: data?.policies || {},
          header: data?.header || {},
          footer: data?.footer || {},
          cookie_banner: data?.cookie_banner || {},
        },
        { headers },
      );
      setData(r.data);
      setDirty(false);
      setSavedAt(new Date());
      toast.success('Збережено');
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const policy = useMemo(
    () => data?.policies?.[tab]?.[activeLang] || { title: '', content: '' },
    [data, tab, activeLang],
  );

  const isPolicy = POLICY_TABS.some((t) => t.id === tab);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-center text-[#71717A] py-10 flex items-center justify-center gap-2">
          <ArrowsClockwise size={18} className="animate-spin" />
          Завантаження…
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto" data-testid="admin-info-page">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#18181B]">Info — Site content</h1>
          <p className="text-sm text-[#71717A] mt-1">
            Privacy, Terms, Cookies, Conditions, footer contacts &amp; socials. Public site shows EN/BG.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[12px] text-[#16A34A]">
              <CheckCircle size={14} weight="fill" /> Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={load}
            disabled={saving}
            className="inline-flex items-center gap-2 px-3.5 h-10 rounded-lg border border-[#E4E4E7] bg-white text-[#52525B] hover:bg-[#FAFAFA] hover:border-[#D4D4D8] text-[13px] font-medium transition-colors disabled:opacity-50"
            data-testid="info-reload"
          >
            <ArrowsClockwise size={15} /> Reload
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-lg bg-[#18181B] hover:bg-black text-white text-[13px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="info-save"
          >
            <FloppyDisk size={15} weight="fill" /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[#E4E4E7] overflow-x-auto">
        {ALL_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`info-tab-${t.id}`}
              className={`px-4 py-3 flex items-center gap-2 font-medium text-[13.5px] border-b-2 -mb-px whitespace-nowrap transition-colors ${
                active
                  ? 'border-[#18181B] text-[#18181B]'
                  : 'border-transparent text-[#71717A] hover:text-[#18181B]'
              }`}
            >
              <Icon size={16} weight={active ? 'fill' : 'regular'} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Policy editor */}
      {isPolicy && (
        <div className="space-y-5">
          <Block
            title={POLICY_TABS.find((t) => t.id === tab).label}
            description="Edit title and rich-text body for both languages. Bold, italic, headings, lists and links are supported."
          >
            {/* Lang selector */}
            <div className="inline-flex items-center gap-1 rounded-lg p-0.5 bg-[#F4F4F5] border border-[#E4E4E7] mb-5">
              {LANGS.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setActiveLang(l.code)}
                  className={`px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wider rounded-md transition-all flex items-center gap-1.5 ${
                    activeLang === l.code
                      ? 'bg-white text-[#18181B] shadow-sm border border-[#E4E4E7]'
                      : 'text-[#71717A] hover:text-[#18181B]'
                  }`}
                  data-testid={`info-lang-${l.code}`}
                >
                  <Globe size={12} />
                  {l.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Field label="Title">
                <input
                  type="text"
                  value={policy.title || ''}
                  onChange={(e) => updatePolicy(tab, activeLang, 'title', e.target.value)}
                  className={inputCls}
                  placeholder="e.g. Privacy Policy"
                  data-testid="info-policy-title"
                />
              </Field>

              <div>
                <span className="block text-[12px] font-semibold text-[#52525B] mb-1.5 uppercase tracking-wider">Content</span>
                <div className="bibi-admin-quill">
                  <ReactQuill
                    theme="snow"
                    value={policy.content || ''}
                    onChange={(v) => updatePolicy(tab, activeLang, 'content', v)}
                    modules={quillModules}
                  />
                </div>
              </div>
            </div>
          </Block>
        </div>
      )}

      {/* Header settings */}
      {tab === 'header' && (
        <div className="space-y-5">
          <Block title="Public header phones" description="Phone numbers shown in the public site header. One number per line. They become click-to-call links.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Phones" hint="One number per line — e.g. +359 875 313 158">
                <textarea
                  rows={3}
                  value={(data?.header?.phones || []).join('\n')}
                  onChange={(e) =>
                    updateHeader(
                      'phones',
                      e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    )
                  }
                  className={textareaCls}
                  placeholder={'+359 875 313 158\n+359 897 884 804'}
                  data-testid="info-header-phones"
                />
              </Field>
              <div className="space-y-4">
                <Field label="CTA button label (EN)" hint="Yellow button on the right of the header">
                  <input
                    type="text"
                    value={data?.header?.cta_label_en || ''}
                    onChange={(e) => updateHeader('cta_label_en', e.target.value)}
                    className={inputCls}
                    placeholder="Contact Us"
                    data-testid="info-header-cta-en"
                  />
                </Field>
                <Field label="CTA button label (BG)">
                  <input
                    type="text"
                    value={data?.header?.cta_label_bg || ''}
                    onChange={(e) => updateHeader('cta_label_bg', e.target.value)}
                    className={inputCls}
                    placeholder="Свържете се с нас"
                    data-testid="info-header-cta-bg"
                  />
                </Field>
              </div>
            </div>
          </Block>
        </div>
      )}

      {/* Footer settings */}
      {tab === 'footer' && (
        <div className="space-y-5">
          <Block title="Contacts" description="Phones, email, addresses and working hours displayed in the public footer.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Phones" hint="One number per line">
                <textarea
                  rows={3}
                  value={(data?.footer?.contacts?.phones || []).join('\n')}
                  onChange={(e) =>
                    updateFooter(
                      'contacts.phones',
                      e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    )
                  }
                  className={textareaCls}
                  placeholder="+359 875 313 158"
                  data-testid="info-footer-phones"
                />
              </Field>
              <div className="space-y-4">
                <Field label="Email">
                  <input
                    type="email"
                    value={data?.footer?.contacts?.email || ''}
                    onChange={(e) => updateFooter('contacts.email', e.target.value)}
                    className={inputCls}
                    placeholder="info@bibicars.bg"
                    data-testid="info-footer-email"
                  />
                </Field>
                <Field label="Working hours">
                  <input
                    type="text"
                    value={data?.footer?.contacts?.working_hours || ''}
                    onChange={(e) => updateFooter('contacts.working_hours', e.target.value)}
                    className={inputCls}
                    placeholder="Mon - Fri, 10.00 - 19.00"
                    data-testid="info-footer-hours"
                  />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Addresses" hint="One address per line">
                  <textarea
                    rows={3}
                    value={(data?.footer?.contacts?.addresses || []).join('\n')}
                    onChange={(e) =>
                      updateFooter(
                        'contacts.addresses',
                        e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                      )
                    }
                    className={textareaCls}
                    placeholder="Bulgaria, Sofia, Vitosha Blvd. 230"
                    data-testid="info-footer-addresses"
                  />
                </Field>
              </div>
            </div>
          </Block>

          <Block title="Social media links" description="Public social channels. Toggle a channel to show/hide its icon in the public footer.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {SOCIALS.map((s) => {
                const cur = readSocial(s.key);
                return (
                  <div key={s.key} className="flex items-start gap-3 p-3 bg-[#FAFAFA] border border-[#E4E4E7] rounded-lg">
                    <label className="flex items-center mt-7 cursor-pointer shrink-0" title={cur.enabled ? 'Enabled' : 'Disabled'}>
                      <input
                        type="checkbox"
                        checked={cur.enabled}
                        onChange={(e) => updateSocial(s.key, { enabled: e.target.checked })}
                        className="w-4 h-4 accent-[#18181B] cursor-pointer"
                        data-testid={`info-social-enabled-${s.key}`}
                      />
                    </label>
                    <div className="flex-1 min-w-0">
                      <Field label={s.label} hint={cur.enabled ? 'Visible in footer' : 'Hidden from footer'}>
                        <input
                          type="text"
                          value={cur.url}
                          onChange={(e) => updateSocial(s.key, { url: e.target.value })}
                          className={inputCls}
                          placeholder={s.placeholder}
                          data-testid={`info-social-${s.key}`}
                          disabled={!cur.enabled}
                        />
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          </Block>

          <Block title="Viber community block" description="Separate &lsquo;Join our group&rsquo; block in the footer (not a regular social icon).">
            <label className="flex items-center gap-3 text-[14px] text-[#18181B] mb-4 cursor-pointer">
              <input
                type="checkbox"
                checked={!!data?.footer?.viber_community?.enabled}
                onChange={(e) => updateFooter('viber_community.enabled', e.target.checked)}
                className="w-4 h-4 accent-[#18181B] cursor-pointer"
                data-testid="info-viber-enabled"
              />
              <span className="font-medium">Show Viber community block</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Viber link">
                <input
                  type="text"
                  value={data?.footer?.viber_community?.url || ''}
                  onChange={(e) => updateFooter('viber_community.url', e.target.value)}
                  className={inputCls}
                  placeholder="viber://chat?number=..."
                  data-testid="info-viber-url"
                />
              </Field>
              <Field label="Label (EN)">
                <input
                  type="text"
                  value={data?.footer?.viber_community?.label_en || ''}
                  onChange={(e) => updateFooter('viber_community.label_en', e.target.value)}
                  className={inputCls}
                  placeholder="Join Our Group And Get The Hottest Offers"
                />
              </Field>
              <Field label="Label (BG)">
                <input
                  type="text"
                  value={data?.footer?.viber_community?.label_bg || ''}
                  onChange={(e) => updateFooter('viber_community.label_bg', e.target.value)}
                  className={inputCls}
                  placeholder="Присъединете се към нашата група..."
                />
              </Field>
            </div>
          </Block>
        </div>
      )}

      {/* Cookie banner */}
      {tab === 'cookie_banner' && (
        <div className="space-y-5">
          <Block title="Cookie consent banner" description="Bilingual copy shown to first-time visitors at the bottom of the public site.">
            <label className="flex items-center gap-3 text-[14px] text-[#18181B] mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!data?.cookie_banner?.enabled}
                onChange={(e) => updateBanner('enabled', e.target.checked)}
                className="w-4 h-4 accent-[#18181B] cursor-pointer"
                data-testid="info-banner-enabled"
              />
              <span className="font-medium">Show cookie consent banner on first visit</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Title (EN)">
                <input
                  type="text"
                  value={data?.cookie_banner?.title_en || ''}
                  onChange={(e) => updateBanner('title_en', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Title (BG)">
                <input
                  type="text"
                  value={data?.cookie_banner?.title_bg || ''}
                  onChange={(e) => updateBanner('title_bg', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Body (EN)">
                <textarea
                  rows={4}
                  value={data?.cookie_banner?.body_en || ''}
                  onChange={(e) => updateBanner('body_en', e.target.value)}
                  className={textareaCls}
                />
              </Field>
              <Field label="Body (BG)">
                <textarea
                  rows={4}
                  value={data?.cookie_banner?.body_bg || ''}
                  onChange={(e) => updateBanner('body_bg', e.target.value)}
                  className={textareaCls}
                />
              </Field>
            </div>
          </Block>
        </div>
      )}

      {/* Light-theme Quill styling */}
      <style>{`
        .bibi-admin-quill .ql-toolbar {
          background: #FAFAFA;
          border: 1px solid #E4E4E7 !important;
          border-bottom: 0 !important;
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          padding: 8px 10px;
        }
        .bibi-admin-quill .ql-toolbar .ql-stroke { stroke: #52525B; }
        .bibi-admin-quill .ql-toolbar .ql-fill   { fill:   #52525B; }
        .bibi-admin-quill .ql-toolbar .ql-picker-label { color: #52525B; }
        .bibi-admin-quill .ql-toolbar button:hover .ql-stroke,
        .bibi-admin-quill .ql-toolbar .ql-active .ql-stroke { stroke: #18181B; }
        .bibi-admin-quill .ql-toolbar button:hover .ql-fill,
        .bibi-admin-quill .ql-toolbar .ql-active .ql-fill   { fill:   #18181B; }
        .bibi-admin-quill .ql-toolbar button:hover,
        .bibi-admin-quill .ql-toolbar .ql-active { background: #F4F4F5; border-radius: 4px; }
        .bibi-admin-quill .ql-toolbar .ql-picker-options {
          background: #FFF;
          color: #18181B;
          border: 1px solid #E4E4E7;
          border-radius: 6px;
          box-shadow: 0 6px 20px rgba(0,0,0,0.08);
        }
        .bibi-admin-quill .ql-container {
          background: #FFF;
          border: 1px solid #E4E4E7 !important;
          color: #18181B;
          font-size: 14px;
          min-height: 280px;
          border-bottom-left-radius: 8px;
          border-bottom-right-radius: 8px;
        }
        .bibi-admin-quill .ql-editor {
          min-height: 280px;
          font-family: inherit;
        }
        .bibi-admin-quill .ql-editor.ql-blank::before {
          color: #A1A1AA;
          font-style: normal;
        }
        .bibi-admin-quill .ql-editor a { color: #2563EB; text-decoration: underline; }
        .bibi-admin-quill .ql-editor h1,
        .bibi-admin-quill .ql-editor h2,
        .bibi-admin-quill .ql-editor h3 { color: #18181B; font-weight: 700; }
        .bibi-admin-quill .ql-editor blockquote {
          border-left: 3px solid #E4E4E7;
          padding-left: 12px;
          color: #52525B;
        }
      `}</style>
    </div>
  );
}
