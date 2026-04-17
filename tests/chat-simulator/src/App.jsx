import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import wavenLogo from '../../../src/web/shared/assets/waven-logo-icon.png';

const API_URL = '/api';

function mockWechatOpenid() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'wx_sim_';
  for (let i = 0; i < 20; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function App() {
  const [users, setUsers] = useState([]);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([
    { id: 1, role: 'ai', content: 'Hello, I am Nano AI. How can I help you today?' }
  ]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const chatEndRef = useRef(null);
  const newNameRef = useRef(null);

  const fetchUsers = () =>
    axios.get('/api/users')
      .then(r => {
        const list = r.data.users || [];
        setUsers(list);
        return list;
      })
      .catch(() => []);

  useEffect(() => {
    fetchUsers().then(list => { if (list.length > 0) setUser(list[0]); });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!user) return;

    setMessages([{ id: 1, role: 'ai', content: 'Hello, I am Nano AI. How can I help you today?' }]);
    setSeenIds(new Set());

    const poll = async () => {
      try {
        const r = await axios.get(`${API_URL}/notifications?openid=${user.user_id}`);
        const notifications = r.data.notifications || [];

        setSeenIds(prev => {
          const next = new Set(prev);
          const unseen = notifications.filter(n => !next.has(n.id));
          if (unseen.length > 0) {
            setMessages(prevMsgs => [
              ...prevMsgs,
              ...unseen.map(n => ({ id: `n-${n.id}`, role: 'ai', content: n.content }))
            ]);
            unseen.forEach(n => next.add(n.id));
          }
          return next;
        });
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (showNewUser) {
      setNewName('');
      setTimeout(() => newNameRef.current?.focus(), 50);
    }
  }, [showNewUser]);

  const handleSend = async () => {
    if (!input.trim() || !user || typing) return;
    const text = input.trim();
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    setInput('');
    setTyping(true);
    try {
      await axios.post(`${API_URL}/chat`, { openid: user.user_id, message: text });
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), role: 'ai', content: 'Could not reach the backend. Is it running?' }]);
    } finally {
      setTyping(false);
    }
  };

  const handleCreateUser = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const openid = mockWechatOpenid();
      await axios.post(`${API_URL}/chat`, { openid, nickname: name });
      const list = await fetchUsers();
      const created = list.find(u => u.user_id === openid) || list[list.length - 1];
      if (created) setUser(created);
      setShowNewUser(false);
    } catch {
      // silently ignore
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <div className="chat-header">
        <div className="header-brand">
          <img src={wavenLogo} alt="Waven" className="header-logo" />
          <span className="header-title">NANO AI</span>
        </div>
        <div className="user-selector">
          {users.length > 0 ? (
            <select
              className="user-select"
              value={user?.user_id || ''}
              onChange={e => setUser(users.find(u => u.user_id === e.target.value))}
            >
              {users.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.nickname || 'User ' + u.user_id}
                </option>
              ))}
            </select>
          ) : (
            <span className="no-users">No users — start backend first</span>
          )}
          <button
            className={`refresh-btn${refreshing ? ' spinning' : ''}`}
            onClick={async () => { setRefreshing(true); await fetchUsers(); setRefreshing(false); }}
            title="Refresh users"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 3.54 1.29L13.5 5.5"/>
              <path d="M13.5 2v3.5H10"/>
            </svg>
          </button>
          <button className="new-user-btn" onClick={() => setShowNewUser(true)}>+ New User</button>
        </div>
      </div>

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
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder={user ? 'Type a message...' : 'Select a patient above to begin'}
          disabled={typing || !user}
        />
        <div className="toolbar">
          <button className="send-btn" onClick={handleSend} disabled={typing || !input.trim() || !user}>
            Send
          </button>
        </div>
      </div>

      {showNewUser && (
        <div className="modal-overlay" onClick={() => setShowNewUser(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">New WeChat User</div>
            <div className="modal-field">
              <label className="modal-label">Nickname</label>
              <input
                ref={newNameRef}
                className="modal-input"
                type="text"
                placeholder="e.g. Zhang Wei"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateUser(); if (e.key === 'Escape') setShowNewUser(false); }}
              />
            </div>
            <div className="modal-hint">A mock WeChat openid will be generated automatically.</div>
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setShowNewUser(false)}>Cancel</button>
              <button className="modal-btn-create" onClick={handleCreateUser} disabled={!newName.trim() || creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
