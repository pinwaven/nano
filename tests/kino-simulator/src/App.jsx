import React, { useState } from 'react';
import axios from 'axios';

function App() {
  const [status, setStatus] = useState('Ready for Test');
  const [loading, setLoading] = useState(false);

  const handleStartTest = async () => {
    setLoading(true);
    setStatus('Analyzing...');

    try {
      // Simulate a Kino chip test with some failed biomarkers
      const testData = {
        openid: 'test_user_macos',
        test_type: 'kino_chip',
        test_data: {
          GDF15: 850,
          hsCRP: 1.2,
          IL6: 2.1
          // CD38, GA, and CystatinC are missing/failed, 
          // backend will estimate them!
        },
        message: 'biomarkers' // Trigger the chat simulator message
      };

      await axios.post('/api/chat', testData);
      
      setStatus('Test Complete!');
      setTimeout(() => setStatus('Ready for Test'), 3000);
    } catch (error) {
      console.error('Kino Test Error:', error);
      setStatus('Test Failed');
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
        </div>
        <button 
          className="test-btn" 
          onClick={handleStartTest}
          disabled={loading}
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          {loading ? 'Processing...' : 'Start Biomarker Test'}
        </button>
      </div>
    </>
  );
}

export default App;
