import React, { useState } from 'react';

function App() {
  const [status, setStatus] = useState('Ready for Test');

  const handleStartTest = () => {
    // Button currently does nothing per request
    console.log('Test button pressed. Simulation logic pending.');
  };

  return (
    <>
      <div className="header">KINO DEVICE SIMULATOR</div>
      <div className="device-body">
        <div className="device-screen">
          <div className="status-text">{status}</div>
        </div>
        <button className="test-btn" onClick={handleStartTest}>
          Start Biomarker Test
        </button>
      </div>
    </>
  );
}

export default App;
