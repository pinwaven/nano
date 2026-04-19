import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';

const API = '/api';

const BM_META = [
  { key: 'hsCRP',     label: 'hsCRP',            unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     label: 'GDF-15',           unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       label: 'IL-6',             unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        label: 'Glycated Albumin',  unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', label: 'Cystatin C',        unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      label: 'CD38',              unit: 'xBaseline', color: '#10b981' },
];

function chronoAge(birthDate) {
  if (!birthDate) return null;
  const ms = Date.now() - new Date(birthDate).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return 'var(--text)';
  const diff = Number(bio) - Number(chrono);
  if (diff > 2) return '#ef4444';
  if (diff < -2) return '#10b981';
  return '#f59e0b';
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ values, color, width = 130, height = 38 }) {
  if (!values || values.length < 2) {
    return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 4;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w;
    const y = pad + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const last = values[values.length - 1];
  const lx = pad + w;
  const ly = pad + h - ((last - min) / range) * h;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
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
      const found = users.find(u =>
        u.phone && u.phone.replace(/[\s\-()]/g, '') === cleaned
      );
      if (found) {
        onLogin(found);
      } else {
        setError('No account found with this phone number. Please contact your coach.');
      }
    } catch {
      setError('Connection failed. Please check your network and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-glow" />
      <div className="login-brand">
        <div className="login-logo-ring">
          <img src={wavenLogo} className="login-logo" alt="Waven" />
        </div>
        <div className="login-title">NANO AI</div>
        <div className="login-subtitle">Your Precision Health Companion</div>
      </div>

      <div className="login-card">
        <div className="login-card-label">Sign in to your account</div>
        <div className="login-field">
          <label className="login-label">Phone Number</label>
          <input
            className="login-input"
            type="tel"
            inputMode="tel"
            placeholder="+86 138 0000 0000"
            value={phone}
            onChange={e => { setPhone(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
            autoFocus
          />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={!phone.trim() || loading}
        >
          {loading
            ? <span className="login-btn-spinner" />
            : null
          }
          {loading ? 'Verifying…' : 'Continue'}
        </button>
      </div>

      <div className="login-footer">
        <span>Waven Health</span>
        <span className="login-footer-dot">·</span>
        <span>Precision Longevity</span>
      </div>
    </div>
  );
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab({ user }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.user_id) return;
    setLoading(true);
    axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setRecords(r.data.records || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [user?.user_id]);

  const latestBm = records.length > 0 ? (records[records.length - 1].data?.estimated || {}) : null;
  const trendFor = key => records.map(r => r.data?.estimated?.[key]).filter(v => v != null);
  const age = chronoAge(user.birth_date);

  return (
    <div className="health-tab">
      {/* Hero profile card */}
      <div className="health-hero">
        <div className="health-hero-bg" />
        <div className="health-avatar">
          {(user.nickname || 'U')[0].toUpperCase()}
        </div>
        <div className="health-name">{user.nickname || 'User'}</div>
        {user.bio_age && (
          <div className="health-bio-row">
            <div className="health-bio-chip">
              <span
                className="health-bio-num"
                style={{ color: bioAgeColor(user.bio_age, age) }}
              >
                {Number(user.bio_age).toFixed(1)}
              </span>
              <span className="health-bio-unit">Bio Age</span>
            </div>
            {age && (
              <div className="health-bio-chip health-bio-chip--dim">
                <span className="health-bio-num" style={{ color: 'var(--text-sub)' }}>{age}</span>
                <span className="health-bio-unit">Chrono Age</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Profile details */}
      <div className="health-section">
        <div className="health-section-title">Profile</div>
        <div className="health-info-grid">
          {[
            ['Gender',    user.gender],
            ['Born',      fmtDate(user.birth_date)],
            ['Language',  user.language ? user.language.toUpperCase() : null],
            ['Coach',     user.coach_name],
            ['Joined',    fmtDate(user.created_at)],
            ['Phone',     user.phone],
            ['Email',     user.email],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="health-info-key">{k}</span>
              <span className="health-info-val">{v || '—'}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Latest biomarkers */}
      <div className="health-section">
        <div className="health-section-title">Latest Biomarkers</div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : latestBm ? (
          <div className="bm-list">
            {BM_META.map(({ key, label, unit, color }) => (
              <div key={key} className="bm-row">
                <span className="bm-dot" style={{ background: color }} />
                <span className="bm-label">{label}</span>
                <span className="bm-val" style={{ color }}>{latestBm[key] ?? '—'}</span>
                <span className="bm-unit">{unit}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="health-empty">No biomarker data available yet.</div>
        )}
      </div>

      {/* Trends */}
      <div className="health-section">
        <div className="health-section-title">
          Trends
          {records.length > 0 && (
            <span className="health-section-badge">{records.length} test{records.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : records.length > 0 ? (
          <div className="trend-grid">
            {BM_META.map(({ key, label, unit, color }) => {
              const vals = trendFor(key);
              const last = vals[vals.length - 1];
              return (
                <div key={key} className="trend-card">
                  <div className="trend-label">{label}</div>
                  <div className="trend-val" style={{ color }}>
                    {last != null ? last : '—'}
                    <span className="trend-unit">{unit}</span>
                  </div>
                  <Sparkline values={vals} color={color} width={130} height={38} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="health-empty">No test history yet.</div>
        )}
      </div>
    </div>
  );
}

// ── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ user }) {
  const [messages, setMessages] = useState([
    { id: 'init', role: 'ai', content: 'Hello! I am Nano AI, your personal health companion. How can I help you today?' },
  ]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!user?.user_id) return;
    setMessages([{ id: 'init', role: 'ai', content: 'Hello! I am Nano AI, your personal health companion. How can I help you today?' }]);
    setSeenIds(new Set());

    const poll = async () => {
      try {
        const r = await axios.get(`${API}/notifications?openid=${user.user_id}`);
        const notifications = r.data.notifications || [];
        setSeenIds(prev => {
          const next = new Set(prev);
          const unseen = notifications.filter(n => !next.has(n.id));
          if (unseen.length > 0) {
            setMessages(prev => [
              ...prev,
              ...unseen.map(n => ({ id: `n-${n.id}`, role: 'ai', content: n.content })),
            ]);
            unseen.forEach(n => next.add(n.id));
          }
          return next;
        });
      } catch { /* silent */ }
    };

    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [user?.user_id]);

  const handleSend = async () => {
    if (!input.trim() || typing) return;
    const text = input.trim();
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    setInput('');
    setTyping(true);
    try {
      await axios.post(`${API}/chat`, { openid: user.user_id, message: text });
    } catch {
      setMessages(prev => [
        ...prev,
        { id: Date.now() + 1, role: 'ai', content: 'Could not reach the server. Please try again.' },
      ]);
    } finally {
      setTyping(false);
    }
  };

  return (
    <div className="chat-tab">
      <div className="chat-container">
        {messages.map(msg => (
          <div key={msg.id} className={`message-bubble message-${msg.role}`}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ))}
        {typing && (
          <div className="message-bubble message-ai typing-indicator">
            <span /><span /><span />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder="Type a message…"
          disabled={typing}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={typing || !input.trim()}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('nano_user') || 'null'); } catch { return null; }
  });
  const [tab, setTab] = useState('chat');

  const handleLogin = u => {
    sessionStorage.setItem('nano_user', JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('nano_user');
    setUser(null);
    setTab('chat');
  };

  if (!user) {
    return (
      <div className="shell">
        <LoginScreen onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="phone-frame">
        <div className="app-header">
          <div className="header-brand">
            <img src={wavenLogo} className="header-logo" alt="Waven" />
            <span className="header-title">NANO AI</span>
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
          {tab === 'chat' ? <ChatTab user={user} /> : <HealthTab user={user} />}
        </div>

        <nav className="tab-bar">
          <button
            className={`tab-btn${tab === 'chat' ? ' active' : ''}`}
            onClick={() => setTab('chat')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>Chat</span>
          </button>
          <button
            className={`tab-btn${tab === 'health' ? ' active' : ''}`}
            onClick={() => setTab('health')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span>Health</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

export default App;
