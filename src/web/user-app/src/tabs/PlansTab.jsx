import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import { fmtDate, fmtDateTime } from '../utils.js';

const API = '/api';

// ── Checkin Modal ─────────────────────────────────────────────────────────────

function CheckinModal({ plan, user, onClose, onDone }) {
  const { t } = useLang();
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await axios.post(`${API}/health-plans/${plan.id}/checkin`, {
        openid: user.user_id,
        notes: notes || null,
        checkin_date: new Date().toISOString().slice(0, 10),
      });
      setDone(true);
      setTimeout(onDone, 1200);
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{plan.name_zh || plan.name_en || plan.name}</div>
        {done ? (
          <div className="modal-msg modal-msg--ok">{t.plCheckinSuccess}</div>
        ) : (
          <>
            <div className="modal-desc">{t.plNotes}</div>
            <textarea
              className="modal-textarea"
              placeholder={t.plNotesPlaceholder}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
            />
            <div className="modal-actions">
              <button className="modal-btn modal-btn--ghost" onClick={onClose}>{t.cancel}</button>
              <button className="modal-btn modal-btn--primary" onClick={submit} disabled={saving}>
                {saving ? '…' : t.plCheckin}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Plan Card ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, user, lang, onCheckin, onLeave }) {
  const { t } = useLang();
  const checkedInToday = plan.checked_in_today > 0;
  const startDate = plan.started_at ? new Date(plan.started_at) : null;
  const now = new Date();
  const daysElapsed = startDate ? Math.floor((now - startDate) / 86400000) : 0;
  const totalDays = (plan.duration_weeks || plan.template_duration_weeks || 4) * 7;
  const daysLeft = Math.max(0, totalDays - daysElapsed);
  const checkinCount = parseInt(plan.checkin_count || 0, 10);
  const adherence = totalDays > 0 ? Math.min(100, Math.round((checkinCount / Math.max(1, daysElapsed)) * 100)) : 0;

  return (
    <div className="plan-card">
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
      <div className="plan-card-actions">
        <button
          className={`plan-checkin-btn${checkedInToday ? ' done' : ''}`}
          onClick={() => !checkedInToday && onCheckin(plan)}
          disabled={checkedInToday}
        >
          {checkedInToday ? t.plCheckedIn : t.plCheckin}
        </button>
        <button className="plan-leave-btn" onClick={() => onLeave(plan)}>{t.plLeave}</button>
      </div>
    </div>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

function TemplatesView({ user, lang, onJoined }) {
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

  if (loading) return <div className="ac-loading"><span /><span /><span /></div>;
  if (!templates.length) return <div className="ac-empty">{t.plNoTemplates}</div>;

  return (
    <div className="plan-template-list">
      {templates.map(tpl => (
        <div key={tpl.id} className="plan-template-card">
          <div className="plan-tpl-name">{tpl.name_zh || tpl.name_en}</div>
          {(tpl.desc_zh || tpl.desc_en) && (
            <div className="plan-tpl-desc">{tpl.desc_zh || tpl.desc_en}</div>
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
  );
}

// ── Events ────────────────────────────────────────────────────────────────────

function EventsView({ user, lang }) {
  const { t } = useLang();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const load = () => {
    if (!user?.channel_id) { setLoading(false); return; }
    axios.get(`${API}/events?openid=${encodeURIComponent(user.user_id)}&channel_id=${user.channel_id}`)
      .then(r => setEvents(r.data.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.user_id, user?.channel_id]);

  const signup = async (ev) => {
    setActing(ev.id);
    try {
      await axios.post(`${API}/events/${ev.id}/signups`, { user_id: user.user_id });
      load();
    } catch { /* silent */ }
    setActing(null);
  };

  const cancel = async (ev) => {
    setActing(ev.id);
    try {
      await axios.delete(`${API}/events/${ev.id}/signups?openid=${encodeURIComponent(user.user_id)}`);
      load();
    } catch { /* silent */ }
    setActing(null);
  };

  if (loading) return <div className="ac-loading"><span /><span /><span /></div>;
  if (!events.length) return <div className="ac-empty">{t.evNoEvents}</div>;

  return (
    <div className="ev-list">
      {events.map(ev => {
        const signedUp = ev.signed_up;
        const isFull = ev.capacity && parseInt(ev.signup_count, 10) >= parseInt(ev.capacity, 10);
        return (
          <div key={ev.id} className={`ev-card${signedUp ? ' ev-card--mine' : ''}`}>
            <div className="ev-card-title">{ev.title}</div>
            {ev.description && <div className="ev-card-desc">{ev.description}</div>}
            <div className="ev-card-meta">
              <div className="ev-meta-row">
                <span className="ev-meta-key">{t.evDate}</span>
                <span className="ev-meta-val">{fmtDateTime(ev.scheduled_at, lang)}</span>
              </div>
              {ev.location && (
                <div className="ev-meta-row">
                  <span className="ev-meta-key">{t.evLocation}</span>
                  <span className="ev-meta-val">{ev.location}</span>
                </div>
              )}
              {ev.capacity && (
                <div className="ev-meta-row">
                  <span className="ev-meta-key">已报名</span>
                  <span className="ev-meta-val">{t.evCapacity(ev.signup_count, ev.capacity)}</span>
                </div>
              )}
            </div>
            <div className="ev-card-footer">
              {signedUp ? (
                <>
                  <span className="ev-badge-signed">{t.evSignedUp}</span>
                  <button className="ev-cancel-btn" onClick={() => cancel(ev)} disabled={acting === ev.id}>
                    {acting === ev.id ? '…' : t.evCancelSignup}
                  </button>
                </>
              ) : isFull ? (
                <span className="ev-badge-full">{t.evFull}</span>
              ) : (
                <button className="ev-signup-btn" onClick={() => signup(ev)} disabled={acting === ev.id}>
                  {acting === ev.id ? '…' : t.evSignUp}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PlansTab({ user }) {
  const { t, lang } = useLang();
  const [subTab, setSubTab] = useState('plans');
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkinPlan, setCheckinPlan] = useState(null);
  const [leavingPlan, setLeavingPlan] = useState(null);

  const loadPlans = () => {
    if (!user?.user_id) return;
    setLoading(true);
    axios.get(`${API}/health-plans?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => setPlans(r.data.plans || []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  };

  useEffect(loadPlans, [user?.user_id]);

  const handleLeave = async (plan) => {
    if (!window.confirm(t.plConfirmLeave)) return;
    try {
      await axios.put(`${API}/health-plans/${plan.id}`, { openid: user.user_id, status: 'abandoned' });
      loadPlans();
    } catch { /* silent */ }
  };

  const subTabs = [
    { key: 'plans',     label: t.plMyPlans },
    { key: 'templates', label: t.plTemplates },
    { key: 'events',    label: t.plEvents },
  ];

  return (
    <div className="plans-tab">
      {checkinPlan && (
        <CheckinModal
          plan={checkinPlan}
          user={user}
          onClose={() => setCheckinPlan(null)}
          onDone={() => { setCheckinPlan(null); loadPlans(); }}
        />
      )}

      <div className="ac-sub-tabs">
        {subTabs.map(s => (
          <button key={s.key} className={`ac-sub-tab${subTab === s.key ? ' active' : ''}`} onClick={() => setSubTab(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {subTab === 'plans' && (
        <div className="plan-list">
          {loading ? (
            <div className="ac-loading"><span /><span /><span /></div>
          ) : plans.length === 0 ? (
            <div className="ac-empty">
              <div>{t.plNoPlans}</div>
              <button className="plan-join-btn" style={{ marginTop: 12 }} onClick={() => setSubTab('templates')}>
                {t.plTemplates} →
              </button>
            </div>
          ) : (
            plans.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                user={user}
                lang={lang}
                onCheckin={setCheckinPlan}
                onLeave={handleLeave}
              />
            ))
          )}
        </div>
      )}

      {subTab === 'templates' && (
        <TemplatesView user={user} lang={lang} onJoined={() => { setSubTab('plans'); loadPlans(); }} />
      )}

      {subTab === 'events' && <EventsView user={user} lang={lang} />}
    </div>
  );
}
