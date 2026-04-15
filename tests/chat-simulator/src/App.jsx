import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

const API_URL = '/api';

function App() {
  const [user, setUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [messages, setMessages] = useState([
    { id: 1, role: 'ai', content: 'Hello, I am Nano AI. How can I help you today?' }
  ]);
  const [seenIds, setSeenIds] = useState(new Set());
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    axios.get('/api/users')
      .then(r => setAllUsers(r.data.users))
      .catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!user) {
      setMessages([{ id: 1, role: 'ai', content: 'Hello, I am Nano AI. How can I help you today?' }]);
      setSeenIds(new Set());
      return;
    }

    const poll = async () => {
      try {
        const r = await axios.get(`${API_URL}/notifications?openid=${user.external_id}`);
        const notifications = r.data.notifications || [];
        
        setSeenIds(prev => {
          const next = new Set(prev);
          const newNotifications = notifications.filter(n => !next.has(n.id));
          
          if (newNotifications.length > 0) {
            const newMsgs = newNotifications.map(n => ({
              id: `notification-${n.id}`,
              role: 'ai',
              content: n.content
            }));
            setMessages(prevMsgs => [...prevMsgs, ...newMsgs]);
            newNotifications.forEach(n => next.add(n.id));
          }
          return next;
        });
      } catch {}
    };

    poll(); // Initial poll
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [user]);

  const handleSend = async () => {
    if (!input.trim() || !user || typing) return;
    const text = input.trim();
    setMessages(prev => [...prev, { id: Date.now(), role: 'user', content: text }]);
    setInput('');
    setTyping(true);
    try {
      await axios.post(`${API_URL}/chat`, { openid: user.external_id, message: text });
      // Removed: setMessages(prev => [...prev, { id: Date.now(), role: 'ai', content: r.data.reply || 'Analysis complete.' }]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), role: 'ai', content: 'Could not reach the backend. Is it running?' }]);
    } finally {
      // Keep typing indicator until polling picks up the message if you want, 
      // but for simplicity we'll just stop it here.
      setTyping(false);
    }
  };

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-logo">Nano AI</div>
        <div className="login-subtitle">Select a user to continue</div>
        <div className="login-list">
          {allUsers.map(u => (
            <button key={u.user_id} className="login-btn" onClick={() => setUser(u)}>
              <span className="login-avatar">{(u.nickname || 'U')[0].toUpperCase()}</span>
              {u.nickname || 'User ' + u.user_id}
            </button>
          ))}
          {allUsers.length === 0 && (
            <p className="login-empty">No users found — make sure the backend is running.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="header">
        <span className="header-spacer" />
        <span className="header-title">{user.nickname || 'Chat'}</span>
        <button className="back-btn" onClick={() => setUser(null)}>&#8250;</button>
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
          placeholder="Type a message..."
          disabled={typing}
        />
        <div className="toolbar">
          <button className="send-btn" onClick={handleSend} disabled={typing || !input.trim()}>Send</button>
        </div>
      </div>
    </>
  );
}

export default App;
