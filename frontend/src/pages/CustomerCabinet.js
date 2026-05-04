import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../App';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useLang } from '../i18n';
import ShipmentTrackingMap from '../components/shipping/ShipmentTrackingMap';
import JourneyPanel from '../components/shipping/JourneyPanel';
import PaymentMethodPicker from '../components/payments/PaymentMethodPicker';
import CustomerOrders from '../components/cabinet/CustomerOrders';
import { useShipmentNotifications } from '../hooks/useShipmentNotifications';
import {
  House,
  FileText,
  Car,
  Wallet,
  ClockCounterClockwise,
  User,
  CaretRight,
  Check,
  Clock,
  Truck,
  Warning,
  Bell,
  Heart,
  SignOut,
  ArrowLeft,
  MapPin,
  Anchor,
  Package,
  Phone,
  Envelope,
  PencilSimple,
  ArrowRight,
  CircleNotch
} from '@phosphor-icons/react';
import { useCustomerAuth } from './public/CustomerAuth';
import { useCabinetTheme } from '../context/CabinetThemeContext';
import CabinetThemeToggle from '../components/cabinet/CabinetThemeToggle';

/**
 * Customer Cabinet - BIBI Cars Customer Journey UI
 * 
 * Головний фокус: де моя машина + що мені робити + що вже зроблено
 * НЕ CRM dashboard, а ПРОЦЕС покупки авто
 */

// Simplified Sidebar Navigation
const NAV_ITEMS = [
  { path: '', label: 'Головна', icon: House },
  { path: 'favorites', label: 'Обране', icon: Heart },
  { path: 'orders', label: 'Мої замовлення', icon: Car },
  { path: 'watchlist', label: 'Стеження за VIN', icon: Bell },
  { path: 'invoices', label: 'Рахунки', icon: Wallet },
  { path: 'shipping', label: 'Доставка', icon: Truck },
  { path: 'contracts', label: 'Договори', icon: FileText },
  { path: 'carfax', label: 'Carfax', icon: FileText },
  { path: 'notifications', label: 'Сповіщення', icon: Bell },
  { path: 'profile', label: 'Профіль', icon: User },
];

// Process Steps
const PROCESS_STEPS = [
  { code: 'selection', label: 'Вибір', icon: Car },
  { code: 'contract', label: 'Договір', icon: FileText },
  { code: 'payment', label: 'Оплата', icon: Wallet },
  { code: 'shipping', label: 'Доставка', icon: Truck },
  { code: 'received', label: 'Отримання', icon: Check },
];

// Status to Step mapping
const STATUS_TO_STEP = {
  'new': 0,
  'negotiation': 0,
  'contract_pending': 1,
  'contract_signed': 1,
  'deposit_pending': 2,
  'deposit_paid': 2,
  'payment_pending': 2,
  'payment_complete': 2,
  'auction_won': 2,
  'in_transit': 3,
  'shipping': 3,
  'at_port': 3,
  'customs': 3,
  'delivered': 4,
  'completed': 4,
};

// Layout Component
export const CabinetLayout = () => {
  return <CabinetLayoutInner />;
};

const CabinetLayoutInner = () => {
  const { customerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, customer: authCustomer } = useCustomerAuth();
  const { theme } = useCabinetTheme();
  const basePath = `/cabinet/${customerId}`;

  // Header-level customer state (fetched from cabinet endpoint, stays in sync)
  const [customer, setCustomer] = useState(authCustomer || null);

  const refreshCustomer = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/profile`);
      if (res.data?.customer) {
        setCustomer((prev) => ({ ...(prev || {}), ...res.data.customer }));
      }
    } catch (err) {
      // silent
    }
  }, [customerId]);

  useEffect(() => {
    refreshCustomer();
  }, [refreshCustomer]);

  // Re-fetch when route changes (cheap, ensures header stays in sync after profile edits)
  useEffect(() => {
    refreshCustomer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const isActive = (path) => {
    const fullPath = path ? `${basePath}/${path}` : basePath;
    return location.pathname === fullPath || (path && location.pathname.startsWith(`${basePath}/${path}`));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/cabinet/login');
    toast.success('Ви вийшли з кабінету');
  };

  const avatarUrl = customer?.picture || customer?.avatar;
  const initial = (customer?.firstName?.[0] || customer?.name?.[0] || 'B').toUpperCase();

  return (
    <div className="cabinet-scope min-h-screen bg-[#F8F8F8]" data-theme={theme} data-testid="cabinet-root">
      <div className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar - Compact */}
        <aside className="bg-white border border-[#E4E4E7] rounded-2xl p-4 h-fit sticky top-6">
          <div className="mb-4 pb-3 border-b border-[#E4E4E7]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-[#18181B] text-white flex items-center justify-center font-bold text-sm shrink-0">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="avatar"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  initial
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-[#18181B] text-sm truncate">
                  {customer?.firstName || customer?.name || 'Мій кабінет'}
                </h2>
                <p className="text-xs text-[#71717A] truncate">BIBI Cars</p>
              </div>
            </div>

            {/* Theme toggle row */}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.12em] text-[#71717A] font-semibold">
                Тема
              </span>
              <CabinetThemeToggle />
            </div>
          </div>
          
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path ? `${basePath}/${item.path}` : basePath}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                    active
                      ? 'bg-[#18181B] text-white'
                      : 'text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]'
                  }`}
                  data-testid={`nav-${item.path || 'dashboard'}`}
                >
                  <Icon size={18} weight={active ? 'fill' : 'regular'} />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Back & Logout */}
          <div className="mt-4 pt-3 border-t border-[#E4E4E7] space-y-1">
            <Link
              to="/"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#71717A] hover:bg-[#F4F4F5] text-sm"
              data-testid="back-to-site"
            >
              <ArrowLeft size={18} />
              <span>На сайт</span>
            </Link>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-500 hover:bg-red-50 text-sm"
              data-testid="logout-btn"
            >
              <SignOut size={18} />
              <span>Вийти</span>
            </button>
          </div>
        </aside>

        {/* Main Content — expose setCustomer/refreshCustomer to children via Outlet context */}
        <main>
          <Outlet context={{ customer, setCustomer, refreshCustomer }} />
        </main>
      </div>
    </div>
  );
};

