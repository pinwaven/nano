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
      if (response.data.customers.length > 0) {
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
      alert('Instruction sent to user chat!');
      setInstruction('');
    } catch (err) {
      alert('Failed to send instruction.');
    }
  };

  if (loading) return <div style={{padding: 20}}>Loading PHM App...</div>;

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-header">PHM Dashboard</div>
        <div className="customer-list">
          {customers.map(c => (
            <div 
              key={c.id} 
              className={`customer-item ${selectedUser?.id === c.id ? 'active' : ''}`}
              onClick={() => setSelectedUser(c)}
            >
              {c.nickname || 'Anonymous'}
            </div>
          ))}
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <span>Customer: {selectedUser?.nickname}</span>
          <button onClick={fetchCustomers} style={{fontSize: 12}}>Refresh Data</button>
        </div>

        <div className="dashboard">
          <div className="left-panel">
            <div className="card">
              <div className="card-title">Latest Bio-Analysis</div>
              <div className="metric-grid">
                <div className="metric-box">
                  <div className="metric-label">Biological Age</div>
                  <div className="metric-value">{selectedUser?.bio_age || 'N/A'}</div>
                </div>
                <div className="metric-box">
                  <div className="metric-label">Chronological Age</div>
                  <div className="metric-value">{selectedUser?.chrono_age || 'N/A'}</div>
                </div>
              </div>
              
              <div style={{marginTop: 20}}>
                <div className="card-title">Biomarker Values</div>
                <pre style={{background: '#f1f1f1', padding: 10, borderRadius: 4, fontSize: 12}}>
                  {JSON.stringify(selectedUser?.bio_data?.actual || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          <div className="right-panel">
            <div className="card">
              <div className="card-title">Send Coach Instruction</div>
              <div className="instruction-box">
                <textarea 
                  placeholder="Type advice or instructions for the user (e.g., 'Please increase water intake based on your GDF15 levels')..."
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <button className="send-btn" onClick={handleSendInstruction}>Send to Nano Chat</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
