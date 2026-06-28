import React, { useState, createContext, useContext, useEffect, useRef } from 'react';
import axios from 'axios';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';
import { T } from './translations.js';

// ── Permission constants ───────────────────────────────────────────────────────
const PERMS = {
  USERS_READ: 'users:read', USERS_WRITE: 'users:write', USERS_DELETE: 'users:delete',
  COACHES_READ: 'coaches:read', COACHES_WRITE: 'coaches:write', COACHES_DELETE: 'coaches:delete',
  STORE_READ: 'store:read', STORE_WRITE: 'store:write', STORE_DELETE: 'store:delete',
  ORDERS_READ: 'orders:read', ORDERS_WRITE: 'orders:write',
  INVITES_READ: 'invites:read', INVITES_WRITE: 'invites:write', INVITES_DELETE: 'invites:delete',
  INVENTORY_READ: 'inventory:read', INVENTORY_WRITE: 'inventory:write',
  ADMIN_ACCTS_READ: 'admin-accounts:read', ADMIN_ACCTS_WRITE: 'admin-accounts:write',
};

// Superadmin always passes. Falls back to tab-name check when allowedPerms absent (compat for old tokens).
function hasPermission(session, perm) {
  if (!session || session.role !== 'channel') return true;
  if (Array.isArray(session.allowedPerms) && session.allowedPerms.length > 0)
    return session.allowedPerms.includes(perm);
  return (session.allowedTabs || []).includes(perm.split(':')[0]);
}

const KINO_MACHINE_PAGE_LIMIT = 10;

function normalizeKinoMachine(machine = {}) {
  return {
    ...machine,
    serial_number: machine.serial_number || machine.machine_no || '',
    name: machine.name || machine.machine_name || '',
    last_used_at: machine.last_used_at || machine.last_seen_at || null,
    test_count: machine.test_count ?? machine.tests ?? 0,
  };
}

function normalizeKinoMachinesPayload(payload = {}) {
  const machines = payload.machines || payload.devices || [];
  const pagination = payload.pagination || {};
  const total = Number(pagination.total ?? payload.total ?? machines.length);
  const limit = Number(pagination.limit ?? KINO_MACHINE_PAGE_LIMIT);
  const totalPages = Number(pagination.total_pages ?? Math.max(1, Math.ceil(total / limit)));

  return {
    devices: machines.map(normalizeKinoMachine),
    pagination: {
      page: Number(pagination.page ?? payload.page ?? 1),
      limit,
      total,
      total_pages: totalPages,
    },
  };
}

function buildKinoMachinesUrl({ page = 1, q = '' } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(Math.max(1, page)));
  params.set('limit', String(KINO_MACHINE_PAGE_LIMIT));
  if (q.trim()) params.set('q', q.trim());
  return `/kino/kino-machines?${params.toString()}`;
}

