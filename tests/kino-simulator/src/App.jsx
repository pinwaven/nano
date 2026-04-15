import React, { useState, useEffect } from 'react';
import axios from 'axios';

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [status, setStatus] = useState('Ready for Test');
  const [loading, setLoading] = useState(false);

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
        openid: selectedUser.external_id,
        test_type: 'kino_chip',
        test_data: { hsCRP: randomCRP },
        message: 'biomarkers'
      });
      setStatus('Test Complete!');
      setTimeout(() => setStatus('Ready for Test'), 3000);
    } catch (err) {
      console.error('Kino Test Error:', err);
      setStatus('Test Failed');
      setTimeout(() => setStatus('Ready for Test'), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="header">Kino Simulator</div>
      <div className="device-body">
        <div className="device-screen">
          <div className="status-text">{status}</div>
          {selectedUser && (
            <div className="screen-user">{selectedUser.nickname || 'User ' + selectedUser.id}</div>
          )}
        </div>

        <div className="user-selector">
          {users.map(u => (
            <button
              key={u.user_id}
              className={`user-pill${selectedUser?.user_id === u.user_id ? ' active' : ''}`}
              onClick={() => setSelectedUser(u)}
            >
              {u.nickname || 'User ' + u.user_id}
            </button>
          ))}
          {users.length === 0 && <span className="no-users">No users — start backend first</span>}
        </div>

        <button
          className="test-btn"
          onClick={handleStartTest}
          disabled={loading || !selectedUser}
          style={{ opacity: (loading || !selectedUser) ? 0.6 : 1 }}
        >
          {loading ? 'Processing...' : 'Start Biomarker Test'}
        </button>
      </div>
    </>
  );
}

export default App;
