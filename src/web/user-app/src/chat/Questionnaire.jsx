// The server-driven questionnaire input bars (pages/main/main.wxml "Onboarding:" blocks +
// main.js:4087–4212). One component per input_type; each submits through saveAnswer with the
// same (displayText, answerValue) pair the miniapp sends.
import { useEffect, useState } from 'react';
import { useLang } from '../i18n/index.js';

function TextBar({ q, onSubmit }) {
  const { t } = useLang();
  const [v, setV] = useState('');
  const go = () => { const name = v.trim(); if (!name) return; setV(''); onSubmit(name, name); };
  return (
    <div className="ob-bar name-bar">
      <input className="ob-input" autoFocus value={v} placeholder={q.config?.placeholder_zh || q.config?.placeholder_en || ''}
        onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }} />
      <div className="ob-confirm" onClick={go}><span>{t.confirm}</span></div>
    </div>
  );
}

function ButtonSelectBar({ q, lang, onSubmit }) {
  return (
    <div className="ob-bar gender-bar">
      {(q.config?.options || []).map(o => (
        <div key={o.value} className="quick-btn" onClick={() => onSubmit(lang === 'zh' ? o.label_zh : o.label_en, o.value)}>
          <span>{lang === 'zh' ? o.label_zh : o.label_en}</span>
        </div>
      ))}
    </div>
  );
}

function DateBar({ q, onSubmit }) {
  const { t } = useLang();
  const [v, setV] = useState('');
  return (
    <div className="ob-bar birthday-bar">
      <div className="picker-row">
        <input type="date" className="picker-val picker-native" value={v} min={q.config?.min_date || '1920-01-01'} max={q.config?.max_date || '2099-12-31'} onChange={e => setV(e.target.value)} />
      </div>
      <div className={`ob-confirm${v ? '' : ' ob-confirm-off'}`} onClick={() => v && onSubmit(v, v)}><span>{t.confirm}</span></div>
    </div>
  );
}

function TimeBar({ q, onSubmit }) {
  const { t } = useLang();
  const [v, setV] = useState((q.config && q.config.default) || '');
  return (
    <div className="ob-bar birthday-bar">
      <div className="picker-row">
        <input type="time" className="picker-val picker-native" value={v} min={q.config?.start || '00:00'} max={q.config?.end || '23:59'} onChange={e => setV(e.target.value)} />
      </div>
      <div className={`ob-confirm${v ? '' : ' ob-confirm-off'}`} onClick={() => v && onSubmit(v, v)}><span>{t.confirm}</span></div>
    </div>
  );
}

function SliderGroupBar({ q, lang, onSubmit }) {
  const { t } = useLang();
  const sliders = q.config?.sliders || [];
  const init = () => { const o = {}; for (const s of sliders) o[s.key] = s.default; return o; };
  const [vals, setVals] = useState(init);
  const [texts, setTexts] = useState(() => { const o = {}; for (const s of sliders) o[s.key] = s.step < 1 ? Number(s.default).toFixed(1) : String(s.default); return o; });
  const apply = (s, raw, clamp) => {
    let val = Number(raw);
    if (isNaN(val)) val = vals[s.key];
    if (clamp && s.min != null && s.max != null) val = Math.min(s.max, Math.max(s.min, val));
    if (s.step) val = Math.round(val / s.step) * s.step;
    const display = s.step < 1 ? val.toFixed(1) : String(val);
    setVals(p => ({ ...p, [s.key]: val })); setTexts(p => ({ ...p, [s.key]: display }));
  };
  const submit = () => {
    const parts = sliders.map(s => `${lang === 'zh' ? s.label_zh : s.label_en}: ${texts[s.key] ?? vals[s.key]}${s.unit}`);
    onSubmit(parts.join('  '), { ...vals });
  };
  return (
    <div className="ob-bar body-bar">
      {sliders.map(s => (
        <div key={s.key} className="slider-row">
          <div className="slider-labels">
            <span className="slider-key">{lang === 'zh' ? s.label_zh : s.label_en}</span>
            <div className="slider-value-wrap">
              <input className="slider-val-input" inputMode="decimal" value={texts[s.key]} onChange={e => setTexts(p => ({ ...p, [s.key]: e.target.value }))} onBlur={e => apply(s, e.target.value, true)} />
              <span className="slider-unit">{s.unit}</span>
            </div>
          </div>
          <div className="slider-control-row">
            <div className="slider-step-btn" onClick={() => apply(s, (vals[s.key] || 0) - (s.step || 1), true)}>−</div>
            <input type="range" className="slider-input" min={s.min} max={s.max} step={s.step} value={vals[s.key]} onChange={e => apply(s, e.target.value, false)} />
            <div className="slider-step-btn" onClick={() => apply(s, (vals[s.key] || 0) + (s.step || 1), true)}>+</div>
          </div>
        </div>
      ))}
      <div className="ob-confirm" onClick={submit}><span>{t.confirm}</span></div>
    </div>
  );
}

