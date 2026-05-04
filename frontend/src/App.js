/**
 * BIBI Cars - Main Application
 * 
 * Структура:
 * / - Публічний сайт (каталог, VIN перевірка)
 * /admin - CRM панель (з авторизацією)
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { Toaster } from 'sonner';

// i18n
import { LanguageProvider } from './i18n';

// Theming
import { CabinetThemeProvider } from './context/CabinetThemeContext';

// Public pages
import PublicLayout from './components/public/PublicLayout';
import HomePage from './pages/public/HomePage';
import VehiclesPage from './pages/public/VehiclesPage';
import VinCheckPage from './pages/public/VinCheckPage';
import VinResultPage from './pages/public/VinResultPage';
import VehicleDetailPage from './pages/public/VehicleDetailPage';
import CalculatorPage from './pages/public/CalculatorPage';
import ComingSoonPage from './pages/public/ComingSoonPage';
import CustomerLoginPage, { CustomerAuthProvider, CustomerProtectedRoute, AuthCallback } from './pages/public/CustomerAuth';
import ForgotPasswordPage from './pages/public/ForgotPasswordPage';
import ResetPasswordPage from './pages/public/ResetPasswordPage';
import { CollectionsPage, CollectionDetailPage } from './pages/public/CollectionsPage';
import AboutPage from './pages/public/AboutPage';
import ContactsPage from './pages/public/ContactsPage';
import BlogPage from './pages/public/BlogPage';
import PolicyPage from './pages/public/PolicyPage';
import CookieConsentBanner from './components/public/CookieConsentBanner';

// Admin pages
// import Login from './pages/Login'; // deprecated — unified auth in CustomerAuth
import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Customers from './pages/Customers';
// Legacy pages — kept as files but no longer mounted in routes.
// import Deals from './pages/Deals';
// import Deposits from './pages/Deposits';
// Deposits page deprecated — replaced by Legal Workflow (P0.3 tab). Redirect lives in routes.
// import Deposits from './pages/Deposits';
import Tasks from './pages/Tasks';
import Staff from './pages/Staff';
import Settings from './pages/Settings';
import Documents from './pages/Documents';
import ProxySettings from './pages/ProxySettings';
import ParserControl from './pages/ParserControl';
import ProxyManager from './pages/ProxyManager';
import ParserLogs from './pages/ParserLogs';
import ParserSettings from './pages/ParserSettings';
import CalculatorAdmin from './pages/CalculatorAdmin';
import Customer360 from './pages/Customer360';
import AdminAnalyticsDashboard from './components/AdminAnalyticsDashboard';
import AdminBusinessMetricsPage from './pages/admin/AdminBusinessMetricsPage';
import ProviderHealthPage from './pages/admin/ProviderHealthPage';
import MarketingControlPanel from './components/MarketingControlPanel';
import ModerationPage from './pages/ModerationPage';
import SourceHealthDashboard from './pages/admin/SourceHealthDashboard';
import VinEngineDashboard from './pages/admin/VinEngineDashboard';
import HistoryReportsAdmin from './pages/admin/HistoryReportsAdmin';
import StaffSessionsBoard from './pages/admin/StaffSessionsBoard';
import KPIDashboard from './pages/admin/KPIDashboard';
import CallBoardPage from './pages/admin/CallBoardPage';
import PredictiveLeadsPage from './pages/admin/PredictiveLeadsPage';
import SecuritySettings from './pages/admin/SecuritySettings';
import NotificationSettings from './pages/admin/NotificationSettings';
import CarfaxAdminPage from './pages/admin/CarfaxAdminPage';
import TeamLeadDashboard from './pages/admin/TeamLeadDashboard';
import IntegrationsPage from './pages/admin/IntegrationsPage';
import AdminPaymentsPage from './pages/admin/AdminPaymentsPage';
import AdminServicesPage from './pages/admin/AdminServicesPage';
import EmailTemplatesPage from './pages/admin/EmailTemplatesPage';
import NotificationRulesPage from './pages/admin/NotificationRulesPage';
import EmailOutboxPage from './pages/admin/EmailOutboxPage';
import ManagerOrdersPage from './pages/manager/ManagerOrdersPage';
import TeamOrdersPage from './pages/team/TeamOrdersPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AuthSettingsPage from './pages/admin/AuthSettingsPage';
import AdminInfoPage from './pages/admin/AdminInfoPage';
import RoutingRulesPage from './pages/admin/RoutingRulesPage';
import CadencesPage from './pages/admin/CadencesPage';
import ScoreRulesPage from './pages/admin/ScoreRulesPage';
import JourneyPage from './pages/admin/JourneyPage';
import RiskDashboardPage from './pages/admin/RiskDashboardPage';
import EscalationDashboard from './pages/admin/EscalationDashboard';
import ContractsAccountingPage from './pages/admin/ContractsAccountingPage';
import LegalWorkflowPage from './pages/admin/LegalWorkflowPage';
import RingostatAdminPage from './pages/admin/RingostatAdminPage';
import VesselFinderSessionPage from './pages/admin/VesselFinderSessionPage';
import ExceptionsDashboardPage from './pages/admin/ExceptionsDashboardPage';
import AutomationExceptionsPage from './pages/admin/AutomationExceptionsPage';
import ExtClientsPage from './pages/admin/ExtClientsPage';
import ShipmentJourneyManager from './pages/admin/ShipmentJourneyManager';
import TrackingLayout, { TrackingIndex } from './pages/admin/TrackingLayout';

// Team Lead pages
import TeamDashboardPage from './pages/team/TeamDashboardPage';
import TeamManagersPage from './pages/team/TeamManagersPage';
import ManagerProfilePage from './pages/team/ManagerProfilePage';
import TeamLeadsPage from './pages/team/TeamLeadsPage';
import ReassignmentCenterPage from './pages/team/ReassignmentCenterPage';
import TeamTasksPage from './pages/team/TeamTasksPage';
import TeamPaymentsPage from './pages/team/TeamPaymentsPage';
import TeamShippingPage from './pages/team/TeamShippingPage';
import TeamAlertsPage from './pages/team/TeamAlertsPage';
import TeamPerformancePage from './pages/team/TeamPerformancePage';

// Manager pages
import ManagerWorkspacePage from './pages/manager/ManagerWorkspacePage';
import ManagerShipmentsPage from './pages/manager/ManagerShipmentsPage';
import UniversalTrackerPage from './pages/manager/UniversalTrackerPage';

import NotificationsPage from './pages/NotificationsPage';
import ParserTestLab from './pages/ParserTestLab';
import {
  CabinetLayout,
  CabinetDashboard,
  CabinetOrders,
  CabinetOrderDetails,
  CabinetRequests,
  CabinetDeposits,
  CabinetTimeline,
  CabinetProfile,
  CabinetNotifications,
  CabinetCarfax,
  CabinetContracts,
  CabinetInvoices,
  CabinetShipping
} from './pages/CustomerCabinet';
import Layout from './components/Layout';

// User Engagement Cabinet pages
import FavoritesPage from './pages/cabinet/FavoritesPage';
import WatchlistPage from './pages/cabinet/WatchlistPage';
import ComparePage from './pages/cabinet/ComparePage';
import HistoryPage from './pages/cabinet/HistoryPage';
import HistoryReportsPage from './pages/cabinet/HistoryReportsPage';
import CarfaxPage from './pages/cabinet/CarfaxPage';
import ManagerCallsPage from './pages/manager/ManagerCallsPage';
import MissedCallsBoard from './pages/manager/MissedCallsBoard';
import ManagerTasksPage from './pages/manager/ManagerTasksPage';

// Cabinet P1 pages
import InvoicesPage from './pages/cabinet/InvoicesPage';
import ContractsPage from './pages/cabinet/ContractsPage';
import ShippingPage from './pages/cabinet/ShippingPage';
import PaymentSuccessPage from './pages/cabinet/PaymentSuccessPage';

// Manager pages
import ManagerInvoicesPage from './pages/ManagerInvoicesPage';

// Intent & AI Dashboard
import IntentDashboard from './pages/IntentDashboard';
// Twilio & AutoCallSettings removed - using Ringostat instead
import UserEngagementPage from './pages/UserEngagementPage';

// Owner & Finance Dashboards
import OwnerPaymentDashboard from './pages/OwnerPaymentDashboard';
import InvoiceRemindersDashboard from './pages/InvoiceRemindersDashboard';

// Analytics
import { initAnalytics } from './utils/analytics';

import './App.css';

// Initialize analytics tracking
if (typeof window !== 'undefined') {
  initAnalytics();
}

// Use REACT_APP_BACKEND_URL for API calls
// Falls back to same origin if not set
const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token]);

  // Setup axios interceptor for auth errors
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        // Only logout on explicit 401 from auth endpoints
        if (error.response?.status === 401 && error.config?.url?.includes('/api/auth/me')) {
          logout();
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const fetchUser = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/auth/me`);
      setUser(res.data);
    } catch (err) {
      // Only logout if it's an auth error
      if (err.response?.status === 401) {
        logout();
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const res = await axios.post(`${API_URL}/api/auth/login`, { email, password });
    const { access_token, user } = res.data;
    localStorage.setItem('token', access_token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    setToken(access_token);
    setUser(user);
    return user;
  };

  const logout = () => {
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F7F7F8]">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-[#0A0A0B] border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-sm text-[#71717A]">Завантаження...</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/cabinet/login" replace />;
  }
  
  return children;
};

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <CabinetThemeProvider>
          <AuthProvider>
            <CustomerAuthProvider>
              <Toaster
                position="top-right"
                theme="dark"
                closeButton
                toastOptions={{
                  classNames: {
                    toast:
                      'bibi-toast !bg-[#1D1D1B] !text-white !border !border-[#3a3a38] !rounded-lg !shadow-[0_12px_40px_rgba(0,0,0,0.6)]',
                    title: '!text-white !font-semibold',
                    description: '!text-[#B0B0B0]',
                    success: '!border-[#FEAE00]/40',
                    error: '!border-red-500/50',
                    info: '!border-[#FEAE00]/30',
                    actionButton:
                      '!bg-[#FEAE00] !text-black !font-semibold hover:!bg-[#FFBF2D]',
                    cancelButton:
                      '!bg-transparent !text-[#B0B0B0] hover:!text-white',
                    closeButton:
                      '!bg-[#2a2a28] !border !border-[#3a3a38] !text-[#B0B0B0] hover:!text-[#FEAE00]',
                  },
                }}
              />
            <Routes>
              {/* ====== PUBLIC SITE ====== */}
              <Route path="/" element={<PublicLayout />}>
                <Route index element={<HomePage />} />
                {/* /catalog and /calculator — placeholder while new UI is being built.
                    Old VehiclesPage / CalculatorPage stay in the codebase but are not
                    wired to public routes; backend endpoints remain available. */}
                <Route path="catalog" element={<ComingSoonPage breadcrumbKey="catalog" title="Catalog" />} />
                <Route path="calculator" element={<ComingSoonPage breadcrumbKey="calculator" title="Calculator" />} />
                {/* Vehicle detail still works via /vehicle/:id (legacy) */}
                <Route path="vehicle/:id" element={<VehicleDetailPage />} />
                <Route path="cars/:slug" element={<VehicleDetailPage />} />
              <Route path="vin-check" element={<VinCheckPage />} />
              <Route path="vin-check/:vin" element={<VinCheckPage />} />
              <Route path="vin" element={<VinResultPage />} />
              <Route path="vin/:query" element={<VinResultPage />} />
              <Route path="search/:query" element={<VinResultPage />} />
              <Route path="blog" element={<BlogPage />} />
              <Route path="collections" element={<CollectionsPage />} />
              <Route path="collections/:slug" element={<CollectionDetailPage />} />
            </Route>

            {/* About Us — pixel-perfect Figma page (own header/footer, NOT PublicLayout) */}
            <Route path="/about" element={<AboutPage />} />

            {/* Contacts — pixel-perfect Figma page (own header/footer, NOT PublicLayout) */}
            <Route path="/contacts" element={<ContactsPage />} />

            {/* Legal / policy pages — driven by /api/site-info content (admin editable) */}
            <Route path="/privacy" element={<PolicyPage policyKey="privacy" />} />
            <Route path="/terms" element={<PolicyPage policyKey="terms" />} />
            <Route path="/cookies" element={<PolicyPage policyKey="cookies" />} />
            <Route path="/conditions" element={<PolicyPage policyKey="conditions" />} />

            {/* ====== CUSTOMER AUTH ====== */}
            <Route path="/cabinet/login" element={<CustomerLoginPage />} />
            <Route path="/cabinet/callback" element={<AuthCallback />} />
            <Route path="/cabinet/auth/callback" element={<AuthCallback />} />
            <Route path="/cabinet/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/cabinet/reset-password" element={<ResetPasswordPage />} />
            
            {/* ====== CABINET - ПРЯМОЙ ДОСТУП БЕЗ АВТОРИЗАЦИИ ====== */}
            <Route path="/cabinet" element={<Navigate to="/cabinet/test_customer_001" replace />} />
            <Route path="/cabinet/favorites" element={<FavoritesPage />} />
            <Route path="/cabinet/compare" element={<ComparePage />} />
            <Route path="/cabinet/history" element={<HistoryPage />} />
            <Route path="/cabinet/history-reports" element={<HistoryReportsPage />} />
            <Route path="/cabinet/carfax" element={<CarfaxPage />} />
            <Route path="/cabinet/invoices" element={<InvoicesPage />} />
            <Route path="/cabinet/contracts" element={<ContractsPage />} />
            <Route path="/cabinet/shipping" element={<ShippingPage />} />

            {/* ====== ADMIN CRM ====== */}
            {/* /admin/login is gone — unified auth lives at /cabinet/login
                (reached via the profile icon in the public header). Any
                stale bookmarks to /admin/login get redirected there. */}
            <Route path="/admin/login" element={<Navigate to="/cabinet/login" replace />} />
            <Route path="/admin" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<Dashboard />} />
              <Route path="leads" element={<Leads />} />
              <Route path="customers" element={<Customers />} />
              <Route path="customers/:id/360" element={<Customer360 />} />
              {/* Legacy /admin/deals — fully redirected to new Deal Pipeline (P0.2 tab in Legal Workflow). */}
              <Route path="deals" element={<Navigate to="/admin/legal?tab=deal_pipeline" replace />} />
              {/* Legacy /admin/deposits — fully redirected to new Legal Workflow (P0.3 tab). */}
              <Route path="deposits" element={<Navigate to="/admin/legal?tab=deposit_v2" replace />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="staff" element={<Staff />} />
              <Route path="documents" element={<Documents />} />
              <Route path="settings" element={<AdminSettingsPage />} />
              <Route path="settings/auth" element={<AuthSettingsPage />} />
              <Route path="info" element={<AdminInfoPage />} />
              <Route path="proxy-settings" element={<ProxySettings />} />
              <Route path="parser" element={<ParserControl />} />
              <Route path="parser/proxies" element={<ProxyManager />} />
              <Route path="parser/logs" element={<ParserLogs />} />
              <Route path="parser/settings" element={<ParserSettings />} />
              {/* Chrome Extension install + download page (Ctrl Center CTA links here) */}
              <Route path="parser-mesh/test" element={<ParserTestLab />} />
              {/* Legacy: Chrome Extension page is now a tab inside /admin/parser */}
              <Route path="parser/chrome-extension" element={<Navigate to="/admin/parser?tab=extension" replace />} />
              <Route path="source-health" element={<SourceHealthDashboard />} />
              <Route path="vin-engine" element={<VinEngineDashboard />} />
              {/* ❌ REMOVED (April 2026): /admin/vin (Parser Sources Control) — duplicate
                   of functionality already covered by /admin/parser/settings.
                  ❌ REMOVED: /admin/vehicles (catalog rudiment) and /admin/analytics/quotes (mock-only data) */}
              <Route path="calculator" element={<CalculatorAdmin />} />
              <Route path="analytics" element={<AdminAnalyticsDashboard />} />
              <Route path="business-metrics" element={<AdminBusinessMetricsPage />} />
              <Route path="provider-health" element={<ProviderHealthPage />} />
              {/* ❌ REMOVED: marketing control (не используется, логика неясна) */}
              {/* <Route path="marketing" element={<MarketingControlPanel />} /> */}
              <Route path="moderation" element={<ModerationPage />} />
              <Route path="listings/moderation" element={<ModerationPage />} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="intent" element={<IntentDashboard />} />
              <Route path="engagement" element={<UserEngagementPage />} />
              {/* Twilio & auto-call removed - use Settings > Integrations > Ringostat */}
              <Route path="history-reports" element={<HistoryReportsAdmin />} />
              <Route path="staff-sessions" element={<StaffSessionsBoard />} />
              <Route path="kpi" element={<KPIDashboard />} />
              <Route path="call-board" element={<CallBoardPage />} />
              <Route path="predictive-leads" element={<PredictiveLeadsPage />} />
              <Route path="security" element={<SecuritySettings />} />
              <Route path="notification-settings" element={<NotificationSettings />} />
              <Route path="carfax" element={<CarfaxAdminPage />} />
              <Route path="team-lead" element={<TeamLeadDashboard />} />
              <Route path="integrations" element={<IntegrationsPage />} />
              <Route path="payments" element={<AdminPaymentsPage />} />
              <Route path="services" element={<AdminServicesPage />} />
              <Route path="settings/email-templates" element={<EmailTemplatesPage />} />
              <Route path="settings/notifications-rules" element={<NotificationRulesPage />} />
              <Route path="settings/email-outbox" element={<EmailOutboxPage />} />
              <Route path="routing-rules" element={<RoutingRulesPage />} />
              <Route path="cadences" element={<CadencesPage />} />
              <Route path="score-rules" element={<ScoreRulesPage />} />
              <Route path="journey" element={<JourneyPage />} />
              <Route path="risk" element={<RiskDashboardPage />} />
              <Route path="escalations" element={<EscalationDashboard />} />
              <Route path="contracts/accounting" element={<ContractsAccountingPage />} />
              <Route path="legal" element={<LegalWorkflowPage />} />
              <Route path="ringostat" element={<RingostatAdminPage />} />

              {/* ═══════════════════ Unified TRACKING hub ═══════════════════
                * Single sidebar entry in the main left nav → `/admin/tracking`.
                * All scattered shipping/vessel/exception pages now live under
                * this nested layout with an internal horizontal tab header.
                * Legacy URLs below redirect to the new paths for back-compat. */}
              <Route path="tracking" element={<TrackingLayout />}>
                <Route index element={<Navigate to="/admin/tracking/vesselfinder" replace />} />
                <Route path="vesselfinder" element={<VesselFinderSessionPage />} />
                <Route path="shipments" element={<ShipmentJourneyManager />} />
                <Route path="exceptions/shipments" element={<ExceptionsDashboardPage />} />
                <Route path="exceptions/automation" element={<AutomationExceptionsPage />} />
                <Route path="ext-clients" element={<ExtClientsPage />} />
                <Route path="*" element={<TrackingIndex />} />
              </Route>

              {/* Legacy redirects — keep old URLs working without 404 */}
              <Route path="vesselfinder" element={<Navigate to="/admin/tracking/vesselfinder" replace />} />
              <Route path="shipments/exceptions" element={<Navigate to="/admin/tracking/exceptions/shipments" replace />} />
              <Route path="identity/exceptions" element={<Navigate to="/admin/tracking/exceptions/automation" replace />} />
              <Route path="ext-clients" element={<Navigate to="/admin/tracking/ext-clients" replace />} />
              <Route path="shipment-journey" element={<Navigate to="/admin/tracking/shipments" replace />} />
              <Route path="owner-dashboard" element={<OwnerPaymentDashboard />} />
              <Route path="invoice-reminders" element={<InvoiceRemindersDashboard />} />

              {/* Catch-all for unknown /admin/* routes — redirects to dashboard.
                  Covers removed routes like /admin/vehicles and /admin/analytics/quotes
                  so users land on a sane page instead of falling through to public site. */}
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Route>

            {/* ====== TEAM LEAD WORKSPACE ====== */}
            <Route path="/team" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<TeamDashboardPage />} />
              <Route path="dashboard" element={<TeamDashboardPage />} />
              <Route path="managers" element={<TeamManagersPage />} />
              <Route path="managers/:id" element={<ManagerProfilePage />} />
              <Route path="leads" element={<TeamLeadsPage />} />
              <Route path="reassignments" element={<ReassignmentCenterPage />} />
              <Route path="tasks" element={<TeamTasksPage />} />
              <Route path="payments" element={<TeamPaymentsPage />} />
              <Route path="shipping" element={<TeamShippingPage />} />
              <Route path="alerts" element={<TeamAlertsPage />} />
              <Route path="performance" element={<TeamPerformancePage />} />
              <Route path="orders" element={<TeamOrdersPage />} />
            </Route>

            {/* ====== MANAGER WORKSPACE ====== */}
            <Route path="/manager" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<ManagerWorkspacePage />} />
              <Route path="calls" element={<ManagerCallsPage />} />
              <Route path="calls/missed" element={<MissedCallsBoard />} />
              <Route path="tasks" element={<ManagerTasksPage />} />
              <Route path="invoices" element={<ManagerInvoicesPage />} />
              <Route path="orders" element={<ManagerOrdersPage />} />
              <Route path="shipments" element={<ManagerShipmentsPage />} />
              <Route path="tracking" element={<UniversalTrackerPage />} />
            </Route>

            {/* ====== CUSTOMER CABINET (CLIENT PORTAL) ====== */}
            <Route path="/cabinet/:customerId" element={<CabinetLayout />}>
              <Route index element={<CabinetDashboard />} />
              <Route path="notifications" element={<CabinetNotifications />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="watchlist" element={<WatchlistPage />} />
              <Route path="compare" element={<ComparePage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="requests" element={<CabinetRequests />} />
              <Route path="orders" element={<CabinetOrders />} />
              <Route path="orders/:dealId" element={<CabinetOrderDetails />} />
              <Route path="deposits" element={<CabinetDeposits />} />
              <Route path="carfax" element={<CabinetCarfax />} />
              <Route path="contracts" element={<CabinetContracts />} />
              <Route path="invoices" element={<CabinetInvoices />} />
              <Route path="payment-success" element={<PaymentSuccessPage />} />
              <Route path="shipping" element={<CabinetShipping />} />
              <Route path="timeline" element={<CabinetTimeline />} />
              <Route path="profile" element={<CabinetProfile />} />
            </Route>

            {/* Legacy redirect: /login → unified /cabinet/login */}
            <Route path="/login" element={<Navigate to="/cabinet/login" replace />} />
            
            {/* Catch all - redirect to home */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
            <CookieConsentBanner />
            </CustomerAuthProvider>
          </AuthProvider>
        </CabinetThemeProvider>
    </LanguageProvider>
    </BrowserRouter>
  );
}

export default App;
export { API_URL };
