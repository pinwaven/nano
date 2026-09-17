// Press-and-hold voice input. The miniapp uses the WechatSI plugin; the web uses the Web Speech
// API where the browser has it and renders nothing otherwise. Merges the result into the input
// the way main.js:_onMicStop does (holds under 500 ms are ignored as accidental taps).
import { useRef, useState } from 'react';
import { useLang } from '../i18n/index.js';
import { asset } from '../assets.js';

const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const voiceSupported = !!SR;

export default function VoiceInput({ disabled, onResult }) {
  const { lang, t } = useLang();
  const [recording, setRecording] = useState(false);
  const rec = useRef(null);
  const startTs = useRef(0);
  const text = useRef('');
  if (!SR) return null;

  const start = e => {
    e.preventDefault();
    if (disabled || recording) return;
    try {
      const r = new SR();
      r.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
      r.continuous = true; r.interimResults = true;
      text.current = '';
      r.onresult = ev => { let s = ''; for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript; text.current = s; };
      r.onend = () => {
        setRecording(false);
        const held = Date.now() - startTs.current;
        const result = text.current.trim();
        if (held >= 500 && result) onResult(result);
      };
      r.onerror = () => setRecording(false);
      rec.current = r; startTs.current = Date.now();
      r.start(); setRecording(true);
    } catch { setRecording(false); }
  };
  const stop = () => { try { rec.current?.stop(); } catch { /* ignore */ } };

  return (
    <>
      {recording && <div className="mic-recording-banner"><span className="mic-recording-dot" /><span className="mic-recording-text">{t.micRecording}</span></div>}
      <div className={`mic-btn${recording ? ' mic-btn-active' : ''}${disabled ? ' mic-btn-disabled' : ''}`}
        onMouseDown={start} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchEnd={stop} onTouchCancel={stop}>
        <img className="mic-icon" src={asset('/assets/icons/mic.svg')} alt="" draggable="false" />
      </div>
    </>
  );
}
