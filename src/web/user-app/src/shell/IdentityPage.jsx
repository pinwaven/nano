// 手机号管理 / 邮箱管理 — pages/phones and pages/emails, which differ only in the identity
// kind (the emails page adds an "unverified" badge and an empty hint). Rendered as a full-screen
// route inside the frame (app.route). Bind = send an OTP, then POST /{kind}-otp/bind; the
// response's `user` is authoritative (it may be the merge winner) and replaces the session.
import { useCallback, useEffect, useRef, useState } from 'react';
import phoneUtils from '@mini/phone.js';
import { api, q } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';

const { maskPhone, maskEmail } = phoneUtils;
const PHONE_RE = /^1\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function IdentityPage({ kind }) {
  const app = useApp();
  const { user, lang, t: T, setRoute, persistUser, updateUser } = app;
  const t = kind === 'phone' ? T.phones : T.emails;
  const isPhone = kind === 'phone';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addMode, setAddMode] = useState(false);
  const [step, setStep] = useState('value');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const timer = useRef(null);

  const fetchRows = useCallback(async () => {
    if (!user || user.guest) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get(`/${kind}-otp/list?user_id=${q(user.user_id)}`);
      const list = res?.success ? (isPhone ? (res.phones || []).map(p => ({ ...p, value: p.phone, masked: maskPhone(p.phone) })) : (res.emails || []).map(e => ({ ...e, value: e.email, masked: e.email }))) : [];
      setRows(list);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user, kind, isPhone]);
  useEffect(() => { fetchRows(); return () => clearInterval(timer.current); }, [fetchRows]);

  // pages/phones/phones.js:fmt — single-brace {key} placeholders.
  const f = (str, vars) => String(str || '').replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] !== undefined ? vars[k] : ''));
  const startCooldown = () => { setCooldown(60); clearInterval(timer.current); timer.current = setInterval(() => setCooldown(c => { if (c <= 1) { clearInterval(timer.current); return 0; } return c - 1; }), 1000); };
  const applyUpdatedUser = u => {
    if (!u) return;
    const { phone: _ph, email: _em, ...rest } = u;
    const maskedPhone = u.maskedPhone || maskPhone(_ph) || maskEmail(_em) || '';
    persistUser({ ...rest, phoneSet: !!_ph, phone_verified: !!u.phone_verified, email_verified: !!u.email_verified, maskedPhone });
  };
  const sendCode = async () => {
    const v = value.trim();
    if (isPhone ? !PHONE_RE.test(v) : !EMAIL_RE.test(v)) { setError(isPhone ? t.errorInvalidPhone : t.errorInvalidEmail); return; }
    setBusy(true); setError('');
    try {
      const res = await api.post(`/${kind}-otp/send`, isPhone ? { phone: v } : { email: v, purpose: 'bind', language: lang });
      if (!res?.success) { setBusy(false); setError(t.errorSendFailed); return; }
      setStep('code'); setCode(''); setBusy(false); startCooldown();
    } catch { setBusy(false); setError(t.errorNetwork); }
  };
  const verifyCode = async c => {
    const cd = (c ?? code).trim(); if (!cd || busy) return;
    setBusy(true); setError('');
    try {
      const res = await api.post(`/${kind}-otp/bind`, { user_id: user.user_id, [kind]: value.trim(), code: cd });
      if (!res?.success) {
        setBusy(false);
        setError(res?.error === 'invalid_code' ? t.errorInvalidCode : res?.error === (isPhone ? 'phone_in_use' : 'email_in_use') ? (isPhone ? t.errorPhoneInUse : t.errorEmailInUse) : t.errorNetwork);
        return;
      }
      applyUpdatedUser(res.user);
      setBusy(false); setAddMode(false); ui.toast(t.toastAdded); fetchRows(); app.checkIdentityVerified();
    } catch { setBusy(false); setError(t.errorNetwork); }
  };
  const setPrimary = async v => {
    const { confirm } = await ui.confirm({ title: t.confirmSetPrimaryTitle, content: f(t.confirmSetPrimaryContent, { [kind]: isPhone ? maskPhone(v) : v }) });
    if (!confirm) return;
    try {
      const r = await api.post(`/${kind}-otp/set-primary`, { user_id: user.user_id, [kind]: v });
      if (!r?.success) { ui.toast(t.errorNetwork); return; }
      const row = rows.find(x => x.value === v);
      updateUser(isPhone ? { phone_verified: true, maskedPhone: maskPhone(v) } : { email_verified: !!(row && row.verified_at) });
      ui.toast(t.toastPrimarySet); fetchRows();
    } catch { ui.toast(t.errorNetwork); }
  };
  const remove = async v => {
    const { confirm } = await ui.confirm({ title: t.confirmRemoveTitle, content: f(t.confirmRemoveContent, { [kind]: isPhone ? maskPhone(v) : v }) });
    if (!confirm) return;
    try {
      const r = await api.post(`/${kind}-otp/remove`, { user_id: user.user_id, [kind]: v });
      if (!r?.success) { ui.toast(t.errorNetwork); return; }
      const next = r.new_primary;
      const row = next && rows.find(x => x.value === next);
      updateUser(isPhone ? { phone_verified: !!next, maskedPhone: next ? maskPhone(next) : '' } : { email_verified: !!next && !!(row && row.verified_at) });
      ui.toast(t.toastRemoved); fetchRows(); app.checkIdentityVerified();
    } catch { ui.toast(t.errorNetwork); }
  };
  const close = () => { clearInterval(timer.current); setAddMode(false); setCooldown(0); };

  return (
    <div className={`${kind}s-page route-page`}>
      <div className="app-header">
        <div className="back-btn" onClick={() => setRoute(null)}><span className="back-icon">‹</span><span className="back-label">{t.back}</span></div>
        <span className="header-title">{t.title}</span>
      </div>
      <div className={`${kind}s-content tab-scroll`}>
        {loading ? <div className="center-msg"><span className="dim-text">{t.loading}</span></div> : (
          <div className="card">
            {rows.map(item => (
              <div key={item.value} className={`${kind}-row`}>
                <div className={`${kind}-row-main`}>
                  <span className={`${kind}-value`}>{item.masked}</span>
                  {item.is_primary && <span className={`${kind}-badge`}>{t.primaryBadge}</span>}
                  {!isPhone && !item.verified_at && <span className="email-badge email-badge-muted">{t.unverifiedBadge}</span>}
                </div>
                <div className={`${kind}-row-actions`}>
                  {!item.is_primary && <span className={`${kind}-action`} onClick={() => setPrimary(item.value)}>{t.setPrimaryAction}</span>}
                  <span className={`${kind}-action ${kind}-action-danger`} onClick={() => remove(item.value)}>{t.removeAction}</span>
                </div>
              </div>
            ))}
            {!isPhone && rows.length === 0 && <div className="center-msg"><span className="dim-text">{t.emptyHint}</span></div>}
            <div className={`btn btn-outline add-${kind}-btn`} onClick={() => { setAddMode(true); setStep('value'); setValue(''); setCode(''); setError(''); }}><span>{isPhone ? t.addPhoneBtn : t.addEmailBtn}</span></div>
          </div>
        )}
      </div>
      {addMode && (
        <div className="withdraw-overlay" onClick={close}>
          <div className="withdraw-modal" onClick={e => e.stopPropagation()}>
            <span className="withdraw-modal-title">{isPhone ? t.addPhoneBtn : t.addEmailBtn}</span>
            {step === 'value' ? (
              <div>
                <div className="form-field"><span className="form-label">{isPhone ? t.phoneLabel : t.emailLabel}</span>
                  <input className="form-input" value={value} autoFocus inputMode={isPhone ? 'numeric' : 'email'} maxLength={isPhone ? 11 : 254} placeholder={isPhone ? t.phonePlaceholder : t.emailPlaceholder}
                    onChange={e => { setValue(isPhone ? e.target.value.replace(/\D/g, '').slice(0, 11) : e.target.value.trim().slice(0, 254)); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') sendCode(); }} /></div>
                {error && <span className="error-text">{error}</span>}
                <div className="withdraw-btns"><div className="btn btn-outline" onClick={close}><span>{t.cancelBtn}</span></div><div className={`btn btn-primary${busy ? ' disabled' : ''}`} onClick={sendCode}><span>{busy ? t.sending : t.sendCodeBtn}</span></div></div>
              </div>
            ) : (
              <div>
                <div className="form-field"><span className="form-label">{t.codeLabel}</span><span className={`${kind}-step-desc`}>{f(t.codeSentTo, { [kind]: value })}</span>
                  <input className="form-input" value={code} autoFocus inputMode="numeric" maxLength={6} placeholder="——————" onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setError(''); if (v.length === 6) verifyCode(v); }} /></div>
                {error && <span className="error-text">{error}</span>}
                <div className={`${kind}s-links`}>
                  {cooldown > 0 ? <span className="dim-text">{f(t.resendCooldown, { n: cooldown })}</span> : <span className={`${kind}s-link`} onClick={sendCode}>{t.resendCode}</span>}
                  <span className={`${kind}s-link`} onClick={() => { clearInterval(timer.current); setStep('value'); setCode(''); setError(''); setCooldown(0); }}>{isPhone ? t.changeNumber : t.changeEmail}</span>
                </div>
                <div className="withdraw-btns"><div className="btn btn-outline" onClick={close}><span>{t.cancelBtn}</span></div><div className={`btn btn-primary${busy ? ' disabled' : ''}`} onClick={() => verifyCode()}><span>{busy ? t.verifying : t.verifyBtn}</span></div></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
