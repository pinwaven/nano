import { useState, useEffect } from 'react';
import axios from 'axios';
import { useLang } from '../i18n.js';
import EventsView from './EventsView.jsx';

const API = '/api';

export default function PlanDetailSheet({ plan, user, lang, onClose, onChanged }) {
  const { t } = useLang();
  const [detail, setDetail] = useState(plan);
  const [reminders, setReminders] = useState([]);
  const [subTab, setSubTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan?.id || !user?.user_id) return;
    axios.get(`${API}/health-plans/${plan.id}?openid=${encodeURIComponent(user.user_id)}`)
      .then(r => {
        if (r.data.success) {
          setDetail({ ...plan, ...r.data.plan });
          setReminders(r.data.reminders || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [plan?.id, user?.user_id]);

  const toggleReminder = async (reminder) => {
    const newStatus = reminder.status === 'paused' ? 'pending' : 'paused';
    try {
      await axios.patch(`${API}/plan-reminders/${reminder.id}`, { openid: user.user_id, status: newStatus });
      setReminders(rs => rs.map(r => r.id === reminder.id ? { ...r, status: newStatus } : r));
    } catch { /* ignore */ }
  };

  const abandonPlan = async () => {
    if (!window.confirm(t.plConfirmAbandon)) return;
    setBusy(true);
    try {
      await axios.put(`${API}/health-plans/${plan.id}`, { openid: user.user_id, status: 'abandoned' });
      onChanged && onChanged();
      onClose();
    } catch { /* silent */ } finally { setBusy(false); }
  };

  const switchType = async () => {
    if (!window.confirm(t.plConfirmSwitch)) return;
    const newType = detail.plan_type === 'primary' ? 'secondary' : 'primary';
    setBusy(true);
    try {
      await axios.put(`${API}/health-plans/${plan.id}`, { openid: user.user_id, plan_type: newType });
      onChanged && onChanged();
      onClose();
    } catch { /* silent */ } finally { setBusy(false); }
  };

  const timeDisplay = r => {
    const d = new Date(r.scheduled_for);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const subTabs = [
    { key: 'overview',   label: t.plDetailOverview },
    { key: 'progress',   label: t.plProgress },
    { key: 'activities', label: t.plActivities },
    { key: 'guidance',   label: t.plDetailGuidance },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card plan-detail-card" onClick={e => e.stopPropagation()}>
        <div className="referral-modal-header">
          <span className="modal-title">{lang === 'zh' ? detail.name_zh : detail.name_en}</span>
          <button className="referral-close-btn" onClick={onClose} aria-label={t.cancel}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="ac-sub-tabs">
          {subTabs.map(s => (
            <button key={s.key} className={`ac-sub-tab${subTab === s.key ? ' active' : ''}`} onClick={() => setSubTab(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="ac-loading"><span /><span /><span /></div>
        ) : (
          <div className="plan-detail-scroll">
            {subTab === 'overview' && (
              <>
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plGoal}</span>
                  <span className="plan-detail-value">{lang === 'zh' ? detail.goal_zh : detail.goal_en}</span>
                </div>
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plStartDate}</span>
                  <span className="plan-detail-value">{detail.start_date}</span>
                </div>
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plDuration}</span>
                  <span className="plan-detail-value">{t.plWeeks(detail.totalWeeks || detail.duration_weeks || detail.template_duration_weeks || 0)}</span>
                </div>
                {detail.target_sub_ages?.length > 0 && (
                  <div className="plan-detail-section">
                    <span className="plan-detail-label">{t.plTargetSubAges}</span>
                    <div className="plan-chips-row">
                      {detail.target_sub_ages.map((sa, i) => <span key={i} className="plan-chip">{sa}</span>)}
                    </div>
                  </div>
                )}
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plReminders}</span>
                  {reminders.length === 0 ? (
                    <div className="plan-empty-hint">{t.plNoReminders}</div>
                  ) : (
                    reminders.map(r => (
                      <div key={r.id} className="plan-reminder-row">
                        <div className="plan-reminder-info">
                          <span className="plan-reminder-time">{timeDisplay(r)}</span>
                          <span className="plan-reminder-content">{r.content}</span>
                        </div>
                        <button
                          className={`plan-reminder-toggle${r.status === 'paused' ? ' reminder-paused' : ' reminder-active'}`}
                          onClick={() => toggleReminder(r)}
                        >
                          {r.status === 'paused' ? t.plReminderResume : t.plReminderPause}
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="plan-actions-row">
                  <button className="plan-action-btn" onClick={switchType} disabled={busy}>{t.plSwitchType}</button>
                  <button className="plan-action-btn plan-action-abandon" onClick={abandonPlan} disabled={busy}>{t.plAbandon}</button>
                </div>
              </>
            )}

            {subTab === 'progress' && (
              <>
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plAdherence}</span>
                  <span className="plan-detail-value">{detail.adherencePct ?? 0}% ({t.plCheckins(detail.checkin_count || 0)})</span>
                </div>
                <div className="plan-detail-section">
                  <span className="plan-detail-label">{t.plWeeksLabel}</span>
                  <span className="plan-detail-value">{detail.weeksDone ?? 0}/{detail.totalWeeks ?? detail.duration_weeks}</span>
                </div>
                <div className="plan-empty-hint">{t.plNoMilestones}</div>
              </>
            )}

            {subTab === 'activities' && <EventsView user={user} lang={lang} />}

            {subTab === 'guidance' && (
              <>
                <div className="plan-detail-section">
                  <span className="plan-detail-value">{lang === 'zh' ? (detail.desc_zh || detail.goal_zh) : (detail.desc_en || detail.goal_en)}</span>
                </div>
                {detail.recommended_dot_ids?.length > 0 && (
                  <div className="plan-detail-section">
                    <span className="plan-detail-label">{t.plRecommendedDots}</span>
                    <div className="plan-chips-row">
                      {detail.recommended_dot_ids.map((id, i) => <span key={i} className="plan-chip plan-chip-dot">DOT{id}</span>)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
