import React, { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [customers, setCustomers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(true);

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
      console.log('Instruction sent successfully');
    } catch (err) {
      console.error('Failed to send instruction');
    }
  };

  if (loading) return <div style={{padding: 40, textAlign: 'center'}}>Loading PHM Mobile...</div>;

  return (
    <>
      <div className="mobile-header">
        <div className="header-title">PHM Mobile</div>
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
          <div className="section-title">Latest Metrics</div>
          <div className="metric-row">
            <span className="metric-label">Biological Age</span>
            <span className="metric-value">{selectedUser?.bio_age || '--'}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Chronological Age</span>
            <span className="metric-value">{selectedUser?.chrono_age || '--'}</span>
          </div>
        </div>

        <div className="mobile-card">
          <div className="section-title">Biomarkers Detail</div>
          {selectedUser?.bio_data?.actual ? (
            Object.entries(selectedUser.bio_data.actual).map(([key, val]) => (
              <div key={key} className="metric-row">
                <span className="metric-label">{key}</span>
                <span className="metric-value" style={{color: '#333', fontSize: '15px'}}>{val}</span>
              </div>
            ))
          ) : (
            <div style={{fontSize: 14, color: '#999'}}>No test data yet.</div>
          )}
        </div>

        <div className="mobile-card">
          <div className="section-title">Coach Advice</div>
          <textarea 
            className="instruction-input"
            placeholder="Type your advice for the customer here..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>
      </div>

      <div className="action-bar">
        <button className="send-btn-mobile" onClick={handleSendInstruction}>
          Send Instruction
        </button>
      </div>
    </>
  );
}

export default App;
EOF
