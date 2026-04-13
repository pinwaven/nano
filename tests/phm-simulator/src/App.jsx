import React, { useState, useEffect } from 'react';
import axios from 'axios';

const translations = {
  en: {
    title: 'PHM Mobile',
    loading: 'Loading PHM Mobile...',
    metrics: 'Latest Metrics',
    bioAge: 'Biological Age',
    chronoAge: 'Chronological Age',
    biomarkers: 'Biomarkers Detail',
    noData: 'No test data yet.',
    advice: 'Coach Advice',
    placeholder: 'Type your advice for the customer here...',
    send: 'Send Instruction',
    success: 'Instruction sent successfully',
    error: 'Failed to send instruction',
    langToggle: '中文'
  },
  zh: {
    title: 'PHM 移动端',
    loading: '正在加载 PHM 移动端...',
    metrics: '最新指标',
    bioAge: '生物年龄',
    chronoAge: '实际年龄',
    biomarkers: '生物标志物详情',
    noData: '暂无测试数据',
    advice: '教练建议',
    placeholder: '在此输入给客户的建议...',
    send: '发送指令',
    success: '指令发送成功',
    error: '发送指令失败',
    langToggle: 'EN'
  }
};

function App() {
  const [customers, setCustomers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState('zh');

  const t = translations[lang];

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    try {
      const response = await axios.get('/api/customers');
      setCustomers(response.data.customers);
      if (response.data.customers.length > 0 && !selectedUser) {
        setSelectedUser(response.data.customers[0]);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSendInstruction = async () => {
    if (!instruction.trim() || !selectedUser) return;

    try {
      await axios.post('/api/coach-instruction', {
        openid: selectedUser.wechat_openid,
        instruction: instruction
      });
      setInstruction('');
      console.log(t.success);
    } catch (err) {
      console.error(t.error);
    }
  };

  const toggleLang = () => {
    setLang(prev => prev === 'zh' ? 'en' : 'zh');
  };

  if (loading) return <div style={{padding: 40, textAlign: 'center'}}>{t.loading}</div>;

  return (
    <>
      <div className="mobile-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="header-title" style={{ margin: 0, flex: 1 }}>{t.title}</div>
          <button
            onClick={toggleLang}
            style={{
              background: '#e5e5ea',
              border: 'none',
              borderRadius: '12px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: '600',
              cursor: 'pointer',
              WebkitAppRegion: 'no-drag'
            }}
          >
            {t.langToggle}
          </button>
        </div>
        <div className="customer-selector">
          {customers.map(c => (
            <div 
              key={c.id} 
              className={`customer-pill ${selectedUser?.id === c.id ? 'active' : ''}`}
              onClick={() => setSelectedUser(c)}
            >
              {c.nickname || 'User ' + c.id}
            </div>
          ))}
        </div>
      </div>

      <div className="scroll-content">
        <div className="mobile-card">
          <div className="section-title">{t.metrics}</div>
          <div className="metric-row">
            <span className="metric-label">{t.bioAge}</span>
            <span className="metric-value">{selectedUser?.bio_age || '--'}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">{t.chronoAge}</span>
            <span className="metric-value">{selectedUser?.chrono_age || '--'}</span>
          </div>
        </div>

        <div className="mobile-card">
          <div className="section-title">{t.biomarkers}</div>
          {selectedUser?.bio_data?.actual ? (
            Object.entries(selectedUser.bio_data.actual).map(([key, val]) => (
              <div key={key} className="metric-row">
                <span className="metric-label">{key}</span>
                <span className="metric-value" style={{color: '#333', fontSize: '15px'}}>{val}</span>
              </div>
            ))
          ) : (
            <div style={{fontSize: 14, color: '#999'}}>{t.noData}</div>
          )}
        </div>

        <div className="mobile-card">
          <div className="section-title">{t.advice}</div>
          <textarea 
            className="instruction-input"
            placeholder={t.placeholder}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>
      </div>

      <div className="action-bar">
        <button className="send-btn-mobile" onClick={handleSendInstruction}>
          {t.send}
        </button>
      </div>
    </>
  );
}

export default App;
