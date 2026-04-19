import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import wavenLogo from '../../shared/assets/waven-logo-icon.png';

const API = '/api';

// ── i18n ──────────────────────────────────────────────────────────────────────

const T = {
  en: {
    subtitle:          'Your Precision Health Companion',
    signIn:            'Sign in to your account',
    phoneLabel:        'Phone Number',
    phonePlaceholder:  '138 0000 0000',
    continue:          'Continue',
    verifying:         'Verifying…',
    errNotFound:       'No account found with this phone number. Please contact your coach.',
    errNetwork:        'Connection failed. Please check your network and try again.',
    footerBrand:       'Harvard Innovation Labs',
    footerTag:         'Member Company',
    tabChat:           'Chat',
    tabHealth:         'Health',
    initMsg:           'Hello! I am Nano, your personal health companion. How can I help you today?',
    inputPlaceholder:  'Type a message…',
    errServer:         'Could not reach the server. Please try again.',
    profile:           'Profile',
    gender:            'Gender',
    born:              'Born',
    language:          'Language',
    coach:             'Coach',
    joined:            'Joined',
    phone:             'Phone',
    email:             'Email',
    bioAge:            'Bio Age',
    chronoAge:         'Chrono Age',
    latestBm:          'Latest Biomarkers',
    trends:            'Trends',
    noBmData:          'No biomarker data available yet.',
    noHistory:         'No test history yet.',
    tests:             n => `${n} test${n !== 1 ? 's' : ''}`,
    genderMap:         { male: 'Male', female: 'Female' },
    langMap:           { zh: 'Chinese', en: 'English' },
    // Onboarding
    obGenderPrompt:    'Before we start, I need a couple of quick details to personalize your health insights. What is your gender?',
    obGenderOnly:      'To personalize your experience, could you share your gender?',
    male:              'Male',
    female:            'Female',
    obBirthdayPrompt:  'What is your date of birth?',
    obBirthdayOnly:    'One quick thing — could you share your date of birth?',
    obBodyPrompt:      'Last step — could you share your height and weight? This helps calculate your health metrics.',
    obBodyOnly:        'One more thing — could you share your height and weight?',
    obComplete:        'Your profile is all set! How can I help you today?',
    dpYear:            'Year',
    dpMonth:           'Month',
    dpDay:             'Day',
    dpConfirm:         'Confirm',
    bsHeight:          'Height',
    bsWeight:          'Weight',
    bsConfirm:         'Confirm',
    bsCm:              'cm',
    bsKg:              'kg',
    bmLabels: {
      hsCRP:     'hsCRP',
      GDF15:     'GDF-15',
      IL6:       'IL-6',
      GA:        'Glycated Albumin',
      CystatinC: 'Cystatin C',
      CD38:      'CD38',
    },
  },
  zh: {
    subtitle:          '您的精准健康伴侣',
    signIn:            '登录您的账户',
    phoneLabel:        '手机号码',
    phonePlaceholder:  '138 0000 0000',
    continue:          '继续',
    verifying:         '验证中…',
    errNotFound:       '未找到该手机号对应的账户，请联系您的 Coach。',
    errNetwork:        '连接失败，请检查网络后重试。',
    footerBrand:       '哈佛大学创新实验室',
    footerTag:         '成员企业',
    tabChat:           '对话',
    tabHealth:         '健康',
    initMsg:           '您好！我是 Nano，您的个人健康伴侣。今天有什么可以帮您的？',
    inputPlaceholder:  '输入消息…',
    errServer:         '无法连接服务器，请重试。',
    profile:           '个人信息',
    gender:            '性别',
    born:              '出生日期',
    language:          '语言',
    coach:             'Coach',
    joined:            '注册时间',
    phone:             '手机',
    email:             '邮箱',
    bioAge:            '生物年龄',
    chronoAge:         '实际年龄',
    latestBm:          '最新生物标志物',
    trends:            '趋势',
    noBmData:          '暂无生物标志物数据。',
    noHistory:         '暂无检测记录。',
    tests:             n => `${n} 次检测`,
    genderMap:         { male: '男', female: '女' },
    langMap:           { zh: '中文', en: 'English' },
    // Onboarding
    obGenderPrompt:    '开始之前，需要了解一些基本信息来个性化您的健康洞察。请问您的性别是？',
    obGenderOnly:      '为了个性化您的体验，请问您的性别是？',
    male:              '男',
    female:            '女',
    obBirthdayPrompt:  '请问您的出生日期是？',
    obBirthdayOnly:    '还有一件事——请告诉我您的出生日期？',
    obBodyPrompt:      '最后一步——请告诉我您的身高和体重，帮助计算您的健康指标。',
    obBodyOnly:        '还有一件事——请告诉我您的身高和体重？',
    obComplete:        '您的个人信息已完善！今天有什么可以帮您的？',
    dpYear:            '年',
    dpMonth:           '月',
    dpDay:             '日',
    dpConfirm:         '确认',
    bsHeight:          '身高',
    bsWeight:          '体重',
    bsConfirm:         '确认',
    bsCm:              'cm',
    bsKg:              'kg',
    bmLabels: {
      hsCRP:     'hsCRP',
      GDF15:     'GDF-15',
      IL6:       'IL-6',
      GA:        '糖化白蛋白',
      CystatinC: '胱抑素 C',
      CD38:      'CD38',
    },
  },
};

