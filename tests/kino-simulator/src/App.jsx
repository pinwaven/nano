import React, { useState, useEffect } from 'react';
import axios from 'axios';
import wavenLogo from '../../../src/web/shared/assets/waven-logo-icon.png';

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [lastCRP, setLastCRP] = useState(null);

  useEffect(() => {
    axios.get('/api/users')
      .then(r => {
        const list = r.data.users || [];
        setUsers(list);
        if (list.length > 0) setSelectedUser(list[0]);
      })
      .catch(() => {});
  }, []);

  const handleStartTest = async () => {
    if (!selectedUser) return;
    setLoading(true);
    setStatus('Analyzing...');
    try {
      const randomCRP = parseFloat((Math.random() * (3.5 - 0.2) + 0.2).toFixed(2));
      await axios.post('/api/chat', {
        openid: selectedUser.user_id,
        test_type: 'kino_chip',
        test_data: { hsCRP: randomCRP },
        message: 'biomarkers'
      });
      setLastCRP(randomCRP);
      setStatus('Complete');
      setTimeout(() => setStatus('Ready'), 3000);
    } catch (err) {
      console.error('Kino Test Error:', err);
      setStatus('Failed');
      setTimeout(() => setStatus('Ready'), 3000);
    } finally {
      setLoading(false);
    }
  };

  const stateClass = loading ? 'analyzing'
    : status === 'Complete' ? 'complete'
    : status === 'Failed' ? 'failed'
    : 'ready';

  const crpRisk = lastCRP
    ? lastCRP < 1 ? 'Low Risk' : lastCRP < 3 ? 'Moderate' : 'Elevated'
    : null;

  return (
    <>
      <div className="kino-header">
        <div className="header-brand">
          <img src={wavenLogo} alt="" className="header-logo" />
          <span className="header-name">KINO</span>
        </div>
        <span className="header-sub">BIOMARKER DEVICE</span>
      </div>

      <div className="kino-body">

        <div className={`device-wrap ${stateClass}`}>
          <div className="ring-track" />
          <div className="ring-face">
            <div className="face-label">STATUS</div>
            <div className="face-status">{status}</div>
            {selectedUser && (
              <div className="face-user">{selectedUser.nickname || 'User'}</div>
            )}
            {stateClass === 'complete' && lastCRP !== null && (
              <div className="face-reading">
                <span className="reading-val">{lastCRP}</span>
                <span className="reading-unit">mg/L</span>
              </div>
            )}
          </div>
        </div>

        {stateClass === 'complete' && crpRisk && (
          <div className="crp-banner">
            <span className="crp-label">hsCRP</span>
            <span className="crp-value">{lastCRP} mg/L</span>
            <span className={`crp-risk risk-${crpRisk.toLowerCase().replace(' ', '-')}`}>{crpRisk}</span>
          </div>
        )}

        <div className="patient-section">
          <div className="section-eyebrow">PATIENT</div>
          {users.length === 0 ? (
            <span className="no-users">No users — start backend first</span>
          ) : (
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
          )}
        </div>

        <button
          className={`test-btn ${stateClass}`}
          onClick={handleStartTest}
          disabled={loading || !selectedUser}
        >
          {loading
            ? <><span className="btn-dot" /><span className="btn-dot" /><span className="btn-dot" /></>
            : status === 'Complete' ? 'Run Another Test'
            : 'Start Biomarker Test'
          }
        </button>

      </div>
    </>
  );
}

export default App;