function MultiSelectBar({ q, lang, onSubmit, onOther }) {
  const { t } = useLang();
  const [list, setList] = useState(() => (q.config?.options || []).map((opt, idx) => ({ key: opt.key || opt.value || String(idx), label: lang === 'zh' ? opt.label_zh : opt.label_en, selected: false })));
  const [other, setOther] = useState('');
  const otherSelected = list.some(i => i.key === 'other' && i.selected);
  const toggle = key => {
    setList(prev => key === 'none'
      ? prev.map(i => ({ ...i, selected: i.key === 'none' }))
      : prev.map(i => (i.key === 'none' ? { ...i, selected: false } : i.key === key ? { ...i, selected: !i.selected } : i)));
  };
  useEffect(() => { if (!otherSelected) setOther(''); }, [otherSelected]);
  const submit = () => {
    const otherText = otherSelected ? other.trim() : '';
    const sep = lang === 'zh' ? '、' : ', ';
    const labels = list.filter(i => i.selected).map(i => (i.key === 'other' && otherText ? `${i.label}（${otherText}）` : i.label));
    const display = labels.length ? labels.join(sep) : t.obConditionsNone;
    onSubmit(display, list.filter(i => i.selected).map(i => i.key));
    if (otherText && q.config?.other_key) onOther(q.config.other_key, otherText);
  };
  return (
    <div className="ob-bar conditions-bar">
      <div className="cond-chips">
        {list.map(i => <div key={i.key} className={`cond-chip${i.selected ? ' cond-chip-on' : ''}`} onClick={() => toggle(i.key)}><span>{i.label}</span></div>)}
      </div>
      {otherSelected && <input className="ob-input cond-other-input" autoFocus placeholder={t.obConditionsOtherPh} value={other} onChange={e => setOther(e.target.value)} />}
      <div className="ob-confirm" onClick={submit}><span>{t.confirm}</span></div>
    </div>
  );
}

export default function Questionnaire({ question, typing, onSubmit, onOther }) {
  const { lang } = useLang();
  if (!question) return null;
  const type = question.input_type;
  if (type === 'text') return <TextBar key={question.id} q={question} onSubmit={onSubmit} />;
  if (type === 'button_select') return typing ? null : <ButtonSelectBar key={question.id} q={question} lang={lang} onSubmit={onSubmit} />;
  if (type === 'date_picker') return <DateBar key={question.id} q={question} onSubmit={onSubmit} />;
  if (type === 'time_picker') return <TimeBar key={question.id} q={question} onSubmit={onSubmit} />;
  if (type === 'slider_group') return <SliderGroupBar key={question.id} q={question} lang={lang} onSubmit={onSubmit} />;
  if (type === 'multi_select') return <MultiSelectBar key={question.id} q={question} lang={lang} onSubmit={onSubmit} onOther={onOther} />;
  return null;
}
