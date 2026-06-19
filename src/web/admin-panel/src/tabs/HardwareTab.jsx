import React, { useState } from 'react';
import { Cpu, Layers } from 'lucide-react';
import { useLang } from '../shared.jsx';
import { KinoTab } from './KinoTab.jsx';
import { ChipsTab } from './ChipsTab.jsx';

function HardwareTab({ devices, machinePagination, coaches, channels, releases, chipBatches, chipModels, onRefresh }) {
  const { t } = useLang();
  const [subTab, setSubTab] = useState('devices');

  return (
    <>
      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'devices' ? ' active' : ''}`} onClick={() => setSubTab('devices')}>
          <Cpu size={13} /> {t.nav.kino}
        </button>
        <button className={`subtab-btn${subTab === 'chips' ? ' active' : ''}`} onClick={() => setSubTab('chips')}>
          <Layers size={13} /> {t.nav.chips}
        </button>
      </div>

      {subTab === 'devices' && (
        <KinoTab
          devices={devices}
          machinePagination={machinePagination}
          coaches={coaches}
          channels={channels}
          releases={releases}
          onRefresh={onRefresh}
        />
      )}
      {subTab === 'chips' && (
        <ChipsTab
          batches={chipBatches}
          models={chipModels}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}

export { HardwareTab };