const LangContext = createContext({ lang: 'zh', t: T.zh });
const useLang = () => useContext(LangContext);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BM_META = [
  { key: 'hsCRP',     unit: 'mg/L',      color: '#ef4444' },
  { key: 'GDF15',     unit: 'pg/mL',     color: '#f97316' },
  { key: 'IL6',       unit: 'pg/mL',     color: '#a855f7' },
  { key: 'GA',        unit: '%',         color: '#6375EC' },
  { key: 'CystatinC', unit: 'mg/L',      color: '#0ea5e9' },
  { key: 'CD38',      unit: 'xBaseline', color: '#10b981' },
];

function chronoAge(birthDate) {
  if (!birthDate) return null;
  return Math.floor((Date.now() - new Date(birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

function fmtDate(d, lang) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function bioAgeColor(bio, chrono) {
  if (!bio || !chrono) return 'var(--text)';
  const diff = Number(bio) - Number(chrono);
  if (diff > 2) return '#ef4444';
  if (diff < -2) return '#10b981';
  return '#f59e0b';
}

function parseDate(str) {
  // Accept YYYY-MM-DD or common variants
  const cleaned = str.trim().replace(/\//g, '-').replace(/\./g, '-');
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
  if (isNaN(date.getTime())) return null;
  if (date > new Date()) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
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

// ── Lang toggle ───────────────────────────────────────────────────────────────

function LangToggle({ lang, onChange }) {
  return (
    <button className="lang-toggle" onClick={() => onChange(lang === 'zh' ? 'en' : 'zh')}>
      <span className={lang === 'zh' ? 'lang-active' : ''}>中</span>
      <span className="lang-sep">/</span>
      <span className={lang === 'en' ? 'lang-active' : ''}>EN</span>
    </button>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin, lang, onLangChange }) {
  const { t } = useLang();
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
        setError(t.errNotFound);
      }
    } catch {
      setError(t.errNetwork);
    } finally {
      setLoading(false);
    }
  };

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
        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={!phone.trim() || loading}
        >
          {loading && <span className="login-btn-spinner" />}
          {loading ? t.verifying : t.continue}
        </button>
      </div>
      <div className="login-footer">
        <span>{t.footerBrand}</span>
        <span className="login-footer-dot">·</span>
        <span>{t.footerTag}</span>
      </div>
    </div>
  );
}

// ── Health Tab ────────────────────────────────────────────────────────────────

function HealthTab({ user }) {
  const { t, lang } = useLang();
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
      <div className="health-hero">
        <div className="health-hero-bg" />
        <div className="health-avatar">{(user.nickname || 'U')[0].toUpperCase()}</div>
        <div className="health-name">{user.nickname || 'User'}</div>
        {user.bio_age && (
          <div className="health-bio-row">
            <div className="health-bio-chip">
              <span className="health-bio-num" style={{ color: bioAgeColor(user.bio_age, age) }}>
                {Number(user.bio_age).toFixed(1)}
              </span>
              <span className="health-bio-unit">{t.bioAge}</span>
            </div>
            {age && (
              <div className="health-bio-chip health-bio-chip--dim">
                <span className="health-bio-num" style={{ color: 'var(--text-sub)' }}>{age}</span>
                <span className="health-bio-unit">{t.chronoAge}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="health-section">
        <div className="health-section-title">{t.profile}</div>
        <div className="health-info-grid">
          {[
            [t.gender,   t.genderMap[user.gender] || user.gender],
            [t.born,     fmtDate(user.birth_date, lang)],
            [t.language, t.langMap[user.language] || user.language],
            [t.coach,    user.coach_name],
            [t.joined,   fmtDate(user.created_at, lang)],
            [t.phone,    user.phone],
            [t.email,    user.email],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <span className="health-info-key">{k}</span>
              <span className="health-info-val">{v || '—'}</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="health-section">
        <div className="health-section-title">{t.latestBm}</div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : latestBm ? (
          <div className="bm-list">
            {BM_META.map(({ key, unit, color }) => (
              <div key={key} className="bm-row">
                <span className="bm-dot" style={{ background: color }} />
                <span className="bm-label">{t.bmLabels[key]}</span>
                <span className="bm-val" style={{ color }}>{latestBm[key] ?? '—'}</span>
                <span className="bm-unit">{unit}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="health-empty">{t.noBmData}</div>
        )}
      </div>

      <div className="health-section">
        <div className="health-section-title">
          {t.trends}
          {records.length > 0 && (
            <span className="health-section-badge">{t.tests(records.length)}</span>
          )}
        </div>
        {loading ? (
          <div className="health-loading"><span /><span /><span /></div>
        ) : records.length > 0 ? (
          <div className="trend-grid">
            {BM_META.map(({ key, unit, color }) => {
              const vals = trendFor(key);
              const last = vals[vals.length - 1];
              return (
                <div key={key} className="trend-card">
                  <div className="trend-label">{t.bmLabels[key]}</div>
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
          <div className="health-empty">{t.noHistory}</div>
        )}
      </div>
    </div>
  );
}

// ── Date Picker Widget ────────────────────────────────────────────────────────

function DatePickerWidget({ onConfirm, disabled }) {
  const { t, lang } = useLang();
  const currentYear = new Date().getFullYear();
  const [year,  setYear]  = useState('');
  const [month, setMonth] = useState('');
  const [day,   setDay]   = useState('');

  const years  = Array.from({ length: currentYear - 1919 }, (_, i) => currentYear - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const daysInMonth = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Reset day if it exceeds the new month's length
  useEffect(() => {
    if (day && Number(day) > daysInMonth) setDay('');
  }, [year, month]);

  const monthLabel = (m) =>
    new Date(2000, m - 1, 1).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' });

  const isComplete = year && month && day;

  const handleConfirm = () => {
    if (!isComplete || disabled) return;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onConfirm(dateStr);
  };

  return (
    <div className="date-picker">
      <div className="date-picker-selects">
        <select
          className="date-picker-select"
          value={year}
          onChange={e => { setYear(e.target.value); setDay(''); }}
          disabled={disabled}
        >
          <option value="">{t.dpYear}</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select
          className="date-picker-select"
          value={month}
          onChange={e => { setMonth(e.target.value); setDay(''); }}
          disabled={disabled}
        >
          <option value="">{t.dpMonth}</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select
          className="date-picker-select"
          value={day}
          onChange={e => setDay(e.target.value)}
          disabled={disabled || !year || !month}
        >
          <option value="">{t.dpDay}</option>
          {days.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <button
        className="date-picker-confirm"
        onClick={handleConfirm}
        disabled={!isComplete || disabled}
      >
        {t.dpConfirm}
      </button>
    </div>
  );
}

// ── Body Slider Widget ────────────────────────────────────────────────────────

function BodySliderWidget({ onConfirm, disabled }) {
  const { t } = useLang();
  const [height, setHeight] = useState(165);
  const [weight, setWeight] = useState(65);

  const handleConfirm = () => {
    if (disabled) return;
    onConfirm({ height, weight });
  };

  return (
    <div className="body-slider">
      <div className="body-slider-row">
        <div className="body-slider-label">
          <span>{t.bsHeight}</span>
          <span className="body-slider-val">{height} <span className="body-slider-unit">{t.bsCm}</span></span>
        </div>
        <input
          type="range"
          className="body-slider-input"
          min={100} max={220} step={1}
          value={height}
          style={{ '--pct': `${((height - 100) / 120) * 100}%` }}
          onChange={e => setHeight(Number(e.target.value))}
          disabled={disabled}
        />
      </div>
      <div className="body-slider-row">
        <div className="body-slider-label">
          <span>{t.bsWeight}</span>
          <span className="body-slider-val">{weight} <span className="body-slider-unit">{t.bsKg}</span></span>
        </div>
        <input
          type="range"
          className="body-slider-input"
          min={30} max={150} step={0.5}
          value={weight}
          style={{ '--pct': `${((weight - 30) / 120) * 100}%` }}
          onChange={e => setWeight(Number(e.target.value))}
          disabled={disabled}
        />
      </div>
      <button
        className="date-picker-confirm"
        onClick={handleConfirm}
        disabled={disabled}
      >
        {t.bsConfirm}
      </button>
    </div>
  );
}

// ── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ user, onUserUpdate }) {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  // 'gender' | 'birthday' | 'done' | null (null = not yet determined)
  const [obStep, setObStep] = useState(null);
  const chatEndRef = useRef(null);

  const addMsg = (role, content) =>
    setMessages(prev => [...prev, { id: `${role}-${Date.now()}`, role, content }]);

  // Save user fields to API, preserving all existing values
  const saveUser = async (updates) => {
    await axios.put(`${API}/users/${user.user_id}`, {
      nickname:   user.nickname,
      phone:      user.phone,
      email:      user.email,
      gender:     user.gender,
      birth_date: user.birth_date,
      language:   user.language,
      coach_id:   user.coach_id,
      ...updates,
    });
  };

  // Initialise chat + determine onboarding step when user changes
  useEffect(() => {
    if (!user?.user_id) return;

    const msgs = [{ id: 'init', role: 'ai', content: t.initMsg }];

    const init = async () => {
      if (!user.gender) {
        msgs.push({ id: 'ob-gender', role: 'ai', content: t.obGenderPrompt });
        setObStep('gender');
        setMessages(msgs);
        return;
      }
      if (!user.birth_date) {
        msgs.push({ id: 'ob-bday', role: 'ai', content: t.obBirthdayOnly });
        setObStep('birthday');
        setMessages(msgs);
        return;
      }
      try {
        const r = await axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`);
        const records = r.data.records || [];
        const hasBody = records.some(rec => rec.test_type === 'body_composition' && rec.data?.actual?.weight);
        if (!hasBody) {
          msgs.push({ id: 'ob-body', role: 'ai', content: t.obBodyOnly });
          setObStep('body');
          setMessages(msgs);
          return;
        }
      } catch { /* skip body check on error */ }
      setObStep('done');
      setMessages(msgs);
    };

    setSeenIds(new Set());
    setInput('');
    init();
  }, [user?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Notification polling (only in normal chat mode)
  useEffect(() => {
    if (!user?.user_id || obStep !== 'done') return;
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
  }, [user?.user_id, obStep]);

  // ── Onboarding handlers ──

  const checkBodyStep = async () => {
    try {
      const r = await axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`);
      const records = r.data.records || [];
      const hasBody = records.some(rec => rec.test_type === 'body_composition' && rec.data?.actual?.weight);
      if (!hasBody) {
        addMsg('ai', t.obBodyPrompt);
        setObStep('body');
        return;
      }
    } catch { /* fall through */ }
    addMsg('ai', t.obComplete);
    setObStep('done');
  };

  const handleSelectGender = async (value) => {
    addMsg('user', t[value]);
    setTyping(true);
    try {
      await saveUser({ gender: value });
      onUserUpdate({ gender: value });
      if (!user.birth_date) {
        addMsg('ai', t.obBirthdayPrompt);
        setObStep('birthday');
      } else {
        await checkBodyStep();
      }
    } catch {
      addMsg('ai', t.errServer);
    } finally {
      setTyping(false);
    }
  };

  const handleSubmitBirthday = async (dateStr) => {
    addMsg('user', dateStr);
    setTyping(true);
    try {
      await saveUser({ birth_date: dateStr });
      onUserUpdate({ birth_date: dateStr });
      await checkBodyStep();
    } catch {
      addMsg('ai', t.errServer);
    } finally {
      setTyping(false);
    }
  };

  const handleSubmitBody = async ({ height, weight }) => {
    addMsg('user', `${t.bsHeight}: ${height}${t.bsCm}  ${t.bsWeight}: ${weight}${t.bsKg}`);
    setTyping(true);
    try {
      await axios.post(`${API}/chat`, {
        openid: user.user_id,
        test_type: 'body_composition',
        test_data: { height, weight },
        tested_at: new Date().toISOString(),
      });
      addMsg('ai', t.obComplete);
      setObStep('done');
    } catch {
      addMsg('ai', t.errServer);
    } finally {
      setTyping(false);
    }
  };

  // ── Normal chat handler ──

  const handleSend = async () => {
    if (!input.trim() || typing || obStep !== 'done') return;
    const text = input.trim();
    addMsg('user', text);
    setInput('');
    setTyping(true);
    try {
      await axios.post(`${API}/chat`, { openid: user.user_id, message: text });
    } catch {
      addMsg('ai', t.errServer);
    } finally {
      setTyping(false);
    }
  };

  const inputDisabled = typing || obStep !== 'done';

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

      {/* Gender quick-reply chips */}
      {obStep === 'gender' && !typing && (
        <div className="quick-replies">
          <button className="quick-reply-btn" onClick={() => handleSelectGender('male')}>
            {t.male}
          </button>
          <button className="quick-reply-btn" onClick={() => handleSelectGender('female')}>
            {t.female}
          </button>
        </div>
      )}

      {/* Birthday date picker */}
      {obStep === 'birthday' && (
        <DatePickerWidget onConfirm={handleSubmitBirthday} disabled={typing} />
      )}

      {/* Body composition sliders */}
      {obStep === 'body' && (
        <BodySliderWidget onConfirm={handleSubmitBody} disabled={typing} />
      )}

      {/* Normal chat input — hidden during onboarding */}
      {obStep === 'done' && (
        <div className="input-area">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={t.inputPlaceholder}
            disabled={inputDisabled}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={inputDisabled || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('nano_user') || 'null'); } catch { return null; }
  });
  const [tab, setTab] = useState('chat');
  const [lang, setLang] = useState(() => user?.language || 'zh');

  const t = T[lang] || T.zh;

  const handleLogin = u => {
    sessionStorage.setItem('nano_user', JSON.stringify(u));
    setUser(u);
    setLang(u.language === 'en' ? 'en' : 'zh');
  };

  const handleUserUpdate = updates => {
    setUser(prev => {
      const next = { ...prev, ...updates };
      sessionStorage.setItem('nano_user', JSON.stringify(next));
      return next;
    });
  };

  const handleLogout = () => {
    sessionStorage.removeItem('nano_user');
    setUser(null);
    setTab('chat');
    setLang('zh');
  };

  if (!user) {
    return (
      <LangContext.Provider value={{ lang, t }}>
        <div className="shell">
          <LoginScreen onLogin={handleLogin} lang={lang} onLangChange={setLang} />
        </div>
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={{ lang, t }}>
      <div className="shell">
        <div className="phone-frame">
          <div className="app-header">
            <div className="header-brand">
              <img src={wavenLogo} className="header-logo" alt="Waven" />
              <span className="header-title">NANO</span>
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
            {tab === 'chat'
              ? <ChatTab user={user} onUserUpdate={handleUserUpdate} />
              : <HealthTab user={user} />
            }
          </div>

          <nav className="tab-bar">
            <button
              className={`tab-btn${tab === 'chat' ? ' active' : ''}`}
              onClick={() => setTab('chat')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>{t.tabChat}</span>
            </button>
            <button
              className={`tab-btn${tab === 'health' ? ' active' : ''}`}
              onClick={() => setTab('health')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              <span>{t.tabHealth}</span>
            </button>
          </nav>
        </div>
      </div>
    </LangContext.Provider>
  );
}

export default App;
