import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import wavenLogo from '../../../src/web/shared/assets/waven-logo-icon.png';

const BIOMARKER_META = [
  { key: 'hsCRP',     label: 'hsCRP',      unit: 'mg/L' },
  { key: 'GDF15',     label: 'GDF-15',     unit: 'pg/mL' },
  { key: 'IL6',       label: 'IL-6',       unit: 'pg/mL' },
  { key: 'GA',        label: 'Glycated Albumin', unit: '%' },
  { key: 'CystatinC', label: 'Cystatin C', unit: 'mg/L' },
  { key: 'CD38',      label: 'CD38',       unit: 'xBaseline' },
];

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [biomarkers, setBiomarkers] = useState(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideVisible, setSlideVisible] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const slideTimer = useRef(null);

  const fetchUsers = () =>
    axios.get('/api/users')
      .then(r => {
        const list = r.data.users || [];
        setUsers(list);
        return list;
      })
      .catch(() => []);

  useEffect(() => {
    fetchUsers().then(list => { if (list.length > 0) setSelectedUser(list[0]); });
  }, []);

  useEffect(() => {
    if (status !== 'Complete' || !biomarkers) {
      clearInterval(slideTimer.current);
      setSlideIndex(0);
      setSlideVisible(true);
      return;
    }
    slideTimer.current = setInterval(() => {
      setSlideVisible(false);
      setTimeout(() => {
        setSlideIndex(i => (i + 1) % BIOMARKER_META.length);
        setSlideVisible(true);
      }, 300);
    }, 2300);
    return () => clearInterval(slideTimer.current);
  }, [status, biomarkers]);

  const handleStartTest = async () => {
    if (!selectedUser) return;
    if (status === 'Complete') {
      setStatus('Ready');
      setBiomarkers(null);
      return;
    }
    setLoading(true);
    setStatus('Analyzing...');
    try {
      const randomCRP = parseFloat((Math.random() * (3.5 - 0.2) + 0.2).toFixed(2));
      const res = await axios.post('/api/chat', {
        openid: selectedUser.user_id,
        test_type: 'kino_chip',
        test_data: { hsCRP: randomCRP },
      });
      setBiomarkers(res.data.biomarkers || null);
      setStatus('Complete');
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

  const hsCRP = biomarkers?.hsCRP ?? null;
  const crpRisk = hsCRP !== null
    ? hsCRP < 1 ? 'Low Risk' : hsCRP < 3 ? 'Moderate' : 'Elevated'
    : null;

  return (
    <>
      <div className="kino-header">
        <div className="header-brand">
          <img src={wavenLogo} alt="Waven" className="header-logo" />
          <span className="header-name">KINO</span>
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
        </div>
      </div>

      <div className="kino-body">

        <div className={`device-wrap ${stateClass}`}>
          <div className="ring-track" />
          <div className="ring-face">
            {stateClass === 'complete' && biomarkers ? (() => {
              const { key, label, unit } = BIOMARKER_META[slideIndex];
              return (
                <div className={`face-slide ${slideVisible ? 'visible' : ''}`}>
                  <div className="face-slide-index">{slideIndex + 1} / {BIOMARKER_META.length}</div>
                  <div className="face-slide-label">{label}</div>
                  <div className="face-slide-val">{biomarkers[key] ?? '—'}</div>
                  <div className="face-slide-unit">{unit}</div>
                </div>
              );
            })() : (
              <>
                <div className="face-label">STATUS</div>
                <div className="face-status">{status}</div>
                {selectedUser && (
                  <div className="face-user">{selectedUser.nickname || 'User'}</div>
                )}
              </>
            )}
          </div>
        </div>

        {stateClass === 'complete' && biomarkers && (
          <div className="biomarker-results">
            <div className="biomarker-results-title">BIOMARKER PANEL</div>
            {BIOMARKER_META.map(({ key, label, unit }) => (
              <div key={key} className="bm-row">
                <span className="bm-label">{label}</span>
                <span className="bm-value">
                  {biomarkers[key] ?? '—'}
                  <span className="bm-unit">{unit}</span>
                </span>
                {key === 'hsCRP' && crpRisk && (
                  <span className={`crp-risk risk-${crpRisk.toLowerCase().replace(' ', '-')}`}>{crpRisk}</span>
                )}
              </div>
            ))}
          </div>
        )}

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
