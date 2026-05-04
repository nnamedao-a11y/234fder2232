import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import { useLang, LANGUAGES } from '../i18n';
import NotificationBell from './NotificationBell';
import RingostatManager from './ringostat/RingostatManager';
import RingostatLiveBar from './ringostat/RingostatLiveBar';
import { 
  ChartPieSlice,
  UsersThree,
  UserCircle,
  Handshake,
  Wallet,
  FileText,
  CarProfile,
  MagnifyingGlass,
  Calculator,
  UsersFour,
  ClipboardText,
  GearSix,
  Database,
  SignOut,
  CaretDown,
  CaretUp,
  ChartLine,
  Megaphone,
  ChartBar,
  UserPlus,
  CreditCard,
  Receipt,
  Car,
  Barcode,
  Percent,
  Users,
  ListChecks,
  Sliders,
  Wrench,
  TrendUp,
  Target,
  List,
  X,
  Globe,
  Phone,
  PhoneCall,
  Anchor,
  Heart,
  Shield,
  ShieldCheck,
  Plugs,
  Path,
  Timer,
  Lightning,
  Briefcase,
  Stack,
  Truck,
  Bell,
  ArrowsClockwise,
  Fire,
  ChartLineUp,
  Kanban,
  User,
  Warning,
  Gauge,
  Scales
} from '@phosphor-icons/react';

