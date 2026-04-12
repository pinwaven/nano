import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

const API_URL = '/api'; // Use Vite proxy to localhost:3000

function App() {
  const [user, setUser] = useState(null); // Currently logged in user
  const [allUsers, setAllUsers] = useState([]);
  const [messages, setMessages] = useState([
    { id: 1, role: 'ai', content: 'Hello, I am Nano AI. How can I help you today?' }
  ]);
  const [input, setInput] = useState('');
  const chatEndRef = useRef(null);

  // Fetch users for the initial selection
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await axios.get('/api/customers');
        setAllUsers(response.data.customers);
      } catch (err) {
        console.error('Failed to fetch users:', err);
      }
    };
    fetchUsers();
  }, []);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  // Notification Polling (only if user is logged in)
  useEffect(() => {
    if (!user) return;

    const poll = async () => {
      try {
        const response = await axios.get(`${API_URL}/notifications?openid=${user.wechat_openid}`);
        if (response.data.notifications?.length > 0) {
          console.log('Received new notifications:', response.data.notifications.length);
          const newMsgs = response.data.notifications.map(n => ({
            id: Date.now() + Math.random(),
            role: 'ai',
            content: n.content
          }));
          setMessages(prev => [...prev, ...newMsgs]);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [user]);

  const handleSend = async () => {
    if (!input.trim() || !user) return;

    const userMsg = { id: Date.now(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const response = await axios.post(`${API_URL}/chat`, {
        openid: user.wechat_openid,
        message: input
      });

      const aiMsg = { 
        id: Date.now() + 1, 
        role: 'ai', 
        content: response.data.reply || 'Analysis complete.' 
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        id: Date.now() + 1, 
        role: 'ai', 
        content: 'Error connecting to Nano backend.' 
      }]);
    }
  };

  // User Selection Screen
  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', backgroundColor: '#f5f5f5', height: '100%' }}>
        <h2 style={{ marginBottom: 30 }}>Select User to Login</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15, alignItems: 'center' }}>
          {allUsers.map(u => (
            <button 
              key={u.id}
              onClick={() => setUser(u)}
              style={{
                padding: '12px 24px',
                width: '200px',
                borderRadius: '8px',
                border: '1px solid #ddd',
                backgroundColor: 'white',
                fontSize: '16px',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}
            >
              {u.nickname || 'User ' + u.id}
            </button>
          ))}
          {allUsers.length === 0 && <p>No users found. Make sure backend is running.</p>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="header">
        <span style={{ fontSize: 12, position: 'absolute', left: 15, fontWeight: 'normal', color: '#888' }} onClick={() => setUser(null)}>
          &lt; Logout
        </span>
        {user.nickname}
      </div>
      <div className="chat-container">
        {messages.map(msg => (
          <div key={msg.id} className={`message-bubble message-${msg.role}`}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>
      <div className="input-area">
        <textarea 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
        />
        <div className="toolbar">
          <button className="send-btn" onClick={handleSend}>Send</button>
        </div>
      </div>
    </>
  );
}

export default App;
