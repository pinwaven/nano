import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ScrollText } from 'lucide-react';

const SECTION_COLORS = {
  'New Features': '#6366f1',
  'Improvements': '#0ea5e9',
  'Bug Fixes': '#f59e0b',
};

export function ChangelogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get('/api/release-notes')
      .then(res => setEntries(res.data.entries || []))
      .catch(() => setError('Failed to load release notes.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 32, color: '#888' }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: '#f87171' }}>{error}</div>;
  if (!entries.length) return <div style={{ padding: 32, color: '#888' }}>No release notes yet.</div>;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
        <ScrollText size={20} style={{ color: '#6366f1' }} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Release Notes</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {entries.map(entry => (
          <div key={entry.version} style={{
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            padding: '20px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
              <span style={{
                fontWeight: 700, fontSize: 15, color: '#111',
                background: '#f3f4f6', padding: '2px 10px', borderRadius: 6,
              }}>
                v{entry.version}
              </span>
              {entry.title && (
                <span style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>{entry.title}</span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>
                {entry.published_at}
              </span>
            </div>
            {(entry.summary || []).map(({ section, items }) => (
              <div key={section} style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: SECTION_COLORS[section] || '#6b7280', marginBottom: 6,
                }}>
                  {section}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(items || []).map((item, i) => (
                    <li key={i} style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