const Layout = () => {
  const { user, logout, token } = useAuth();
  const { t, lang, changeLang, languages } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Language dropdown state
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef(null);
  
  // Mobile search state
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [automationExceptionsCount, setAutomationExceptionsCount] = useState(0);
  
  // Track expanded sections - all collapsed by default
  const [expandedSections, setExpandedSections] = useState({
    crm: false,
    finance: false,
    auto: false,
    team: false,
    teamWorkspace: false,
    managerWorkspace: false,
    control: false,
    settings: false,
    marketing: false
  });

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsMobileMenuOpen(false);
        setIsLangDropdownOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Close language dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target)) {
        setIsLangDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search navigation items
  const searchItems = [
    { path: '/admin', label: t('dashboard'), keywords: ['dashboard', 'дашборд', 'панель'] },
    { path: '/admin/leads', label: t('leads'), keywords: ['leads', 'ліди', 'клієнти'] },
    { path: '/admin/customers', label: t('customers'), keywords: ['customers', 'клієнти'] },
    { path: '/admin/legal?tab=deal_pipeline', label: t('deals'), keywords: ['deals', 'угоди', 'deal pipeline'] },
    { path: '/admin/legal?tab=deposit_v2', label: t('deposits'), keywords: ['deposits', 'депозити', 'deposit'] },
    { path: '/admin/documents', label: t('documents'), keywords: ['documents', 'документи'] },
    { path: '/admin/legal', label: 'Legal Workflow', keywords: ['legal', 'egn', 'depozit', 'contract', 'юридичні', 'депозит'] },
    { path: '/admin/calculator', label: t('calculatorAdmin'), keywords: ['calculator', 'калькулятор'] },
    { path: '/admin/staff', label: t('staff'), keywords: ['staff', 'команда', 'персонал'] },
    { path: '/admin/tasks', label: t('tasks'), keywords: ['tasks', 'задачі'] },
    { path: '/admin/settings', label: t('system'), keywords: ['settings', 'налаштування'] },
  ];

  const filteredSearchItems = searchQuery.trim() 
    ? searchItems.filter(item => 
        item.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const handleSearchSelect = (path) => {
    navigate(path);
    setSearchQuery('');
    setIsMobileSearchOpen(false);
  };

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isMobileMenuOpen]);

  // Phase E badge — poll pending resolver/transfer exceptions every 30 s.
  useEffect(() => {
    if (!user || !['master_admin', 'admin'].includes(user?.role)) return;
    let cancelled = false;
    const API = process.env.REACT_APP_BACKEND_URL || '';
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!token) return;
    const load = () => {
      fetch(`${API}/api/admin/identity/exceptions/count`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && !cancelled) setAutomationExceptionsCount(d.pending || 0); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [user]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Check if any item in section is active
  const isSectionActive = (items) => {
    return items.some(item => location.pathname === item.path || location.pathname.startsWith(item.path + '/'));
  };

  // Navigation structure with groups - using translations
  // Roles: master_admin (admin), team_lead, manager
  const navGroups = [
    {
      id: 'dashboard',
      type: 'single',
      item: { path: '/admin', icon: ChartPieSlice, labelKey: 'dashboard' },
      roles: ['master_admin', 'admin', 'team_lead', 'manager']
    },
    {
      id: 'crm',
      type: 'group',
      labelKey: 'crm',
      icon: UsersThree,
      items: [
        { path: '/admin/leads', icon: UserPlus, labelKey: 'leads' },
        { path: '/admin/customers', icon: UserCircle, labelKey: 'customers' },
        { path: '/admin/legal?tab=deal_pipeline', icon: Handshake, labelKey: 'deals' },
      ],
      roles: ['master_admin', 'admin', 'team_lead', 'manager']
    },
    {
      id: 'finance',
      type: 'group',
      labelKey: 'finance',
      icon: Wallet,
      items: [
        { path: '/admin/legal?tab=deposit_v2', icon: CreditCard, labelKey: 'deposits' },
        { path: '/admin/documents', icon: Receipt, labelKey: 'documents' },
        { path: '/admin/legal', icon: Scales, label: 'Legal Workflow' },
        { path: '/admin/owner-dashboard', icon: ChartLine, labelKey: 'paymentAnalytics', roles: ['master_admin', 'admin'] },
        { path: '/admin/invoice-reminders', icon: PhoneCall, labelKey: 'invoiceReminders', roles: ['master_admin', 'admin', 'team_lead'] },
      ],
      roles: ['master_admin', 'admin', 'team_lead']
    },
    {
      // Calculator — flat single item (was: nested under "Авто" group along with
      // Parser Sources Control, Vehicle DB, Quote Analytics — all of those
      // were removed because Parser tooling already lives under /admin/parser*
      // and is not a duplicate of "Auto" tab).
      id: 'calculator',
      type: 'single',
      item: { path: '/admin/calculator', icon: Percent, labelKey: 'calculatorAdmin' },
      roles: ['master_admin', 'moderator', 'admin', 'team_lead', 'manager']
    },
    {
      id: 'team',
      type: 'group',
      labelKey: 'staffSection',
      icon: UsersFour,
      items: [
        { path: '/admin/team-lead', icon: Shield, labelKey: 'teamLeadPanel', roles: ['team_lead'] },
        { path: '/admin/staff', icon: Users, labelKey: 'staff' },
        { path: '/admin/tasks', icon: ListChecks, labelKey: 'tasks' },
      ],
      roles: ['master_admin', 'admin', 'team_lead']
    },
    {
      id: 'teamWorkspace',
      type: 'group',
      labelKey: 'teamWorkspace',
      icon: Kanban,
      items: [
        { path: '/team/dashboard', icon: ChartPieSlice, labelKey: 'teamDashboard' },
        { path: '/team/managers', icon: Users, labelKey: 'managerLoadBoard' },
        { path: '/team/leads', icon: Fire, labelKey: 'teamLeads' },
        { path: '/team/tasks', icon: ListChecks, labelKey: 'teamTasks' },
        { path: '/team/payments', icon: CreditCard, labelKey: 'paymentsWatch' },
        { path: '/team/orders', icon: Briefcase, label: 'Замовлення команди' },
        { path: '/team/shipping', icon: Truck, labelKey: 'shippingWatch' },
        { path: '/team/alerts', icon: Bell, labelKey: 'alertsFeed' },
        { path: '/team/reassignments', icon: ArrowsClockwise, labelKey: 'reassignments' },
        { path: '/team/performance', icon: ChartLineUp, labelKey: 'teamPerformance' },
      ],
      roles: ['master_admin', 'admin', 'team_lead']
    },
    {
      id: 'managerWorkspace',
      type: 'group',
      labelKey: 'managerWorkspace',
      icon: User,
      items: [
        { path: '/manager', icon: ChartPieSlice, labelKey: 'myWorkspace' },
        { path: '/manager/tasks', icon: ListChecks, labelKey: 'myTasks' },
        { path: '/manager/invoices', icon: Receipt, labelKey: 'myInvoices' },
        { path: '/manager/orders', icon: Briefcase, label: 'Мої замовлення' },
        { path: '/manager/shipments', icon: Truck, labelKey: 'myShipments' },
        { path: '/manager/calls', icon: Phone, labelKey: 'myCalls' },
      ],
      roles: ['master_admin', 'admin', 'team_lead', 'manager']
    },
    {
      id: 'control',
      type: 'group',
      labelKey: 'control',
      icon: Lightning,
      items: [
        { path: '/admin/business-metrics', icon: ChartLine, label: 'Бізнес-метрики' },
        { path: '/admin/provider-health', icon: Gauge, label: 'Provider Pressure' },
        { path: '/admin/routing-rules', icon: Path, labelKey: 'routingRules' },
        { path: '/admin/cadences', icon: Timer, labelKey: 'cadences' },
        { path: '/admin/score-rules', icon: ChartLine, labelKey: 'scoreRules' },
      ],
      roles: ['master_admin', 'admin']
    },
    {
      id: 'settings',
      type: 'group',
      labelKey: 'settings',
      icon: Sliders,
      items: [
        { path: '/admin/integrations', icon: Plugs, labelKey: 'integrations', roles: ['master_admin', 'admin'] },
        { path: '/admin/payments', icon: CreditCard, label: 'Платежі (Stripe)', roles: ['master_admin', 'admin'] },
        { path: '/admin/services', icon: Stack, label: 'Каталог послуг', roles: ['master_admin', 'admin'] },
        { path: '/admin/settings/email-templates',    icon: FileText, label: 'Email шаблони',       roles: ['master_admin', 'admin'] },
        { path: '/admin/settings/notifications-rules',icon: Bell,     label: 'Правила сповіщень',   roles: ['master_admin', 'admin'] },
        { path: '/admin/settings/email-outbox',       icon: Megaphone,label: 'Email outbox',        roles: ['master_admin', 'admin'] },
        // Tracking-hub items moved to top-level `/admin/tracking` (see TrackingLayout.jsx)
        { path: '/admin/ringostat', icon: Phone, labelKey: 'ringostat', roles: ['master_admin', 'admin'] },
        {
          // Unified Tracking hub (VesselFinder · Shipment journey ·
          // Shipment/Automation exceptions · HMAC ext-clients).
          // Nested routes live under /admin/tracking/* — see TrackingLayout.jsx.
          path: '/admin/tracking',
          icon: Anchor,
          label: 'Відстеження',
          badge: 'automationExceptions',
          matchPrefix: true,
          roles: ['master_admin', 'admin'],
        },
        { path: '/admin/parser', icon: Database, label: 'VIN Парсер' },
        { path: '/admin/settings', icon: Wrench, labelKey: 'system' },
        { path: '/admin/settings/auth', icon: ShieldCheck, label: 'Auth & URLs', roles: ['master_admin', 'admin'] },
        { path: '/admin/info', icon: FileText, label: 'Info' },
      ],
      roles: ['master_admin', 'moderator', 'admin']
    },
    {
      id: 'analytics',
      type: 'group',
      labelKey: 'analyticsAndInsights',
      icon: Megaphone,
      items: [
        { path: '/admin/analytics', icon: ChartBar, labelKey: 'analytics' },
        { path: '/admin/journey', icon: ChartLineUp, labelKey: 'journeyFunnel' },
        { path: '/admin/risk', icon: Shield, labelKey: 'riskDashboard' },
        { path: '/admin/escalations', icon: Lightning, labelKey: 'priorityAlerts' },
        { path: '/admin/contracts/accounting', icon: FileText, labelKey: 'contractsAccounting' },
        { path: '/admin/intent', icon: TrendUp, labelKey: 'intentDashboard' },
        { path: '/admin/engagement', icon: Heart, labelKey: 'userEngagement' },
        // ❌ REMOVED: auto-call (Twilio deprecated)
        // ❌ REMOVED: marketing control (не используется)
      ],
      roles: ['master_admin', 'moderator', 'admin', 'team_lead']
    }
  ];

  // Filter groups based on user role
  const visibleGroups = navGroups.filter(group => {
    if (!group.roles) return true;
    return group.roles.includes(user?.role);
  });

  const roleLabels = {
    master_admin: t('roleMasterAdmin'),
    admin: t('roleAdmin'),
    team_lead: t('roleTeamLead') || 'Team Lead',
    moderator: t('roleModerator'),
    manager: t('roleManager'),
    finance: t('roleFinance')
  };

  return (
    <div className="flex h-screen bg-[#F7F7F8]">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          data-testid="mobile-overlay"
        />
      )}

      {/* Sidebar - hidden on mobile (<768px), visible on md+ */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-[#E4E4E7]
        transform transition-transform duration-300 ease-out
        flex flex-col
        md:static md:translate-x-0 md:w-[260px] md:flex
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="p-4 md:p-5 border-b border-[#E4E4E7] flex items-center justify-between">
          <img 
            src="/images/logo.svg" 
            alt="Logo" 
            className="h-8 md:h-10 w-auto"
          />
          {/* Close button for mobile */}
          <button
            className="md:hidden p-2 -mr-2 text-[#71717A] hover:text-[#18181B] transition-colors"
            onClick={() => setIsMobileMenuOpen(false)}
            data-testid="mobile-menu-close"
          >
            <X size={24} weight="bold" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 md:py-4 overflow-y-auto" data-testid="sidebar-nav">
          {visibleGroups.map((group) => {
            if (group.type === 'single') {
              // Single item (Dashboard / Tracking hub)
              const { path, icon: Icon, labelKey, label, badge, matchPrefix } = group.item;
              const displayLabel = label || t(labelKey);
              const showBadge = badge === 'automationExceptions' && automationExceptionsCount > 0;
              return (
                <NavLink
                  key={group.id}
                  to={path}
                  end={!matchPrefix}
                  className={({ isActive }) =>
                    `sidebar-item min-h-[44px] ${isActive ? 'active' : ''}`
                  }
                  data-testid={`nav-${labelKey || group.id}`}
                >
                  <Icon size={20} weight="duotone" />
                  <span style={{ flex: 1 }}>{displayLabel}</span>
                  {showBadge && (
                    <span
                      data-testid={`badge-${group.id}`}
                      style={{
                        background: '#f59e0b',
                        color: '#fff',
                        borderRadius: 999,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                        marginLeft: 6,
                      }}
                    >
                      {automationExceptionsCount}
                    </span>
                  )}
                </NavLink>
              );
            }

            // Group with items
            const isExpanded = expandedSections[group.id];
            const isActive = isSectionActive(group.items);
            const GroupIcon = group.icon;
            const groupLabel = group.label || t(group.labelKey);

            return (
              <div key={group.id} className="mb-1">
                {/* Group Header */}
                <button
                  onClick={() => toggleSection(group.id)}
                  className={`sidebar-group-header min-h-[44px] ${isActive ? 'active' : ''}`}
                  data-testid={`nav-group-${group.id}`}
                >
                  <div className="flex items-center gap-3">
                    <GroupIcon size={20} weight="duotone" />
                    <span>{groupLabel}</span>
                  </div>
                  {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                </button>

                {/* Group Items */}
                {isExpanded && (
                  <div className="sidebar-group-items">
                    {group.items
                      .filter(item => !item.roles || item.roles.includes(user?.role))
                      .map(({ path, icon: Icon, labelKey, label, badge }) => (
                      <NavLink
                        key={path}
                        to={path}
                        className={({ isActive }) =>
                          `sidebar-subitem min-h-[44px] ${isActive ? 'active' : ''}`
                        }
                        data-testid={`nav-${labelKey || path.replace(/\//g, '-')}`}
                      >
                        <Icon size={16} weight="duotone" />
                        <span style={{ flex: 1 }}>{label || t(labelKey)}</span>
                        {badge === 'automationExceptions' && automationExceptionsCount > 0 && (
                          <span
                            data-testid="badge-automation-exceptions"
                            style={{
                              background: '#f59e0b',
                              color: '#fff',
                              borderRadius: 999,
                              padding: '2px 7px',
                              fontSize: 11,
                              fontWeight: 700,
                              marginLeft: 6,
                            }}
                          >
                            {automationExceptionsCount}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 md:p-4 border-t border-[#E4E4E7]">
          <div className="text-xs text-[#A1A1AA] px-3 mb-2">{roleLabels[user?.role] || user?.role}</div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-[#71717A] hover:text-[#DC2626] rounded-xl hover:bg-[#FEE2E2] transition-all"
            data-testid="logout-btn"
          >
            <SignOut size={18} weight="duotone" />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Header */}
        <header className="h-14 md:h-16 bg-white border-b border-[#E4E4E7] flex items-center justify-between px-4 md:px-8">
          {/* Mobile Menu Button + Search */}
          <div className="flex items-center gap-3 flex-1">
            {/* Hamburger Menu Button */}
            <button
              className="md:hidden p-2 -ml-2 text-[#18181B] hover:bg-[#F4F4F5] rounded-lg transition-colors"
              onClick={() => setIsMobileMenuOpen(true)}
              data-testid="mobile-menu-toggle"
            >
              <List size={24} weight="bold" />
            </button>
            
            {/* Search - Desktop */}
            <div className="hidden md:block w-80 relative">
              <input 
                type="text" 
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full"
                data-testid="search-input"
              />
              {searchQuery && filteredSearchItems.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 py-2 max-h-64 overflow-auto">
                  {filteredSearchItems.map(item => (
                    <button
                      key={item.path}
                      onClick={() => handleSearchSelect(item.path)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-[#F4F4F5] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-3">
            {/* Mobile Search Button */}
            <button 
              className="md:hidden p-2 text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-lg transition-colors"
              onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
              data-testid="mobile-search-btn"
            >
              <MagnifyingGlass size={20} weight="bold" />
            </button>
            
            {/* Language Switcher Dropdown */}
            <div className="relative" ref={langDropdownRef}>
              <button
                onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
                className="flex items-center gap-1.5 px-2.5 py-2 text-sm font-medium text-[#71717A] hover:text-[#18181B] hover:bg-[#F4F4F5] rounded-lg transition-all"
                data-testid="lang-switcher-btn"
              >
                <Globe size={20} weight="duotone" />
                <span className="hidden sm:inline">{(languages || LANGUAGES).find(l => l.code === lang)?.label}</span>
                <CaretDown size={14} className={`transition-transform ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isLangDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-[#E4E4E7] rounded-xl shadow-lg py-1 min-w-[140px] z-50">
                  {(languages || LANGUAGES).map((language) => (
                    <button
                      key={language.code}
                      onClick={() => {
                        changeLang(language.code);
                        setIsLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                        lang === language.code 
                          ? 'bg-[#F4F4F5] text-[#18181B] font-medium' 
                          : 'text-[#71717A] hover:bg-[#F4F4F5] hover:text-[#18181B]'
                      }`}
                      data-testid={`lang-${language.code}`}
                    >
                      <span className="text-base">{language.flag}</span>
                      <span>{language.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <RingostatLiveBar />
            <button
              onClick={() => navigate('/manager/tracking')}
              className="w-9 h-9 rounded-full hover:bg-[#F4F4F5] flex items-center justify-center transition-colors"
              title="Універсальний трекер (VIN / Container / IMO)"
              data-testid="global-tracker-btn"
            >
              <MagnifyingGlass size={20} className="text-[#52525B]" />
            </button>
            <NotificationBell />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          {/* Mobile Search Panel */}
          {isMobileSearchOpen && (
            <div className="md:hidden mb-4 relative">
              <input 
                type="text" 
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="input w-full"
                data-testid="mobile-search-input"
              />
              {searchQuery && filteredSearchItems.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E4E4E7] rounded-xl shadow-lg z-50 py-2 max-h-64 overflow-auto">
                  {filteredSearchItems.map(item => (
                    <button
                      key={item.path}
                      onClick={() => handleSearchSelect(item.path)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#F4F4F5] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Ringostat Real-time Manager */}
      <RingostatManager />
    </div>
  );
};

export default Layout;
