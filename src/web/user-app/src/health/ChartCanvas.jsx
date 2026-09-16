// A <canvas> that runs one of charts.js's draw functions and, when the function returns a
// layout, hosts the drag-to-inspect crosshair (_onChartTouch / _onChartTouchEnd).
import { useEffect, useRef } from 'react';

export default function ChartCanvas({ draw, deps = [], width, height = 200, className = '' }) {
  const ref = useRef(null);
  const layout = useRef(null);
  const lastIdx = useRef(null);

  const render = idx => { if (ref.current) layout.current = draw(ref.current, idx); };
  useEffect(() => { lastIdx.current = null; render(null); }, [width, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = e => {
    const l = layout.current; if (!l) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const x = Math.max(l.pL, Math.min(l.pL + l.plotW, cx));
    const idx = Math.round((x - l.pL) / l.plotW * Math.max(l.len - 1, 1));
    if (lastIdx.current === idx) return;
    lastIdx.current = idx; render(idx);
  };
  const onEnd = () => { if (lastIdx.current == null) return; lastIdx.current = null; render(null); };

  return (
    <canvas ref={ref} className={className} style={{ width, height, touchAction: 'none' }}
      onPointerDown={onMove} onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') onMove(e); }} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onEnd}
      onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={onEnd} />
  );
}
