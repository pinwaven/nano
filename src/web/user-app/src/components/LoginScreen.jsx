import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import wavenLogo from '../../../shared/assets/waven-logo-icon.png';
import { useLang } from '../i18n.js';
import { LangToggle } from './Widgets.jsx';

const API = '/api';
const QR_POLL_INTERVAL = 2500; // ms

export default function LoginScreen({ onLogin, lang, onLangChange }) {
  const { t } = useLang();
  const [tab, setTab] = useState('qr'); // 'phone' | 'qr'

  // ── Phone login ────────────────────────────────────────────────
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleaned = phone.trim().replace(/[\s\-()]/g, '');
    if (!cleaned) return;
    setLoading(true);
    setError('');
    try {
      const r = await axios.get(`${API}/users`);
      const users = r.data.users || [];
      const found = users.find(u => u.phone && u.phone.replace(/[\s\-()]/g, '') === cleaned);
      if (found) {
        onLogin(found);
      } else {
        setError(t.errNotFound);
      }
    } catch {
      setError(t.errNetwork);
    } finally {
      setLoading(false);
    }
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
            setTimeout(() => onLogin(p.data.user), 800);
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
          <img src={wavenLogo} className="login-logo" alt="Waven" />
        </div>
        <div className="login-title">NANO</div>
        <div className="login-subtitle">{t.subtitle}</div>
      </div>

      {/* Tab switcher */}
      <div className="login-tab-bar">
        <button
          className={`login-tab-btn${tab === 'qr' ? ' login-tab-btn--active' : ''}`}
          onClick={() => setTab('qr')}
        >
          {t.loginTabQr}
        </button>
      </div>

      {/* Phone login card — disabled */}
      {tab === 'phone' && (
        <div className="login-card">
          <div className="login-card-label">{t.signIn}</div>
          <div className="login-field">
            <label className="login-label">{t.phoneLabel}</label>
            <input
              className="login-input"
              type="tel"
              inputMode="tel"
              placeholder={t.phonePlaceholder}
              value={phone}
              onChange={e => { setPhone(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
              autoFocus
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" onClick={handleLogin} disabled={!phone.trim() || loading}>
            {loading && <span className="login-btn-spinner" />}
            {loading ? t.verifying : t.continue}
          </button>
        </div>
      )}

      {/* QR login card */}
      {tab === 'qr' && (
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
        <span>{t.footerBrand}</span>
        <span className="login-footer-dot">·</span>
        <span>{t.footerTag}</span>
      </div>
    </div>
  );
}
