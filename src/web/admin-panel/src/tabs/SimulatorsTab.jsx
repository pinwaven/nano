import React from 'react';

const SIM_V = `?v=${__SIM_VERSION__}`;

function SimulatorsTab() {
  return (
    <div className="sims-grid">
      <div className="card sim-card">
        <div className="card-header">Kino Simulator</div>
        <iframe src={`/admin/sim/kino/${SIM_V}`} title="Kino" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">Chat Simulator</div>
        <iframe src={`/admin/sim/chat/${SIM_V}`} title="Chat" className="sim-iframe" />
      </div>
      <div className="card sim-card">
        <div className="card-header">Coach Simulator</div>
        <iframe src={`/admin/sim/coach/${SIM_V}`} title="Coach" className="sim-iframe" />
      </div>
    </div>
  );
}

export { SimulatorsTab };
