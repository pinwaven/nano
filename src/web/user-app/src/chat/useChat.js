// The chat tab's state machine — a port of pages/main/main.js's chat half (_initChat, the
// questionnaire engine, _sendMessage, the toolbox tools, the 打卡 program cards, the :::formula
// CTAs, the lab-report consent chips) on top of useNotificationPoll (the two-channel delivery
// contract). Messages live in a ref and are mirrored into state on every change so segment
// objects can be patched in place exactly as the miniapp does with setData paths.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q, putToOss } from '../api.js';
import { CHAT_WAIT_ASYNC_MS, CHAT_WAIT_SYNC_MS } from '../config.js';
import { useNotificationPoll } from '../hooks/useNotificationPoll.js';
import { makeMsg, fromHistoryRow, applySeparators, attachSparks, attachProgramState, attachFormulaCta, formulaCtaFor, buildSeriesIndex, uid } from './messages.js';
import { msgSeparator } from '../lib/format.js';
import { useDotsData, loadDots, getDotsState, invalidateDots, pkgTitle } from '../plans/dotsStore.js';
import { ui } from '../components/ui/ui.js';
import { openGcnStoreGated } from '../gcn.js';
import { submitFormulation as submitFormulationShared, isFormulaSubmitting } from '../plans/formulation.js';
import { chatSendSpec, filterPendingCoachEchoes } from './chat-context.js';

const CANCELLED = Symbol('picker-cancelled');

