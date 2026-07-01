import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';
import { NameInputWidget, DatePickerWidget, BodySliderWidget } from '../components/Widgets.jsx';

const API = '/api';

export default function ChatTab({ user, onUserUpdate }) {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [obStep, setObStep] = useState(null);
  const chatEndRef = useRef(null);

  const addMsg = (role, content) =>
    setMessages(prev => [...prev, { id: `${role}-${Date.now()}-${Math.random()}`, role, content }]);

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
          setMessages(history.map((m, i) => ({ id: `h-${i}`, role: m.role === 'assistant' ? 'ai' : m.role, content: m.content })));
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
        setMessages(history.map((m, i) => ({ id: `h-${i}`, role: m.role === 'assistant' ? 'ai' : m.role, content: m.content })));
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
