import React, { useEffect, useRef } from 'react';
import HealthTab from '../health/HealthTab.jsx';
import Toolbox from '../chat/Toolbox.jsx';

export function style(css) {
  return Object.fromEntries(String(css || '').split(';').filter(v => v.includes(':')).map(v => {
    const i = v.indexOf(':');
    return [v.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.slice(i + 1).trim().replace(/(-?\d+(?:\.\d+)?)rpx/g, (_, n) => `${n / 2}px`)];
  }));
}
export function Scroll({ vertical, horizontal, scrollId, children, style: css, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (scrollId && el) {
      const target = el.querySelector(`[id="${CSS.escape(scrollId)}"]`);
      if (target) el.scrollTop = target.offsetTop + target.offsetHeight - el.clientHeight;
    }
  }, [scrollId, children]);
  return <div {...props} ref={ref} style={{ overflowY: vertical ? 'auto' : undefined, overflowX: horizontal ? 'auto' : undefined, ...css }}>{children}</div>;
}
// Keep the miniapp's visible picker row. A native control overlays it for touch and keyboard.
export function Picker({ mode = 'selector', range = [], value, valueFromRange, onChange, children, end, max }) {
  const emit = e => onChange({ detail: { value: valueFromRange ? range[Number(e.target.value)] : e.target.value } });
  const text = nodes => React.Children.toArray(nodes).map(n => React.isValidElement(n) ? text(n.props.children) : String(n)).join(' ');
  const label = text(children);
  return <div className="coach-picker">
    {children}
    {mode === 'selector' ? <select aria-label={label || 'Select'} value={valueFromRange ? range.indexOf(value) : value ?? ''} onChange={emit}>
      <option value="" disabled />
      {range.map((option, i) => <option key={i} value={i}>{option}</option>)}
    </select> : <input aria-label={label || (mode === 'date' ? 'Date' : 'Time')} type={mode} value={value || ''} max={max || end} onChange={emit} />}
  </div>;
}
export function ClientHealth({ user, coachId }) {
  return <HealthTab visible client={user} coachId={coachId} mode="coach" />;
}
export function CoachToolbox({ tools, disabled, onAction }) {
  return <Toolbox tools={tools} disabled={disabled} onAction={onAction} />;
}

// Mobile long-press, desktop context menu, and Shift+F10 open the same CRM stage picker.
export function PipelineCard({ onClick, onKeyDown, onContextMenu, ...props }) {
  const timer = useRef(null), held = useRef(false), start = useRef(null);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => clear, []);
  return <div {...props} onContextMenu={onContextMenu}
    onPointerDown={e => { held.current = false; start.current = [e.clientX,e.clientY]; if (e.pointerType === 'touch') timer.current = setTimeout(() => { held.current = true; onContextMenu(e); }, 600); }}
    onPointerMove={e => { if (start.current && Math.hypot(e.clientX-start.current[0],e.clientY-start.current[1]) > 10) clear(); }}
    onPointerUp={clear} onPointerCancel={clear}
    onClick={e => { if (!held.current) onClick?.(e); held.current = false; }}
    onKeyDown={e => { if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) onContextMenu(e); else onKeyDown?.(e); }} />;
}
