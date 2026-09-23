// components/toolbox — the "+" panel. upload_image opens a file input here (the miniapp runs
// wx.chooseMedia inside the component) and hands the File up; other tools emit their action.
import { useRef } from 'react';
import { useLang } from '../i18n/index.js';

export function getToolList(t) {
  return [
    { action: 'upload_image', icon: '▣', label: t.toolUploadImage },
    { action: 'test_chip',    icon: '⬡', label: t.toolTestChip },
    { action: 'formula_dots', icon: '◉', label: t.toolFormulaDots },
    { action: 'health_advice',icon: '♥', label: t.toolHealthAdvice },
  ];
}

export default function Toolbox({ disabled, onAction, tools }) {
  const { t } = useLang();
  const fileRef = useRef(null);
  const tap = action => {
    if (disabled) return;
    if (action === 'upload_image') { fileRef.current?.click(); return; }
    onAction(action);
  };
  return (
    <div className="toolbox-panel">
      <div className="toolbox-grid">
        {(tools || getToolList(t)).map(tool => (
          <div key={tool.action} className={`tool-item${disabled ? ' tool-item-disabled' : ''}`} onClick={() => tap(tool.action)}>
            <span className="tool-item-icon">{tool.icon}</span>
            <span className="tool-item-label">{tool.label}</span>
          </div>
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAction('upload_image', f); }} />
    </div>
  );
}
