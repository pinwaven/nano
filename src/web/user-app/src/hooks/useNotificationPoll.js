// The chat delivery contract, ported from pages/main/main.js:_startPolling/_poll/_beginChatWait
// (3945–4083). Two channels, both required (CLAUDE.md §22):
//   1. GET /notifications — a DESTRUCTIVE read (rows flip to 'sent' as they are returned).
//   2. GET /chat-history?since_id — the durable backstop; ai rows only while a turn is pending.
// Everything mutable lives in refs so a React StrictMode double-mount cannot double-render a
// row: the first tick's notification read consumes the rows, the second returns nothing.
import { useCallback, useEffect, useRef } from 'react';
import { api, q } from '../api.js';
import { AI_ECHO_TYPES, AG_NOTIFICATION_TYPES, CHAT_WAIT_ASYNC_MS } from '../config.js';

// main.js:_aiKey — whitespace-collapsed first 160 chars.
export function aiKey(content) {
  return String(content || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export function useNotificationPoll({ userId, enabled, onStatus, onAiRows, onHistoryRows, onQuestionnaireReady, onProgramDay, onTimeout, onTyping }) {
  const seenIds = useRef(new Set());
  const rendered = useRef(new Set());
  const renderedOrder = useRef([]);
  const lastMsgId = useRef(null);
  const waitStartedAt = useRef(null);
  const waitBudget = useRef(CHAT_WAIT_ASYNC_MS);
  const inFlight = useRef(false);
  const cb = useRef({});
  cb.current = { onStatus, onAiRows, onHistoryRows, onQuestionnaireReady, onProgramDay, onTimeout, onTyping };

  const markRenderedAi = useCallback(content => {
    const k = aiKey(content); if (!k) return;
    if (!rendered.current.has(k)) {
      rendered.current.add(k); renderedOrder.current.push(k);
      if (renderedOrder.current.length > 200) rendered.current.delete(renderedOrder.current.shift());
    }
  }, []);
  const isRenderedAi = useCallback(content => rendered.current.has(aiKey(content)), []);
  const setLastMsgId = useCallback(id => { lastMsgId.current = id; }, []);
  const beginChatWait = useCallback(budgetMs => { waitStartedAt.current = Date.now(); waitBudget.current = budgetMs || CHAT_WAIT_ASYNC_MS; cb.current.onTyping?.(true); }, []);
  const endChatWait = useCallback(() => { waitStartedAt.current = null; cb.current.onTyping?.(false); cb.current.onStatus?.(''); }, []);

  const poll = useCallback(async () => {
    if (!userId || inFlight.current) return;
    inFlight.current = true;
    try {
      try {
        const res = await api.get(`/notifications?openid=${q(userId)}`);
        const unseen = (res?.notifications || []).filter(n => !seenIds.current.has(n.id));
        if (unseen.length) {
          unseen.forEach(n => seenIds.current.add(n.id));
          const statusRows = unseen.filter(n => n.notification_type === 'chat_status');
          const realRows = unseen.filter(n => n.notification_type !== 'chat_status');
          if (statusRows.length) cb.current.onStatus?.(statusRows[statusRows.length - 1].content);
          if (realRows.length) {
            const hasQ = realRows.some(n => n.notification_type === 'questionnaire_ready');
            const bubbleRows = realRows.filter(n => n.notification_type !== 'questionnaire_ready'
              && !(AI_ECHO_TYPES.has(n.notification_type) && isRenderedAi(n.content)));
            bubbleRows.forEach(n => { if (AI_ECHO_TYPES.has(n.notification_type)) markRenderedAi(n.content); });
            waitStartedAt.current = null;
            cb.current.onAiRows?.(bubbleRows.map(n => ({
              id: `n-${n.id}`, role: 'ai', content: n.content, notificationType: n.notification_type,
              source: AG_NOTIFICATION_TYPES.has(n.notification_type) ? 'viva_ag' : null,
            })));
            cb.current.onTyping?.(false); cb.current.onStatus?.('');
            if (hasQ) cb.current.onQuestionnaireReady?.();
            if (realRows.some(n => typeof n.notification_type === 'string' && n.notification_type.indexOf('program_day') === 0)) cb.current.onProgramDay?.();
          }
        }
      } catch { /* one lost tick is fine */ }

      if (lastMsgId.current !== null) {
        try {
          const roles = waitStartedAt.current ? 'coach,ai' : 'coach';
          const res = await api.get(`/chat-history?openid=${q(userId)}&since_id=${lastMsgId.current}&roles=${roles}`);
          const rows = res?.messages || [];
          if (rows.length) {
            lastMsgId.current = Math.max(...rows.map(m => m.id));
            const fresh = rows.filter(m => m.role === 'coach' || !isRenderedAi(m.content));
            const gotAi = fresh.some(m => m.role !== 'coach');
            fresh.forEach(m => { if (m.role !== 'coach') markRenderedAi(m.content); });
            if (fresh.length) cb.current.onHistoryRows?.(fresh, gotAi);
            if (gotAi) { waitStartedAt.current = null; cb.current.onTyping?.(false); cb.current.onStatus?.(''); }
          }
        } catch { /* ignore */ }
      }

      if (waitStartedAt.current && Date.now() - waitStartedAt.current > waitBudget.current) {
        waitStartedAt.current = null;
        cb.current.onTyping?.(false); cb.current.onStatus?.('');
        cb.current.onTimeout?.();
      }
    } finally {
      inFlight.current = false;
    }
  }, [userId, isRenderedAi, markRenderedAi]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    let timer = null;
    const start = () => { if (!timer) { poll(); timer = setInterval(poll, 3000); } };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [enabled, userId, poll]);

  return { pollNow: poll, beginChatWait, endChatWait, markRenderedAi, isRenderedAi, setLastMsgId, isWaiting: () => !!waitStartedAt.current };
}
