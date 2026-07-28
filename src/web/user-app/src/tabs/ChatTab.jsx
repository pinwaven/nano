import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';
import { NameInputWidget, DatePickerWidget, BodySliderWidget } from '../components/Widgets.jsx';
import ChatToolbox from '../components/ChatToolbox.jsx';
import ActionChip from '../components/ActionChip.jsx';

const API = '/api';

export default function ChatTab({ user, onUserUpdate, onNavigateTab }) {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [obStep, setObStep] = useState(null);
  const chatEndRef = useRef(null);
  const lastMsgIdRef = useRef(null);
  const pendingHealthReportRef = useRef(null);

  const addMsg = (role, content, persist = false, extra = {}) => {
    const msg = { id: `${role}-${Date.now()}-${Math.random()}`, role, content, ...extra };
    setMessages(prev => [...prev, msg]);
    if (persist && user?.user_id) {
      axios.post(`${API}/chat-messages`, { openid: user.user_id, role, content }).catch(() => {});
    }
    return msg.id;
  };

  const addActionMsg = (action, label, persist = false) => {
    setMessages(prev => [...prev, { id: `action-${action}-${Date.now()}`, role: 'action', action, label }]);
    if (persist && user?.user_id) {
      axios.post(`${API}/chat-messages`, { openid: user.user_id, role: 'action', content: JSON.stringify({ action, label }) }).catch(() => {});
    }
  };

  const addImageMsg = (imageUrl) => {
    const id = `user-${Date.now()}`;
    setMessages(prev => [...prev, { id, role: 'user', content: '', imageUrl }]);
    return id;
  };

  const updateImageMsg = (id, imageUrl) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, imageUrl } : m));
  };

  const removeHrActions = () => {
    setMessages(prev => prev.filter(m => !(m.role === 'action' && typeof m.action === 'string' && m.action.indexOf('hr_') === 0)));
  };

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

  const mapHistoryRow = (m, i) => {
    const role = m.role === 'assistant' ? 'ai' : m.role;
    if (role === 'action') {
      try {
        const parsed = JSON.parse(m.content);
        return { id: `h-${i}`, role: 'action', action: parsed.action, label: parsed.label };
      } catch { return null; }
    }
    return { id: `h-${i}`, role, content: m.content, imageUrl: m.image_url || null };
  };

  useEffect(() => {
    if (!user?.user_id) return;
    const msgs = [{ id: 'init', role: 'ai', content: t.initMsg }];

    const init = async () => {
      if (!user.nickname) {
        msgs.push({ id: 'ob-name', role: 'ai', content: t.obNamePrompt });
        setObStep('name');
        setMessages(msgs);
        return;
      }
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
      } catch { /* skip */ }
      setObStep('done');
      await loadHistory();
    };

    const loadHistory = async () => {
      try {
        const r = await axios.get(`${API}/chat-history?openid=${encodeURIComponent(user.user_id)}`);
        const history = r.data.messages || [];
        if (history.length > 0) {
          const mapped = history.map(mapHistoryRow).filter(Boolean);
          setMessages(mapped);
          const ids = history.map(m => m.id).filter(id => typeof id === 'number');
          if (ids.length > 0) lastMsgIdRef.current = Math.max(...ids);
        } else {
          setMessages(msgs);
        }
      } catch {
        setMessages(msgs);
      }
    };

    setSeenIds(new Set());
    setInput('');
    init();
  }, [user?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

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
      if (lastMsgIdRef.current !== null) {
        try {
          const r = await axios.get(`${API}/chat-history?openid=${encodeURIComponent(user.user_id)}&since_id=${lastMsgIdRef.current}`);
          const newCoach = r.data.messages || [];
          if (newCoach.length > 0) {
            setMessages(prev => [
              ...prev,
              ...newCoach.map(m => ({ id: `c-${m.id}`, role: 'coach', content: (m.content || '').replace(/\n+/g, ' '), imageUrl: null })),
            ]);
            lastMsgIdRef.current = Math.max(...newCoach.map(m => m.id));
          }
        } catch { /* silent */ }
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [user?.user_id, obStep]);

  const checkBodyStep = async () => {
    try {
      const r = await axios.get(`${API}/biomarkers?openid=${encodeURIComponent(user.user_id)}`);
      const records = r.data.records || [];
      const hasBody = records.some(rec => rec.test_type === 'body_composition' && rec.data?.actual?.weight);
      if (!hasBody) { addMsg('ai', t.obBodyPrompt); setObStep('body'); return; }
    } catch { /* fall through */ }
    addMsg('ai', t.obComplete);
    setObStep('done');
    try {
      const r = await axios.get(`${API}/chat-history?openid=${encodeURIComponent(user.user_id)}`);
      const history = r.data.messages || [];
      if (history.length > 0) {
        setMessages(history.map(mapHistoryRow).filter(Boolean));
        const ids = history.map(m => m.id).filter(id => typeof id === 'number');
        if (ids.length > 0) lastMsgIdRef.current = Math.max(...ids);
      }
    } catch { /* keep current */ }
  };

  const handleSubmitName = async (name) => {
    addMsg('user', name);
    setTyping(true);
    try {
      await saveUser({ nickname: name });
      onUserUpdate({ nickname: name });
      if (!user.gender) { addMsg('ai', t.obGenderOnly); setObStep('gender'); }
      else if (!user.birth_date) { addMsg('ai', t.obBirthdayOnly); setObStep('birthday'); }
      else await checkBodyStep();
    } catch { addMsg('ai', t.errServer); }
    finally { setTyping(false); }
  };

  const handleSelectGender = async (value) => {
    addMsg('user', t[value]);
    setTyping(true);
    try {
      await saveUser({ gender: value });
      onUserUpdate({ gender: value });
      if (!user.birth_date) { addMsg('ai', t.obBirthdayPrompt); setObStep('birthday'); }
      else await checkBodyStep();
    } catch { addMsg('ai', t.errServer); }
    finally { setTyping(false); }
  };

  const handleSubmitBirthday = async (dateStr) => {
    addMsg('user', dateStr);
    setTyping(true);
    try {
      await saveUser({ birth_date: dateStr });
      onUserUpdate({ birth_date: dateStr });
      await checkBodyStep();
    } catch { addMsg('ai', t.errServer); }
    finally { setTyping(false); }
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
    } catch { addMsg('ai', t.errServer); }
    finally { setTyping(false); }
  };

  const handleSend = async () => {
    if (!input.trim() || typing || obStep !== 'done') return;
    const text = input.trim();
    addMsg('user', text);
    setInput('');
    setTyping(true);
    try {
      await axios.post(`${API}/chat`, { openid: user.user_id, message: text });
    } catch { addMsg('ai', t.errServer); }
    finally { setTyping(false); }
  };

  // ── Toolbox tools ────────────────────────────────────────────────────────

  const runFormulaDots = async () => {
    addMsg('user', t.toolFormulaDotMsg, true);
    addMsg('ai', t.formulaGenerating, true);
    setTyping(true);
    try {
      await axios.post(`${API}/formula-dots`, { openid: user.user_id });
      addMsg('ai', t.formulaComplete, true);
      addActionMsg('view_dots', t.formulaViewDots, true);
    } catch { addMsg('ai', t.formulaError); }
    finally { setTyping(false); }
  };

  const runHealthAdvice = async () => {
    addMsg('user', t.toolHealthAdviceMsg);
    setTyping(true);
    try {
      const r = await axios.post(`${API}/health-advice`, { openid: user.user_id });
      const reply = r.data?.message;
      if (!reply) throw new Error('empty response');
      addMsg('ai', reply, true);
    } catch { addMsg('ai', t.healthAdviceError); }
    finally { setTyping(false); }
  };

  const runUploadImage = async (file) => {
    const filename = `img_${Date.now()}.jpg`;
    addMsg('ai', t.imageUploading);
    setTyping(true);
    const localUrl = URL.createObjectURL(file);
    const msgId = addImageMsg(localUrl);
    try {
      const presignRes = await axios.get(`${API}/oss/presign?type=image&filename=${encodeURIComponent(filename)}&category=user-images`);
      const { put_url, get_url, key } = presignRes.data || {};
      if (!put_url) throw new Error('presign failed');
      await axios.put(put_url, file, { headers: { 'Content-Type': 'application/octet-stream' } });
      updateImageMsg(msgId, get_url);
      addMsg('ai', t.imageAnalyzing);
      const r = await axios.post(`${API}/analyze-image`, { openid: user.user_id, oss_key: key, filename, get_url });
      const reply = r.data?.message;
      if (!reply) throw new Error('empty response');
      addMsg('ai', reply, true);
      if (r.data?.pending_health_report) startHealthReportConsent(r.data.payload);
    } catch {
      updateImageMsg(msgId, null);
      addMsg('ai', t.imageError);
    } finally {
      setTyping(false);
    }
  };

  // ── Action chip handling ────────────────────────────────────────────────

  const startHealthReportConsent = (payload) => {
    if (!payload) return;
    pendingHealthReportRef.current = payload;
    addMsg('ai', t.hrAskOwn);
    addActionMsg('hr_own_yes', t.hrYes);
    addActionMsg('hr_own_no', t.hrNo);
  };

  const saveHealthReport = async () => {
    const payload = pendingHealthReportRef.current;
    if (!payload) return;
    pendingHealthReportRef.current = null;
    setTyping(true);
    try {
      const r = await axios.post(`${API}/health-reports`, {
        openid: user.user_id,
        oss_key: payload.oss_key,
        get_url: payload.get_url,
        report_date: payload.report_date,
        institution: payload.institution,
        report_type: payload.report_type,
        observations: payload.observations || [],
        compute_bioage: true,
      });
      if (r.data?.success) {
        let msg = t.hrSaved;
        if (r.data.bioage_updated) msg += ' ' + t.hrSavedBioage;
        addMsg('ai', msg);
      }
    } catch { /* silent */ }
    finally { setTyping(false); }
  };

  const handleMsgAction = (action) => {
    if (action === 'view_dots') {
      onNavigateTab && onNavigateTab('plans');
    } else if (action === 'hr_own_yes') {
      removeHrActions();
      addMsg('ai', t.hrAskSave);
      addActionMsg('hr_save_yes', t.hrSave);
      addActionMsg('hr_save_no', t.hrLater);
    } else if (action === 'hr_own_no') {
      removeHrActions();
      pendingHealthReportRef.current = null;
      addMsg('ai', t.hrNotOwn);
    } else if (action === 'hr_save_yes') {
      removeHrActions();
      saveHealthReport();
    } else if (action === 'hr_save_no') {
      removeHrActions();
      pendingHealthReportRef.current = null;
      addMsg('ai', t.hrNotSaved);
    }
  };

  const inputDisabled = typing || obStep !== 'done';

  return (
    <div className="chat-tab">
      <div className="chat-container">
        {messages.map(msg => {
          if (msg.role === 'action') {
            return <ActionChip key={msg.id} action={msg.action} label={msg.label} onAction={handleMsgAction} />;
          }
          return (
            <div key={msg.id} className={`message-bubble message-${msg.role}`}>
              {msg.imageUrl && <img src={msg.imageUrl} className="message-image" alt="" />}
              {msg.content && <ReactMarkdown>{msg.content}</ReactMarkdown>}
            </div>
          );
        })}
        {typing && (
          <div className="message-bubble message-ai typing-indicator">
            <span /><span /><span />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {obStep === 'name' && <NameInputWidget onConfirm={handleSubmitName} disabled={typing} />}
      {obStep === 'gender' && !typing && (
        <div className="quick-replies">
          <button className="quick-reply-btn" onClick={() => handleSelectGender('male')}>{t.male}</button>
          <button className="quick-reply-btn" onClick={() => handleSelectGender('female')}>{t.female}</button>
        </div>
      )}
      {obStep === 'birthday' && <DatePickerWidget onConfirm={handleSubmitBirthday} disabled={typing} />}
      {obStep === 'body' && <BodySliderWidget onConfirm={handleSubmitBody} disabled={typing} />}
      {obStep === 'done' && (
        <div className="input-area">
          <ChatToolbox
            onFormulaDots={runFormulaDots}
            onHealthAdvice={runHealthAdvice}
            onUploadImage={runUploadImage}
            disabled={inputDisabled}
          />
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={t.inputPlaceholder}
            disabled={inputDisabled}
            rows={1}
          />
          <button className="send-btn" onClick={handleSend} disabled={inputDisabled || !input.trim()} aria-label="Send">
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
