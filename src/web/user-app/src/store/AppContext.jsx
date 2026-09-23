// App-level state, mirroring the Mini Program's app.js globalData + pages/main/main.js
// onLoad/onShow. Persisted under the same localStorage keys the miniapp uses in wx.storage so
// the two clients keep the same session model: a PII-stripped user object, channel, coach,
// theme, text scale, sandbox origin, and the "continue as previous" logout snapshot.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, q, setSandboxMode } from '../api.js';
import { getSessionToken, saveSessionToken, clearSessionToken, sessionAgeMs, SESSION_EXPIRED_EVENT } from '../session.js';
import { STORAGE_KEYS as K, isAevivaChannel, gcnStoreSlug, emailLoginAllowedFor } from '../config.js';
import { LangContext, tableFor } from '../i18n/index.js';
import phoneUtils from '@mini/phone.js';

const { maskPhone, maskEmail } = phoneUtils;

export const storage = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

// login.js:_finishLogin — omit phone/email (PII); keep phoneSet/verified flags and a masked
// form for the logged-out card, captured NOW because the raw phone is only ever seen here.
function trimUser(user) {
  const { phone: _ph, email: _em, ...rest } = user;
  const maskedPhone = user.maskedPhone || maskPhone(_ph) || maskEmail(_em) || '';
  return { ...rest, phoneSet: !!_ph || !!user.phoneSet, phone_verified: !!user.phone_verified, email_verified: !!user.email_verified, maskedPhone };
}

