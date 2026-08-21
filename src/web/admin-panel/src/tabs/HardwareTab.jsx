import React, { useState } from 'react';
import { Cpu, Layers, PackageSearch } from 'lucide-react';
import { useLang } from '../shared.jsx';
import { KinoTab } from './KinoTab.jsx';
import { ChipsTab } from './ChipsTab.jsx';
import { BoxesTab } from './BoxesTab.jsx';

function HardwareTab({ devices, machinePagination, coaches, channels, releases, chipBatches, chipModels, boxBatches, users, onRefresh }) {
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
        <button className={`subtab-btn${subTab === 'boxes' ? ' active' : ''}`} onClick={() => setSubTab('boxes')}>
          <PackageSearch size={13} /> {t.nav.boxes}
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
      {subTab === 'boxes' && (
        <BoxesTab
          batches={boxBatches}
          users={users}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}

export { HardwareTab };
