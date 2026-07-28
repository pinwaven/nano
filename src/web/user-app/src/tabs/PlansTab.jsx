import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import PlanDetailSheet from '../components/PlanDetailSheet.jsx';
import DotsView from '../components/DotsView.jsx';

const API = '/api';

const DEFAULT_DAILY_TASKS = [
  { key: 'dots',      label_zh: '服用原粒', label_en: 'Dots',      enabled: true },
  { key: 'weight',    label_zh: '记录体重', label_en: 'Weight',    enabled: true },
  { key: 'questions', label_zh: '每日问答', label_en: 'Questions', enabled: true },
];

function deriveTodayTasks(plan) {
  const tc = plan.today_checkin || null;
  const acts = Array.isArray(tc?.activities_done) ? tc.activities_done : [];
  const taskDone = {
    dots:      () => tc?.dots_taken || false,
    weight:    () => acts.includes('weight_logged'),
    questions: () => acts.includes('daily_questions'),
  };
  const templateTasks = Array.isArray(plan.daily_tasks) && plan.daily_tasks.length > 0
    ? plan.daily_tasks : DEFAULT_DAILY_TASKS;
  const todayTasks = templateTasks
    .filter(tk => tk.enabled)
    .map(tk => ({ key: tk.key, labelZh: tk.label_zh, labelEn: tk.label_en, done: taskDone[tk.key]?.() || false }));
  const todayDoneCount = todayTasks.filter(tk => tk.done).length;
  const total = todayTasks.length || 1;
  return {
    todayTasks,
    todayDoneCount,
    todayProgressPct: Math.round((todayDoneCount / total) * 100),
    today_dots_taken: tc?.dots_taken || false,
    today_activities: acts,
  };
}

// ── Weight Entry Modal ───────────────────────────────────────────────────────

