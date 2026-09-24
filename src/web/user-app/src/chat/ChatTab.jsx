// The chat tab — pages/main/main.wxml's CHAT block on top of useChat.
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext.jsx';
import { useChat } from './useChat.js';
import SegmentRenderer from './SegmentRenderer.jsx';
import Questionnaire from './Questionnaire.jsx';
import Toolbox from './Toolbox.jsx';
import FocusSheet from './FocusSheet.jsx';
import VoiceInput from './VoiceInput.jsx';

export default function ChatTab({ onGuestTap, context = null, footerActions = null }) {
  const app = useApp();
  const { t, isAeviva } = app;
  const coachMode = !!context?.coachMode;
  const isGuest = coachMode ? false : app.isGuest;
  const chat = useChat(app, context || {});
  const { messages, typing, statusText, obStep, ob, hasMoreHistory, historyLoading, kinoScanPending, toolboxOpen, isSending } = chat;
  const [input, setInput] = useState('');
  const listRef = useRef(null);
  const endRef = useRef(null);
  const taRef = useRef(null);

  // Scroll to the newest message after every append / image load (§23: generous bottom padding
  // in .chat-inner is what keeps a short last message clear of the input bar).
  useEffect(() => {
    const el = endRef.current; if (!el) return;
    const go = () => el.scrollIntoView({ block: 'end' });
    go(); const a = setTimeout(go, 150); const b = setTimeout(go, 500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [chat.scrollTick, messages.length, typing, statusText]);

  // Prepended history: keep the previously-first message in place.
  useEffect(() => {
    if (!chat.scrollAnchor) return;
    const node = listRef.current?.querySelector(`[data-mid="${CSS.escape(String(chat.scrollAnchor))}"]`);
    node?.scrollIntoView({ block: 'start' });
    chat.setScrollAnchor(null);
  }, [chat.scrollAnchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (isGuest) { onGuestTap?.(); return; }
    if (await chat.handleSend(input)) setInput('');
  };
  const onKey = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  const autoGrow = () => { const ta = taRef.current; if (!ta) return; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; };
  useEffect(autoGrow, [input]);

  const segCtx = {
    isAeviva: isAeviva && !coachMode,
    onToggleTier: chat.toggleFormulaTier, onFormulaSubmit: chat.handleFormulaSubmit, onFormulaOrder: chat.handleFormulaOrder,
    onProductTap: chat.handleProductTap, onPlayLesson: chat.playLesson, onLessonEnded: chat.lessonEnded, onCheckinStart: chat.startCheckin,
  };
  const inputVisible = obStep === 'done' || isGuest;

  return (
    <div className={`chat-tab${coachMode ? ' coach-client-chat' : ''}`}>
      <div className="chat-messages chat-scroll" ref={listRef}>
        <div className="chat-inner">
          {hasMoreHistory ? (
            <div className={`chat-history-load${historyLoading ? ' chat-history-loading' : ''}`} onClick={chat.loadMoreHistory}>
              {historyLoading ? <div className="chat-history-spinner-row"><div className="chat-history-spinner" /><span className="chat-history-text">{t.chatHistoryLoading}</span></div>
                : <span className="chat-history-text">{t.chatHistoryLoadMore}</span>}
            </div>
          ) : messages.length > 0 ? (
            <div className="chat-history-start"><span className="chat-history-start-text">{t.chatHistoryStart}</span></div>
          ) : null}

          {messages.map((m, mi) => (
            <div key={m.id} data-mid={m.id}>
              {m.sep && <div className="msg-daysep"><span className="msg-daysep-text">{m.sep}</span></div>}
              <div className={`msg-row ${m.role === 'user' ? 'msg-row-user' : 'msg-row-ai'}`}>
                {m.role === 'action' ? (
                  <div className="msg-action-card" onClick={() => chat.handleMsgAction(m.action)}>
                    <span className="msg-action-label">{m.label}</span><span className="msg-action-arrow">›</span>
                  </div>
                ) : m.role === 'coach' ? (
                  <div className="message-bubble message-coach"><span className="msg-coach-label">Coach</span><span className="msg-text">{m.content}</span></div>
                ) : (
                  <div className={`message-bubble ${m.role === 'user' ? 'message-user' : 'message-ai'}${m.imageOnly ? ' msg-bubble-image' : ''}`}>
                    {m.imageUrl && <img className={`msg-image${m.imageOnly ? '' : ' msg-image-inset'}`} src={m.imageUrl} alt="" onLoad={() => { if (mi === messages.length - 1) endRef.current?.scrollIntoView({ block: 'end' }); }} />}
                    {m.role === 'user' && m.content && <span className="msg-text">{m.content}</span>}
                    {m.source === 'viva_ag' && <span className="msg-ag-label">Viva AG</span>}
                    {m.role !== 'user' && <SegmentRenderer msg={m} mi={mi} ctx={segCtx} />}
                  </div>
                )}
              </div>
            </div>
          ))}

          {typing && (
            <div className="msg-row msg-row-ai">
              <div className="message-bubble message-ai typing-indicator">
                <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
                {statusText && <span className="typing-status-text">{statusText}</span>}
              </div>
            </div>
          )}
          <div style={{ height: 8 }} ref={endRef} />
        </div>
      </div>

      {!isGuest && !coachMode && <Questionnaire question={ob.question} typing={typing} onSubmit={chat.saveAnswer} onOther={chat.saveOtherText} />}

      {kinoScanPending && (
        <div className="ob-bar kino-scan-bar">
          <div className="kino-scan-btn" onClick={chat.runTestChip}><span className="kino-scan-icon">⬡</span><span className="kino-scan-label">{t.kinoScanBtn}</span></div>
          <div className="kino-scan-close" onClick={() => chat.setKinoScanPending(false)}>✕</div>
        </div>
      )}

      {inputVisible && <div className="ai-disclaimer"><span className="ai-disclaimer-text">{t.aiDisclaimer}</span></div>}

      {inputVisible && footerActions}

      {inputVisible && (
        <div className="input-container">
          {toolboxOpen && <Toolbox disabled={typing} onAction={chat.handleToolAction} />}
          <div className="input-area">
            <div className={`plus-btn${toolboxOpen ? ' plus-btn-open' : ''}`} onClick={() => { if (isGuest) { onGuestTap?.(); return; } if (typing && !toolboxOpen) return; chat.setToolboxOpen(!toolboxOpen); }}>
              <span className="plus-icon">+</span>
            </div>
            <textarea ref={taRef} className="chat-textarea" placeholder={context?.placeholder || t.inputPh} value={input} maxLength={500} rows={1}
              onChange={e => setInput(e.target.value)} onKeyDown={onKey} />
            {!input && !isGuest ? (
              <VoiceInput disabled={typing || isSending} onResult={r => setInput(cur => (cur ? `${cur}${/\s$/.test(cur) ? '' : ' '}${r}` : r))} />
            ) : !input && isGuest ? (
              <div className="mic-btn guest-signup-btn" onClick={onGuestTap}><span className="guest-signup-btn-text">{t.guestSignupBtn}</span></div>
            ) : (
              <div className={`send-btn${input ? ' send-active' : ''}`} onClick={send}><span className="send-icon">↑</span></div>
            )}
          </div>
        </div>
      )}

      <FocusSheet sheet={chat.focusSheet} onGo={chat.focusGo} onSkip={chat.focusSkip} onChoose={chat.focusChoose} onClose={chat.focusClose} />
    </div>
  );
}