function LoginScreen({ onLogin, sessionExpired }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await axios.post('/api/admin/login', { username, password })
      if (res.data?.token) {
        sessionStorage.setItem('nano_admin_token', res.data.token)
        sessionStorage.setItem('nano_admin_user', username)
        sessionStorage.setItem('nano_admin_role', res.data.role || 'superadmin')
        sessionStorage.setItem('nano_admin_channel_id', res.data.channel_id ?? '')
        sessionStorage.setItem('nano_admin_channel_name', res.data.channel_name || '')
        sessionStorage.setItem('nano_admin_channel_logo', res.data.channel_logo || '')
        sessionStorage.setItem('nano_admin_tabs', JSON.stringify(res.data.allowed_tabs || []))
        sessionStorage.setItem('nano_admin_perms', JSON.stringify(res.data.allowed_perms || []))
        sessionStorage.setItem('nano_admin_cms', res.data.can_manage_subchannels ? '1' : '')
        sessionStorage.setItem('nano_admin_can_customize_store', res.data.can_customize_store ? '1' : '')
        sessionStorage.setItem('nano_admin_can_manage_warehouses', res.data.can_manage_warehouses ? '1' : '')
        sessionStorage.setItem('nano_admin_autonomous', res.data.autonomous ? '1' : '')
        onLogin(res.data.token)
      } else {
        setError('Login failed')
      }
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0B1C2E' }}>
      <div style={{ background: '#0F2540', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 16, padding: '48px 40px', width: 360, boxShadow: '0 16px 64px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <img src={wavenLogo} alt="Waven" style={{ width: 32, height: 32 }} />
          <span style={{ color: '#EEF2FF', fontWeight: 700, fontSize: 18, letterSpacing: 4 }}>NANO ADMIN</span>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'rgba(166,196,229,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
              style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '10px 14px', color: '#EEF2FF', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ color: 'rgba(166,196,229,0.6)', fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{ background: '#162E4A', border: '1px solid rgba(99,117,236,0.25)', borderRadius: 8, padding: '10px 14px', color: '#EEF2FF', fontSize: 14, outline: 'none' }}
            />
          </div>
          {sessionExpired && !error && <div style={{ color: '#fbbf24', fontSize: 13, textAlign: 'center' }}>Session expired — please sign in again.</div>}
          {error && <div style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{error}</div>}
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: 8, background: 'linear-gradient(135deg, #6375EC, #8B9FFF)', border: 'none', borderRadius: 8, padding: '12px 0', color: '#fff', fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

const LangCtx = createContext({ lang: 'en', t: T.en, toggleLang: () => {} });
const useLang = () => useContext(LangCtx);

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v) => (v == null || v === '' ? '—' : v);
const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';
const bioAgeColor = (bio, chrono) => {
  if (!bio || !chrono) return '#64748b';
  return Number(bio) <= Number(chrono) ? '#16a34a' : '#dc2626';
};
const ALL_ROLES = ['user', 'coach', 'admin', 'superadmin'];
const EMPTY_USER = { nickname: '', gender: '', birth_date: '', language: 'zh', external_id: '', external_app: 'wechat', coach_id: '', channel_id: '', phone: '', email: '', roles: ['user'] };

// ── shared components ─────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = '#3b82f6' }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: color + '1a', color }}>
        <Icon size={20} />
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function RichStatCard({ icon: Icon, label, value, color = '#3b82f6', subs = [] }) {
  return (
    <div className="stat-card" style={{ alignItems: 'flex-start', paddingTop: 14, paddingBottom: 14 }}>
      <div className="stat-icon" style={{ background: color + '1a', color, marginTop: 2 }}>
        <Icon size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {subs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {subs.map((s, i) => (
              <span key={i} style={{
                fontSize: 11, whiteSpace: 'nowrap', borderRadius: 4, padding: '1px 6px',
                background: s.highlight ? color + '15' : '#f1f5f9',
                color: s.highlight ? color : '#64748b',
                border: `1px solid ${s.highlight ? color + '30' : '#e2e8f0'}`,
                fontWeight: s.highlight ? 600 : 400,
              }}>
                {s.label} {s.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ children, color = '#3b82f6' }) {
  return <span className="badge" style={{ background: color + '1a', color }}>{children}</span>;
}

// ── UserPicker ─────────────────────────────────────────────────────────────────
// Reusable channel-scoped user search widget.
// Props:
//   value        — { user_id, nickname } or null
//   onChange     — called with { user_id, nickname } on select, or null on clear
//   placeholder  — input placeholder text
//   label        — optional label string
function UserPicker({ value, onChange, placeholder = 'Search by name, phone…', label }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = (q) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/api/users', { params: { q, limit: 10 } });
        setResults(res.data.users || []);
        setOpen(true);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 280);
  };

  const select = (u) => {
    onChange({ user_id: u.user_id, nickname: u.nickname });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const clear = () => { onChange(null); setQuery(''); setResults([]); };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {label && <div className="form-label-text" style={{ marginBottom: 4, fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{label}</div>}
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{value.nickname || value.user_id}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8, fontFamily: 'monospace' }}>{value.user_id?.slice(0, 20)}…</span>
          </div>
          <button type="button" onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', lineHeight: 1, padding: 2, fontSize: 16 }}>×</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={placeholder}
            style={{ width: '100%', boxSizing: 'border-box' }}
            autoComplete="off"
          />
          {loading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--muted)' }}>…</span>}
        </div>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', maxHeight: 220, overflowY: 'auto', marginTop: 2,
        }}>
          {results.map(u => (
            <button key={u.user_id} type="button" onMouseDown={() => select(u)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
              border: 'none', background: 'none', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
            }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{u.nickname || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{u.user_id?.slice(0, 24)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export {
  T,
  PERMS, hasPermission,
  KINO_MACHINE_PAGE_LIMIT, normalizeKinoMachine, normalizeKinoMachinesPayload, buildKinoMachinesUrl,
  LoginScreen,
  LangCtx, useLang,
  fmt, fmtDate, bioAgeColor,
  ALL_ROLES, EMPTY_USER,
  StatCard, RichStatCard, Badge,
  UserPicker,
};
