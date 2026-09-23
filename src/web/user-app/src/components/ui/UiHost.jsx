import { useEffect, useRef, useState } from 'react';
import { _bindHost } from './ui.js';
import { useLang } from '../../i18n/index.js';

export default function UiHost() {
  const { t } = useLang();
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [modalInput, setModalInput] = useState('');
  const [sheet, setSheet] = useState(null);
  const [scan, setScan] = useState(null);
  const [loading, setLoading] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    _bindHost({
      toast: ({ title, duration }) => {
        clearTimeout(toastTimer.current);
        setToast(title);
        toastTimer.current = setTimeout(() => setToast(null), duration);
      },
      confirm: m => { setModalInput(m.editable ? m.content || '' : ''); setModal(m); },
      actionSheet: s => setSheet(s),
      scan: s => setScan(s),
      loading: title => setLoading(title),
    });
    return () => _bindHost(null);
  }, []);

  const closeModal = confirm => { modal?.resolve({ confirm, content: modalInput }); setModal(null); };
  const closeSheet = idx => { if (idx == null) sheet?.reject(new Error('cancel')); else sheet?.resolve({ tapIndex: idx }); setSheet(null); };

  return (
    <>
      {toast && <div className="ui-toast">{toast}</div>}
      {loading && <div className="ui-mask ui-loading"><div className="ui-spinner" /><div>{loading}</div></div>}
      {modal && (
        <div className="ui-mask" onClick={() => modal.showCancel && closeModal(false)}>
          <div className="ui-modal" onClick={e => e.stopPropagation()}>
            {modal.title && <div className="ui-modal-title">{modal.title}</div>}
            {!modal.editable && modal.content && <div className="ui-modal-body">{modal.content}</div>}
            {modal.editable && <input className="ui-input" autoFocus value={modalInput} placeholder={modal.placeholderText} onChange={e => setModalInput(e.target.value)} />}
            <div className="ui-modal-actions">
              {modal.showCancel && <button className="ui-btn ui-btn-ghost" onClick={() => closeModal(false)}>{modal.cancelText || t.cancel || '取消'}</button>}
              <button className="ui-btn ui-btn-primary" onClick={() => closeModal(true)}>{modal.confirmText || t.confirm || '确定'}</button>
            </div>
          </div>
        </div>
      )}
      {sheet && (
        <div className="ui-mask ui-mask-bottom" onClick={() => closeSheet(null)}>
          <div className="ui-sheet" onClick={e => e.stopPropagation()}>
            {sheet.title && <div className="ui-sheet-title">{sheet.title}</div>}
            {sheet.itemList.map((it, i) => (
              <button key={i} className="ui-sheet-item" onClick={() => closeSheet(i)}>{it}</button>
            ))}
            <button className="ui-sheet-item ui-sheet-cancel" onClick={() => closeSheet(null)}>{t.cancel || '取消'}</button>
          </div>
        </div>
      )}
      {scan && <Scanner title={scan.title} onDone={v => { scan.resolve(v); setScan(null); }} onCancel={() => { scan.reject(new Error('cancel')); setScan(null); }} />}
    </>
  );
}

// wx.scanCode stand-in. The miniapp scans a Kino chip QR or a Dots box QR and hands the raw
// string to the server; here the camera path uses BarcodeDetector when the browser has it
// (Chrome/Edge/Android), and the manual field covers everything else.
function Scanner({ title, onDone, onCancel }) {
  const { t } = useLang();
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const [mode, setMode] = useState(supported ? 'camera' : 'manual');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const videoRef = useRef(null);

  useEffect(() => {
    if (mode !== 'camera') return undefined;
    let stream, raf, stopped = false;
    let detector;
    try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { setMode('manual'); return undefined; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(s => {
      if (stopped) { s.getTracks().forEach(tr => tr.stop()); return; }
      stream = s;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = s;
      v.play().catch(() => {});
      const tick = async () => {
        if (stopped) return;
        try {
          if (v.readyState >= 2) {
            const codes = await detector.detect(v);
            if (codes.length && codes[0].rawValue) { onDone(codes[0].rawValue); return; }
          }
        } catch { /* keep scanning */ }
        raf = setTimeout(tick, 250);
      };
      tick();
    }).catch(() => { setErr(''); setMode('manual'); });
    return () => { stopped = true; clearTimeout(raf); stream?.getTracks().forEach(tr => tr.stop()); };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ui-mask" onClick={onCancel}>
      <div className="ui-modal ui-scanner" onClick={e => e.stopPropagation()}>
        {title && <div className="ui-modal-title">{title}</div>}
        {mode === 'camera' ? (
          <>
            <video ref={videoRef} className="ui-scanner-video" muted playsInline />
            <div className="ui-modal-body">{t.scanCameraHint}</div>
            <div className="ui-modal-actions">
              <button className="ui-btn ui-btn-ghost" onClick={onCancel}>{t.scanCancel}</button>
              <button className="ui-btn ui-btn-ghost" onClick={() => setMode('manual')}>{t.scanManualHint}</button>
            </div>
          </>
        ) : (
          <>
            <input className="ui-input" autoFocus value={value} placeholder={t.scanManualHint}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && value.trim()) onDone(value.trim()); }} />
            {err && <div className="ui-error">{err}</div>}
            <div className="ui-modal-actions">
              <button className="ui-btn ui-btn-ghost" onClick={onCancel}>{t.scanCancel}</button>
              {supported && <button className="ui-btn ui-btn-ghost" onClick={() => setMode('camera')}>{t.scanUseCamera}</button>}
              <button className="ui-btn ui-btn-primary" disabled={!value.trim()} onClick={() => onDone(value.trim())}>{t.scanConfirm}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
