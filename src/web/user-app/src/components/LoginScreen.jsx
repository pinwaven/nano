import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import wavenLogo from '../../../shared/assets/waven-logo-icon.png';
import { useLang } from '../i18n/index.js';
import { LangToggle } from './Widgets.jsx';
import { STORAGE_KEYS as K, emailLoginAllowedFor } from '../config.js';
import { storage } from '../store/AppContext.jsx';

const API = '/api';
const QR_POLL_INTERVAL = 2500; // ms

// Email OTP login (nano's /email-otp/*) is a Waven-channel identity; the server refuses an
// aeviva-tree account with channel_not_supported, and the web user-app is channel-unaware at
// login time, so the tab is always offered here and the refusal is surfaced as a message.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function LoginScreen({ onLogin, lang, onLangChange, onContinue }) {
  const { t } = useLang();
  // pages/login/login.js: the logged-out card offers an instant, no-OTP "continue as previous"
  // restore from the logout snapshot; the channel/logo/name come from the last session's
  // channel; email login is only offered on the Waven tree (or with no channel known yet).
  const lastSession = storage.get(K.lastSession);
  const lastChannel = storage.get(K.channel) || lastSession?.channel || null;
  const emailAllowed = emailLoginAllowedFor(lastChannel);
  // Only a snapshot that carries its own session can be resumed without signing in.
  const [showLoggedOut, setShowLoggedOut] = useState(!!(lastSession && lastSession.user && lastSession.maskedPhone && lastSession.session_token));
  const [tab, setTab] = useState('qr'); // 'phone' | 'email' | 'qr'

  // ── Phone / email + OTP login ─────────────────────────────────
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otpStep, setOtpStep] = useState('phone'); // 'phone' | 'code'
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef(null);

  const startCooldown = (seconds) => {
    setResendCooldown(seconds);
    clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(s => {
        if (s <= 1) { clearInterval(cooldownRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearInterval(cooldownRef.current), []);

  const isEmail = tab === 'email';
  const cleanedPhone = () => phone.trim().replace(/[\s\-()]/g, '');
  const cleanedEmail = () => email.trim().toLowerCase();

  const handleSendCode = async () => {
    let payload;
    if (isEmail) {
      const e = cleanedEmail();
      if (!EMAIL_RE.test(e)) { setError(t.errInvalidEmail); return; }
      payload = { email: e, language: lang };
    } else {
      const p = cleanedPhone();
      if (!/^1\d{10}$/.test(p)) { setError(t.errInvalidPhone); return; }
      payload = { phone: p };
    }
    setLoading(true);
    setError('');
    try {
      const r = await axios.post(`${API}/${isEmail ? 'email-otp' : 'phone-otp'}/send`, payload);
      if (!r.data.success) {
        setError(r.data.error === 'rate_limited' ? t.errRateLimited
          : r.data.error === 'invalid_email' ? t.errInvalidEmail
          : t.errSendFailed);
        return;
      }
      setOtpStep('code');
      startCooldown(60);
    } catch {
      setError(t.errNetwork);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const payload = isEmail
        ? { email: cleanedEmail(), code: code.trim(), language: lang }
        : { phone: cleanedPhone(), code: code.trim() };
      const r = await axios.post(`${API}/${isEmail ? 'email-otp' : 'phone-otp'}/verify`, payload);
      if (!r.data.success) {
        setError(r.data.error === 'too_many_attempts' ? t.errTooManyAttempts
          : r.data.error === 'channel_not_supported' ? t.errChannelNotSupported
          : t.errInvalidCode);
        return;
      }
      onLogin(r.data);
    } catch {
      setError(t.errNetwork);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeNumber = () => {
    setOtpStep('phone');
    setCode('');
    setError('');
    clearInterval(cooldownRef.current);
    setResendCooldown(0);
  };

  // Switching identifier tabs restarts the OTP flow — a code sent to a phone must not be
  // submitted against an email.
  const switchTab = next => {
    if (next === tab) return;
    handleChangeNumber();
    setTab(next);
  };

  // ── QR login ───────────────────────────────────────────────────
  const [qrImg, setQrImg] = useState(null);
  const [qrSession, setQrSession] = useState(null);
  const [qrStatus, setQrStatus] = useState('idle'); // idle | loading | pending | confirmed | expired | error
  const [qrError, setQrError] = useState('');
  const pollRef = useRef(null);
  const expireRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (expireRef.current) clearTimeout(expireRef.current);
    pollRef.current = null;
    expireRef.current = null;
  };

  const initQr = async () => {
    stopPolling();
    setQrImg(null);
    setQrSession(null);
    setQrStatus('loading');
    setQrError('');
    try {
      const r = await axios.post(`${API}/qr-login/init`, {});
      if (!r.data.success) throw new Error(r.data.error || 'init failed');
      setQrImg(r.data.qr_image);
      setQrSession(r.data.session_id);
      setQrStatus('pending');

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const p = await axios.get(`${API}/qr-login/status`, { params: { session_id: r.data.session_id } });
          const s = p.data.status;
          if (s === 'confirmed' && p.data.user) {
            stopPolling();
            setQrStatus('confirmed');
            setTimeout(() => onLogin(p.data), 800);
          } else if (s === 'expired') {
            stopPolling();
            setQrStatus('expired');
          }
        } catch { /* transient network errors ok, keep polling */ }
      }, QR_POLL_INTERVAL);

      // Auto-expire after 5 min
      expireRef.current = setTimeout(() => {
        stopPolling();
        setQrStatus('expired');
      }, (r.data.expires_in || 300) * 1000);
    } catch (err) {
      setQrStatus('error');
      setQrError(err.message || t.errNetwork);
    }
  };

  // Init QR when tab switches to 'qr'
  useEffect(() => {
    if (tab === 'qr') {
      initQr();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [tab]);

  return (
    <div className="login-screen">
      <div className="login-glow" />
      <div className="login-top-bar">
        <LangToggle lang={lang} onChange={onLangChange} />
      </div>
      <div className="login-brand">
        <div className="login-logo-ring">
          <img src={lastChannel?.logo_url || wavenLogo} className="login-logo" alt="" />
        </div>
        <div className="login-title">{lastChannel?.name || 'NANO'}</div>
        <div className="login-subtitle">{t.subtitle}</div>
      </div>

      {showLoggedOut && (
        <div className="login-card">
          <div className="login-card-label">{t.welcomeBack}</div>
          <button className="login-btn" onClick={() => onContinue?.()}>{t.continueAs(lastSession.maskedPhone)}</button>
          <button className="login-btn login-btn--ghost" style={{ marginTop: 10 }} onClick={() => { setShowLoggedOut(false); setTab('phone'); }}>{t.useOtherPhone}</button>
          {emailAllowed && <button className="login-btn login-btn--ghost" style={{ marginTop: 10 }} onClick={() => { setShowLoggedOut(false); setTab('email'); }}>{t.useEmailLogin}</button>}
        </div>
      )}

      {/* Tab switcher */}
      {!showLoggedOut && <div className="login-tab-bar">
        <button
          className={`login-tab-btn${tab === 'phone' ? ' login-tab-btn--active' : ''}`}
          onClick={() => switchTab('phone')}
        >
          {t.loginTabPhone}
        </button>
        {emailAllowed && <button
          className={`login-tab-btn${tab === 'email' ? ' login-tab-btn--active' : ''}`}
          onClick={() => switchTab('email')}
        >
          {t.loginTabEmail}
        </button>}
        <button
          className={`login-tab-btn${tab === 'qr' ? ' login-tab-btn--active' : ''}`}
          onClick={() => switchTab('qr')}
        >
          {t.loginTabQr}
        </button>
      </div>}

      {/* Phone / email + OTP login card */}
      {!showLoggedOut && (tab === 'phone' || tab === 'email') && (
        <div className="login-card">
          <div className="login-card-label">{t.signIn}</div>

          {otpStep === 'phone' && (
            <>
              <div className="login-field">
                <label className="login-label">{isEmail ? t.emailLabel : t.phoneLabel}</label>
                {isEmail ? (
                  <input
                    className="login-input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder={t.emailPlaceholder}
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendCode(); }}
                    autoFocus
                  />
                ) : (
                  <input
                    className="login-input"
                    type="tel"
                    inputMode="tel"
                    placeholder={t.phonePlaceholder}
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') handleSendCode(); }}
                    autoFocus
                  />
                )}
              </div>
              {error && <div className="login-error">{error}</div>}
              <button className="login-btn" onClick={handleSendCode} disabled={!(isEmail ? email : phone).trim() || loading}>
                {loading && <span className="login-btn-spinner" />}
                {loading ? t.verifying : t.sendCode}
              </button>
            </>
          )}

          {otpStep === 'code' && (
            <>
              <div className="login-field">
                <label className="login-label">{t.codeLabel}</label>
                <input
                  className="login-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder={t.otpCodePlaceholder}
                  value={code}
                  onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleVerifyCode(); }}
                  autoFocus
                />
              </div>
              {error && <div className="login-error">{error}</div>}
              <button className="login-btn" onClick={handleVerifyCode} disabled={!code.trim() || loading}>
                {loading && <span className="login-btn-spinner" />}
                {loading ? t.verifying : t.confirm}
              </button>
              <div className="login-qr-hint">
                {resendCooldown > 0 ? (
                  t.resendIn(resendCooldown)
                ) : (
                  <button className="login-link-btn" onClick={handleSendCode} disabled={loading}>{t.resendCode}</button>
                )}
                <span className="login-footer-dot">·</span>
                <button className="login-link-btn" onClick={handleChangeNumber} disabled={loading}>{isEmail ? t.changeEmail : t.changeNumber}</button>
              </div>
              {isEmail && <div className="login-qr-hint">{t.emailSpamHint}</div>}
            </>
          )}
        </div>
      )}

      {/* QR login card */}
      {!showLoggedOut && tab === 'qr' && (
        <div className="login-card login-card--qr">
          <div className="login-card-label">{t.qrTitle}</div>
          <div className="login-qr-desc">{t.qrDesc}</div>

          {qrStatus === 'loading' && (
            <div className="login-qr-placeholder">
              <div className="login-qr-spinner" />
            </div>
          )}

          {qrStatus === 'pending' && qrImg && (
            <div className="login-qr-wrap">
              <img className="login-qr-img" src={qrImg} alt="WeChat QR" />
            </div>
          )}

          {qrStatus === 'confirmed' && (
            <div className="login-qr-success">
              <div className="login-qr-success-icon">✓</div>
              <div>{t.qrSuccess}</div>
            </div>
          )}

          {qrStatus === 'expired' && (
            <div className="login-qr-expired">
              <div>{t.qrExpired}</div>
              <button className="login-btn" style={{ marginTop: '12px' }} onClick={initQr}>
                {t.qrRefresh}
              </button>
            </div>
          )}

          {qrStatus === 'error' && (
            <div className="login-qr-expired">
              <div>{qrError || t.errNetwork}</div>
              <button className="login-btn" style={{ marginTop: '12px' }} onClick={initQr}>
                {t.qrRefresh}
              </button>
            </div>
          )}

          <div className="login-qr-hint">{t.qrHint}</div>
        </div>
      )}

      <div className="login-footer">
        <span>{t.loginFooter}</span>
      </div>
    </div>
  );
}
