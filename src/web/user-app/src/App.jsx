import { useState, useEffect } from 'react';
import axios from 'axios';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import { T, LangContext } from './i18n.js';
import LoginScreen from './components/LoginScreen.jsx';
import ChatTab from './tabs/ChatTab.jsx';
import HealthTab from './tabs/HealthTab.jsx';
import DotsTab from './tabs/DotsTab.jsx';
import PlansTab from './tabs/PlansTab.jsx';
import StoreTab from './tabs/StoreTab.jsx';
import AcademyTab from './tabs/AcademyTab.jsx';

const API = '/api';

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('nano_user') || 'null'); } catch { return null; }
  });
  const [tab, setTab] = useState('chat');
  const [lang, setLang] = useState(() => user?.language || 'zh');
  const [wvtLoading, setWvtLoading] = useState(false);

  const t = T[lang] || T.zh;

  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(window.location.search);
    const wvt = params.get('wvt');
    if (!wvt) return;
    setWvtLoading(true);
    axios.post(`${API}/exchange-webview-token`, { wvt })
      .then(r => {
        if (r.data.success && r.data.user) {
          const u = r.data.user;
          sessionStorage.setItem('nano_user', JSON.stringify(u));
          setUser(u);
          setLang(u.language === 'en' ? 'en' : 'zh');
          const url = new URL(window.location.href);
          url.searchParams.delete('wvt');
          window.history.replaceState({}, '', url.toString());
        }
      })
      .catch(() => {})
      .finally(() => setWvtLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = u => {
    sessionStorage.setItem('nano_user', JSON.stringify(u));
    setUser(u);
    setLang(u.language === 'en' ? 'en' : 'zh');
  };

  const handleUserUpdate = updates => {
    setUser(prev => {
      const next = { ...prev, ...updates };
      sessionStorage.setItem('nano_user', JSON.stringify(next));
      return next;
    });
  };

  const handleLogout = () => {
    sessionStorage.removeItem('nano_user');
    setUser(null);
    setTab('chat');
    setLang('zh');
  };

  if (!user) {
    return (
      <LangContext.Provider value={{ lang, t }}>
        <div className="shell">
          {wvtLoading ? (
            <div className="wvt-loading">
              <div className="login-glow" />
              <div className="login-brand">
                <div className="login-logo-ring">
                  <img src={wavenLogo} className="login-logo" alt="Waven" />
                </div>
                <div className="login-title">NANO</div>
              </div>
            </div>
          ) : (
            <LoginScreen onLogin={handleLogin} lang={lang} onLangChange={setLang} />
          )}
        </div>
      </LangContext.Provider>
    );
  }

  const TABS = [
    {
      id: 'chat', label: t.tabChat,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: 'health', label: t.tabHealth,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
    {
      id: 'dots', label: t.tabDots,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="2.2" /><circle cx="16" cy="8" r="2.2" />
          <circle cx="8" cy="16" r="2.2" /><circle cx="16" cy="16" r="2.2" />
        </svg>
      ),
    },
    {
      id: 'plans', label: t.tabPlans,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
          <line x1="8" y1="14" x2="16" y2="14"/>
        </svg>
      ),
    },
    {
      id: 'store', label: t.tabStore,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
      ),
    },
    {
      id: 'learn', label: t.tabLearn,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      ),
    },
  ];

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className="shell">
        <div className="phone-frame">
          <div className="app-header">
            <div className="header-brand">
              <img src={wavenLogo} className="header-logo" alt="Waven" />
              <span className="header-title">NANO</span>
            </div>
            <div className="header-right">
              <div className="header-user">{user.nickname || 'User'}</div>
              <button className="logout-btn" onClick={handleLogout} title="Sign out">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="tab-content">
            <div style={{ display: tab === 'chat'   ? 'contents' : 'none' }}><ChatTab user={user} onUserUpdate={handleUserUpdate} /></div>
            <div style={{ display: tab === 'health' ? 'contents' : 'none' }}><HealthTab user={user} /></div>
            <div style={{ display: tab === 'dots'   ? 'contents' : 'none' }}><DotsTab user={user} /></div>
            <div style={{ display: tab === 'plans'  ? 'contents' : 'none' }}><PlansTab user={user} /></div>
            <div style={{ display: tab === 'store'  ? 'contents' : 'none' }}><StoreTab user={user} /></div>
            <div style={{ display: tab === 'learn'  ? 'contents' : 'none' }}><AcademyTab user={user} /></div>
          </div>

          <nav className="tab-bar">
            {TABS.map(tb => (
              <button
                key={tb.id}
                className={`tab-btn${tab === tb.id ? ' active' : ''}`}
                onClick={() => setTab(tb.id)}
              >
                {tb.icon}
                <span>{tb.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </LangContext.Provider>
  );
}

export default App;
