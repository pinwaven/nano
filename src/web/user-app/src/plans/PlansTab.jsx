// The 方案 tab — pages/main/main.wxml's PLANS+DOTS block: inner subtabs 原粒 (default) | 方案.
// Plans: cards with daily tasks (main.js:_loadPlans / handlePlanTask), weight + questions
// modals, reminders (_loadReminders), the template browse sheet, the detail overlay
// (概览/进度/活动/指导). Dots: packages (stage pills + CTAs), 兑换码, the formulate-first card,
// scan-box → POST /box-claim, and the Mon–Sun week scroller over the active plan.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q, clipboard } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';
import { asset } from '../assets.js';
import { openGcnStoreGated } from '../gcn.js';
import { fmtDate, getWeekRange, fmtWeekLabel } from '../lib/format.js';
import { useDotsData, loadDots } from './dotsStore.js';
import { submitFormulation, isFormulaSubmitting } from './formulation.js';

const NEO_AVAILABLE = false; // Neo dispenser is not shipping (main.js data.neoAvailable) — cartridges/dispense stay off
const STALE_MS = 30_000;

function Pulse() { return <div className="center-wrap"><div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" /></div>; }

export default function PlansTab({ visible, onGuestTap }) {
  const app = useApp();
  const { user, lang, t, isGuest, isAeviva, on, emit } = app;
  const userId = user?.user_id;
  const [subTab, setSubTab] = useState('dots');
  const dots = useDotsData();
  const [weekOffset, setWeekOffset] = useState(0);

  // ── plans ────────────────────────────────────────────────────────────────
  const [plansLoading, setPlansLoading] = useState(true);
  const [activePlans, setActivePlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const plansLoadedAt = useRef(0);
  const [busy, setBusy] = useState(false);
  const [weightModal, setWeightModal] = useState(null); // planId
  const [weightInput, setWeightInput] = useState('');
  const [questionsModal, setQuestionsModal] = useState(null); // { planId, energy, sleep, mood }
  const [browseOpen, setBrowseOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [signedIds, setSignedIds] = useState([]);

  const loadPlans = useCallback(async () => {
    if (!userId || isGuest) { setPlansLoading(false); return; }
    plansLoadedAt.current = Date.now();
    try {
      const [plansRes, tplRes] = await Promise.all([api.get(`/health-plans?openid=${q(userId)}`), api.get('/health-plan-templates')]);
      const now = Date.now();
      const plans = (plansRes?.plans || []).map(p => {
        const totalWeeks = p.duration_weeks || p.template_duration_weeks || 4;
        const weeksElapsed = Math.max(0, Math.floor((now - new Date(p.start_date).getTime()) / (7 * 86400000)));
        const checkins = parseInt(p.checkin_count || 0, 10);
        const daysSinceStart = Math.max(1, Math.floor((now - new Date(p.start_date).getTime()) / 86400000));
        const tc = p.today_checkin || null;
        const acts = Array.isArray(tc?.activities_done) ? tc.activities_done : [];
        const taskDone = { dots: () => tc?.dots_taken || false, weight: () => acts.includes('weight_logged'), questions: () => acts.includes('daily_questions') };
        const defaultTasks = [{ key: 'dots', label_zh: '服用原粒', label_en: 'Dots', enabled: true }, { key: 'weight', label_zh: '记录体重', label_en: 'Weight', enabled: true }, { key: 'questions', label_zh: '每日问答', label_en: 'Questions', enabled: true }];
        const templateTasks = Array.isArray(p.daily_tasks) && p.daily_tasks.length > 0 ? p.daily_tasks : defaultTasks;
        const todayTasks = templateTasks.filter(x => x.enabled).map(x => ({ key: x.key, labelZh: x.label_zh, labelEn: x.label_en, done: taskDone[x.key]?.() || false }));
        const todayDoneCount = todayTasks.filter(x => x.done).length;
        return {
          ...p, name_zh: p.name_zh || p.custom_name_zh || '', name_en: p.name_en || p.custom_name_en || '', totalWeeks, weeksDone: weeksElapsed,
          progressPct: Math.min(100, Math.round((weeksElapsed / totalWeeks) * 100)), adherencePct: Math.min(100, Math.round((checkins / daysSinceStart) * 100)),
          checkedInToday: parseInt(p.checked_in_today || 0, 10) > 0, todayTasks, todayDoneCount, todayProgressPct: Math.round((todayDoneCount / (todayTasks.length || 1)) * 100),
          today_dots_taken: tc?.dots_taken || false, today_activities: acts,
        };
      });
      const enrolled = new Set(plans.map(p => p.template_id));
      const hasPrimary = plans.some(p => p.plan_type === 'primary'), hasSecondary = plans.some(p => p.plan_type === 'secondary');
      setTemplates((tplRes?.templates || []).map(x => ({ ...x, sub_ages_display: (x.target_sub_ages || []).join(' · '), alreadyEnrolled: enrolled.has(x.id), canJoinPrimary: !enrolled.has(x.id) && !hasPrimary, canJoinSecondary: !enrolled.has(x.id) && !hasSecondary })));
      setActivePlans(plans);
    } catch { /* ignore */ }
    setPlansLoading(false);
  }, [userId, isGuest]);

  const loadReminders = useCallback(async () => {
    if (!userId || isGuest) return;
    setRemindersLoading(true);
    try {
      const res = await api.get(`/reminders?openid=${q(userId)}`);
      const now = new Date();
      setReminders((res?.reminders || []).map(r => {
        const dt = new Date(r.scheduled_for);
        const isToday = dt.toDateString() === now.toDateString();
        const isTomorrow = dt.toDateString() === new Date(now.getTime() + 86400000).toDateString();
        const hhmm = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        const dateLabel = isToday ? (lang === 'zh' ? `今天 ${hhmm}` : `Today ${hhmm}`) : isTomorrow ? (lang === 'zh' ? `明天 ${hhmm}` : `Tomorrow ${hhmm}`) : fmtDate(r.scheduled_for, lang);
        return { ...r, dateLabel, isCoach: !!r.coach_id, recurrenceLabel: r.recurrence === 'daily' ? t.reminderRecurDaily : r.recurrence === 'weekly' ? t.reminderRecurWeekly : '' };
      }));
    } catch { /* ignore */ }
    setRemindersLoading(false);
  }, [userId, isGuest, lang, t]);

  useEffect(() => { setPlansLoading(true); loadPlans(); loadReminders(); }, [userId, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => on('plans:subtab', tab => { setSubTab(tab); if (tab === 'dots') loadDots(user, lang, t); }), [on, user, lang, t]);
  useEffect(() => on('tab:switch', tab => { if (tab !== 'plans') return; if (Date.now() - plansLoadedAt.current > STALE_MS) { loadPlans(); loadReminders(); } loadDots(user, lang, t); }), [on, loadPlans, loadReminders, user, lang, t]);

  const upsertCheckin = async (planId, dots_taken, activities_done) => {
    const d = new Date(); const pad = n => String(n).padStart(2, '0');
    await api.post(`/health-plans/${planId}/checkin`, { openid: userId, checkin_date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, dots_taken, activities_done });
  };
  const handleTask = async (planId, task) => {
    if (isGuest) { onGuestTap?.(); return; }
    if (busy) return;
    if (task === 'dots') {
      const plan = activePlans.find(p => String(p.id) === String(planId)); if (!plan) return;
      setBusy(true);
      try { await upsertCheckin(planId, !plan.today_dots_taken, plan.today_activities); await loadPlans(); } catch (e) { ui.toast(e.message || 'Error'); }
      setBusy(false);
    } else if (task === 'weight') { setWeightInput(''); setWeightModal(planId); }
    else if (task === 'questions') setQuestionsModal({ planId, energy: 3, sleep: 3, mood: 3 });
  };
  const submitWeight = async () => {
    const w = parseFloat(weightInput);
    if (!w || w < 10 || w > 500) { ui.toast(lang === 'zh' ? '请输入有效体重' : 'Enter a valid weight'); return; }
    setBusy(true);
    try {
      await api.post('/biomarkers', { openid: userId, test_type: 'body_composition', test_data: { weight: w } });
      const plan = activePlans.find(p => String(p.id) === String(weightModal));
      await upsertCheckin(weightModal, plan?.today_dots_taken || false, [...(plan?.today_activities || []).filter(a => a !== 'weight_logged'), 'weight_logged']);
      setWeightModal(null); await loadPlans(); emit('health:refresh');
    } catch (e) { ui.toast(e.message || 'Error'); }
    setBusy(false);
  };
  const submitQuestions = async () => {
    setBusy(true);
    try {
      const plan = activePlans.find(p => String(p.id) === String(questionsModal.planId));
      await upsertCheckin(questionsModal.planId, plan?.today_dots_taken || false, [...(plan?.today_activities || []).filter(a => a !== 'daily_questions'), 'daily_questions']);
      setQuestionsModal(null); await loadPlans();
    } catch (e) { ui.toast(e.message || 'Error'); }
    setBusy(false);
  };
  const joinPlan = async (templateId, planType) => {
    if (isGuest) { onGuestTap?.(); return; }
    try {
      const body = { openid: userId, template_id: templateId, plan_type: planType || 'primary', source: 'self' };
      const res = await api.post('/health-plans', body, { raw: true });
      if (!res.data?.success && res.data?.error === 'conflict') {
        const { confirm } = await ui.confirm({ title: t.plansConflict, content: '', confirmText: lang === 'zh' ? '替换' : 'Replace' });
        if (!confirm) return;
        await api.put(`/health-plans/${res.data.existing_plan_id}`, { openid: userId, status: 'abandoned' });
        await api.post('/health-plans', body);
      }
      setBrowseOpen(false); await loadPlans();
    } catch (e) { ui.toast(e.message || 'Error'); }
  };
  const openDetail = async plan => {
    setDetail(plan); setDetailTab('overview');
    try {
      const res = await api.get(`/health-plans/${plan.id}?openid=${q(userId)}`);
      const rems = (res?.reminders || []).map(r => { const dt = new Date(r.scheduled_for); return { ...r, timeDisplay: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` }; });
      setDetail({ ...plan, ...(res?.plan || {}), reminders: rems, formulation: res?.formulation || null, recommendedDots: res?.recommended_dots || [] });
    } catch { /* keep plan */ }
  };
  const toggleReminder = async (id, status) => {
    const next = status === 'paused' ? 'pending' : 'paused';
    try { await api.patch(`/plan-reminders/${id}`, { openid: userId, status: next }); setDetail(d => ({ ...d, reminders: (d.reminders || []).map(r => (String(r.id) === String(id) ? { ...r, status: next } : r)) })); } catch { /* ignore */ }
  };
  const abandonPlan = async () => {
    const { confirm } = await ui.confirm({ title: t.plansConfirmAbandon, content: '' }); if (!confirm) return;
    try { await api.put(`/health-plans/${detail.id}`, { openid: userId, status: 'abandoned' }); setDetail(null); await loadPlans(); } catch (e) { ui.toast(e.message || 'Error'); }
  };
  const switchType = async () => {
    const { confirm } = await ui.confirm({ title: t.plansConfirmSwitch, content: '' }); if (!confirm) return;
    try { await api.put(`/health-plans/${detail.id}`, { openid: userId, plan_type: detail.plan_type === 'primary' ? 'secondary' : 'primary' }); setDetail(null); await loadPlans(); } catch (e) { ui.toast(e.message || 'Error'); }
  };
  const loadEvents = async () => {
    if (!user?.channel_id) return;
    setEventsLoading(true);
    try {
      const res = await api.get(`/events?channel_id=${q(user.channel_id)}&user_id=${q(userId)}`);
      const list = (res?.events || []).map(ev => {
        const dt = new Date(ev.scheduled_at); const signupCount = parseInt(ev.signup_count, 10) || 0;
        const remaining = ev.capacity ? Math.max(0, ev.capacity - signupCount) : null;
        return { ...ev, scheduled_at_display: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`, remaining, is_full: ev.capacity !== null && remaining === 0 };
      });
      setEvents(list); setSignedIds(list.filter(ev => ev.signed_up).map(ev => ev.id));
    } catch { /* ignore */ }
    setEventsLoading(false);
  };
  // Correct routes: POST /event-signups and DELETE /event-signups/:eventId (main.js:5084–5110).
  const signUp = async eventId => { try { const res = await api.post('/event-signups', { event_id: eventId, user_id: userId }); if (res?.success) { setSignedIds(s => [...s, eventId]); ui.toast(t.eventsSignedUp); } else ui.toast(res?.error || 'Error'); } catch { ui.toast(t.errServer); } };
  const cancelSignup = async eventId => { try { await api.del(`/event-signups/${eventId}?user_id=${q(userId)}`); setSignedIds(s => s.filter(id => id !== eventId)); ui.toast(t.eventsCancel); } catch { ui.toast(t.errServer); } };

  // ── dots ─────────────────────────────────────────────────────────────────
  const { monday, sunday } = getWeekRange(weekOffset);
  const weekLabel = fmtWeekLabel(monday, sunday, lang);
  const dotsDays = dots.allDays.filter(x => x.dateStr >= monday && x.dateStr <= sunday);
  const hasPrevWeek = dots.allDays.length > 0 && dots.allDays[0].dateStr < monday;
  const hasNextWeek = dots.allDays.length > 0 && dots.allDays[dots.allDays.length - 1].dateStr > sunday;
  const scanBox = async () => {
    if (!userId) return;
    let code; try { code = await ui.scan({ title: t.scanBoxTitle }); } catch { return; }
    ui.loading(t.scanBoxWorking, true);
    try {
      const r = await api.post('/box-claim', { openid: userId, box_code: code });
      ui.loading('', false);
      if (r?.success) { ui.toast(r.already_claimed ? t.scanBoxAlready : t.scanBoxOk, { duration: 2500 }); loadDots(user, lang, t, { force: true }); }
      else await ui.confirm({ title: t.scanBoxFailTitle, content: t[`scanBoxErr_${r?.reason}`] || t.scanBoxErrGeneric, showCancel: false, confirmText: t.gotIt });
    } catch { ui.loading('', false); ui.toast(t.scanBoxErrGeneric); }
  };
  const packagePay = orderId => { if (orderId && isAeviva) openGcnStoreGated(app, { intent: 'pay_order', order_id: orderId }); };
  const packageSubmit = async (planId, orderId) => {
    if (!isAeviva || !planId || !orderId || isFormulaSubmitting()) return;
    const { confirm } = await ui.confirm({ title: t.formulaSubmitConfirmTitle, content: t.pkgSubmitConfirm }); if (!confirm) return;
    const ok = await submitFormulation(app, planId, orderId, msg => ui.confirm({ title: '', content: msg, showCancel: false }));
    if (ok) { ui.toast(t.pkgSubmitOk); loadDots(user, lang, t, { force: true }); }
  };
  const goFormulate = () => { if (isGuest || !user) return; emit('chat:startFormulaDots', {}); };

  const guestLock = (icon, title) => <div className="guest-lock-card" onClick={onGuestTap}><span className="guest-lock-icon">{icon}</span><span className="guest-lock-title">{title}</span><div className="guest-lock-btn"><span>{t.guestJoinBtn}</span></div></div>;

  return (
    <div className="plans-tab">
      <div className="inner-tab-bar">
        <div className={`inner-tab${subTab === 'dots' ? ' inner-tab-active' : ''}`} onClick={() => { setSubTab('dots'); loadDots(user, lang, t); }}><span className="inner-tab-text">{t.plansDotsDotsTab}</span></div>
        <div className={`inner-tab${subTab === 'plans' ? ' inner-tab-active' : ''}`} onClick={() => setSubTab('plans')}><span className="inner-tab-text">{t.plansDotsPlanTab}</span></div>
      </div>

      {subTab === 'plans' ? (
        isGuest ? <div className="guest-lock-card" onClick={onGuestTap}><span className="guest-lock-icon">🔒</span><span className="guest-lock-text">{t.guestLockMsg}</span></div>
        : plansLoading ? <div className="plans-loading"><span className="loading-dots">···</span></div> : (
          <div className="plans-scroll tab-scroll">
            <div className="plans-header"><span className="plans-title">{t.plansTitle}</span><div className="plans-browse-btn" onClick={() => setBrowseOpen(true)}><span className="plans-browse-btn-text">+ {t.plansBrowse}</span></div></div>
            {activePlans.length === 0 && <div className="plans-empty"><span className="plans-empty-text">{t.plansEmpty}</span><div className="plans-browse-cta" onClick={() => setBrowseOpen(true)}><span className="plans-browse-cta-text">{t.plansBrowse}</span></div></div>}
            {activePlans.map(item => (
              <div key={item.id} className="plan-card" onClick={() => openDetail(item)}>
                <div className="plan-card-header"><div className={`plan-type-badge plan-type-${item.plan_type}`}><span className="plan-type-text">{item.plan_type === 'primary' ? t.plansPrimary : t.plansSecondary}</span></div><span className="plan-card-name">{lang === 'zh' ? item.name_zh : item.name_en}</span></div>
                <div className="plan-progress-bar-track"><div className="plan-progress-bar-fill" style={{ width: `${item.progressPct}%` }} /></div>
                <div className="plan-card-meta-row"><span className="plan-meta-item">{t.plansAdherence}: {item.adherencePct}%</span><span className="plan-meta-item">{item.weeksDone}/{item.totalWeeks} {t.plansWeeks}</span></div>
                <div className="plan-daily-section">
                  <div className="plan-daily-tasks">
                    {item.todayTasks.map(task => <div key={task.key} className={`plan-task-chip${task.done ? ' plan-task-done' : ''}`} onClick={e => { e.stopPropagation(); handleTask(item.id, task.key); }}><span className="plan-task-label">{lang === 'zh' ? task.labelZh : task.labelEn}</span><span className="plan-task-check">{task.done ? '✓' : '○'}</span></div>)}
                  </div>
                  <div className="plan-daily-bar-row"><div className="plan-daily-bar-track"><div className={`plan-daily-bar-fill${item.todayDoneCount === item.todayTasks.length ? ' plan-daily-complete' : ''}`} style={{ width: `${item.todayProgressPct}%` }} /></div><span className="plan-daily-count">{item.todayDoneCount}/{item.todayTasks.length} {t.todayProgress}</span></div>
                </div>
              </div>
            ))}
            <div className="reminders-section">
              <span className="reminders-section-title">{t.remindersTitle}</span>
              {remindersLoading ? <div className="reminders-empty"><span className="reminder-date">···</span></div>
                : reminders.length === 0 ? <div className="reminders-empty"><span className="reminder-date">{t.remindersEmpty}</span></div>
                : reminders.map(r => (
                  <div key={r.id} className="reminder-card">
                    <div className="reminder-card-top"><span className="reminder-content">{r.content}</span><div className={`reminder-source-badge reminder-source-${r.isCoach ? 'coach' : 'ai'}`}><span className="reminder-source-text">{r.isCoach ? t.reminderSourceCoach : t.reminderSourceAi}</span></div></div>
                    <div className="reminder-card-bottom"><span className="reminder-date">{r.dateLabel}</span>{r.recurrenceLabel && <div className="reminder-recur-badge"><span className="reminder-recur-text">{r.recurrenceLabel}</span></div>}</div>
                  </div>
                ))}
            </div>
            <div style={{ height: 24 }} />
          </div>
        )
      ) : (
        <div className="dots-subtab-scroll tab-scroll">
          {isAeviva && !isGuest && dots.packages.length > 0 && (
            <div className="pkg-section">
              <span className="pkg-section-title">{t.pkgSectionTitle}</span>
              {dots.packages.map(item => (
                <div key={item.key} className="pkg-card">
                  <div className="pkg-card-hdr"><span className="pkg-name">{item.name}</span><span className={`pkg-stage pkg-stage-${item.stage}`}>{item.stageLabel}</span></div>
                  {item.meta && <span className="pkg-meta">{item.meta}</span>}
                  {item.tracking_number && <div className="pkg-track" onClick={async () => { if (await clipboard.write(item.tracking_number)) ui.toast(lang === 'zh' ? '单号已复制' : 'Tracking copied'); }}><span className="pkg-track-text">{item.trackingLabel}</span><span className="pkg-track-copy">{t.copy}</span></div>}
                  {item.can_pay ? <div className="pkg-cta" onClick={() => packagePay(item.order_id)}><span className="pkg-cta-text">{t.pkgPayBtn}</span></div>
                    : item.can_submit && item.submit_plan_id ? <div className="pkg-cta" onClick={() => packageSubmit(item.submit_plan_id, item.order_id)}><span className="pkg-cta-text">{t.pkgUseFormulaBtn}</span></div>
                    : item.can_submit ? <span className="pkg-hint">{t.pkgNeedsFormulaHint}</span>
                    : item.can_scan ? <div className="pkg-cta pkg-cta-ghost" onClick={scanBox}><span className="pkg-cta-text">{t.pkgScanBtn}</span></div> : null}
                </div>
              ))}
            </div>
          )}
          {isAeviva && !isGuest && (
            <div className="code-section">
              <span className="pkg-section-title">{t.codeSectionTitle}</span>
              {dots.codes.map(item => (
                <div key={item.key} className="pkg-card">
                  <div className="pkg-card-hdr"><span className="pkg-name">{item.name}</span><span className="code-chip">{item.code}</span></div>
                  {item.meta && <span className="pkg-meta">{item.meta}</span>}
                  <div className="pkg-cta" onClick={() => app.openCodeSheet({ code: item.code, manual: false, max: item.max_distinct_dots || null, name: item.name || '', planId: null })}><span className="pkg-cta-text">{t.codeUseBtn}</span></div>
                </div>
              ))}
              <div className="pkg-cta pkg-cta-ghost" onClick={() => app.openCodeSheet({ code: '', manual: true, max: null, name: '', planId: null })}><span className="pkg-cta-text">{t.codeManualBtn}</span></div>
            </div>
          )}
          {!NEO_AVAILABLE && isAeviva && !isGuest && !dots.hasPackageInFlight && !dots.hasProposedFormula && (
            <div className="order-dots-card" onClick={goFormulate}><span className="order-dots-title">{t.formulateFirstTitle}</span><span className="order-dots-detail">{t.formulateFirstDetail}</span><div className="order-dots-btn"><span className="order-dots-btn-text">{t.formulateFirstBtn}</span></div></div>
          )}
          {isAeviva && !isGuest && <div className="scan-box-card" onClick={scanBox}><div className="scan-box-main"><span className="scan-box-title">{t.scanBoxTitle}</span><span className="scan-box-detail">{t.scanBoxDetail}</span></div><img className="scan-box-icon" src={asset('/assets/icons/scan.svg')} alt="" /></div>}
          <div className="dots-header">
            <span className="dots-title">{t.dotsTitle}</span>
            <div className="dots-week-nav">
              <span className={`dots-week-arrow${!hasPrevWeek ? ' dots-week-arrow-disabled' : ''}`} onClick={() => hasPrevWeek && setWeekOffset(o => o - 1)}>‹</span>
              {weekLabel && <span className="dots-week-label">{weekLabel}</span>}
              <span className={`dots-week-arrow${!hasNextWeek ? ' dots-week-arrow-disabled' : ''}`} onClick={() => hasNextWeek && setWeekOffset(o => o + 1)}>›</span>
            </div>
          </div>
          {isGuest ? guestLock('◉', t.guestDotsCta) : dots.loading ? <Pulse /> : dotsDays.length > 0 ? (
            <div className="dots-scroll" style={{ overflowX: 'auto' }}>
              <div className="dots-days">
                {dotsDays.map(item => (
                  <div key={item.dateStr || item.label} className={`day-card${item.isToday ? ' day-today' : ''}`}>
                    <span className="day-label">{item.label}</span>
                    {[['morning', t.morning, 'morning_cup'], ['evening', t.evening, 'evening_cup']].map(([slot, label, slotName]) => item[slot].length > 0 && (
                      <div key={slot} className={`meal-slot${item.isToday && dots.dispenseSlot === slotName ? ' meal-slot-active' : ''}`}>
                        <span className="meal-name">{label}</span>
                        <div className="dot-chips">{item[slot].map(dot => <div key={dot.displayKey} className="dot-chip"><div className="dot-swatch" style={{ background: dot.color }} /><span className="dot-key">{dot.displayKey}</span><span className="dot-count">×{dot.count}</span></div>)}</div>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ width: 4, flexShrink: 0 }} />
              </div>
            </div>
          ) : <div className="dots-empty"><span>{t.noPlan}</span></div>}
          <div style={{ height: 24 }} />
        </div>
      )}

      {weightModal != null && (
        <div className="modal-overlay">
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <span className="modal-title">{t.taskWeightTitle}</span>
            <input className="modal-input" inputMode="decimal" autoFocus placeholder={t.taskWeightPlaceholder} value={weightInput} onChange={e => setWeightInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitWeight(); }} />
            <div className="modal-actions"><div className="modal-btn modal-btn-cancel" onClick={() => setWeightModal(null)}><span>{t.taskWeightCancel}</span></div><div className="modal-btn modal-btn-confirm" onClick={submitWeight}><span>{t.taskWeightConfirm}</span></div></div>
          </div>
        </div>
      )}
      {questionsModal && (
        <div className="modal-overlay">
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <span className="modal-title">{t.taskQuestionsTitle}</span>
            {[['energy', t.taskQEnergy], ['sleep', t.taskQSleep], ['mood', t.taskQMood]].map(([k, label]) => (
              <div key={k} className="q-row"><span className="q-label">{label}</span><input type="range" className="slider-input" min={1} max={5} step={1} value={questionsModal[k]} onChange={e => setQuestionsModal(m => ({ ...m, [k]: Number(e.target.value) }))} /><span className="q-val">{questionsModal[k]}</span></div>
            ))}
            <div className="modal-actions"><div className="modal-btn modal-btn-cancel" onClick={() => setQuestionsModal(null)}><span>{t.taskQCancel}</span></div><div className="modal-btn modal-btn-confirm" onClick={submitQuestions}><span>{t.taskQSubmit}</span></div></div>
          </div>
        </div>
      )}

      {detail && (
        <div className="overlay-mask">
          <div className="overlay-panel" onClick={e => e.stopPropagation()}>
            <div className="overlay-header"><span className="overlay-title">{lang === 'zh' ? detail.name_zh : detail.name_en}</span><div className="overlay-close" onClick={() => setDetail(null)}><span className="close-x">✕</span></div></div>
            <div className="detail-tabs">
              {[['overview', t.plansSubTabOverview], ['progress', t.plansSubTabProgress], ['activities', t.plansSubTabActivities], ['guidance', t.plansSubTabGuidance]].map(([k, label]) => (
                <div key={k} className={`detail-tab${detailTab === k ? ' detail-tab-active' : ''}`} onClick={() => { setDetailTab(k); if (k === 'activities') loadEvents(); }}><span className="detail-tab-text">{label}</span></div>
              ))}
            </div>
            {detailTab === 'overview' && (
              <div className="overlay-scroll tab-scroll">
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansGoal}</span><span className="plan-detail-value">{lang === 'zh' ? detail.goal_zh : detail.goal_en}</span></div>
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansStartDate}</span><span className="plan-detail-value">{String(detail.start_date || '').substring(0, 10)}</span></div>
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansDuration}</span><span className="plan-detail-value">{detail.totalWeeks} {t.plansWeeks}</span></div>
                {detail.target_sub_ages?.length > 0 && <div className="plan-detail-section"><span className="plan-detail-label">{t.plansTargetSubAges}</span><div className="plan-chips-row">{detail.target_sub_ages.map(x => <div key={x} className="plan-chip"><span className="plan-chip-text">{x}</span></div>)}</div></div>}
                <div className="plan-detail-section">
                  <span className="plan-detail-label plan-section-label">{t.planReminders}</span>
                  {(!detail.reminders || detail.reminders.length === 0) && <div className="plan-empty-hint"><span>{t.planNoReminders}</span></div>}
                  {(detail.reminders || []).map(r => (
                    <div key={r.id} className="plan-reminder-row">
                      <div className="plan-reminder-info"><span className="plan-reminder-time">{r.timeDisplay}</span><span className="plan-reminder-content">{r.content}</span></div>
                      <div className={`plan-reminder-toggle ${r.status === 'paused' ? 'reminder-paused' : 'reminder-active'}`} onClick={() => toggleReminder(r.id, r.status)}><span>{r.status === 'paused' ? t.planReminderResume : t.planReminderPause}</span></div>
                    </div>
                  ))}
                </div>
                {detail.formulation ? (
                  <div className="plan-detail-section">
                    <span className="plan-detail-label plan-section-label">{t.formulationReadyTitle}</span>
                    <div className="plan-chips-row">{(detail.formulation.dot_breakdown || []).map(x => <div key={x.key_name} className="plan-chip plan-chip-dot"><span className="plan-chip-text">{lang === 'zh' ? x.name_zh : x.name} ×{x.total_count}</span></div>)}</div>
                    {isAeviva && <div className="plan-action-btn plan-action-buy" onClick={() => openGcnStoreGated(app, { intent: 'buy_custom_formulation', nutrition_plan_id: detail.formulation.nutrition_plan_id })}><span>{t.buyFormulationBtn}</span></div>}
                  </div>
                ) : isAeviva ? <div className="plan-detail-section"><span className="plan-detail-label plan-section-label">{t.formulationNotReadyTitle}</span><span className="plan-empty-hint">{t.formulationNotReadyHint}</span></div> : null}
                <div className="plan-actions-row"><div className="plan-action-btn plan-action-switch" onClick={switchType}><span>{t.plansSwitch}</span></div><div className="plan-action-btn plan-action-abandon" onClick={abandonPlan}><span>{t.plansAbandon}</span></div></div>
              </div>
            )}
            {detailTab === 'progress' && (
              <div className="overlay-scroll tab-scroll">
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansAdherence}</span><span className="plan-detail-value">{detail.adherencePct}% ({detail.checkin_count || 0} {lang === 'zh' ? '次打卡' : 'check-ins'})</span></div>
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansWeeks}</span><span className="plan-detail-value">{detail.weeksDone}/{detail.totalWeeks}</span></div>
                <div className="plan-detail-section"><span className="plan-detail-label">{t.plansNoMilestones}</span></div>
              </div>
            )}
            {detailTab === 'activities' && (
              <div className="overlay-scroll tab-scroll">
                {eventsLoading ? <div className="panel-center" style={{ padding: '30px 0' }}><span className="empty-text">{t.eventsLoading}</span></div>
                  : events.length === 0 ? <div className="panel-center" style={{ padding: '30px 0' }}><span className="empty-text">{t.eventsEmpty}</span></div>
                  : <div className="events-list">{events.map(ev => (
                    <div key={ev.id} className="event-card">
                      <div className="event-card-header"><span className="event-title">{ev.title}</span>{signedIds.includes(ev.id) && <div className="event-badge-signed"><span>{t.eventsSignedUp}</span></div>}</div>
                      <span className="event-meta">📅 {ev.scheduled_at_display}</span>
                      {ev.location && <span className="event-meta">📍 {ev.location}</span>}
                      {ev.description && <span className="event-desc">{ev.description}</span>}
                      {ev.capacity && <span className="event-meta">{t.eventsCapacity}: {ev.remaining}/{ev.capacity}</span>}
                      <div className="event-card-actions">
                        {signedIds.includes(ev.id) ? <div className="event-btn event-btn-cancel" onClick={() => cancelSignup(ev.id)}><span>{t.eventsCancel}</span></div>
                          : ev.is_full ? <div className="event-btn event-btn-disabled"><span>{t.eventsFull}</span></div>
                          : <div className="event-btn event-btn-signup" onClick={() => signUp(ev.id)}><span>{t.eventsSignUp}</span></div>}
                      </div>
                    </div>))}</div>}
              </div>
            )}
            {detailTab === 'guidance' && (
              <div className="overlay-scroll tab-scroll">
                <div className="plan-detail-section"><span className="plan-detail-value">{lang === 'zh' ? (detail.desc_zh || detail.goal_zh) : (detail.desc_en || detail.goal_en)}</span></div>
                {detail.recommendedDots?.length > 0 && <div className="plan-detail-section"><span className="plan-detail-label">{t.plansRecommendedDots}</span><div className="plan-chips-row">{detail.recommendedDots.map(x => <div key={x.key_name} className="plan-chip plan-chip-dot"><span className="plan-chip-text">{lang === 'zh' ? (x.key_name_zh || x.name_zh) : x.name}</span></div>)}</div></div>}
              </div>
            )}
          </div>
        </div>
      )}

      {browseOpen && (
        <div className="overlay-mask">
          <div className="overlay-panel" onClick={e => e.stopPropagation()}>
            <div className="overlay-header"><span className="overlay-title">{t.plansTemplates}</span><div className="overlay-close" onClick={() => setBrowseOpen(false)}><span className="close-x">✕</span></div></div>
            <div className="overlay-scroll tab-scroll">
              {templates.map(item => (
                <div key={item.id} className="browse-tpl-card">
                  <span className="browse-tpl-name">{lang === 'zh' ? item.name_zh : item.name_en}</span>
                  <span className="browse-tpl-goal">{lang === 'zh' ? item.goal_zh : item.goal_en}</span>
                  <span className="browse-tpl-meta">{item.duration_weeks} {t.plansWeeks} · {item.sub_ages_display}</span>
                  <div className="browse-tpl-actions">
                    {item.alreadyEnrolled ? <div className="browse-enrolled-badge"><span>{t.plansAlreadyEnrolled}</span></div> : (
                      <>
                        <div className={`browse-join-btn${item.canJoinPrimary ? '' : ' browse-join-disabled'}`} onClick={() => item.canJoinPrimary && joinPlan(item.id, 'primary')}><span>{t.plansJoinPrimary}</span></div>
                        <div className={`browse-join-btn browse-join-secondary${item.canJoinSecondary ? '' : ' browse-join-disabled'}`} onClick={() => item.canJoinSecondary && joinPlan(item.id, 'secondary')}><span>{t.plansJoinSecondary}</span></div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div style={{ height: 24 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