function fmtDate(d, lang) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const y = date.getFullYear(), m = date.getMonth() + 1, day = date.getDate();
  if (lang === 'zh') return `${y}年${m}月${day}日`;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[date.getMonth()]} ${day}, ${y}`;
}

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  // A stored user without a session (signed in before sessions existed, or expired) is signed
  // out: every private route would 401 anyway.
  const [user, setUserState] = useState(() => (getSessionToken() ? storage.get(K.user) : null));
  const [channel, setChannel] = useState(() => storage.get(K.channel));
  const [coach, setCoach] = useState(() => storage.get(K.coach));
  const [sandboxMode, setSandbox] = useState(() => !!storage.get(K.sandboxActive));
  const [theme, setThemeState] = useState(() => storage.get(K.theme) || storage.get(K.user)?.theme || 'dark');
  const [textScale, setTextScaleState] = useState(() => Number(storage.get(K.textScale) || 0));
  const [lang, setLangState] = useState(() => {
    const u = storage.get(K.user); const c = storage.get(K.channel);
    return u?.language === 'en' ? 'en' : (c?.locale === 'en' ? 'en' : 'zh');
  });
  const [viva, setViva] = useState({ personaType: 'nano', expiresAt: null, expired: false, expiresAtDisplay: '', vivaAgActive: false });
  const [credits, setCredits] = useState({ balance: 0, currency: 'CNY' });
  const [tab, setTab] = useState('chat');
  const [route, setRoute] = useState(null); // 'phones' | 'emails' | 'referral' | null — full-screen overlays
  // The 兑换码 redeem sheet (Plans ▸ Dots + the chat's :::formula card) is app-level so it can
  // open over whichever tab is showing. { code, manual, max, name, planId } | null.
  const [codeSheet, setCodeSheet] = useState(null);
  const openCodeSheet = useCallback(opts => setCodeSheet(opts || { code: '', manual: true, max: null, name: '', planId: null }), []);
  const closeCodeSheet = useCallback(() => setCodeSheet(null), []);
  const bus = useRef(new Map()); // cross-tab signals (chat ↔ dots ↔ health)

  useEffect(() => { setSandboxMode(sandboxMode); }, [sandboxMode]);

  // Theme + text scale live on <html> so body background and every inherited token follow.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle('theme-light', theme === 'light');
    for (let i = 1; i <= 3; i++) el.classList.toggle(`fs-${i}`, textScale === i);
  }, [theme, textScale]);

  const isGuest = !!user?.guest;
  const roles = user?.roles || (isGuest ? [] : (user ? ['user'] : []));
  const derived = useMemo(() => ({
    isCoach: roles.includes('coach'),
    isAdmin: roles.includes('admin') || roles.includes('superadmin'),
    isSuperadmin: roles.includes('superadmin'),
    isAeviva: isAevivaChannel(channel),
    gcnStoreSlug: gcnStoreSlug(channel),
    emailLoginAllowed: emailLoginAllowedFor(channel),
  }), [roles.join(','), channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = useMemo(() => tableFor(lang, channel), [lang, channel]);

  const persistUser = useCallback(u => { setUserState(u); if (u) storage.set(K.user, u); else storage.remove(K.user); }, []);

  // main.js:_updateUser — a locally-known change (questionnaire answer, avatar) without a refetch.
  const updateUser = useCallback(patch => {
    setUserState(prev => { const next = { ...(prev || {}), ...patch }; storage.set(K.user, next); return next; });
  }, []);

  // main.js:_saveUser — PUT with the three always-sent profile fields; never resend phone/email.
  const saveUser = useCallback(async updates => {
    const u = user; if (!u?.user_id) return null;
    return api.put(`/users/${q(u.user_id)}`, { nickname: u.nickname, gender: u.gender, birth_date: u.birth_date, ...updates });
  }, [user]);

  const login = useCallback((data) => {
    saveSessionToken(data.session_token);
    const u = data.user;
    const trimmed = trimUser(u);
    persistUser(trimmed);
    setChannel(data.channel || null); storage.set(K.channel, data.channel || null);
    setCoach(data.coach || null); storage.set(K.coach, data.coach || null);
    setLangState(u.language === 'en' ? 'en' : (data.channel?.locale === 'en' ? 'en' : 'zh'));
    if (u.theme) { setThemeState(u.theme); storage.set(K.theme, u.theme); }
    if (u.text_scale != null) { setTextScaleState(Number(u.text_scale) || 0); storage.set(K.textScale, Number(u.text_scale) || 0); }
    setTab('chat');
  }, [persistUser]);

  // login.js:continueAsPrevious — restore the logout snapshot with no network.
  const continueAsPrevious = useCallback(() => {
    const last = storage.get(K.lastSession);
    // The snapshot must carry that account's own session; one from before sessions has none.
    if (!last?.user || !last.session_token) return false;
    saveSessionToken(last.session_token);
    persistUser(last.user);
    setChannel(last.channel || null); storage.set(K.channel, last.channel || null);
    setCoach(last.coach || null); storage.set(K.coach, last.coach || null);
    setLangState(last.user.language === 'en' ? 'en' : 'zh');
    setTab('chat');
    return true;
  }, [persistUser]);

  // main.js:exitSandbox
  const exitSandbox = useCallback(() => {
    const origin = storage.get(K.sandboxOrigin);
    storage.remove(K.sandboxOrigin); storage.remove(K.sandboxActive);
    setSandbox(false);
    if (origin?.user) {
      persistUser(origin.user);
      setChannel(origin.channel || null); storage.set(K.channel, origin.channel || null);
      setCoach(origin.coach || null); storage.set(K.coach, origin.coach || null);
    } else {
      persistUser(null);
    }
    setTab('chat');
  }, [persistUser]);

  // main.js:handleLogout — snapshot (minus PII) for the logged-out "continue as" card.
  const logout = useCallback(() => {
    if (sandboxMode) { exitSandbox(); return; }
    if (user && !user.guest) {
      const { phone, email, ...userToStore } = user;
      storage.set(K.lastSession, { user: userToStore, channel, coach, maskedPhone: user.maskedPhone || maskPhone(phone) || '', session_token: getSessionToken() });
    }
    clearSessionToken();
    persistUser(null);
    setRoute(null);
    setTab('chat');
  }, [user, channel, coach, sandboxMode, exitSandbox, persistUser]);

  const toggleLang = useCallback(() => setLangState(l => (l === 'zh' ? 'en' : 'zh')), []);

  // main.js:toggleTheme — globalData → storage → view → server.
  const toggleTheme = useCallback(async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeState(next); storage.set(K.theme, next);
    updateUser({ theme: next });
    if (user?.user_id && !isGuest) { try { await api.patch(`/users/${q(user.user_id)}`, { theme: next }); } catch { /* ignore */ } }
  }, [theme, user, isGuest, updateUser]);

  // main.js:_applyTextScale
  const setTextScale = useCallback(async level => {
    const n = Math.max(0, Math.min(3, Number(level) || 0));
    setTextScaleState(n); storage.set(K.textScale, n);
    if (user?.user_id && !isGuest) { try { await api.patch(`/users/${q(user.user_id)}`, { text_scale: n }); } catch { /* ignore */ } }
    return n;
  }, [user, isGuest]);

  // main.js:_loadVivaSubscriptionStatus
  const loadVivaSubscriptionStatus = useCallback(async () => {
    if (!user?.user_id || isGuest) return;
    try {
      const res = await api.get(`/viva-subscription-status?openid=${q(user.user_id)}`);
      if (res?.success) {
        const expiresAt = res.viva_subscription_expires_at || null;
        const personaType = res.persona_type || 'nano';
        setViva({
          personaType, expiresAt,
          expired: personaType === 'viva' && (!expiresAt || new Date(expiresAt) <= new Date()),
          expiresAtDisplay: expiresAt ? fmtDate(expiresAt, lang) : '',
          vivaAgActive: !!res.viva_ag_active,
        });
      }
    } catch { /* ignore */ }
  }, [user, isGuest, lang]);

  // main.js:_loadCreditBalance
  const loadCreditBalance = useCallback(async () => {
    if (!user?.user_id || isGuest) return;
    try {
      const res = await api.get(`/credits/balance?user_id=${q(user.user_id)}`);
      if (res?.success) setCredits({ balance: res.balance || 0, currency: res.currency || 'CNY' });
    } catch { /* ignore */ }
  }, [user, isGuest]);

  // main.js:_checkIdentityVerified — authoritative flags from the server; cached on error.
  const checkIdentityVerified = useCallback(async () => {
    if (!user || user.guest) return { phone: false, email: false };
    try {
      const res = await api.get(`/users/${q(user.user_id)}`);
      const phone = !!res?.user?.phone_verified, email = !!res?.user?.email_verified;
      updateUser({ phone_verified: phone, email_verified: email });
      return { phone, email };
    } catch {
      return { phone: !!user.phone_verified, email: !!user.email_verified };
    }
  }, [user, updateUser]);

  // main.js:onShow — heartbeat on every foreground; the wearable-sync race is not applicable.
  useEffect(() => {
    if (!user?.user_id || isGuest) return undefined;
    const beat = () => { if (document.visibilityState === 'visible') api.post('/heartbeat', { user_id: user.user_id }).catch(() => {}); };
    beat();
    loadVivaSubscriptionStatus();
    loadCreditBalance();
    const onVis = () => { if (document.visibilityState === 'visible') { beat(); loadVivaSubscriptionStatus(); loadCreditBalance(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [user?.user_id, isGuest]); // eslint-disable-line react-hooks/exhaustive-deps

  // api.js reports a 401 — the session expired or was revoked — by clearing it and firing this.
  useEffect(() => {
    const onExpired = () => { persistUser(null); setRoute(null); setTab('chat'); };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [persistUser]);

  // Sessions last 30 days; renew one a day old so an active user never meets the expiry.
  useEffect(() => {
    if (!user?.user_id || isGuest || sessionAgeMs() < 24 * 3600 * 1000) return;
    api.post('/session/refresh').then(r => { if (r?.session_token) saveSessionToken(r.session_token); }).catch(() => {});
  }, [user?.user_id, isGuest]);

  // Tiny event bus for cross-tab signals: 'dots:changed', 'health:refresh', 'chat:goto', …
  const emit = useCallback((evt, payload) => { (bus.current.get(evt) || []).forEach(fn => { try { fn(payload); } catch { /* ignore */ } }); }, []);
  const on = useCallback((evt, fn) => {
    const list = bus.current.get(evt) || []; list.push(fn); bus.current.set(evt, list);
    return () => bus.current.set(evt, (bus.current.get(evt) || []).filter(f => f !== fn));
  }, []);

  const value = {
    user, channel, coach, lang, theme, textScale, sandboxMode, isGuest, ...derived, t,
    personaType: viva.personaType, vivaSubscriptionExpiresAt: viva.expiresAt, vivaSubscriptionExpired: viva.expired,
    vivaSubscriptionExpiresAtDisplay: viva.expiresAtDisplay, vivaAgActive: viva.vivaAgActive,
    creditBalance: credits.balance, creditCurrency: credits.currency,
    tab, setTab, route, setRoute, codeSheet, openCodeSheet, closeCodeSheet,
    login, logout, continueAsPrevious, exitSandbox, updateUser, saveUser, persistUser,
    toggleLang, toggleTheme, setTextScale,
    loadVivaSubscriptionStatus, loadCreditBalance, checkIdentityVerified,
    setViva, emit, on,
  };

  return (
    <AppContext.Provider value={value}>
      <LangContext.Provider value={{ lang, t }}>{children}</LangContext.Provider>
    </AppContext.Provider>
  );
}
