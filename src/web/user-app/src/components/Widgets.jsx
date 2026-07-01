import { useState, useEffect } from 'react';
import { useLang } from '../i18n.js';

export function LangToggle({ lang, onChange }) {
  return (
    <button className="lang-toggle" onClick={() => onChange(lang === 'zh' ? 'en' : 'zh')}>
      <span className={lang === 'zh' ? 'lang-active' : ''}>中</span>
      <span className="lang-sep">/</span>
      <span className={lang === 'en' ? 'lang-active' : ''}>EN</span>
    </button>
  );
}

export function NameInputWidget({ onConfirm, disabled }) {
  const { t } = useLang();
  const [name, setName] = useState('');
  return (
    <div className="name-input-widget">
      <input
        className="name-input-field"
        type="text"
        placeholder={t.obNamePlaceholder}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !disabled) onConfirm(name.trim()); }}
        disabled={disabled}
        autoFocus
      />
      <button
        className="name-input-confirm"
        onClick={() => name.trim() && onConfirm(name.trim())}
        disabled={disabled || !name.trim()}
      >
        {t.dpConfirm}
      </button>
    </div>
  );
}

export function DatePickerWidget({ onConfirm, disabled }) {
  const { t, lang } = useLang();
  const currentYear = new Date().getFullYear();
  const [year,  setYear]  = useState('');
  const [month, setMonth] = useState('');
  const [day,   setDay]   = useState('');

  const years  = Array.from({ length: currentYear - 1919 }, (_, i) => currentYear - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const daysInMonth = year && month ? new Date(Number(year), Number(month), 0).getDate() : 31;
  const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  useEffect(() => {
    if (day && Number(day) > daysInMonth) setDay('');
  }, [year, month]);

  const monthLabel = m =>
    new Date(2000, m - 1, 1).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' });

  const handleConfirm = () => {
    if (!year || !month || !day || disabled) return;
    onConfirm(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  };

  return (
    <div className="date-picker">
      <div className="date-picker-selects">
        <select className="date-picker-select" value={year} onChange={e => { setYear(e.target.value); setDay(''); }} disabled={disabled}>
          <option value="">{t.dpYear}</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="date-picker-select" value={month} onChange={e => { setMonth(e.target.value); setDay(''); }} disabled={disabled}>
          <option value="">{t.dpMonth}</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select className="date-picker-select" value={day} onChange={e => setDay(e.target.value)} disabled={disabled || !year || !month}>
          <option value="">{t.dpDay}</option>
          {days.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>
      <button className="date-picker-confirm" onClick={handleConfirm} disabled={!year || !month || !day || disabled}>
        {t.dpConfirm}
      </button>
    </div>
  );
}

export function BodySliderWidget({ onConfirm, disabled }) {
  const { t } = useLang();
  const [height, setHeight] = useState(165);
  const [weight, setWeight] = useState(65);

  return (
    <div className="body-slider">
      <div className="body-slider-row">
        <div className="body-slider-label">
          <span>{t.bsHeight}</span>
          <span className="body-slider-val">{height} <span className="body-slider-unit">{t.bsCm}</span></span>
        </div>
        <input type="range" className="body-slider-input" min={100} max={220} step={1}
          value={height} style={{ '--pct': `${((height - 100) / 120) * 100}%` }}
          onChange={e => setHeight(Number(e.target.value))} disabled={disabled} />
      </div>
      <div className="body-slider-row">
        <div className="body-slider-label">
          <span>{t.bsWeight}</span>
          <span className="body-slider-val">{weight} <span className="body-slider-unit">{t.bsKg}</span></span>
        </div>
        <input type="range" className="body-slider-input" min={30} max={150} step={0.5}
          value={weight} style={{ '--pct': `${((weight - 30) / 120) * 100}%` }}
          onChange={e => setWeight(Number(e.target.value))} disabled={disabled} />
      </div>
      <button className="date-picker-confirm" onClick={() => !disabled && onConfirm({ height, weight })} disabled={disabled}>
        {t.bsConfirm}
      </button>
    </div>
  );
}
