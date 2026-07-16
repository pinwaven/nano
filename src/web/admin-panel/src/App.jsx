import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import {
  Users, Droplets, UserCog, RefreshCcw,
  ChevronDown, Activity, Calendar, Plus, Pencil, Trash2, X, Check, Globe,
  ShoppingBag, Package, Building2, Tag, Copy, Cpu, Layers, QrCode, Printer, ChevronLeft, ChevronRight, Download,
  Coins, TrendingUp, Settings2, Landmark,
  GraduationCap, Video, FileText, Upload, ExternalLink, Play, BookOpen,
  Bug, AlertCircle, Image as ImageIcon,
  ClipboardList, ChevronUp, Send, Eye,
  BarChart2, Award, Archive, Box, Target, Filter, MessageSquare, FlaskConical, Shield,
  LayoutDashboard, Sparkles, Music2, ScrollText,
} from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

import { T, LoginScreen, LangCtx, useLang, PERMS, hasPermission, StatCard, RichStatCard, Badge, normalizeKinoMachinesPayload, buildKinoMachinesUrl } from './shared.jsx';
import { ContentTab } from './tabs/ContentTab.jsx';
import { AdminAccountsTab } from './tabs/AdminAccountsTab.jsx';
import { ChannelTab } from './tabs/ChannelTab.jsx';
import { CoachCRMTab } from './tabs/CoachCRMTab.jsx';
import { CoachTab } from './tabs/CoachTab.jsx';
import { DashboardTab } from './tabs/DashboardTab.jsx';
import { DigitalAssetsTab } from './tabs/DigitalAssetsTab.jsx';
import DotsTab from './tabs/DotsTab.jsx';
import { FinanceTab } from './tabs/FinanceTab.jsx';
import { HardwareTab } from './tabs/HardwareTab.jsx';
import InventoryTab from './tabs/InventoryTab.jsx';
import { InvitesTab } from './tabs/InvitesTab.jsx';
import { LabTab } from './tabs/LabTab.jsx';
import { PartnersTab } from './tabs/PartnersTab.jsx';
import { ReportsTab } from './tabs/ReportsTab.jsx';
import { RewardsTab } from './tabs/RewardsTab.jsx';
import StoreTab from './tabs/StoreTab.jsx';
import { TicketsTab } from './tabs/TicketsTab.jsx';
import { UsersTab } from './tabs/UsersTab.jsx';
import { ChangelogTab } from './tabs/ChangelogTab.jsx';

axios.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('nano_admin_token') || import.meta.env.VITE_API_TOKEN
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only worker /api/ routes signal session expiry with 401. Other services
    // (/kino/, /lab/) return 401 for token types they don't accept — a channel
    // admin token is valid for the worker but rejected by the kino function.
    const url = error.config?.url || '';
    if (error.response?.status === 401 && url.startsWith('/api') && !url.includes('/admin/login')) {
      window.dispatchEvent(new CustomEvent('admin-session-expired'))
    }
    return Promise.reject(error)
  }
)

