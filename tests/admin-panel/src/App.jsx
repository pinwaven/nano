import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Droplets, UserCog, ClipboardList, RefreshCcw } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState('users');
  const [data, setData] = useState({ users: [], dots: [], phms: [] });
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [uRes, dRes, pRes] = await Promise.all([
        axios.get('/api/customers'),
        axios.get('/api/dots-inventory'),
        axios.get('/api/phm-list')
      ]);
      setData({
        users: uRes.data.customers || [],
        dots: dRes.data.dots || [],
        phms: pRes.data.phms || []
      });
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const renderContent = () => {
    if (loading) return <div style={{padding: 20}}>Loading Dashboard...</div>;

    switch (activeTab) {
      case 'users':
        return (
          <div className="card">
            <table className="table-container">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nickname</th>
                  <th>Language</th>
                  <th>Gender</th>
                  <th>BioAge</th>
                  <th>PHM</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map(u => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.nickname || 'Unknown'}</td>
                    <td><span className={`badge badge-${u.language}`}>{u.language?.toUpperCase()}</span></td>
                    <td>{u.gender || '--'}</td>
                    <td style={{fontWeight: 'bold', color: '#2563eb'}}>{u.bio_age || '--'}</td>
                    <td>{u.coach_name || 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'dots':
        return (
          <div className="card">
            <table className="table-container">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Name (EN)</th>
                  <th>Name (ZH)</th>
                  <th>Color</th>
                  <th>Payload Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {data.dots.map(d => (
                  <tr key={d.id}>
                    <td style={{fontWeight: '600'}}>{d.key_name}</td>
                    <td>{d.name}</td>
                    <td>{d.name_zh}</td>
                    <td>
                      <span className="dot-color-preview" style={{backgroundColor: d.color?.toLowerCase()}} />
                      {d.color}
                    </td>
                    <td style={{fontSize: '12px', color: '#64748b'}}>
                      {JSON.stringify(d.ingredients_zh)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'phms':
        return (
          <div className="card">
            <table className="table-container">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Customers</th>
                </tr>
              </thead>
              <tbody>
                {data.phms.map(p => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td style={{fontWeight: '600'}}>{p.name}</td>
                    <td>{p.email}</td>
                    <td>{p.phone}</td>
                    <td>{p.customer_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      default:
        return <div>Select a tab</div>;
    }
  };

  return (
    <>
      <div className="sidebar">
        <div className="sidebar-header">Nano Admin</div>
        <div style={{flex: 1, padding: '10px 0'}}>
          <div className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
            <Users size={18} style={{marginRight: 12}} /> Users
          </div>
          <div className={`nav-item ${activeTab === 'dots' ? 'active' : ''}`} onClick={() => setActiveTab('dots')}>
            <Droplets size={18} style={{marginRight: 12}} /> Precision Dots
          </div>
          <div className={`nav-item ${activeTab === 'phms' ? 'active' : ''}`} onClick={() => setActiveTab('phms')}>
            <UserCog size={18} style={{marginRight: 12}} /> PHM Coaches
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="top-bar">
          <div style={{fontSize: '18px', fontWeight: '600'}}>
            {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Management
          </div>
          <button onClick={fetchData} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: '6px', border: '1px solid #ddd', background: 'white', cursor: 'pointer'}}>
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>
        <div className="page-container">
          {renderContent()}
        </div>
      </div>
    </>
  );
}

export default App;
