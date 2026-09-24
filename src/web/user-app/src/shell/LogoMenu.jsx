// The header dropdown (pages/main/main.wxml "Logo menu"), same rows, order and gating.
// Coach opens its own route; admin / superadmin link to the web admin panel; the Kino Simulator overlay is not
// ported (admin-only tooling, out of the twin's scope).
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';

export default function LogoMenu({ open, onClose, onReferral, onVivaRedeem, onGuestJoin }) {
  const app = useApp();
  const { t, lang, theme, textScale, isGuest, isAeviva, isCoach, isAdmin, isSuperadmin, emailLoginAllowed,
    personaType, vivaSubscriptionExpired, vivaSubscriptionExpiresAtDisplay, creditBalance, sandboxMode } = app;
  if (!open) return null;
  const close = fn => () => { onClose(); fn && fn(); };
  const showVivaUntil = !isGuest && isAeviva && personaType === 'viva' && !vivaSubscriptionExpired && vivaSubscriptionExpiresAtDisplay;
  const adminLink = <a className="menu-item" href="/admin/" target="_blank" rel="noopener" onClick={onClose}><span className="menu-item-icon">⚙</span><span className="menu-item-label">{t.adminMenu}</span></a>;
  return (
    <div className="menu-mask" onClick={onClose}>
      <div className="menu-dropdown" onClick={e => e.stopPropagation()}>
        {showVivaUntil && (
          <div className="menu-credit-row" onClick={close(onVivaRedeem)}>
            <span className="menu-credit-label">{lang === 'zh' ? 'Viva 订阅至' : 'Viva subscribed until'}</span>
            <span className="menu-credit-value">{vivaSubscriptionExpiresAtDisplay}</span>
          </div>
        )}
        {showVivaUntil && creditBalance <= 0 && <div className="menu-divider" />}
        {!isGuest && creditBalance > 0 && (
          <>
            <div className="menu-credit-row" onClick={close(onReferral)}>
              <span className="menu-credit-label">{lang === 'zh' ? '积分余额' : 'Credits'}</span>
              <span className="menu-credit-value">{creditBalance} pts</span>
            </div>
            <div className="menu-divider" />
          </>
        )}
        {isCoach && <button className="menu-item" onClick={close(() => app.setRoute('coach'))}><span className="menu-item-icon">👨‍⚕️</span><span className="menu-item-label">{t.coachMenu}</span></button>}
        {isAdmin && <div className="menu-divider" />}
        {isAdmin && adminLink}
        {isSuperadmin && <div className="menu-divider" />}
        {isSuperadmin && <a className="menu-item" href="/admin/" target="_blank" rel="noopener" onClick={onClose}><span className="menu-item-icon">🖥</span><span className="menu-item-label">{t.webAdminMenu}</span></a>}
        {!isGuest && <div className="menu-divider" />}
        {!isGuest && <div className="menu-item" onClick={close(onReferral)}><span className="menu-item-icon">★</span><span className="menu-item-label">{t.referralMenu}</span></div>}
        {!isGuest && <div className="menu-item" onClick={close(() => app.setRoute('phones'))}><span className="menu-item-icon">📱</span><span className="menu-item-label">{t.phonesMenu}</span></div>}
        {!isGuest && emailLoginAllowed && <div className="menu-item" onClick={close(() => app.setRoute('emails'))}><span className="menu-item-icon">✉️</span><span className="menu-item-label">{t.emailsMenu}</span></div>}
        {!isGuest && isAeviva && personaType === 'viva' && <div className="menu-item" onClick={close(onVivaRedeem)}><span className="menu-item-icon">✧</span><span className="menu-item-label">{t.vivaRedeemMenu}</span></div>}
        <div className="menu-divider" />
        <div className="menu-item" onClick={close(app.toggleTheme)}>
          <span className="menu-item-icon">{theme === 'dark' ? '☀' : '🌑'}</span>
          <span className="menu-item-label">{theme === 'dark' ? t.lightMode : t.darkMode}</span>
        </div>
        <div className="menu-divider" />
        <div className="menu-fs-row">
          <span className="menu-item-icon">A</span>
          <span className="menu-item-label">{t.textSizeMenu}</span>
          <div className="menu-fs-steps">
            {[0, 1, 2, 3].map(n => (
              <div key={n} className={`menu-fs-step${textScale === n ? ' menu-fs-step-on' : ''}`}
                onClick={async e => { e.stopPropagation(); if (n === textScale) return; await app.setTextScale(n); ui.toast(t.textSizeLevels[n], { duration: 900 }); }}>
                <span className={`menu-fs-a${n}`}>A</span>
              </div>
            ))}
          </div>
        </div>
        <div className="menu-divider" />
        <div className="menu-item" onClick={close(app.toggleLang)}>
          <span className="menu-item-icon">{lang === 'zh' ? '🇺🇸' : '🇨🇳'}</span>
          <span className="menu-item-label">{lang === 'zh' ? 'English' : '中文'}</span>
        </div>
        <div className="menu-divider" />
        {!isGuest ? (
          <div className="menu-item" onClick={close(app.logout)}><span className="menu-item-icon">↪</span><span className="menu-item-label">{sandboxMode ? t.exitSandbox : t.logout}</span></div>
        ) : (
          <div className="menu-item" onClick={close(onGuestJoin)}><span className="menu-item-icon">✦</span><span className="menu-item-label">{t.guestMenuSignUp}</span></div>
        )}
      </div>
    </div>
  );
}