function AdminPanel({ session, onLogout }) {
  const [lang, setLang] = useState('zh');
  const t = T[lang];
  const toggleLang = () => setLang(l => l === 'en' ? 'zh' : 'en');

  const isSuperadmin = !session || session.role === 'superadmin';
  const isCmsAdmin = session?.role === 'channel' && session?.canManageSubchannels;
  const SUPERADMIN_ONLY = new Set(['changelog']);

  const [data, setData] = useState({ users: [], dots: [], coaches: [], storeItems: [], orders: [], channels: [], invitations: [], kinoDevices: [], kinoMachinePagination: null, chipBatches: [], chipModels: [], tickets: [], adminAccounts: [], koneApkReleases: [], skus: [], inventoryStock: [] });
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const ok = (res) => res.status === 'fulfilled' ? res.value.data : {};
    const cid = session?.channelId;
    const isChannel = session?.role === 'channel';
    try {
      const canManageOwnAdmins = isChannel && hasPermission(session, PERMS.ADMIN_ACCTS_READ);
    const [uRes, dRes, pRes, sRes, oRes, chRes, invRes, kinoRes, cbRes, cmRes, tkRes, aaRes, hptRes, apkRes, skuRes, stockRes] = await Promise.allSettled([
        axios.get(isChannel ? `/api/channel-users/${cid}?minimal=true` : '/api/users?minimal=true'),
        axios.get('/api/dots-inventory'),
        axios.get(isChannel ? `/api/channel-coaches/${cid}?include_subchannels=true` : '/api/coach-list'),
        axios.get('/api/store-items?all=true'),
        axios.get(isChannel ? `/api/orders?channel_id=${cid}` : '/api/orders'),
        (isChannel && !isCmsAdmin && !canManageOwnAdmins) ? Promise.resolve({ data: {} }) : axios.get('/api/channels'),
        axios.get(isChannel ? `/api/invitations?channel_id=${cid}` : '/api/invitations'),
        axios.get('/kino/kino-machines?page=1&limit=10'),
        axios.get('/api/kino-chip-batches'),
        axios.get('/api/kino-chip-models'),
        axios.get('/api/tickets'),
        (isChannel && !isCmsAdmin && !canManageOwnAdmins) ? Promise.resolve({ data: {} }) : axios.get('/api/admin-accounts'),
        axios.get('/api/health-plan-templates?all=true'),
        axios.get('/api/kone-apk-releases'),
        axios.get('/api/skus'),
        axios.get('/api/inventory-stock'),
      ]);
      const kinoMachines = normalizeKinoMachinesPayload(ok(kinoRes));
      setData({
        users:               ok(uRes).users              || [],
        dots:                ok(dRes).dots               || [],
        coaches:             ok(pRes).coaches            || [],
        storeItems:          ok(sRes).items              || [],
        orders:              ok(oRes).orders             || [],
        channels:            ok(chRes).channels          || [],
        invitations:         ok(invRes).invitations      || [],
        kinoDevices:         kinoMachines.devices,
        kinoMachinePagination: kinoMachines.pagination,
        chipBatches:         ok(cbRes).batches           || [],
        chipModels:          ok(cmRes).models            || [],
        tickets:             ok(tkRes).tickets           || [],
        adminAccounts:       ok(aaRes).accounts          || [],
        healthPlanTemplates: ok(hptRes).templates        || [],
        koneApkReleases:     ok(apkRes).releases         || [],
        skus:                ok(skuRes).skus             || [],
        inventoryStock:      ok(stockRes).inventory      || [],
      });
      setLastRefresh(new Date());
    } catch (err) { console.error('Admin fetch error:', err); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Channel-scoped admins locked into a GCN-linked channel see this tab's real content —
  // GCN's own admin console (GcnInventoryEmbed, see InventoryTab.jsx) — so the nav label
  // should say "GCN", not "Inventory" (which is inert for them). Superadmins switch between
  // channels inside the tab itself, so there's no single "current channel" to key off here —
  // their label stays generic.
  const GCN_LINKED_CHANNEL_KEYS = new Set(['aeviva', 'aeviva-china']);
  const currentChannel = (data.channels || []).find(c => String(c.id) === String(session?.channelId));
  const inventoryLabel = !isSuperadmin && GCN_LINKED_CHANNEL_KEYS.has(currentChannel?.key_name)
    ? 'GCN'
    : t.nav.inventory;

  const NAV = [
    { id: 'dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'channels',  label: t.nav.channels,   icon: Building2   },
    { id: 'users',    label: t.nav.users,    icon: Users       },
    { id: 'coaches',  label: t.nav.coaches,  icon: UserCog     },
    { id: 'dots',     label: t.nav.dots,     icon: Droplets    },
    { id: 'store',     label: t.nav.store,      icon: ShoppingBag },
    { id: 'inventory', label: inventoryLabel,  icon: Archive     },
    { id: 'hardware',       label: t.nav.hardware,      icon: Cpu    },
    { id: 'invites',  label: t.nav.invites,  icon: Tag         },
    { id: 'rewards',   label: t.nav.rewards,   icon: Coins          },
    { id: 'partners',  label: t.nav.partners,  icon: Award          },
    { id: 'finance',   label: t.nav.finance,   icon: Landmark       },
    { id: 'content',   label: t.nav.content,   icon: GraduationCap  },
    { id: 'reports',        label: t.nav.reports,        icon: BarChart2     },
    { id: 'tickets',  label: t.nav.tickets,  icon: Bug            },
    { id: 'admin-accounts', label: t.nav.adminAccounts, icon: Settings2 },
    { id: 'coach-crm',     label: t.nav.coachCrm,     icon: Target        },
    { id: 'lab',           label: t.nav.lab,           icon: FlaskConical  },
    { id: 'digital-assets', label: t.nav.digitalAssets, icon: Music2 },
    { id: 'changelog',      label: t.nav.changelog,      icon: ScrollText },
  ];

  const visibleNAV = isSuperadmin
    ? NAV
    : NAV.filter(n => {
        if (n.id === 'dashboard') return true;
        if (n.disabled) return false;
        if (SUPERADMIN_ONLY.has(n.id)) return false;
        if (n.id === 'store') return false;
        if (n.id === 'channels') return isCmsAdmin;
        if (n.id === 'coach-crm') return (session?.allowedTabs || []).includes('coaches');
        return (session?.allowedTabs || []).includes(n.id);
      });

  const defaultTab = 'dashboard';
  const [tab, setTab] = useState(defaultTab);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isGcnEmbedTab = tab === 'inventory' && !isSuperadmin && GCN_LINKED_CHANNEL_KEYS.has(currentChannel?.key_name);
  const topbarLabel = isGcnEmbedTab ? 'GCN : Guardian Chain Network' : NAV.find(n => n.id === tab)?.label;

  const handleNavClick = (id) => { setTab(id); setSidebarOpen(false); };

  return (
    <LangCtx.Provider value={{ lang, t, toggleLang }}>
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          {!isSuperadmin && session?.channelLogo
            ? <img src={session.channelLogo} alt={session.channelName} className="brand-logo" style={{ borderRadius: 6, objectFit: 'cover' }} />
            : <img src={wavenLogo} alt="Waven" className="brand-logo" />
          }
          {!isSuperadmin && session?.channelName ? session.channelName : t.brand}
        </div>
        <nav className="sidebar-nav">
          {visibleNAV.map(({ id, label, icon: Icon, disabled }) => (
            <button key={id}
              className={`nav-item${tab === id ? ' active' : ''}${disabled ? ' disabled' : ''}`}
              onClick={() => !disabled && handleNavClick(id)}
              style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              title={disabled ? 'Coming soon' : undefined}
            >
              <Icon size={15} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="lang-toggle" onClick={toggleLang}>
            <Globe size={13} />{lang === 'en' ? '中文' : 'English'}
          </button>
          <button className="lang-toggle" onClick={onLogout} style={{ color: '#f87171' }}>
            Sign Out
          </button>
          {lastRefresh && <span>{t.updated} {lastRefresh.toLocaleTimeString()}</span>}
        </div>
      </aside>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <div className="topbar-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isGcnEmbedTab && session?.channelLogo && (
              <img
                src={session.channelLogo}
                alt={session.channelName || 'Aeviva'}
                style={{ width: 20, height: 20, borderRadius: '50%', objectFit: 'cover' }}
              />
            )}
            {topbarLabel}
          </div>
          <button className="refresh-btn" onClick={fetchData} disabled={loading}>
            <RefreshCcw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? t.topbar.loading : t.topbar.refresh}
          </button>
        </header>
        <div className={`content${isGcnEmbedTab ? ' content--full-bleed' : ''}`}>
          {tab === 'dashboard' && <DashboardTab users={data.users} coaches={data.coaches} devices={data.kinoDevices} batches={data.chipBatches} orders={data.orders} tickets={data.tickets} session={session} isSuperadmin={isSuperadmin} onNavigate={setTab} />}
          {tab === 'users'    && <UsersTab    users={data.users} coaches={data.coaches} channels={data.channels} session={session} isCmsAdmin={isCmsAdmin} onRefresh={fetchData} />}
          {tab === 'coaches'  && <CoachTab    coaches={data.coaches} users={data.users} channels={data.channels} session={session} isCmsAdmin={isCmsAdmin} onRefresh={fetchData} />}
          {tab === 'dots'     && <DotsTab     dots={data.dots} onRefresh={fetchData} />}
          {tab === 'store'     && <StoreTab      storeItems={data.storeItems} orders={data.orders} channels={data.channels} skus={data.skus || []} inventoryStock={data.inventoryStock || []} session={session} onRefresh={fetchData} />}
          {tab === 'inventory' && <InventoryTab  channels={data.channels} session={session} isSuperadmin={isSuperadmin} />}
          {tab === 'channels'  && <ChannelTab    channels={data.channels} onRefresh={fetchData} isSuperadmin={isSuperadmin} session={session} />}
          {tab === 'hardware' && <HardwareTab devices={data.kinoDevices} machinePagination={data.kinoMachinePagination} coaches={data.coaches} channels={data.channels} releases={data.koneApkReleases} chipBatches={data.chipBatches} chipModels={data.chipModels} onRefresh={fetchData} />}
          {tab === 'digital-assets' && <DigitalAssetsTab session={session} channels={data.channels} isSuperadmin={isSuperadmin} onRefresh={fetchData} />}
          {tab === 'invites'  && <InvitesTab  invitations={data.invitations} channels={data.channels} coaches={data.coaches} session={session} onRefresh={fetchData} />}
          {tab === 'rewards'   && <RewardsTab />}
          {tab === 'partners'  && <PartnersTab users={data.users} session={session} />}
          {tab === 'finance'   && <FinanceTab />}
          {tab === 'content' && <ContentTab channels={data.channels} users={data.users} coaches={data.coaches} dots={data.dots} healthPlanTemplates={data.healthPlanTemplates || []} session={session} isSuperadmin={isSuperadmin} onRefresh={fetchData} />}
          {tab === 'reports'        && <ReportsTab />}
          {tab === 'tickets'  && <TicketsTab tickets={data.tickets} onRefresh={fetchData} />}
          {tab === 'admin-accounts' && <AdminAccountsTab accounts={data.adminAccounts} channels={data.channels} session={session} onRefresh={fetchData} />}
          {tab === 'coach-crm'     && <CoachCRMTab coaches={data.coaches} users={data.users} />}
          {tab === 'lab'           && <LabTab users={data.users} onRefresh={fetchData} />}
          {tab === 'changelog'     && <ChangelogTab />}
        </div>
      </div>
    </LangCtx.Provider>
  );
}

export default function App() {
  const readSession = (token) => ({
    token,
    role: sessionStorage.getItem('nano_admin_role') || 'superadmin',
    channelId: sessionStorage.getItem('nano_admin_channel_id') || null,
    channelName: sessionStorage.getItem('nano_admin_channel_name') || '',
    channelLogo: sessionStorage.getItem('nano_admin_channel_logo') || '',
    allowedTabs: JSON.parse(sessionStorage.getItem('nano_admin_tabs') || '[]'),
    allowedPerms: JSON.parse(sessionStorage.getItem('nano_admin_perms') || '[]'),
    canManageSubchannels: sessionStorage.getItem('nano_admin_cms') === '1',
    canCustomizeStore: sessionStorage.getItem('nano_admin_can_customize_store') === '1',
    canManageWarehouses: sessionStorage.getItem('nano_admin_can_manage_warehouses') === '1',
    autonomous: sessionStorage.getItem('nano_admin_autonomous') === '1',
    username: sessionStorage.getItem('nano_admin_user') || '',
  });

  const [session, setSession] = useState(() => {
    const token = sessionStorage.getItem('nano_admin_token');
    return token ? readSession(token) : null;
  });
  const [sessionExpired, setSessionExpired] = useState(false);

  const handleLogin = (token) => { setSessionExpired(false); setSession(readSession(token)); };

  const handleLogout = useCallback(() => {
    ['nano_admin_token','nano_admin_user','nano_admin_role','nano_admin_channel_id','nano_admin_channel_name','nano_admin_channel_logo','nano_admin_tabs','nano_admin_perms','nano_admin_cms','nano_admin_can_customize_store','nano_admin_can_manage_warehouses','nano_admin_autonomous'].forEach(k => sessionStorage.removeItem(k));
    setSession(null);
  }, []);

  const handleSessionExpired = useCallback(() => {
    ['nano_admin_token','nano_admin_user','nano_admin_role','nano_admin_channel_id','nano_admin_channel_name','nano_admin_channel_logo','nano_admin_tabs','nano_admin_perms','nano_admin_cms','nano_admin_can_customize_store','nano_admin_can_manage_warehouses','nano_admin_autonomous'].forEach(k => sessionStorage.removeItem(k));
    setSessionExpired(true);
    setSession(null);
  }, []);

  useEffect(() => {
    window.addEventListener('admin-session-expired', handleSessionExpired);
    return () => window.removeEventListener('admin-session-expired', handleSessionExpired);
  }, [handleSessionExpired]);

  if (!session) return <LoginScreen onLogin={handleLogin} sessionExpired={sessionExpired} />;
  return <AdminPanel session={session} onLogout={handleLogout} />;
}