function WeightEntryModal({ user, plan, onClose, onDone }) {
  const { t } = useLang();
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const w = parseFloat(weight);
    if (!w || w < 10 || w > 500) { setError(t.plTaskWeightInvalid); return; }
    setSaving(true);
    setError('');
    try {
      await axios.post(`${API}/biomarkers`, {
        openid: user.user_id, test_type: 'body_composition', test_data: { weight: w },
      });
      const activities = [...(plan.today_activities || []).filter(a => a !== 'weight_logged'), 'weight_logged'];
      await axios.post(`${API}/health-plans/${plan.id}/checkin`, {
        openid: user.user_id,
        checkin_date: new Date().toISOString().slice(0, 10),
        dots_taken: plan.today_dots_taken || false,
        activities_done: activities,
      });
      onDone();
    } catch { setError(t.errServer); }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{t.plTaskWeightTitle}</div>
        <input
          className="modal-input"
          type="number"
          inputMode="decimal"
          placeholder={t.plTaskWeightPlaceholder}
          value={weight}
          onChange={e => setWeight(e.target.value)}
        />
        {error && <div className="modal-msg modal-msg--err">{error}</div>}
        <div className="modal-actions">
          <button className="modal-btn modal-btn--ghost" onClick={onClose}>{t.cancel}</button>
          <button className="modal-btn modal-btn--primary" onClick={submit} disabled={saving}>
            {saving ? '…' : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Daily Questions Modal ────────────────────────────────────────────────────

function DailyQuestionsModal({ user, plan, onClose, onDone }) {
  const { t } = useLang();
  const [vals, setVals] = useState({ energy: 3, sleep: 3, mood: 3 });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const activities = [...(plan.today_activities || []).filter(a => a !== 'daily_questions'), 'daily_questions'];
      await axios.post(`${API}/health-plans/${plan.id}/checkin`, {
        openid: user.user_id,
        checkin_date: new Date().toISOString().slice(0, 10),
        dots_taken: plan.today_dots_taken || false,
        activities_done: activities,
      });
      onDone();
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{t.plTaskQuestionsTitle}</div>
        {['energy', 'sleep', 'mood'].map(k => (
          <div className="q-row" key={k}>
            <span className="q-label">{k === 'energy' ? t.plTaskQEnergy : k === 'sleep' ? t.plTaskQSleep : t.plTaskQMood}</span>
            <input
              type="range" min="1" max="5" step="1"
              value={vals[k]}
              onChange={e => setVals(v => ({ ...v, [k]: Number(e.target.value) }))}
              className="q-slider"
            />
            <span className="q-val">{vals[k]}</span>
          </div>
        ))}
        <div className="modal-actions">
          <button className="modal-btn modal-btn--ghost" onClick={onClose}>{t.cancel}</button>
          <button className="modal-btn modal-btn--primary" onClick={submit} disabled={saving}>
            {saving ? '…' : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Plan Card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, user, lang, onOpenDetail, onTask }) {
  const { t } = useLang();
  const startDate = plan.start_date ? new Date(plan.start_date) : null;
  const now = new Date();
  const daysElapsed = startDate ? Math.floor((now - startDate) / 86400000) : 0;
  const totalDays = (plan.duration_weeks || plan.template_duration_weeks || 4) * 7;
  const daysLeft = Math.max(0, totalDays - daysElapsed);
  const adherence = plan.adherencePct ?? 0;
  const todayTasks = plan.todayTasks || [];
  const todayDoneCount = plan.todayDoneCount || 0;
  const todayProgressPct = Math.round((todayDoneCount / (todayTasks.length || 1)) * 100);

  const taskLabel = tk => (lang === 'zh' ? tk.labelZh : tk.labelEn) || tk.key;

  return (
    <div className="plan-card" onClick={() => onOpenDetail(plan)}>
      <div className="plan-card-top">
        <div>
          <div className="plan-card-name">{plan.name_zh || plan.name_en || plan.template_key}</div>
          <div className="plan-card-type">{plan.plan_type === 'primary' ? t.plPrimary : t.plSecondary}</div>
        </div>
        <div className="plan-card-days">{t.plDaysLeft(daysLeft)}</div>
      </div>
      {(plan.goal_zh || plan.goal_en) && (
        <div className="plan-card-goal">{plan.goal_zh || plan.goal_en}</div>
      )}
      <div className="plan-card-bar-row">
        <div className="plan-card-bar">
          <div className="plan-card-bar-fill" style={{ width: `${adherence}%` }} />
        </div>
        <span className="plan-card-pct">{adherence}%</span>
      </div>
      <div className="plan-daily-section">
        <div className="plan-daily-tasks">
          {todayTasks.map(tk => (
            <button
              key={tk.key}
              className={`plan-task-chip${tk.done ? ' plan-task-done' : ''}`}
              onClick={e => { e.stopPropagation(); onTask(plan, tk.key); }}
            >
              <span>{taskLabel(tk)}</span>
              <span className="plan-task-check">{tk.done ? '✓' : '○'}</span>
            </button>
          ))}
        </div>
        <div className="plan-daily-bar-row">
          <div className="plan-daily-bar-track">
            <div
              className={`plan-daily-bar-fill${todayDoneCount === todayTasks.length ? ' plan-daily-complete' : ''}`}
              style={{ width: `${todayProgressPct}%` }}
            />
          </div>
          <span className="plan-daily-count">{todayDoneCount}/{todayTasks.length} {t.plTodayProgress}</span>
        </div>
      </div>
    </div>
  );
}

// ── Template Browse Sheet ────────────────────────────────────────────────────

function TemplateBrowseSheet({ user, lang, onClose, onJoined }) {
  const { t } = useLang();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(null);

  useEffect(() => {
    if (!user?.channel_id) return;
    axios.get(`${API}/health-plan-templates?channel_id=${user.channel_id}`)
      .then(r => setTemplates(r.data.templates || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [user?.channel_id]);

  const join = async (tpl) => {
    setJoining(tpl.id);
    try {
      await axios.post(`${API}/health-plans`, {
        openid: user.user_id,
        template_id: tpl.id,
        plan_type: 'secondary',
        source: 'self',
      });
      onJoined && onJoined();
    } catch { /* silent */ }
    setJoining(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card plan-detail-card" onClick={e => e.stopPropagation()}>
        <div className="referral-modal-header">
          <span className="modal-title">{t.plBrowseTitle}</span>
          <button className="referral-close-btn" onClick={onClose} aria-label={t.cancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="plan-detail-scroll">
          {loading ? (
            <div className="ac-loading"><span /><span /><span /></div>
          ) : !templates.length ? (
            <div className="ac-empty">{t.plNoTemplates}</div>
          ) : (
            <div className="plan-template-list">
              {templates.map(tpl => (
                <div key={tpl.id} className="plan-template-card">
                  <div className="plan-tpl-name">{lang === 'zh' ? tpl.name_zh : tpl.name_en}</div>
                  {(tpl.desc_zh || tpl.desc_en) && (
                    <div className="plan-tpl-desc">{lang === 'zh' ? tpl.desc_zh : tpl.desc_en}</div>
                  )}
                  <div className="plan-tpl-meta">
                    {tpl.duration_weeks && <span>{t.plWeeks(tpl.duration_weeks)}</span>}
                  </div>
                  <button
                    className="plan-join-btn"
                    onClick={() => join(tpl)}
                    disabled={joining === tpl.id}
                  >
                    {joining === tpl.id ? '…' : t.plJoin}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PlansTab({ user }) {
  const { t, lang } = useLang();
  const [innerTab, setInnerTab] = useState('plans');
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailPlan, setDetailPlan] = useState(null);
  const [weightTask, setWeightTask] = useState(null);
  const [questionsTask, setQuestionsTask] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);

  const loadPlans = () => {
    if (!user?.user_id) return;
    setLoading(true);
    axios.get(`${API}/health-plans?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => {
        const now = Date.now();
        const mapped = (r.data.plans || []).map(p => {
          const totalWeeks = p.duration_weeks || p.template_duration_weeks || 4;
          const startMs = p.start_date ? new Date(p.start_date).getTime() : now;
          const weeksElapsed = Math.max(0, Math.floor((now - startMs) / (7 * 86400000)));
          const progressPct = Math.min(100, Math.round((weeksElapsed / totalWeeks) * 100));
          const checkins = parseInt(p.checkin_count || 0, 10);
          const daysSinceStart = Math.max(1, Math.floor((now - startMs) / 86400000));
          const adherencePct = Math.min(100, Math.round((checkins / daysSinceStart) * 100));
          return { ...p, totalWeeks, weeksDone: weeksElapsed, progressPct, adherencePct, ...deriveTodayTasks(p) };
        });
        setPlans(mapped);
      })
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadPlans, [user?.user_id]);

  const handleTask = async (plan, taskKey) => {
    if (taskBusy) return;
    if (taskKey === 'weight') { setWeightTask(plan); return; }
    if (taskKey === 'questions') { setQuestionsTask(plan); return; }
    if (taskKey === 'dots') {
      setTaskBusy(true);
      try {
        await axios.post(`${API}/health-plans/${plan.id}/checkin`, {
          openid: user.user_id,
          checkin_date: new Date().toISOString().slice(0, 10),
          dots_taken: !plan.today_dots_taken,
          activities_done: plan.today_activities || [],
        });
        loadPlans();
      } catch { /* silent */ } finally { setTaskBusy(false); }
    }
  };

  return (
    <div className="plans-tab">
      {detailPlan && (
        <PlanDetailSheet
          plan={detailPlan}
          user={user}
          lang={lang}
          onClose={() => setDetailPlan(null)}
          onChanged={loadPlans}
        />
      )}
      {weightTask && (
        <WeightEntryModal
          plan={weightTask}
          user={user}
          onClose={() => setWeightTask(null)}
          onDone={() => { setWeightTask(null); loadPlans(); }}
        />
      )}
      {questionsTask && (
        <DailyQuestionsModal
          plan={questionsTask}
          user={user}
          onClose={() => setQuestionsTask(null)}
          onDone={() => { setQuestionsTask(null); loadPlans(); }}
        />
      )}
      {browseOpen && (
        <TemplateBrowseSheet
          user={user}
          lang={lang}
          onClose={() => setBrowseOpen(false)}
          onJoined={() => { setBrowseOpen(false); loadPlans(); }}
        />
      )}

      <div className="ac-sub-tabs">
        <button className={`ac-sub-tab${innerTab === 'plans' ? ' active' : ''}`} onClick={() => setInnerTab('plans')}>
          {t.plInnerPlans}
        </button>
        <button className={`ac-sub-tab${innerTab === 'dots' ? ' active' : ''}`} onClick={() => setInnerTab('dots')}>
          {t.plInnerDots}
        </button>
      </div>

      {innerTab === 'plans' && (
        <div className="plan-list">
          <div className="plans-header-row">
            <button className="plan-join-btn plans-browse-btn" onClick={() => setBrowseOpen(true)}>
              + {t.plBrowseBtn}
            </button>
          </div>
          {loading ? (
            <div className="ac-loading"><span /><span /><span /></div>
          ) : plans.length === 0 ? (
            <div className="ac-empty">
              <div>{t.plNoPlans}</div>
              <button className="plan-join-btn" style={{ marginTop: 12 }} onClick={() => setBrowseOpen(true)}>
                {t.plBrowseBtn} →
              </button>
            </div>
          ) : (
            plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                user={user}
                lang={lang}
                onOpenDetail={setDetailPlan}
                onTask={handleTask}
              />
            ))
          )}
        </div>
      )}

      {innerTab === 'dots' && <DotsView user={user} />}
    </div>
  );
}