// ============ NEW DASHBOARD - CUSTOMER JOURNEY UI ============
export const CabinetDashboard = () => {
  const { customerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, [customerId]);

  const loadDashboard = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/dashboard`);
      setData(res.data);
    } catch (error) {
      toast.error('Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!data) return <ErrorState />;

  const { customer, activeDeals, latestTimeline, nextAction, manager } = data;
  
  // Get primary active deal (most recent or in-progress)
  const primaryDeal = activeDeals?.[0];
  const currentStep = primaryDeal ? (STATUS_TO_STEP[primaryDeal.status] || 0) : 0;
  const progressPercent = primaryDeal ? Math.round(((currentStep + 1) / PROCESS_STEPS.length) * 100) : 0;

  // Determine CTA based on status
  const getCTA = () => {
    if (!primaryDeal) return null;
    
    const status = primaryDeal.status;
    
    if (status === 'contract_pending') {
      return { label: 'Підписати договір', action: 'contract', urgent: true };
    }
    if (status === 'deposit_pending' || status === 'payment_pending') {
      return { label: 'Оплатити', action: 'payment', urgent: true };
    }
    if (['in_transit', 'shipping', 'at_port'].includes(status)) {
      return { label: 'Переглянути доставку', action: 'shipping', urgent: false };
    }
    return null;
  };

  const cta = getCTA();
  const statusLabels = {
    'new': 'Нова заявка',
    'negotiation': 'Переговори',
    'contract_pending': 'Очікуємо підпис договору',
    'contract_signed': 'Договір підписано',
    'deposit_pending': 'Очікуємо депозит',
    'deposit_paid': 'Депозит оплачено',
    'payment_pending': 'Очікуємо оплату',
    'payment_complete': 'Оплачено',
    'auction_won': 'Аукціон виграно',
    'in_transit': 'В дорозі',
    'shipping': 'Доставка',
    'at_port': 'В порту',
    'customs': 'Митниця',
    'delivered': 'Доставлено',
    'completed': 'Завершено',
  };

  return (
    <div className="space-y-4" data-testid="cabinet-dashboard">
      
      {/* 1. HEADER - Compact Greeting + Status + CTA */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white border border-[#E4E4E7] rounded-2xl p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[#18181B]">
              Привіт, {customer.firstName || customer.name || 'Клієнт'}!
            </h1>
            {primaryDeal && (
              <p className="text-sm text-[#71717A] mt-1">
                Статус: <span className={`font-semibold ${
                  cta?.urgent ? 'text-amber-600' : 'text-[#18181B]'
                }`}>{statusLabels[primaryDeal.status] || primaryDeal.status}</span>
              </p>
            )}
          </div>
          
          {cta && (
            <Link
              to={`/cabinet/${customerId}/${cta.action === 'contract' ? 'contracts' : cta.action === 'payment' ? 'invoices' : 'shipping'}`}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                cta.urgent 
                  ? 'bg-[#18181B] text-white hover:bg-[#27272A]' 
                  : 'bg-[#F4F4F5] text-[#18181B] hover:bg-[#E4E4E7]'
              }`}
              data-testid="main-cta"
            >
              {cta.label}
            </Link>
          )}
        </div>

        {/* Progress Bar */}
        {primaryDeal && (
          <div className="mt-4">
            <div className="h-2 bg-[#E4E4E7] rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-[#18181B]" 
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-xs text-[#71717A] mt-2">
              Етап {currentStep + 1} з {PROCESS_STEPS.length} — {PROCESS_STEPS[currentStep]?.label}
            </p>
          </div>
        )}
      </motion.div>

      {/* 2. ACTION ALERT - If urgent action needed */}
      {nextAction && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`rounded-2xl p-5 ${
            nextAction.urgency === 'high' 
              ? 'bg-amber-50 border border-amber-200' 
              : 'bg-emerald-50 border border-emerald-200'
          }`}
          data-testid="action-alert"
        >
          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              nextAction.urgency === 'high' ? 'bg-amber-500' : 'bg-emerald-500'
            }`}>
              <Warning size={20} weight="fill" className="text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-[#18181B]">{nextAction.title}</h3>
              <p className="text-sm text-[#71717A] mt-1">{nextAction.description}</p>
            </div>
            {nextAction.dealId && (
              <Link 
                to={`/cabinet/${customerId}/orders/${nextAction.dealId}`}
                className="bg-[#18181B] text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-[#27272A]"
              >
                Переглянути
              </Link>
            )}
          </div>
        </motion.div>
      )}

      {/* 3. VEHICLE BLOCK - The main thing customer wants to see */}
      {primaryDeal && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white border border-[#E4E4E7] rounded-2xl overflow-hidden"
          data-testid="vehicle-block"
        >
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-[#F4F4F5] rounded-xl flex items-center justify-center shrink-0">
                <Car size={24} className="text-[#18181B]" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-lg text-[#18181B]">
                  {primaryDeal.title || primaryDeal.vehicleTitle || 'Ваш автомобіль'}
                </h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-[#71717A]">
                  <span>VIN: {primaryDeal.vin || '—'}</span>
                  {primaryDeal.lot && <span>Лот: {primaryDeal.lot}</span>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-[#18181B]">${(primaryDeal.clientPrice || 0).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Shipping Status - If applicable */}
          {['in_transit', 'shipping', 'at_port', 'customs', 'delivered'].includes(primaryDeal.status) && (
            <div className="border-t border-[#E4E4E7] p-5 bg-[#FAFAFA]">
              <div className="flex items-center gap-3 mb-3">
                <MapPin size={18} className="text-[#71717A]" />
                <span className="text-sm font-medium text-[#18181B]">Поточний статус:</span>
                <span className="text-sm text-emerald-600 font-semibold">
                  {primaryDeal.shippingStatus || statusLabels[primaryDeal.status]}
                </span>
              </div>
              
              {primaryDeal.eta && (
                <div className="flex items-center gap-3">
                  <Clock size={18} className="text-[#71717A]" />
                  <span className="text-sm text-[#71717A]">ETA:</span>
                  <span className="text-sm font-semibold text-[#18181B]">
                    {primaryDeal.etaDays ? `${primaryDeal.etaDays} днів` : new Date(primaryDeal.eta).toLocaleDateString('uk-UA')}
                  </span>
                </div>
              )}

              {primaryDeal.containerNumber && (
                <div className="flex items-center gap-3 mt-2">
                  <Package size={18} className="text-[#71717A]" />
                  <span className="text-sm text-[#71717A]">Контейнер:</span>
                  <span className="text-sm font-mono text-[#18181B]">{primaryDeal.containerNumber}</span>
                </div>
              )}
            </div>
          )}

          {/* View Details Link */}
          <Link 
            to={`/cabinet/${customerId}/orders/${primaryDeal.id}`}
            className="block border-t border-[#E4E4E7] p-3 text-center text-sm font-medium text-[#18181B] hover:bg-[#F4F4F5] transition-colors"
          >
            Детальніше про замовлення <ArrowRight size={14} className="inline ml-1" />
          </Link>
        </motion.div>
      )}

      {/* 4. TIMELINE - What's happening (vertical) */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white border border-[#E4E4E7] rounded-2xl p-5"
        data-testid="timeline-block"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[#18181B]">Хід процесу</h2>
          <Link to={`/cabinet/${customerId}/timeline`} className="text-xs text-[#71717A] hover:text-[#18181B]">
            Всі події
          </Link>
        </div>

        {latestTimeline && latestTimeline.length > 0 ? (
          <div className="space-y-0">
            {latestTimeline.slice(0, 5).map((event, idx) => (
              <div key={event.id} className="flex gap-3">
                {/* Vertical Line */}
                <div className="flex flex-col items-center">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${
                    idx === 0 ? 'bg-emerald-500' : 'bg-[#E4E4E7]'
                  }`} />
                  {idx < latestTimeline.length - 1 && idx < 4 && (
                    <div className="w-0.5 h-full min-h-[40px] bg-[#E4E4E7]" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-4">
                  <p className={`text-sm font-medium ${idx === 0 ? 'text-[#18181B]' : 'text-[#71717A]'}`}>
                    {event.title || formatEventType(event.type)}
                  </p>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    {event.timestamp || event.createdAt
                      ? new Date(event.timestamp || event.createdAt).toLocaleDateString('uk-UA')
                      : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#71717A] text-center py-4">Поки що немає подій</p>
        )}
      </motion.div>

      {/* 5. MANAGER CONTACT - Compact */}
      {manager && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-[#18181B] text-white rounded-2xl p-5"
          data-testid="manager-block"
        >
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
              <User size={22} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white/60 text-xs">Ваш менеджер</p>
              <h3 className="font-semibold">{manager.name}</h3>
            </div>
            <div className="flex gap-2">
              {manager.phone && (
                <a href={`tel:${manager.phone}`} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">
                  <Phone size={18} />
                </a>
              )}
              {manager.email && (
                <a href={`mailto:${manager.email}`} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center hover:bg-white/20">
                  <Envelope size={18} />
                </a>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* No active orders - Show call to action */}
      {!primaryDeal && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white border border-[#E4E4E7] rounded-2xl p-8 text-center"
        >
          <div className="w-16 h-16 bg-[#F4F4F5] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Car size={32} className="text-[#71717A]" />
          </div>
          <h2 className="text-lg font-semibold text-[#18181B]">Поки немає активних замовлень</h2>
          <p className="text-sm text-[#71717A] mt-2 mb-6">
            Перегляньте наш каталог та оберіть авто вашої мрії
          </p>
          <Link
            to="/vehicles"
            className="inline-flex items-center gap-2 bg-[#18181B] text-white px-6 py-3 rounded-xl font-medium hover:bg-[#27272A]"
          >
            <Car size={18} />
            Переглянути авто
          </Link>
        </motion.div>
      )}
    </div>
  );
};

// Helper function
const formatEventType = (type) => {
  const labels = {
    'lead_created': 'Заявка створена',
    'deal_created': 'Замовлення створено',
    'deposit_created': 'Депозит виставлено',
    'deposit_confirmed': 'Депозит підтверджено',
    'contract_sent': 'Договір надіслано',
    'contract_signed': 'Договір підписано',
    'payment_received': 'Оплата отримана',
    'auction_won': 'Аукціон виграно',
    'shipping_started': 'Доставка почалась',
    'arrived_at_port': 'Прибуло в порт',
    'customs_cleared': 'Митниця пройдена',
    'delivered': 'Доставлено',
  };
  return labels[type] || type;
};

// ============ ORDERS PAGE ============
export const CabinetOrders = () => {
  const { customerId } = useParams();
  return (
    <div className="space-y-4" data-testid="cabinet-orders">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Мої замовлення</h1>
        <p className="text-sm text-[#71717A] mt-1">Статус виконання послуг по оплачених рахунках. Оновлюється автоматично кожні 30 секунд.</p>
      </div>
      <CustomerOrders customerId={customerId} />
    </div>
  );
};

// ============ ORDER DETAILS PAGE ============
export const CabinetOrderDetails = () => {
  const { customerId, dealId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrderDetails();
  }, [customerId, dealId]);

  const loadOrderDetails = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/orders/${dealId}`);
      setData(res.data);
    } catch (error) {
      toast.error('Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!data) return <ErrorState />;

  const { deal, processState, whatsNext, deposits, depositSummary, timeline } = data;
  const currentStep = STATUS_TO_STEP[deal.status] || 0;
  const progressPercent = Math.round(((currentStep + 1) / PROCESS_STEPS.length) * 100);

  return (
    <div className="space-y-4" data-testid="cabinet-order-details">
      {/* Back + Header */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <Link to={`/cabinet/${customerId}/orders`} className="text-sm text-[#71717A] hover:text-[#18181B] mb-3 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Назад
        </Link>
        <h1 className="text-xl font-bold text-[#18181B] mt-2">
          {deal.title || deal.vehicleTitle || `Замовлення`}
        </h1>
        <p className="text-sm text-[#71717A]">VIN: {deal.vin || '—'}</p>

        {/* Progress */}
        <div className="mt-4">
          <div className="h-2 bg-[#E4E4E7] rounded-full overflow-hidden">
            <div className="h-full bg-[#18181B] transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="flex justify-between mt-3">
            {PROCESS_STEPS.map((step, idx) => (
              <div key={step.code} className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                  idx < currentStep ? 'bg-emerald-500 text-white' :
                  idx === currentStep ? 'bg-[#18181B] text-white' :
                  'bg-[#E4E4E7] text-[#71717A]'
                }`}>
                  {idx < currentStep ? <Check size={14} /> : idx + 1}
                </div>
                <span className="text-[10px] mt-1 text-[#71717A]">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* What's Next */}
      {whatsNext && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <h3 className="font-semibold text-[#18181B]">{whatsNext.title}</h3>
          <p className="text-sm text-[#71717A] mt-1">{whatsNext.description}</p>
        </div>
      )}

      {/* Deal Info + Deposits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <h2 className="font-semibold text-[#18181B] mb-3">Деталі</h2>
          <div className="space-y-2 text-sm">
            <InfoRow label="Статус" value={deal.status} />
            <InfoRow label="Ціна" value={`$${(deal.clientPrice || 0).toLocaleString()}`} />
            <InfoRow label="Дата" value={new Date(deal.createdAt).toLocaleDateString('uk-UA')} />
          </div>
        </div>

        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <h2 className="font-semibold text-[#18181B] mb-3">Платежі</h2>
          <div className="space-y-2 text-sm">
            <InfoRow label="Депозитів" value={depositSummary?.total || 0} />
            <InfoRow label="Сума" value={`$${(depositSummary?.totalAmount || 0).toLocaleString()}`} />
            <InfoRow label="Підтверджено" value={`$${(depositSummary?.confirmedAmount || 0).toLocaleString()}`} />
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h2 className="font-semibold text-[#18181B] mb-4">Історія</h2>
        {timeline?.length > 0 ? (
          <div className="space-y-3">
            {timeline.map((event, idx) => (
              <div key={event.id} className="flex gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${idx === 0 ? 'bg-emerald-500' : 'bg-[#E4E4E7]'}`} />
                <div>
                  <p className="text-sm font-medium text-[#18181B]">{event.title || formatEventType(event.type)}</p>
                  <p className="text-xs text-[#A1A1AA]">{new Date(event.createdAt).toLocaleDateString('uk-UA')}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#71717A] text-center py-4">Немає подій</p>
        )}
      </div>
    </div>
  );
};

// ============ SIMPLE PAGES (Keep existing logic, simplified UI) ============

export const CabinetRequests = () => {
  const { customerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/requests`);
        setData(res.data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-requests">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Мої заявки</h1>
      </div>
      {data?.data?.length > 0 ? (
        <div className="space-y-3">
          {data.data.map((lead) => (
            <div key={lead.id} className="bg-white border border-[#E4E4E7] rounded-2xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium text-[#18181B]">{lead.firstName} {lead.lastName}</h3>
                  <p className="text-sm text-[#71717A]">VIN: {lead.vin || '—'}</p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-[#F4F4F5]">{lead.status}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає заявок" />
      )}
    </div>
  );
};

export const CabinetDeposits = () => {
  const { customerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/deposits`);
        setData(res.data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-deposits">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Депозити</h1>
        {data?.summary && (
          <div className="flex gap-4 mt-3">
            <div className="bg-[#F4F4F5] rounded-xl px-4 py-2">
              <p className="text-xs text-[#71717A]">Всього</p>
              <p className="font-bold">${data.summary.totalAmount?.toLocaleString() || 0}</p>
            </div>
            <div className="bg-emerald-50 rounded-xl px-4 py-2">
              <p className="text-xs text-emerald-600">Підтверджено</p>
              <p className="font-bold text-emerald-600">{data.summary.confirmed || 0}</p>
            </div>
          </div>
        )}
      </div>
      {data?.data?.length > 0 ? (
        <div className="space-y-3">
          {data.data.map((dep) => (
            <div key={dep.id} className="bg-white border border-[#E4E4E7] rounded-2xl p-4 flex justify-between items-center">
              <div>
                <p className="font-bold text-[#18181B]">${(dep.amount || 0).toLocaleString()}</p>
                <p className="text-xs text-[#71717A]">{new Date(dep.createdAt).toLocaleDateString('uk-UA')}</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                dep.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>{dep.status}</span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає депозитів" />
      )}
    </div>
  );
};

export const CabinetTimeline = () => {
  const { customerId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/timeline`);
        setData(res.data);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-timeline">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Історія подій</h1>
      </div>
      {data?.data?.length > 0 ? (
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5 space-y-4">
          {data.data.map((event, idx) => (
            <div key={event.id} className="flex gap-3">
              <div className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${idx === 0 ? 'bg-emerald-500' : 'bg-[#E4E4E7]'}`} />
              <div>
                <p className="font-medium text-[#18181B]">{event.title || formatEventType(event.type)}</p>
                {event.description && <p className="text-sm text-[#71717A]">{event.description}</p>}
                <p className="text-xs text-[#A1A1AA] mt-1">{new Date(event.createdAt).toLocaleString('uk-UA')}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає подій" />
      )}
    </div>
  );
};

export const CabinetNotifications = () => {
  const { customerId } = useParams();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/notifications?limit=50`);
        setNotifications(res.data?.data || res.data || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-notifications">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B] flex items-center gap-2">
          <Bell size={24} /> Сповіщення
        </h1>
      </div>
      {notifications.length > 0 ? (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className={`bg-white border rounded-2xl p-4 ${n.isRead ? 'border-[#E4E4E7]' : 'border-blue-300 bg-blue-50'}`}>
              <h3 className="font-medium text-[#18181B]">{n.title}</h3>
              <p className="text-sm text-[#71717A] mt-1">{n.message}</p>
              <p className="text-xs text-[#A1A1AA] mt-2">{new Date(n.createdAt).toLocaleString('uk-UA')}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає сповіщень" />
      )}
    </div>
  );
};

export const CabinetProfile = () => {
  const { customerId } = useParams();
  const outletCtx = useOutletContext() || {};
  const setLayoutCustomer = outletCtx.setCustomer;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  
  // Password change
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Email change
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  
  // Avatar
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/profile`);
        setData(res.data);
        const c = res.data.customer;
        if (c) {
          setFirstName(c.firstName || '');
          setLastName(c.lastName || '');
          setCity(c.city || '');
          setPhone(c.phone || '');
          // sync sidebar immediately
          if (setLayoutCustomer) setLayoutCustomer((prev) => ({ ...(prev || {}), ...c }));
        }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId, setLayoutCustomer]);

  // Helper to get auth headers
  const getAuthHeaders = () => {
    const headers = {};
    // Try JWT token first (email/password login)
    const token = localStorage.getItem('customer_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      return headers;
    }
    
    // Try session token from Google OAuth
    const session = localStorage.getItem('customer_session');
    if (session) {
      try {
        const sessionData = JSON.parse(session);
        if (sessionData.sessionToken) {
          headers['Authorization'] = `Bearer ${sessionData.sessionToken}`;
        }
      } catch {}
    }
    return headers;
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const res = await axios.patch(
        `${API_URL}/api/customer-cabinet/${customerId}/profile`,
        { firstName, lastName, city, phone }
      );
      toast.success('Профіль оновлено');
      setEditing(false);
      const updated = res.data?.customer || {};
      setData(prev => ({
        ...prev,
        customer: { ...prev.customer, ...updated, firstName, lastName, city, phone }
      }));
      if (setLayoutCustomer) {
        setLayoutCustomer((prev) => ({
          ...(prev || {}),
          ...updated,
          firstName,
          lastName,
          city,
          phone,
        }));
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Помилка збереження');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Паролі не співпадають');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Мінімум 6 символів');
      return;
    }
    setSaving(true);
    try {
      const headers = getAuthHeaders();
      if (!headers['Authorization']) {
        toast.error('Зміна пароля доступна лише для акаунтів з входом через email. Увійдіть знову через email+пароль.');
        return;
      }
      await axios.patch(`${API_URL}/api/customer-auth/me/password`,
        { currentPassword, newPassword },
        { headers, withCredentials: true }
      );
      toast.success('Пароль змінено');
      setShowPasswordModal(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      if (error.response?.status === 401) {
        toast.error('Невірний поточний пароль');
        return;
      }
      toast.error(error.response?.data?.message || error.response?.data?.detail || 'Помилка зміни паролю');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail.includes('@')) {
      toast.error('Невірний email');
      return;
    }
    setSaving(true);
    try {
      const headers = getAuthHeaders();
      if (!headers['Authorization']) {
        toast.error('Зміна email доступна лише через особистий кабінет. Увійдіть знову через email+пароль.');
        return;
      }
      await axios.patch(`${API_URL}/api/customer-auth/me/email`,
        { email: newEmail, password: emailPassword },
        { headers, withCredentials: true }
      );
      toast.success('Email змінено');
      setShowEmailModal(false);
      setData(prev => ({ ...prev, customer: { ...prev.customer, email: newEmail } }));
      setNewEmail('');
      setEmailPassword('');
    } catch (error) {
      toast.error(error.response?.data?.message || error.response?.data?.detail || 'Помилка зміни email');
    } finally {
      setSaving(false);
    }
  };

  // Завантаження аватара — використовує cabinet endpoint БЕЗ OAuth/Google redirect
  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Потрібен файл зображення');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Файл занадто великий. Максимум 5MB');
      e.target.value = '';
      return;
    }

    setAvatarUploading(true);
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await axios.post(
        `${API_URL}/api/customer-cabinet/${customerId}/avatar`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      const url = res.data?.url || res.data?.avatar || res.data?.picture;
      setData(prev => ({
        ...prev,
        customer: {
          ...prev.customer,
          avatar: url,
          picture: url,
        },
      }));
      // Push to sidebar layout immediately
      if (setLayoutCustomer) {
        setLayoutCustomer((prev) => ({
          ...(prev || {}),
          avatar: url,
          picture: url,
        }));
      }

      // Sync session cache if present
      const session = localStorage.getItem('customer_session');
      if (session) {
        try {
          const s = JSON.parse(session);
          s.picture = url;
          s.avatar = url;
          localStorage.setItem('customer_session', JSON.stringify(s));
        } catch {}
      }

      toast.success('Аватар оновлено');
    } catch (err) {
      console.error('Avatar upload error:', err?.response?.data || err.message);
      toast.error(err?.response?.data?.detail || 'Не вдалося завантажити аватар');
    } finally {
      setAvatarUploading(false);
      if (e?.target) e.target.value = '';
    }
  };

  // Видалення аватара
  const handleAvatarDelete = async () => {
    setAvatarUploading(true);
    try {
      await axios.delete(`${API_URL}/api/customer-cabinet/${customerId}/avatar`);
      setData(prev => ({
        ...prev,
        customer: { ...prev.customer, avatar: null, picture: null },
      }));
      if (setLayoutCustomer) {
        setLayoutCustomer((prev) => ({ ...(prev || {}), avatar: null, picture: null }));
      }
      toast.success('Аватар видалено');
    } catch (err) {
      toast.error('Помилка');
    } finally {
      setAvatarUploading(false);
    }
  };

  if (loading) return <LoadingState />;
  if (!data) return <ErrorState />;

  const { customer, stats, manager } = data;
  const avatar = customer?.picture || customer?.avatar;

  return (
    <div className="space-y-4" data-testid="cabinet-profile">
      {/* Header with Avatar */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <div className="flex items-center gap-4">
          {/* Avatar */}
          <div className="relative group">
            <div 
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold overflow-hidden bg-[#18181B] text-white ${avatarUploading ? 'opacity-50' : 'cursor-pointer'}`}
              onClick={() => !avatarUploading && fileInputRef.current?.click()}
            >
              {avatarUploading ? (
                <CircleNotch size={24} className="animate-spin" />
              ) : avatar ? (
                <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                (customer?.firstName?.[0] || 'C').toUpperCase()
              )}
            </div>
            {!avatarUploading && (
              <div 
                className="absolute inset-0 bg-black/50 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <PencilSimple size={20} className="text-white" />
              </div>
            )}
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              className="hidden" 
              onChange={handleAvatarChange}
            />
          </div>
          
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[#18181B]">
              {customer?.firstName} {customer?.lastName || customer?.name}
            </h1>
            <p className="text-sm text-[#71717A]">{customer?.email}</p>
          </div>
          
          {!editing ? (
            <button 
              onClick={() => setEditing(true)}
              className="p-2 hover:bg-[#F4F4F5] rounded-xl transition-colors"
              data-testid="edit-profile-btn"
            >
              <PencilSimple size={20} className="text-[#71717A]" />
            </button>
          ) : (
            <div className="flex gap-2">
              <button 
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 text-sm text-[#71717A] hover:bg-[#F4F4F5] rounded-lg"
              >
                Скасувати
              </button>
              <button 
                onClick={handleSaveProfile}
                disabled={saving}
                className="px-3 py-1.5 text-sm bg-[#18181B] text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Profile Info */}
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <h2 className="font-semibold text-[#18181B] mb-4">Особисті дані</h2>
          
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Ім'я</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#18181B] outline-none text-sm"
                  placeholder="Ім'я"
                  data-testid="profile-firstname-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Прізвище</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#18181B] outline-none text-sm"
                  placeholder="Прізвище"
                  data-testid="profile-lastname-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Місто</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#18181B] outline-none text-sm"
                  placeholder="Місто"
                  data-testid="profile-city-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Телефон</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl focus:ring-2 focus:ring-[#18181B] outline-none text-sm"
                  placeholder="+380..."
                  data-testid="profile-phone-input"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              <InfoRow label="Ім'я" value={customer?.firstName || '—'} />
              <InfoRow label="Прізвище" value={customer?.lastName || '—'} />
              <InfoRow label="Місто" value={customer?.city || '—'} />
              <InfoRow label="Телефон" value={customer?.phone || '—'} />
            </div>
          )}
        </div>

        {/* Account Security */}
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <h2 className="font-semibold text-[#18181B] mb-4">Безпека акаунту</h2>
          <div className="space-y-3">
            {/* Email */}
            <div className="flex items-center justify-between py-2 border-b border-[#F4F4F5]">
              <div>
                <p className="text-sm text-[#71717A]">Email</p>
                <p className="font-medium text-[#18181B]">{customer?.email || '—'}</p>
              </div>
              <button 
                onClick={() => { setShowEmailModal(true); setNewEmail(customer?.email || ''); }}
                className="text-xs text-[#18181B] hover:underline"
                data-testid="change-email-btn"
              >
                Змінити
              </button>
            </div>
            
            {/* Password */}
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm text-[#71717A]">Пароль</p>
                <p className="font-medium text-[#18181B]">••••••••</p>
              </div>
              <button 
                onClick={() => setShowPasswordModal(true)}
                className="text-xs text-[#18181B] hover:underline"
                data-testid="change-password-btn"
              >
                Змінити
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h2 className="font-semibold text-[#18181B] mb-3">Статистика</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-[#F4F4F5] rounded-xl p-3">
            <p className="text-[#71717A]">Замовлень</p>
            <p className="text-lg font-bold">{stats?.totalDeals || 0}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl p-3">
            <p className="text-emerald-600">Завершено</p>
            <p className="text-lg font-bold text-emerald-700">{stats?.completedDeals || 0}</p>
          </div>
          <div className="bg-[#F4F4F5] rounded-xl p-3">
            <p className="text-[#71717A]">Депозитів</p>
            <p className="text-lg font-bold">{stats?.totalDeposits || 0}</p>
          </div>
          <div className="bg-[#F4F4F5] rounded-xl p-3">
            <p className="text-[#71717A]">Клієнт з</p>
            <p className="text-lg font-bold">{stats?.memberSince ? new Date(stats.memberSince).toLocaleDateString('uk-UA') : '—'}</p>
          </div>
        </div>
      </div>

      {/* Manager */}
      {manager && (
        <div className="bg-[#18181B] text-white rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 bg-white/10 rounded-xl flex items-center justify-center">
              <User size={22} />
            </div>
            <div>
              <p className="text-white/60 text-xs">Ваш менеджер</p>
              <h3 className="font-semibold">{manager.name}</h3>
              <p className="text-white/60 text-sm">{manager.phone}</p>
            </div>
          </div>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[#18181B] mb-4">Змінити пароль</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Поточний пароль</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl text-sm"
                  data-testid="current-password-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Новий пароль</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl text-sm"
                  data-testid="new-password-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Підтвердити пароль</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl text-sm"
                  data-testid="confirm-password-input"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button 
                type="button"
                onClick={() => setShowPasswordModal(false)} 
                className="flex-1 py-2 text-sm text-[#71717A] hover:bg-[#F4F4F5] rounded-xl"
                data-testid="cancel-password-btn"
              >
                Скасувати
              </button>
              <button 
                type="button"
                onClick={handleChangePassword} 
                disabled={saving} 
                className="flex-1 py-2 text-sm bg-[#18181B] text-white rounded-xl disabled:opacity-50"
                data-testid="submit-password-btn"
              >
                {saving ? 'Збереження...' : 'Змінити'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Change Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[#18181B] mb-4">Змінити email</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Новий email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl text-sm"
                  data-testid="new-email-input"
                />
              </div>
              <div>
                <label className="text-xs text-[#71717A] block mb-1">Пароль для підтвердження</label>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-[#E4E4E7] rounded-xl text-sm"
                  data-testid="email-password-input"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button 
                type="button"
                onClick={() => setShowEmailModal(false)} 
                className="flex-1 py-2 text-sm text-[#71717A] hover:bg-[#F4F4F5] rounded-xl"
                data-testid="cancel-email-btn"
              >
                Скасувати
              </button>
              <button 
                type="button"
                onClick={handleChangeEmail} 
                disabled={saving} 
                className="flex-1 py-2 text-sm bg-[#18181B] text-white rounded-xl disabled:opacity-50"
                data-testid="submit-email-btn"
              >
                {saving ? 'Збереження...' : 'Змінити'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const CabinetCarfax = () => {
  const { customerId } = useParams();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/carfax`);
        setReports(res.data?.data || res.data || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-carfax">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Carfax звіти</h1>
      </div>
      {reports.length > 0 ? (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="bg-white border border-[#E4E4E7] rounded-2xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-[#18181B]">VIN: {r.vin}</p>
                  <p className="text-xs text-[#71717A]">{(r.issuedAt || r.createdAt) ? new Date(r.issuedAt || r.createdAt).toLocaleDateString('uk-UA') : ''}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${
                  r.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>{r.status}</span>
              </div>
              {r.pdfUrl && (
                <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
                  Завантажити PDF
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає Carfax звітів" />
      )}
    </div>
  );
};

export const CabinetContracts = () => {
  const { customerId } = useParams();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/contracts`);
        setContracts(res.data?.data || res.data || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  const handleSign = async (id) => {
    try {
      const res = await axios.post(`${API_URL}/api/docusign/envelopes/${id}/sign`, {
        customerId,
        returnUrl: window.location.href
      });
      if (res.data?.signingUrl) window.location.href = res.data.signingUrl;
    } catch (error) {
      toast.error('Помилка підписання');
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-contracts">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Договори</h1>
      </div>
      {contracts.length > 0 ? (
        <div className="space-y-3">
          {contracts.map((c) => (
            <div key={c.id} className="bg-white border border-[#E4E4E7] rounded-2xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-[#18181B]">{c.title || `Договір #${c.id?.slice(0, 8)}`}</p>
                  <p className="text-sm text-[#71717A]">VIN: {c.vin || c.dealVin || '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    c.status === 'signed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>{c.status === 'signed' ? 'Підписано' : 'Очікує'}</span>
                  {(c.status === 'pending' || c.status === 'sent') && (
                    <button onClick={() => handleSign(c.id)} className="px-3 py-1.5 bg-[#18181B] text-white text-sm rounded-lg">
                      Підписати
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає договорів" />
      )}
    </div>
  );
};

export const CabinetInvoices = () => {
  const { customerId } = useParams();
  const [data, setData] = useState({ invoices: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [pickerInvoice, setPickerInvoice] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/invoices`);
        const invoices = res.data?.data || res.data?.invoices || [];
        const summary = res.data?.summary || {
          totalAmount: invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0),
          paid: invoices.filter((i) => i.status === 'paid').length,
          pending: invoices.filter((i) => i.status !== 'paid').length,
        };
        setData({ invoices, summary });
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [customerId]);

  const handlePay = (invoice) => {
    if (typeof invoice === 'string') {
      // Backwards-compatible: caller passed an id
      const found = data.invoices.find((i) => i.id === invoice);
      if (found) setPickerInvoice(found); else toast.error('Рахунок не знайдено');
      return;
    }
    setPickerInvoice(invoice);
  };

  const proceedPay = async (selectedMethod) => {
    if (!pickerInvoice) return;
    try {
      const res = await axios.post(`${API_URL}/api/stripe/create-checkout-session`, {
        invoiceId: pickerInvoice.id,
        amount: pickerInvoice.amount,
        description: pickerInvoice.description || `Рахунок #${pickerInvoice.id}`,
        customerId,
        currency: pickerInvoice.currency,
        originUrl: window.location.origin,
        preferredMethod: selectedMethod,
      });
      if (res.data?.url) window.location.href = res.data.url;
      else toast.error('Не вдалось отримати URL платежу');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Помилка створення платежу');
    } finally {
      setPickerInvoice(null);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4" data-testid="cabinet-invoices">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
        <h1 className="text-xl font-bold text-[#18181B]">Рахунки та платежі</h1>
        <div className="flex gap-4 mt-3">
          <div className="bg-[#F4F4F5] rounded-xl px-4 py-2">
            <p className="text-xs text-[#71717A]">Всього</p>
            <p className="font-bold">${data.summary.totalAmount?.toLocaleString() || 0}</p>
          </div>
          <div className="bg-emerald-50 rounded-xl px-4 py-2">
            <p className="text-xs text-emerald-600">Оплачено</p>
            <p className="font-bold text-emerald-600">{data.summary.paid || 0}</p>
          </div>
          <div className="bg-amber-50 rounded-xl px-4 py-2">
            <p className="text-xs text-amber-600">Очікують</p>
            <p className="font-bold text-amber-600">{data.summary.pending || 0}</p>
          </div>
        </div>
      </div>
      {data.invoices.length > 0 ? (
        <div className="space-y-3">
          {data.invoices.map((inv) => (
            <div key={inv.id} className="bg-white border border-[#E4E4E7] rounded-2xl p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-lg text-[#18181B]">${(inv.amount || 0).toLocaleString()}</p>
                  <p className="text-sm text-[#71717A]">{inv.description || `Рахунок #${inv.id?.slice(0, 8)}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}>{inv.status === 'paid' ? 'Оплачено' : 'Очікує'}</span>
                  {inv.status === 'pending' && (
                    <button onClick={() => handlePay(inv)} className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg flex items-center gap-1">
                      <Wallet size={14} /> Оплатити
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState message="Немає рахунків" />
      )}

      {/* Payment method picker */}
      <PaymentMethodPicker
        open={!!pickerInvoice}
        onClose={() => setPickerInvoice(null)}
        amount={pickerInvoice?.amount}
        currency={pickerInvoice?.currency}
        description={pickerInvoice?.description || `Рахунок #${pickerInvoice?.id || ''}`}
        onProceed={proceedPay}
      />
    </div>
  );
};

export const CabinetShipping = () => {
  const { customerId } = useParams();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const {
    isConnected,
    positionUpdate,
    reconnectTimestamp,
    subscribe,
  } = useShipmentNotifications();

  const loadShipments = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/customer-cabinet/${customerId}/shipping`);
      const list = res.data?.data || res.data?.shipments || res.data || [];
      setShipments(Array.isArray(list) ? list : []);
      // auto-expand first active
      const active = (Array.isArray(list) ? list : []).find(
        (s) => !['delivered', 'cancelled'].includes(s.status)
      );
      if (active) setExpandedId(active.id);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    loadShipments();
  }, [loadShipments]);

  // Refetch on reconnect
  useEffect(() => {
    if (reconnectTimestamp > 0) loadShipments();
  }, [reconnectTimestamp, loadShipments]);

  // Subscribe to each active shipment room
  useEffect(() => {
    if (!isConnected) return;
    shipments.forEach((s) => {
      if (!['delivered', 'cancelled'].includes(s.status)) subscribe(s.id);
    });
  }, [isConnected, shipments, subscribe]);

  // Apply live position updates
  useEffect(() => {
    if (!positionUpdate || !positionUpdate.shipmentId) return;
    const pos = positionUpdate.currentPosition;
    const valid =
      pos &&
      Number.isFinite(pos.lat) &&
      Number.isFinite(pos.lng) &&
      pos.lat >= -90 && pos.lat <= 90 &&
      pos.lng >= -180 && pos.lng <= 180;
    setShipments((prev) =>
      prev.map((s) =>
        s.id === positionUpdate.shipmentId
          ? {
              ...s,
              progress:
                typeof positionUpdate.progress === 'number'
                  ? Math.max(0, Math.min(1, positionUpdate.progress))
                  : s.progress,
              liveEta: positionUpdate.eta || s.liveEta,
              trackingSource: positionUpdate.type || s.trackingSource,
              currentPosition: valid ? pos : s.currentPosition,
            }
          : s
      )
    );
  }, [positionUpdate]);

  if (loading) return <LoadingState />;

  const activeShipments = shipments.filter(
    (s) => !['delivered', 'cancelled'].includes(s.status)
  );
  const deliveredShipments = shipments.filter((s) => s.status === 'delivered');

  const statusBadge = (status) => {
    if (status === 'delivered') return { label: 'Доставлено', cls: 'bg-emerald-100 text-emerald-700' };
    if (status === 'in_transit') return { label: 'В дорозі', cls: 'bg-blue-100 text-blue-700' };
    if (status === 'at_port') return { label: 'В порту', cls: 'bg-indigo-100 text-indigo-700' };
    if (status === 'customs') return { label: 'Митниця', cls: 'bg-purple-100 text-purple-700' };
    return { label: status || 'Очікує', cls: 'bg-amber-100 text-amber-700' };
  };

  return (
    <div className="space-y-4" data-testid="cabinet-shipping">
      <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#18181B] flex items-center gap-2">
            <Truck size={24} /> Доставка
          </h1>
          <p className="text-sm text-[#71717A] mt-1">
            Live-трекінг авто від порту до вас
          </p>
        </div>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
            }`}
          />
          {isConnected ? 'Real-time' : 'Offline'}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Truck size={20} /> <span className="text-sm font-medium opacity-90">В дорозі</span>
          </div>
          <div className="text-3xl font-bold">{activeShipments.length}</div>
        </div>
        <div className="bg-white border border-[#E4E4E7] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Check size={20} className="text-emerald-500" />{' '}
            <span className="text-sm font-medium text-[#71717A]">Доставлено</span>
          </div>
          <div className="text-3xl font-bold text-[#18181B]">{deliveredShipments.length}</div>
        </div>
      </div>

      {shipments.length > 0 ? (
        <div className="space-y-4">
          {shipments.map((s) => {
            const badge = statusBadge(s.status);
            const expanded = expandedId === s.id;
            const liveUpdate =
              positionUpdate?.shipmentId === s.id ? positionUpdate : null;
            // Derive current vessel/container from the active stage (falls back
            // to top-level for legacy shipments).
            const curStage = (s.stages || []).find((st) => st.id === s.currentStageId);
            const curVessel = curStage?.vessel || s.vessel;
            const curContainer = curStage?.container || s.container;
            // Live status pill: 🟢 live / 🟡 estimated / 🔴 stale / ⚪ no-data
            // Uses backend-computed trackingHealth (which accounts for > 3h staleness).
            const src = s.trackingSource || s.currentPosition?.source;
            const health = s.trackingHealth;   // ok | estimated | stale | no_data
            const livePill = (() => {
              if (health === 'stale') {
                return { dot: 'bg-rose-500 animate-pulse', text: 'Застаріло', cls: 'bg-rose-50 text-rose-700 border-rose-200' };
              }
              if (health === 'ok') {
                return { dot: 'bg-emerald-500 animate-pulse', text: 'Live', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
              }
              if (health === 'estimated') {
                return { dot: 'bg-amber-500', text: 'Estimated', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
              }
              return { dot: 'bg-slate-400', text: 'Немає даних', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
            })();
            const progressPct = Math.min(100, Math.max(0, Math.round((s.progress || 0) * 100)));
            return (
              <div
                key={s.id}
                className="bg-white border border-[#E4E4E7] rounded-2xl overflow-hidden"
                data-testid={`shipment-card-${s.id}`}
              >
                <div
                  className="p-5 cursor-pointer hover:bg-[#FAFAFA]"
                  onClick={() =>
                    setExpandedId(expanded ? null : s.id)
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 bg-[#F4F4F5] rounded-xl flex items-center justify-center shrink-0">
                        <Truck size={20} className="text-[#18181B]" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[#18181B] truncate">
                          {s.vehicleTitle || `Доставка #${s.id?.slice(-6)}`}
                        </h3>
                        <p className="text-sm text-[#71717A] font-mono truncate">
                          VIN: {s.vin || '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${livePill.cls}`}
                        data-testid="live-pill"
                        title={`Tracking source: ${src || 'unknown'}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${livePill.dot}`} />
                        {livePill.text}
                      </span>
                      <span
                        className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </div>

                  {/* Vessel / container / region chips — CONTAINER-FIRST
                      (клиенту важнее контейнер, чем название судна) */}
                  {(curVessel?.name || curContainer?.number || s.location) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      {curContainer?.number && (
                        <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-800 border border-indigo-100 rounded-full px-2 py-0.5 font-mono">
                          📦 {curContainer.number}
                        </span>
                      )}
                      {curVessel?.name && (
                        <span className="inline-flex items-center gap-1 bg-sky-50 text-sky-800 border border-sky-100 rounded-full px-2 py-0.5 font-medium">
                          ⚓ {curVessel.name}
                        </span>
                      )}
                      {s.location && (
                        <span className="inline-flex items-center gap-1 bg-zinc-50 text-zinc-700 border border-zinc-200 rounded-full px-2 py-0.5">
                          📍 {s.location}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Emotional status line — "Автомобіль в Атлантичному океані" */}
                  {s.emotionalText && (
                    <div className="mt-2 text-sm text-zinc-700 italic">
                      {s.emotionalText}
                    </div>
                  )}

                  {/* Inline progress */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-zinc-700 min-w-[2.5rem] text-right">{progressPct}%</span>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    {s.originPort && (
                      <div>
                        <div className="text-xs text-[#71717A]">Звідки</div>
                        <div className="text-sm">{s.originPort}</div>
                      </div>
                    )}
                    {s.destinationPort && (
                      <div>
                        <div className="text-xs text-[#71717A]">Куди</div>
                        <div className="text-sm">{s.destinationPort}</div>
                      </div>
                    )}
                    {(s.liveEta || s.estimatedArrivalDate) && (
                      <div>
                        <div className="text-xs text-[#71717A]">ETA</div>
                        <div className="text-sm font-medium text-blue-600">
                          {new Date(s.liveEta || s.estimatedArrivalDate).toLocaleDateString('uk-UA')}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-[#E4E4E7] p-5 bg-[#FAFAFA] space-y-4">
                    {/* Full Journey Panel (map + overlay + stages + vessel
                        history + container + events). Replaces ad-hoc
                        map + events rendering. */}
                    <JourneyPanel
                      shipmentId={s.id}
                      initialJourney={s.stages ? s : null}
                      liveUpdate={liveUpdate}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState message="Немає активних доставок" />
      )}
    </div>
  );
};


// ============ COMPONENTS ============

const OrderCard = ({ deal, customerId }) => {
  const currentStep = STATUS_TO_STEP[deal.status] || 0;
  
  return (
    <Link 
      to={`/cabinet/${customerId}/orders/${deal.id}`}
      className="block bg-white border border-[#E4E4E7] rounded-2xl p-4 hover:border-[#18181B] transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-[#F4F4F5] rounded-xl flex items-center justify-center shrink-0">
            <Car size={20} className="text-[#71717A]" />
          </div>
          <div>
            <h3 className="font-medium text-[#18181B]">{deal.title || deal.vehicleTitle || deal.vin}</h3>
            <p className="text-sm text-[#71717A]">VIN: {deal.vin || '—'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-bold text-[#18181B]">${(deal.clientPrice || 0).toLocaleString()}</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[#71717A]">
            {deal.status}
          </span>
        </div>
      </div>
      {/* Mini Progress */}
      <div className="flex items-center gap-1 mt-3">
        {PROCESS_STEPS.map((_, idx) => (
          <div key={idx} className={`h-1 flex-1 rounded-full ${
            idx < currentStep ? 'bg-emerald-500' :
            idx === currentStep ? 'bg-[#18181B]' :
            'bg-[#E4E4E7]'
          }`} />
        ))}
      </div>
    </Link>
  );
};

const InfoRow = ({ label, value }) => (
  <div className="flex items-center justify-between py-1.5 border-b border-[#F4F4F5] last:border-0">
    <span className="text-[#71717A]">{label}</span>
    <span className="font-medium text-[#18181B]">{value}</span>
  </div>
);

const LoadingState = () => (
  <div className="flex items-center justify-center py-20">
    <CircleNotch size={32} className="animate-spin text-[#71717A]" />
  </div>
);

const ErrorState = () => (
  <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
    <p className="text-red-600">Помилка завантаження даних</p>
  </div>
);

const EmptyState = ({ message }) => (
  <div className="bg-white border border-[#E4E4E7] rounded-2xl p-8 text-center text-[#71717A]">
    {message}
  </div>
);

export default CabinetDashboard;
