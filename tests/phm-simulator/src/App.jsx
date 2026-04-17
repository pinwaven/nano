import React, { useState, useEffect } from 'react';
import axios from 'axios';
import wavenLogo from '../../../src/web/shared/assets/waven-logo-icon.png';

const translations = {
  en: {
    title: 'PHM',
    metrics: 'Latest Metrics',
    bioAge: 'Biological Age',
    chronoAge: 'Chronological Age',
    biomarkers: 'Biomarker Detail',
    plan: 'Nutrition Plan (7-Day)',
    noData: 'No test data yet.',
    advice: 'PHM Advice',
    placeholder: 'Type your advice for the patient here...',
    send: 'Send Instruction',
    langToggle: '中文'
  },
  zh: {
    title: 'PHM',
    metrics: '最新指标',
    bioAge: '生物年龄',
    chronoAge: '实际年龄',
    biomarkers: '生物标志物详情',
    plan: '营养方案 (7天)',
    noData: '暂无测试数据',
    advice: 'PHM 建议',
    placeholder: '在此输入给用户的建议...',
    send: '发送指令',
    langToggle: 'EN'
  }
};

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lang, setLang] = useState('zh');

  const t = translations[lang];

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/users');
      const list = response.data.users || [];
      setUsers(list);
      if (list.length > 0) {
        setSelectedUser(prev => {
          const refreshed = prev ? list.find(u => u.user_id === prev.user_id) : null;
          return refreshed || list[0];
        });
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendInstruction = async () => {
    if (!instruction.trim() || !selectedUser) return;
    try {
      await axios.post('/api/phm-instruction', {
        openid: selectedUser.user_id,
        instruction
      });
      setInstruction('');
    } catch (err) {
      console.error('Failed to send instruction:', err);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span style={{ fontSize: 12, letterSpacing: 3, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
        Loading...
      </span>
    </div>
  );

  return (
    <>
      <div className="mobile-header">
        <div className="mobile-header-top">
          <div className="header-brand">
            <img src={wavenLogo} alt="Waven" className="header-logo" />
            <span className="header-title">{t.title}</span>
          </div>
          <button className="lang-toggle" onClick={() => setLang(l => l === 'zh' ? 'en' : 'zh')}>
            {t.langToggle}
          </button>
        </div>
        <div className="user-selector">
          {users.length > 0 ? (
            <select
              className="user-select"
              value={selectedUser?.user_id || ''}
              onChange={e => setSelectedUser(users.find(u => u.user_id === e.target.value))}
            >
              {users.map(u => (
                <option key={u.user_id} value={u.user_id}>
                  {u.nickname || 'User ' + u.user_id}
                </option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No users — start backend first</span>
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
        </div>
      </div>

      <div className="scroll-content">

        <div className="mobile-card">
          <div className="section-title">{t.metrics}</div>
          <div className="metric-row">
            <span className="metric-label">{t.bioAge}</span>
            <span className="metric-value bio-age">{selectedUser?.bio_age ?? '--'}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">{t.chronoAge}</span>
            <span className="metric-value">{selectedUser?.chrono_age ?? '--'}</span>
          </div>
        </div>

        <div className="mobile-card">
          <div className="section-title">{t.biomarkers}</div>
          {selectedUser?.bio_data?.actual
            ? Object.entries(selectedUser.bio_data.actual).map(([key, val]) => (
                <div key={key} className="biomarker-row">
                  <span className="biomarker-key">{key}</span>
                  <span className="biomarker-val">{val}</span>
                </div>
              ))
            : <div className="no-data">{t.noData}</div>
          }
        </div>

        <div className="mobile-card">
          <div className="section-title">{t.plan}</div>
          {selectedUser?.latest_plan
            ? <div className="plan-content">{selectedUser.latest_plan}</div>
            : <div className="no-data">{t.noData}</div>
          }
        </div>

        <div className="mobile-card">
          <div className="section-title">{t.advice}</div>
          <textarea
            className="instruction-input"
            placeholder={t.placeholder}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
          />
        </div>

      </div>

      <div className="action-bar">
        <button
          className="send-btn-mobile"
          onClick={handleSendInstruction}
          disabled={!instruction.trim() || !selectedUser}
        >
          {t.send}
        </button>
      </div>
    </>
  );
}

export default App;
