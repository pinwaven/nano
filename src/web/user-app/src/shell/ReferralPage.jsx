// 邀请好友 — pages/referral. Shows the referral code; 分享 copies an invite URL to this app
// (the miniapp shares a card to pages/login?invite=<code>, which the web cannot do).
import { clipboard } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';

export default function ReferralPage() {
  const app = useApp();
  const { user, t: T, setRoute } = app;
  const t = T.referral;
  const code = user?.referral_code || user?.user_id || '';
  const copyCode = async () => { if (await clipboard.write(code)) ui.toast(t.copied); };
  const share = async () => {
    const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/?invite=${encodeURIComponent(code)}`;
    if (navigator.share) { try { await navigator.share({ title: t.shareTitle, url }); return; } catch { /* fall through to copy */ } }
    if (await clipboard.write(url)) ui.toast(T.inviteLinkCopied);
  };
  return (
    <div className="referral-page route-page">
      <div className="app-header">
        <div className="back-btn" onClick={() => setRoute(null)}><span className="back-icon">‹</span><span className="back-label">{t.back}</span></div>
        <span className="header-title">{t.title}</span>
      </div>
      <div className="tab-scroll" style={{ flex: 1 }}>
        <div className="card">
          <span className="card-label">{t.yourCode}</span>
          <div className="code-row"><span className="code-value">{code}</span></div>
          <div className="btn-row"><div className="btn btn-outline" onClick={copyCode}><span>{t.copyCode}</span></div><div className="btn btn-primary" onClick={share}><span>{t.shareCard}</span></div></div>
        </div>
        <div className="card how-card">
          <span className="card-label">{t.howTitle}</span>
          {[t.how1, t.how2, t.how3].map((x, i) => <div key={i} className="how-row"><span className="how-num">{i + 1}</span><span className="how-text">{x}</span></div>)}
        </div>
        <div className="bottom-safe" />
      </div>
    </div>
  );
}
