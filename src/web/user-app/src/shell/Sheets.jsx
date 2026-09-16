// The two app-level sheets from pages/main/main.wxml: the guest 邀请码 join sheet
// (submitGuestInvite → POST /validate-invite, then hand off to the login screen with ?invite=)
// and the Viva 订阅码 redeem sheet (submitVivaRedeem → POST /viva-subscription-redeem).
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STORAGE_KEYS as K } from '../config.js';
import { useApp, storage } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';
import { fmtDate } from '../lib/format.js';

export function GuestJoinSheet({ open, onClose }) {
  const app = useApp();
  const { t } = app;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(''); setError(''); setBusy(false); } }, [open]);
  if (!open) return null;
  const digits = Array.from({ length: 6 }, (_, i) => code[i] || '');
  const submit = async () => {
    if (busy) return;
    const c = code.trim();
    if (!c) { setError(t.guestInviteRequired); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post('/validate-invite', { invite_code: c });
      if (res?.invalid_code) { setError(t.guestInviteInvalid); setBusy(false); return; }
      if (!res?.success) { setError(res?.error || t.errServer); setBusy(false); return; }
      // Valid — hand off to the login screen, which owns account creation. The web cannot
      // create the account from an invite alone (phone/email OTP verify ignores invite_code
      // today); the code is kept so a later server change can consume it.
      storage.set(K.ref, c);
      app.logout();
    } catch { setError(t.errServer); setBusy(false); }
  };
  return (
    <div className="guest-sheet-mask" onClick={onClose}>
      <div className="guest-sheet" onClick={e => e.stopPropagation()}>
        <div className="guest-sheet-handle" />
        <span className="guest-sheet-title">{t.guestJoinTitle}</span>
        <span className="guest-sheet-desc">{t.guestJoinDesc}</span>
        <div className="pin-field">
          <div className="pin-boxes">{digits.map((d, i) => <div key={i} className={`pin-box${d ? ' pin-filled' : ''}${!d && i === code.length ? ' pin-active' : ''}`}><span className="pin-digit">{d}</span></div>)}</div>
          <input className="pin-capture" inputMode="numeric" autoFocus maxLength={6} value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </div>
        {error && <div className="guest-sheet-error"><span>{error}</span></div>}
        <div className={`guest-sheet-btn${busy ? ' guest-sheet-btn-disabled' : ''}`} onClick={submit}><span>{busy ? t.guestActivating : t.guestJoinBtn}</span></div>
      </div>
    </div>
  );
}

export function VivaRedeemSheet({ open, onClose }) {
  const app = useApp();
  const { t, lang, user, vivaSubscriptionExpiresAtDisplay, vivaSubscriptionExpired, setViva } = app;
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setCode(''); setError(''); setBusy(false); } }, [open]);
  if (!open) return null;
  const submit = async () => {
    if (busy) return;
    const c = code.trim();
    if (!c) { setError(t.vivaRedeemRequired); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post('/viva-subscription-redeem', { openid: user.user_id, code: c });
      if (!res?.success) {
        setError({ invalid_code: t.vivaRedeemInvalid, already_used: t.vivaRedeemAlreadyUsed, code_expired: t.vivaRedeemExpired, revoked: t.vivaRedeemInvalid }[res?.status] || t.errServer);
        setBusy(false); return;
      }
      const display = fmtDate(res.new_expires_at, lang);
      setViva(v => ({ ...v, expiresAt: res.new_expires_at, expiresAtDisplay: display, expired: false }));
      setBusy(false); onClose();
      ui.toast(`${t.vivaRedeemSuccess} ${display}`, { duration: 3000 });
    } catch { setError(t.errServer); setBusy(false); }
  };
  return (
    <div className="guest-sheet-mask" onClick={onClose}>
      <div className="guest-sheet" onClick={e => e.stopPropagation()}>
        <div className="guest-sheet-handle" />
        <span className="guest-sheet-title">{t.vivaRedeemTitle}</span>
        <span className="guest-sheet-desc">{vivaSubscriptionExpiresAtDisplay && !vivaSubscriptionExpired ? (lang === 'zh' ? '当前订阅至 ' + vivaSubscriptionExpiresAtDisplay : 'Currently active until ' + vivaSubscriptionExpiresAtDisplay) : (lang === 'zh' ? '当前无有效订阅' : 'No active subscription')}</span>
        <input className="viva-redeem-input" autoFocus value={code} placeholder={t.vivaRedeemPlaceholder} onChange={e => { setCode(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        {error && <div className="guest-sheet-error"><span>{error}</span></div>}
        <div className={`guest-sheet-btn${busy ? ' guest-sheet-btn-disabled' : ''}`} onClick={submit}><span>{busy ? '…' : t.vivaRedeemBtn}</span></div>
      </div>
    </div>
  );
}
