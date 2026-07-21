import { useRef, useState } from 'react';
import { useLang } from '../i18n.js';

export default function ChatToolbox({ onFormulaDots, onHealthAdvice, onUploadImage, disabled }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef(null);

  const tools = [
    { action: 'upload_image',  label: t.toolUploadImage },
    { action: 'formula_dots',  label: t.toolFormulaDots },
    { action: 'health_advice', label: t.toolHealthAdvice },
  ];

  const handleToolClick = (action) => {
    setOpen(false);
    if (action === 'upload_image') { fileInputRef.current?.click(); return; }
    if (action === 'formula_dots') onFormulaDots();
    if (action === 'health_advice') onHealthAdvice();
  };

  return (
    <div className="chat-toolbox">
      {open && (
        <div className="toolbox-menu">
          {tools.map(tool => (
            <button
              key={tool.action}
              className="toolbox-menu-item"
              onClick={() => handleToolClick(tool.action)}
              disabled={disabled}
            >
              {tool.label}
            </button>
          ))}
        </div>
      )}
      <button
        className={`toolbox-toggle-btn${open ? ' open' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-label="Tools"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onUploadImage(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