export function useChat(app, options = {}) {
  const { targetUser = null, coachMode = false } = options;
  const { user, lang, t, isAeviva, sandboxMode, updateUser, saveUser, emit, on } = app;
  const chatUser = targetUser || user;
  const userId = chatUser?.user_id;
  const isGuest = coachMode ? false : app.isGuest;

  const msgsRef = useRef([]);
  const [messages, setMessagesState] = useState([]);
  const commit = useCallback(() => setMessagesState([...msgsRef.current]), []);
  const setMessages = useCallback(next => { msgsRef.current = next; commit(); }, [commit]);

  const [typing, setTyping] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [obStep, setObStep] = useState(null); // null | question key | 'done'
  const [ob, setOb] = useState({ question: null, questions: [], assignmentId: null, qIndex: 0, type: null });
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [kinoScanPending, setKinoScanPending] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [focusSheet, setFocusSheet] = useState(null); // { plans, opts } | null
  const [scrollAnchor, setScrollAnchor] = useState(null);
  const [scrollTick, setScrollTick] = useState(0);

  const obRef = useRef(ob); obRef.current = ob;
  const obStepRef = useRef(obStep); obStepRef.current = obStep;
  const typingRef = useRef(typing); typingRef.current = typing;
  const oldestDbId = useRef(0);
  const bioSeries = useRef(null);
  const programState = useRef({ lessons: {}, days: {} });
  const pendingHealthReport = useRef(null);
  const pendingCoachEchoes = useRef([]);
  const dots = useDotsData();
  const dotsRef = useRef(dots); dotsRef.current = dots;

  const scrollBottom = useCallback(() => setScrollTick(n => n + 1), []);

  // ── de-dup + poll ────────────────────────────────────────────────────────
  const appendMsgs = useCallback(newMsgs => {
    const cur = msgsRef.current;
    const run = applySeparators(newMsgs, cur[cur.length - 1], lang);
    setMessages([...cur, ...run]);
    scrollBottom();
  }, [lang, setMessages, scrollBottom]);

  const ctaCtx = useCallback(() => ({ t, codes: dotsRef.current.codes, packages: dotsRef.current.packages }), [t]);

  const decorate = useCallback(msg => {
    if (msg.segments) {
      attachSparks(msg.segments, bioSeries.current);
      if (!coachMode) attachFormulaCta(msg.segments, ctaCtx());
      attachProgramState(msg.segments, programState.current);
    }
    return msg;
  }, [coachMode, ctaCtx]);

  const coachHistoryPath = useCallback(({ sinceId, roles }) =>
    `/chat-history?openid=${q(userId)}&since_id=${q(sinceId)}&roles=${q(roles)}`, [userId]);
  const poll = useNotificationPoll({
    userId, enabled: obStep === 'done' && !isGuest,
    // Managed customers never log in, so their notification stream can provide full status
    // parity. A coach must never consume a regular user's destructive notification inbox.
    notificationsEnabled: !coachMode || chatUser?.account_type === 'managed',
    historyPath: coachMode ? coachHistoryPath : null,
    onTyping: setTyping,
    onStatus: setStatusText,
    onAiRows: rows => { if (rows.length) appendMsgs(rows.map(r => decorate(makeMsg(r)))); },
    onHistoryRows: rows => {
      const fresh = filterPendingCoachEchoes(rows, pendingCoachEchoes.current, coachMode);
      if (fresh.length) appendMsgs(fresh.map(m => decorate(fromHistoryRow(m, `c-${m.id}`))));
    },
    onQuestionnaireReady: () => checkForPendingQuestionnaireRef.current(),
    onProgramDay: () => refreshProgramStateRef.current(),
    onTimeout: () => addMsgRef.current('ai', t.chatTimedOut),
  });

  // ── message helpers ──────────────────────────────────────────────────────
  const addMsg = useCallback((role, rawContent, persist = false) => {
    const effectiveRole = coachMode && role === 'user' ? 'coach' : role;
    const msg = decorate(makeMsg({ id: uid(effectiveRole), role: effectiveRole, content: rawContent }));
    if (msg.role === 'ai') poll.markRenderedAi(rawContent);
    if (persist && effectiveRole === 'coach') {
      pendingCoachEchoes.current.push(String(rawContent || '').replace(/\s+/g, ' ').trim());
    }
    appendMsgs([msg]);
    if (persist && userId) api.post('/chat-messages', { openid: userId, role: effectiveRole, content: rawContent }).catch(() => {});
    return msg.id;
  }, [coachMode, decorate, appendMsgs, poll, userId]);
  const addMsgRef = useRef(addMsg); addMsgRef.current = addMsg;

  const addActionMsg = useCallback((action, label, persist = false) => {
    appendMsgs([makeMsg({ id: `action-${action}-${Date.now()}`, role: 'action', action, label })]);
    if (persist && userId) api.post('/chat-messages', { openid: userId, role: 'action', content: JSON.stringify({ action, label }) }).catch(() => {});
  }, [appendMsgs, userId]);

  const addImageMsg = useCallback(imageUrl => {
    const id = uid('user');
    appendMsgs([makeMsg({ id, role: 'user', content: '', imageUrl })]);
    return id;
  }, [appendMsgs]);
  const updateImageMsg = useCallback((id, imageUrl) => {
    setMessages(msgsRef.current.map(m => (m.id === id ? { ...m, imageUrl } : m)));
  }, [setMessages]);
  const removeHrActions = useCallback(() => {
    setMessages(msgsRef.current.filter(m => !(m.role === 'action' && typeof m.action === 'string' && m.action.indexOf('hr_') === 0)));
  }, [setMessages]);

  // ── programs (§42) ───────────────────────────────────────────────────────
  const refreshProgramState = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/programs/my?openid=${q(userId)}`);
      const state = { lessons: {}, days: {} };
      for (const e of (res?.enrollments || [])) {
        for (const d of (e.days || [])) {
          state.days[`${e.program_id}:${d.day_index}`] = { checkin_done: !!d.checkin_completed_at, lesson_done: !d.lesson_id || !!d.lesson_completed_at, completed: !!d.completed_at };
          if (d.lesson_id && d.lesson_completed_at) state.lessons[String(d.lesson_id)] = true;
        }
      }
      programState.current = state;
      let changed = false;
      for (const m of msgsRef.current) if (m.segments && attachProgramState(m.segments, state)) changed = true;
      if (changed) commit();
    } catch { /* ignore */ }
  }, [userId, commit]);
  const refreshProgramStateRef = useRef(refreshProgramState); refreshProgramStateRef.current = refreshProgramState;

  const playLesson = useCallback(async (mi, si) => {
    const seg = msgsRef.current[mi]?.segments?.[si];
    if (!userId || !seg || seg.t !== 'lesson' || seg.loading) return;
    for (const m of msgsRef.current) for (const sg of (m.segments || [])) if (sg && sg.t === 'lesson' && sg.url) sg.url = '';
    seg.loading = true; commit();
    try {
      const d = await api.get(`/programs/lesson-url?openid=${q(userId)}&lesson_id=${q(seg.lessonId)}`);
      if (!d?.success || !d.url) throw new Error(d?.error || 'no url');
      seg.url = d.url; seg.poster = d.poster_url || '';
    } catch {
      ui.toast(t.programLessonUnavailable);
    } finally { seg.loading = false; commit(); }
  }, [userId, commit, t]);

  const lessonEnded = useCallback(async lessonId => {
    if (!lessonId || !userId) return;
    try { await api.post('/academy/progress', { user_id: userId, lesson_id: Number(lessonId) }); } catch { /* silent */ }
    refreshProgramState();
  }, [userId, refreshProgramState]);

  const startCheckin = useCallback(async (programId, dayIndex) => {
    if (!userId || !programId || !dayIndex || typingRef.current || obStepRef.current !== 'done') return;
    try {
      const d = await api.post('/programs/day/start-checkin', { openid: userId, program_id: Number(programId), day_index: Number(dayIndex) });
      if (!d?.success) { ui.toast(d?.error || t.errServer); return; }
      if (d.done || d.sandbox) { refreshProgramState(); return; }
      await checkForPendingQuestionnaireRef.current();
    } catch { ui.toast(t.errServer); }
  }, [userId, t, refreshProgramState]);

  // ── questionnaire engine ─────────────────────────────────────────────────
  const getNestedPath = (obj, dotPath) => (!dotPath || !obj) ? undefined : dotPath.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj);
  const isQuestionAnswered = (qn, u, records, answeredIds) => {
    if (answeredIds.has(qn.id)) return true;
    const cc = qn.completion_check || {};
    if (cc.type === 'user_field') return !!(u[cc.field]);
    if (cc.type === 'bio_data_field') return (u.bio_data || {})[cc.field] !== undefined;
    if (cc.type === 'biomarker') return records.some(r => r.test_type === cc.test_type && getNestedPath(r.data, cc.data_path));
    return false;
  };

  const showQuestion = useCallback(qn => {
    addMsg('ai', lang === 'zh' ? qn.prompt_zh : qn.prompt_en);
    setOb(prev => ({ ...prev, question: qn }));
    setObStep(qn.key);
  }, [addMsg, lang]);

  const startQuestionnaire = useCallback((assignment, questions, firstIdx) => {
    if (assignment.type !== 'onboarding' && assignment.type !== 'program_day') addMsg('ai', t.questionnaireIntro, true);
    setOb({ question: null, questions, assignmentId: assignment.assignment_id, qIndex: firstIdx, type: assignment.type });
    if (assignment.status === 'pending') api.patch(`/questionnaire-assignments/${assignment.assignment_id}`, { status: 'in_progress' }).catch(() => {});
    showQuestion(questions[firstIdx]);
  }, [addMsg, showQuestion, t]);

  const findAndStart = useCallback(async () => {
    const u = chatUser;
    const [qRes, bRes] = await Promise.all([
      api.get(`/pending-questionnaires?openid=${q(u.user_id)}`),
      api.get(`/biomarkers?openid=${q(u.user_id)}`),
    ]);
    const pending = qRes?.assignments || [];
    const records = bRes?.records || [];
    for (const assignment of pending) {
      const answeredIds = new Set((assignment.responses || []).map(r => r.question_id));
      const questions = assignment.questions || [];
      const firstIdx = questions.findIndex(qn => !isQuestionAnswered(qn, u, records, answeredIds));
      if (firstIdx >= 0) { startQuestionnaire(assignment, questions, firstIdx); return true; }
    }
    return false;
  }, [chatUser, startQuestionnaire]);

  const onAllDone = useCallback((silent = false) => {
    if (!silent) addMsg('ai', t.questionnaireThanks, true);
    setObStep('done');
  }, [addMsg, t]);

  // Idempotent but UNGUARDED (re-posts the intro); every caller checks obStep === 'done' first.
  const checkForPendingQuestionnaire = useCallback(async () => {
    if (!app.user) return;
    try { await findAndStart(); } catch { /* ignore */ }
  }, [app.user, findAndStart]);
  const checkForPendingQuestionnaireRef = useRef(checkForPendingQuestionnaire); checkForPendingQuestionnaireRef.current = checkForPendingQuestionnaire;

  const advanceOnboarding = useCallback(async () => {
    const type = obRef.current.type;
    try {
      const u = app.user;
      const [qRes, bRes] = await Promise.all([api.get(`/pending-questionnaires?openid=${q(u.user_id)}`), api.get(`/biomarkers?openid=${q(u.user_id)}`)]);
      const records = bRes?.records || [];
      for (const assignment of (qRes?.assignments || [])) {
        const answeredIds = new Set((assignment.responses || []).map(r => r.question_id));
        const questions = assignment.questions || [];
        const firstIdx = questions.findIndex(qn => !isQuestionAnswered(qn, u, records, answeredIds));
        if (firstIdx >= 0) {
          if (type === 'custom') addMsg('ai', t.questionnaireThanks, true);
          startQuestionnaire(assignment, questions, firstIdx);
          return;
        }
      }
    } catch { /* ignore */ }
    const isProgramDay = type === 'program_day';
    onAllDone(isProgramDay);
    if (isProgramDay) refreshProgramState();
  }, [app.user, addMsg, t, startQuestionnaire, onAllDone, refreshProgramState]);

  const saveAnswer = useCallback(async (displayText, answerValue) => {
    const { question, assignmentId, qIndex, questions } = obRef.current;
    if (!question || !assignmentId) return;
    addMsg('user', displayText);
    setTyping(true);
    try {
      const res = await api.post('/questionnaire-responses', { assignment_id: assignmentId, question_id: question.id, answer: answerValue, answer_display: displayText });
      if (question.save_target === 'user_field' && question.save_field) updateUser({ [question.save_field]: answerValue });
      else if (question.save_target === 'bio_data_field' && question.save_field) updateUser({ bio_data: { ...(app.user.bio_data || {}), [question.save_field]: answerValue } });
      if (res?.completed) {
        setOb(prev => ({ ...prev, question: null })); setObStep(null); setTyping(false);
        await advanceOnboarding();
      } else {
        const nextIdx = questions.findIndex((_, i) => i > qIndex);
        if (nextIdx >= 0) { setOb(prev => ({ ...prev, qIndex: nextIdx })); setTyping(false); showQuestion(questions[nextIdx]); }
        else { setOb(prev => ({ ...prev, question: null })); setObStep(null); setTyping(false); await advanceOnboarding(); }
      }
    } catch {
      addMsg('ai', t.errServer);
      setTyping(false);
    }
  }, [addMsg, updateUser, app.user, advanceOnboarding, showQuestion, t]);

  // Free text on a multi_select "other" — persisted to bio_data separately (main.js:4210).
  const saveOtherText = useCallback((otherKey, text) => {
    if (!otherKey || !text) return;
    saveUser({ bio_data: { [otherKey]: text } }).catch(() => {});
  }, [saveUser]);

  // ── init ─────────────────────────────────────────────────────────────────
  const setBioSeries = useCallback(records => {
    try { bioSeries.current = buildSeriesIndex(records); } catch { return; }
    let changed = false;
    for (const m of msgsRef.current) if (attachSparks(m.segments, bioSeries.current)) changed = true;
    if (changed) commit();
  }, [commit]);

  const initChat = useCallback(async () => {
    const u = chatUser;
    if (!u) return;
    if (u.guest) { setMessages([makeMsg({ id: 'init', role: 'ai', content: t.initMsg })]); setObStep(null); return; }
    let historyLoaded = false;
    try {
      const res = await api.get(`/chat-history?openid=${q(u.user_id)}`);
      const history = res?.messages || [];
      if (history.length > 0) {
        const msgs = applySeparators(history.map((m, i) => decorate(fromHistoryRow(m, `h-${i}`))), null, lang);
        const ids = history.map(m => m.id).filter(id => typeof id === 'number');
        poll.setLastMsgId(ids.length ? Math.max(...ids) : 0);
        oldestDbId.current = ids.length ? Math.min(...ids) : 0;
        history.forEach(m => { if (m.role === 'ai' || m.role === 'assistant') poll.markRenderedAi(m.content); });
        setMessages(msgs);
        setHasMoreHistory(res?.has_more ?? false);
        scrollBottom();
        historyLoaded = true;
        refreshProgramState();
      } else {
        poll.setLastMsgId(0);
      }
    } catch { /* ignore */ }
    if (!historyLoaded) setMessages([makeMsg({ id: 'init', role: 'ai', content: t.initMsg })]);
    if (!coachMode && !u.phone_verified && !u.email_verified) {
      addMsg('ai', t.verifyPhonePrompt);
      addActionMsg('verify_phone', t.verifyPhoneCta);
    }
    if (coachMode) {
      try {
        const bRes = await api.get(`/biomarkers?openid=${q(u.user_id)}`);
        setBioSeries(bRes?.records || []);
      } catch { /* rich metric cards still render without sparklines */ }
      onAllDone(true);
      return;
    }
    let started = false;
    try {
      const [qRes, bRes] = await Promise.all([api.get(`/pending-questionnaires?openid=${q(u.user_id)}`), api.get(`/biomarkers?openid=${q(u.user_id)}`)]);
      const pending = qRes?.assignments || [];
      const records = bRes?.records || [];
      setBioSeries(records);
      for (const assignment of pending) {
        const answeredIds = new Set((assignment.responses || []).map(r => r.question_id));
        const questions = assignment.questions || [];
        const firstIdx = questions.findIndex(qn => !isQuestionAnswered(qn, u, records, answeredIds));
        if (firstIdx >= 0) { startQuestionnaire(assignment, questions, firstIdx); started = true; break; }
      }
    } catch { /* ignore */ }
    if (!started) onAllDone(true);
  }, [chatUser, coachMode, t, lang, decorate, poll, setMessages, scrollBottom, refreshProgramState, addMsg, addActionMsg, setBioSeries, startQuestionnaire, onAllDone]);

  useEffect(() => {
    msgsRef.current = []; setMessagesState([]); setObStep(null); setTyping(false); setStatusText('');
    initChat();
    if (userId && !isGuest && !coachMode) loadDots(chatUser, lang, t);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-resolve every formula CTA when the codes/packages land (main.js:_refreshFormulaCtas).
  useEffect(() => {
    let touched = false;
    for (const m of msgsRef.current) {
      if (!m.segments || !m.segments.some(sg => sg && sg.t === 'formula')) continue;
      attachFormulaCta(m.segments, ctaCtx()); touched = true;
    }
    if (touched) commit();
  }, [dots.codes, dots.packages, ctaCtx, commit]);

  // Other tabs ask the chat to start a tool / re-check questionnaires (AG panel, Dots card).
  useEffect(() => {
    if (coachMode) return undefined;
    return on('chat:checkQuestionnaire', () => { if (obStepRef.current === 'done') checkForPendingQuestionnaireRef.current(); });
  }, [on, coachMode]);

  // ── load earlier ─────────────────────────────────────────────────────────
  const loadMoreHistory = useCallback(async () => {
    if (historyLoading || !hasMoreHistory || !userId || !oldestDbId.current) return;
    setHistoryLoading(true);
    try {
      const res = await api.get(`/chat-history?openid=${q(userId)}&before_id=${oldestDbId.current}`);
      const history = res?.messages || [];
      if (history.length > 0) {
        const newMsgs = applySeparators(history.map(m => decorate(fromHistoryRow(m, `old-${m.id}`))), null, lang);
        const existing = [...msgsRef.current];
        if (existing.length && newMsgs.length) existing[0] = { ...existing[0], sep: msgSeparator(newMsgs[newMsgs.length - 1].ts, existing[0].ts, lang) };
        const ids = history.map(m => m.id).filter(id => typeof id === 'number');
        oldestDbId.current = ids.length ? Math.min(...ids) : oldestDbId.current;
        setScrollAnchor(existing[0]?.id || null);
        setMessages([...newMsgs, ...existing]);
        setHasMoreHistory(res?.has_more ?? false);
      } else setHasMoreHistory(false);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  }, [historyLoading, hasMoreHistory, userId, decorate, lang, setMessages]);

  // ── send ─────────────────────────────────────────────────────────────────
  const onAsyncStart = useCallback(() => { poll.beginChatWait(CHAT_WAIT_ASYNC_MS); setTyping(true); setStatusText(t.chatThinking); }, [poll, t]);

  const sendMessage = useCallback(async text => {
    if (!userId) return;
    if (coachMode) pendingCoachEchoes.current.push(text.replace(/\s+/g, ' ').trim());
    addMsg(coachMode ? 'coach' : 'user', text);
    setTyping(true); setStatusText(''); setToolboxOpen(false);
    try {
      const send = chatSendSpec({ coachMode, user: chatUser, text });
      if (send.path === '/coach-instruction') {
        await api.post(send.path, send.body);
        setTyping(false);
        poll.pollNow();
        return;
      }
      const res = await api.post(send.path, send.body, { timeoutMs: 30000 });
      if (res?.recorded_weight != null) emit('health:refresh');
      if (res?.launch_tool === 'formula_dots') { startFormulaDotsRef.current({ skipUserMsg: true }); return; }
      if (res?.processing) { onAsyncStart(); return; }
      if (sandboxMode) { if (res?.reply) addMsg('ai', res.reply); setTyping(false); setStatusText(''); return; }
      if (res?.blocked_reason === 'subscription_expired') { addMsg('ai', t.vivaSubscriptionExpiredBanner || t.errServer); setTyping(false); return; }
      if (res?.success === false) { addMsg('ai', t.errServer); setTyping(false); setStatusText(''); return; }
      poll.beginChatWait(CHAT_WAIT_SYNC_MS);
      poll.pollNow();
    } catch {
      if (coachMode) pendingCoachEchoes.current.pop();
      addMsg('ai', t.errServer); setTyping(false); setStatusText('');
    }
  }, [userId, coachMode, chatUser?.account_type, addMsg, emit, onAsyncStart, sandboxMode, t, poll]);

  const handleSend = useCallback(async text => {
    const trimmed = String(text || '').trim();
    if (!trimmed || typingRef.current || obStepRef.current !== 'done' || isSending) return false;
    setIsSending(true);
    await sendMessage(trimmed);
    setIsSending(false);
    return true;
  }, [isSending, sendMessage]);

  // ── tools (utils/tool-actions.js) ────────────────────────────────────────
  const runFormulaDots = useCallback(async (opts = {}) => {
    if (!opts.skipUserMsg) addMsg('user', t.toolFormulaDotMsg, true);
    addMsg('ai', t.formulaGenerating, true);
    setTyping(true);
    try {
      const body = { openid: userId };
      if (opts.ignoreFocus) body.ignore_focus = true;
      const res = await api.post('/formula-dots', body);
      if (res?.processing) { onAsyncStart(); return; }
      addMsg('ai', t.formulaComplete, true);
      setTyping(false);
    } catch { addMsg('ai', t.formulaError); setTyping(false); }
    scrollBottom();
  }, [addMsg, t, userId, onAsyncStart, scrollBottom]);

  // Focus sheet before 营养定制 (main.js:_startFormulaDots).
  const startFormulaDots = useCallback(async (opts = {}) => {
    if (!userId) return;
    let plans = [];
    try {
      const res = await api.get(`/health-plans?openid=${q(userId)}`);
      plans = (res?.plans || []).map(p => ({
        id: p.id, plan_type: p.plan_type,
        name: lang === 'zh' ? (p.name_zh || p.custom_name_zh || '') : (p.name_en || p.custom_name_en || ''),
        goal: lang === 'zh' ? (p.goal_zh || p.custom_goal_zh || '') : (p.goal_en || p.custom_goal_en || ''),
      }));
    } catch { /* fall through with none */ }
    setFocusSheet({ plans, opts });
  }, [userId, lang]);
  const startFormulaDotsRef = useRef(startFormulaDots); startFormulaDotsRef.current = startFormulaDots;

  const focusGo = useCallback(() => { const o = focusSheet?.opts || {}; setFocusSheet(null); runFormulaDots(o); }, [focusSheet, runFormulaDots]);
  const focusSkip = useCallback(() => { const o = focusSheet?.opts || {}; setFocusSheet(null); runFormulaDots({ ...o, ignoreFocus: true }); }, [focusSheet, runFormulaDots]);
  const focusChoose = useCallback(() => {
    setFocusSheet(null);
    if (!coachMode) { app.setTab('plans'); emit('plans:subtab', 'plans'); }
  }, [app, emit, coachMode]);
  const focusClose = useCallback(() => setFocusSheet(null), []);

  useEffect(() => {
    if (coachMode) return undefined;
    return on('chat:startFormulaDots', opts => { app.setTab('chat'); startFormulaDotsRef.current(opts || {}); });
  }, [on, app, coachMode]);

  const runHealthAdvice = useCallback(async () => {
    addMsg('user', t.toolHealthAdviceMsg);
    setTyping(true);
    try {
      const res = await api.post('/health-advice', { openid: userId, async: true }, { timeoutMs: 290000 });
      if (res?.processing) { onAsyncStart(); return; }
      const reply = res?.message;
      if (!reply) throw new Error('empty');
      addMsg('ai', reply, true);
      setTyping(false);
    } catch { addMsg('ai', t.healthAdviceError); setTyping(false); }
  }, [addMsg, t, userId, onAsyncStart]);

  const startHealthReportConsent = useCallback(payload => {
    if (!payload) return;
    pendingHealthReport.current = payload;
    addMsg('ai', t.hrAskOwn);
    addActionMsg('hr_own_yes', t.hrYes);
    addActionMsg('hr_own_no', t.hrNo);
  }, [addMsg, addActionMsg, t]);

  const runUploadImage = useCallback(async file => {
    if (!file || !userId) return;
    const filename = `img_${Date.now()}.jpg`;
    addMsg('ai', t.imageUploading);
    setTyping(true);
    const localUrl = URL.createObjectURL(file);
    const msgId = addImageMsg(localUrl);
    try {
      const presign = await api.get(`/oss/presign?type=image&filename=${q(filename)}&category=user-images`);
      const { put_url, get_url, key } = presign || {};
      if (!put_url) throw new Error('presign failed');
      await putToOss(put_url, file, 'application/octet-stream');
      updateImageMsg(msgId, get_url);
      addMsg('ai', t.imageAnalyzing);
      const res = await api.post('/analyze-image', { openid: userId, oss_key: key, filename, get_url });
      const reply = res?.message;
      if (!reply) throw new Error('empty');
      addMsg('ai', reply, true);
      if (res?.pending_health_report) startHealthReportConsent(res.payload);
    } catch {
      updateImageMsg(msgId, null);
      addMsg('ai', t.imageError);
    } finally { setTyping(false); }
  }, [userId, addMsg, addImageMsg, updateImageMsg, t, startHealthReportConsent]);

  const saveHealthReport = useCallback(async () => {
    const payload = pendingHealthReport.current;
    if (!payload) return;
    pendingHealthReport.current = null;
    setTyping(true);
    try {
      const res = await api.post('/health-reports', {
        openid: userId, oss_key: payload.oss_key, get_url: payload.get_url, report_date: payload.report_date,
        institution: payload.institution, report_type: payload.report_type, observations: payload.observations || [], compute_bioage: true,
      });
      if (res?.success) {
        let msg = t.hrSaved;
        if (res.bioage_updated) msg += ' ' + t.hrSavedBioage;
        addMsg('ai', msg);
        emit('health:refresh');
      } else addMsg('ai', t.hrSaveError);
    } catch { addMsg('ai', t.hrSaveError); }
    finally { setTyping(false); }
  }, [userId, t, addMsg, emit]);

  // Kino chip: the scan bar → ui.scan() (camera or manual) → POST /kino-scan (runTestChip).
  const runTestChip = useCallback(async () => {
    setKinoScanPending(false);
    let chipId;
    try { chipId = await ui.scan({ title: t.kinoScanBtn }); } catch { return; }
    addMsg('user', chipId, true);
    setTyping(true);
    try {
      const r = await api.post('/kino-scan', { openid: userId, chip_id: chipId }, { raw: true });
      if (r.statusCode !== 200) throw new Error('server error');
      const status = r.data?.status;
      if (status === 'invalid_chip') addMsg('ai', t.kinoScanInvalidChip, true);
      else if (status === 'already_linked') addMsg('ai', t.kinoScanAlreadyLinked, true);
      else if (status === 'used') addMsg('ai', t.kinoScanUsed, true);
      else if (status === 'claimed_by_other') addMsg('ai', t.kinoScanClaimedByOther, true);
      else { addMsg('ai', t.kinoScanSuccess, true); addMsg('ai', t.kinoScanInstruction, true); }
    } catch { addMsg('ai', t.kinoScanError, true); }
    finally { setTyping(false); }
  }, [addMsg, t, userId]);

  const handleToolAction = useCallback((action, file) => {
    if (typingRef.current || obStepRef.current !== 'done') return;
    setToolboxOpen(false);
    if (action === 'test_chip') { addMsg('ai', t.kinoScanPrompt); setKinoScanPending(true); }
    else if (action === 'formula_dots') startFormulaDots();
    else if (action === 'health_advice') runHealthAdvice();
    else if (action === 'upload_image') runUploadImage(file);
  }, [addMsg, t, startFormulaDots, runHealthAdvice, runUploadImage]);

  // ── action chips ─────────────────────────────────────────────────────────
  const handleMsgAction = useCallback(action => {
    if (action === 'view_dots' && !coachMode) { app.setTab('plans'); emit('plans:subtab', 'dots'); invalidateDots(); loadDots(chatUser, lang, t, { force: true }); }
    else if (action === 'verify_phone') app.setRoute('phones');
    else if (action === 'hr_own_yes') { removeHrActions(); addMsg('ai', t.hrAskSave); addActionMsg('hr_save_yes', t.hrSave); addActionMsg('hr_save_no', t.hrLater); }
    else if (action === 'hr_own_no') { removeHrActions(); pendingHealthReport.current = null; addMsg('ai', t.hrNotOwn); }
    else if (action === 'hr_save_yes') { removeHrActions(); saveHealthReport(); }
    else if (action === 'hr_save_no') { removeHrActions(); pendingHealthReport.current = null; addMsg('ai', t.hrNotSaved); }
  }, [app, emit, lang, t, coachMode, chatUser, removeHrActions, addMsg, addActionMsg, saveHealthReport]);

  // ── :::formula card ──────────────────────────────────────────────────────
  const toggleFormulaTier = useCallback((mi, si, ti) => {
    const seg = msgsRef.current[mi]?.segments?.[si];
    const tiers = seg && seg.tiers;
    if (!tiers || !tiers[ti] || tiers.length < 2) return;
    let openIdx = -1;
    for (let i = 0; i < tiers.length; i++) { tiers[i].open = i === Number(ti) ? !tiers[i].open : false; if (tiers[i].open) openIdx = i; }
    seg.cta = formulaCtaFor(openIdx >= 0 ? tiers[openIdx] : null, ctaCtx());
    commit();
  }, [ctaCtx, commit]);

  const pickAwaitingOrder = useCallback(async () => {
    let packages = [];
    try {
      const res = await api.get(`/formulation-orders?openid=${q(userId)}`);
      packages = (res?.packages || []).filter(p => p.can_submit && p.order_id);
    } catch { return null; }
    if (packages.length <= 1) return packages.length === 1 ? packages[0].order_id : null;
    const labels = packages.map(p => [pkgTitle(p, t.pkgUnnamed), p.max_distinct_dots ? t.pkgTierUpTo(p.max_distinct_dots) : ''].filter(Boolean).join(' · '));
    try { const r = await ui.actionSheet({ itemList: labels }); return packages[r.tapIndex].order_id; } catch { return CANCELLED; }
  }, [userId, t]);

  const handleFormulaSubmit = useCallback(async planId => {
    if (coachMode || !isAeviva || !planId || !userId || isFormulaSubmitting()) return;
    const { confirm } = await ui.confirm({ title: t.formulaSubmitConfirmTitle, content: t.formulaSubmitConfirmBody });
    if (!confirm) return;
    const orderId = await pickAwaitingOrder();
    if (orderId === CANCELLED) return;
    await submitFormulationShared(app, planId, orderId, msg => addMsg('ai', msg, true));
  }, [coachMode, isAeviva, userId, t, pickAwaitingOrder, app, addMsg]);

  const handleFormulaOrder = useCallback(async (seg) => {
    if (coachMode || !isAeviva || !userId) return;
    const planId = seg.planId || null;
    if (getDotsState().proposedDistinctDots === null) { try { await loadDots(chatUser, lang, t); } catch { /* unwarned */ } }
    const cta = seg.cta || {};
    if (cta.mode === 'redeem' && cta.code) { app.openCodeSheet({ code: cta.code, manual: false, max: Number(cta.max) || null, name: cta.label || '', planId }); return; }
    if (cta.mode === 'pay' && cta.orderId) { openGcnStoreGated(app, { intent: 'pay_order', order_id: cta.orderId }); return; }
    if (cta.mode === 'buy' && Number(cta.width) > 0) { openGcnStoreGated(app, { intent: 'buy_formulation_package', max_distinct_dots: Number(cta.width), nutrition_plan_id: planId }); return; }
    if ((getDotsState().codes || []).length > 0) { app.setTab('plans'); emit('plans:subtab', 'dots'); return; }
    app.openCodeSheet({ code: '', manual: true, max: null, name: '', planId });
  }, [coachMode, isAeviva, userId, app, chatUser, lang, t, emit]);

  const handleProductTap = useCallback(sku => { if (isAeviva && sku) openGcnStoreGated(app, { intent: 'view_product', sku_id: sku }); }, [isAeviva, app]);

  return {
    messages, typing, statusText, obStep, ob, hasMoreHistory, historyLoading, kinoScanPending, toolboxOpen, isSending,
    focusSheet, scrollAnchor, scrollTick, setScrollAnchor,
    setToolboxOpen, setKinoScanPending,
    handleSend, loadMoreHistory, handleToolAction, handleMsgAction, runTestChip,
    saveAnswer, saveOtherText,
    playLesson, lessonEnded, startCheckin,
    toggleFormulaTier, handleFormulaSubmit, handleFormulaOrder, handleProductTap,
    focusGo, focusSkip, focusChoose, focusClose,
  };
}
