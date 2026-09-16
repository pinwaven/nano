// The app shell — pages/main/main.wxml's root: header (tap → logo menu), banners, the five
// always-mounted tabs, the bottom tab bar, and the full-screen routes (phones / emails).
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { VERSION, IS_DEV_BACKEND, STORAGE_KEYS as K } from './config.js';
import { asset } from './assets.js';
import { useApp, storage } from './store/AppContext.jsx';
import { openGcnStoreGated } from './gcn.js';
import LoginScreen from './components/LoginScreen.jsx';
import LogoMenu from './shell/LogoMenu.jsx';
import UiHost from './components/ui/UiHost.jsx';
import ChatTab from './chat/ChatTab.jsx';
import HealthTab from './health/HealthTab.jsx';
import PlansTab from './plans/PlansTab.jsx';
import CodeRedeemSheet from './plans/CodeRedeemSheet.jsx';
import StoreTab from './store/StoreTab.jsx';
import LearnTab from './learn/LearnTab.jsx';
import IdentityPage from './shell/IdentityPage.jsx';
import ReferralPage from './shell/ReferralPage.jsx';
import { GuestJoinSheet, VivaRedeemSheet } from './shell/Sheets.jsx';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';

const TAB_ICON = { chat: 'chat', health: 'health', plans: 'plans', learn: 'training', store: 'store' };

function App() {
  const app = useApp();
  const { user, channel, t, lang, tab, setTab, isGuest, isAeviva, login, toggleLang, sandboxMode, theme, textScale,
    personaType, vivaSubscriptionExpired, exitSandbox } = app;
  const [wvtLoading, setWvtLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guestSheet, setGuestSheet] = useState(false);
  const [vivaSheet, setVivaSheet] = useState(false);
  const { route, setRoute } = app;

  // pages/appview → web: a one-time `?wvt=` signs the miniapp user in here.
  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('ref')) storage.set(K.ref, params.get('ref'));
    const wvt = params.get('wvt');
    if (!wvt) return;
    setWvtLoading(true);
    api.post('/exchange-webview-token', { wvt })
      .then(r => {
        if (r?.success && r.user) {
          login(r);
          const url = new URL(window.location.href);
          url.searchParams.delete('wvt');
          window.history.replaceState({}, '', url.toString());
        }
      })
      .catch(() => {})
      .finally(() => setWvtLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // main.js:switchTab — the Store tab on a GCN-linked channel opens the storefront and does NOT
  // switch tabs; other tabs tell their owners to refresh when stale.
  const switchTab = async next => {
    if (next === 'store' && isAeviva && !isGuest) { await openGcnStoreGated(app); return; }
    setTab(next);
    app.emit('tab:switch', next);
  };

  if (!user) {
    return (
      <div className="shell">
        {wvtLoading ? (
          <div className="wvt-loading">
            <div className="login-glow" />
            <div className="login-brand"><div className="login-logo-ring"><img src={wavenLogo} className="login-logo" alt="Waven" /></div><div className="login-title">NANO</div></div>
          </div>
        ) : <LoginScreen onLogin={login} lang={lang} onLangChange={toggleLang} onContinue={app.continueAsPrevious} />}
        <UiHost />
      </div>
    );
  }

  const tabs = ['chat', 'health', 'plans', ...(isGuest ? [] : ['learn', 'store'])];
  const tabLabel = { chat: t.tabChat, health: t.tabHealth, plans: t.tabPlans, learn: t.tabLearn, store: t.tabStore };
  const sandboxBannerText = sandboxMode ? String(t.sandboxBanner || '').replace('{name}', user.nickname || '—') : '';

  return (
    <div className="shell">
      <div className="phone-frame">
        <div className={`main fs-${textScale}${theme === 'light' ? ' theme-light' : ''}`}>
          <div className="app-header" onClick={() => setMenuOpen(o => !o)}>
            <div className="header-logo-btn">
              <img className="header-logo-img" src={channel?.logo_url || asset('/assets/waven-logo-icon.png')} alt="" />
              <span className="header-title">{channel?.name || 'NANO'}</span>
            </div>
            <div className="header-divider" />
            <span className="header-user">{isGuest ? t.guestHeaderName : (user.nickname || 'User')}</span>
            {IS_DEV_BACKEND && <span className="header-version">v{VERSION}</span>}
          </div>

          {sandboxMode && (
            <div className="sandbox-banner" onClick={exitSandbox}>
              <span className="sandbox-banner-text">{sandboxBannerText}</span><span className="sandbox-banner-exit">{t.exitSandbox}</span>
            </div>
          )}
          {!sandboxMode && personaType === 'viva' && vivaSubscriptionExpired && (
            <div className="viva-expired-banner" onClick={() => openGcnStoreGated(app, { intent: 'buy_viva_subscription' })}>
              <span className="viva-expired-banner-text">{t.vivaSubscriptionExpiredBanner}</span><span className="viva-expired-banner-btn">{t.vivaSubscriptionRenewBtn}</span>
            </div>
          )}

          <LogoMenu open={menuOpen} onClose={() => setMenuOpen(false)} onReferral={() => setRoute('referral')} onVivaRedeem={() => setVivaSheet(true)} onGuestJoin={() => setGuestSheet(true)} />

          <div className="tab-content">
            <div className={`tab-pane${tab === 'chat' ? '' : ' tab-hidden'}`}><ChatTab onGuestTap={() => setGuestSheet(true)} /></div>
            <div className={`tab-pane${tab === 'health' ? '' : ' tab-hidden'}`}><HealthTab visible={tab === 'health'} onGuestTap={() => setGuestSheet(true)} /></div>
            <div className={`tab-pane${tab === 'plans' ? '' : ' tab-hidden'}`}><PlansTab visible={tab === 'plans'} onGuestTap={() => setGuestSheet(true)} /></div>
            {!isGuest && <div className={`tab-pane${tab === 'learn' ? '' : ' tab-hidden'}`}><LearnTab /></div>}
            {!isGuest && <div className={`tab-pane${tab === 'store' ? '' : ' tab-hidden'}`}><StoreTab onGuestTap={() => setGuestSheet(true)} /></div>}
          </div>

          {route === 'phones' && <div className="route-layer"><IdentityPage kind="phone" /></div>}
          {route === 'emails' && <div className="route-layer"><IdentityPage kind="email" /></div>}
          {route === 'referral' && <div className="route-layer"><ReferralPage /></div>}
          <GuestJoinSheet open={guestSheet} onClose={() => setGuestSheet(false)} />
          <VivaRedeemSheet open={vivaSheet} onClose={() => setVivaSheet(false)} />

          <CodeRedeemSheet />
          <UiHost />
          <div className="tab-bar">
            {tabs.map(id => (
              <div key={id} className={`tab-btn${tab === id ? ' tab-active' : ''}`} onClick={() => switchTab(id)}>
                {tab === id && <div className="tab-line" />}
                <img className="tab-icon-img" src={asset(`/assets/icons/${TAB_ICON[id]}.svg`)} alt="" />
                <span className="tab-label">{tabLabel[id]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
