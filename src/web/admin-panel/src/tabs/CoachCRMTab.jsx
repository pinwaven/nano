import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  X, Plus, Trash2, Check, Filter, Eye, Send, FileText, Users, UserCog,
  Activity, TrendingUp, AlertCircle, Layout, ClipboardList, Calendar, Video,
  Target, Award, MessageSquare,
} from 'lucide-react';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { useLang, Badge, StatCard } from '../shared.jsx';

const STAGE_COLORS = {
  lead: '#f59e0b', onboarding: '#6375EC', active: '#10b981',
  at_risk: '#ef4444', churned: '#6b7280', graduated: '#0ea5e9',
};
const STAGE_KEYS = ['lead', 'onboarding', 'active', 'at_risk', 'churned', 'graduated'];

const crmDaysSince = (d) => d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : null;
const crmBioAgeDelta = (c) => (c.latest_bio_age && c.chrono_age)
  ? parseFloat(c.latest_bio_age) - parseFloat(c.chrono_age)
  : null;

const CRM_ACTIVITY_META = {
  stage_changed:         { icon: Filter,        color: '#6375EC' },
  note_added:            { icon: FileText,      color: '#f59e0b' },
  bulk_message_sent:     { icon: Send,          color: '#3b82f6' },
  appointment_scheduled: { icon: Calendar,      color: '#8b5cf6' },
  appointment_completed: { icon: Check,         color: '#10b981' },
  goal_set:              { icon: Target,        color: '#0ea5e9' },
  goal_achieved:         { icon: Award,         color: '#10b981' },
  nps_received:          { icon: MessageSquare, color: '#ec4899' },
};

function CrmAvatar({ name, url, size = 28 }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.42), fontWeight: 700, color: '#fff', background: `hsl(${h},55%,55%)`,
    }}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}

function CrmClientCard({ client: c, tagColors, onClick }) {
  const { t } = useLang();
  const tc = t.coachCrm;
  const delta = crmBioAgeDelta(c);
  const dStage = crmDaysSince(c.stage_changed_at);
  return (
    <div className="crm-card" draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', c.user_id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onClick}>
      <div className="crm-card-head">
        <CrmAvatar name={c.nickname || c.user_id} url={c.avatar_url} size={26} />
        <span className="crm-card-name">{c.nickname || c.user_id}</span>
        {delta !== null && (
          <span className="crm-card-delta" style={{ color: delta < 0 ? '#10b981' : '#ef4444' }}>
            {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
          </span>
        )}
      </div>
      {(c.crm_tags || []).length > 0 && (
        <div className="crm-card-tags">
          {c.crm_tags.map(tag => (
            <span key={tag} className="tag-chip" style={{ background: (tagColors[tag] || '#6375EC') + '1c', color: tagColors[tag] || '#6375EC' }}>{tag}</span>
          ))}
        </div>
      )}
      <div className="crm-card-foot">
        <span>{c.last_scan_at ? new Date(c.last_scan_at).toLocaleDateString() : tc.neverScanned}</span>
        {dStage !== null && <span>{tc.daysInStage(dStage)}</span>}
      </div>
    </div>
  );
}

function CrmKanban({ pipeline, stageLabels, tagColors, onStageChange, onOpenClient }) {
  const { t } = useLang();
  const tc = t.coachCrm;
  const [dragOver, setDragOver] = useState(null);
  return (
    <div className="crm-board">
      {STAGE_KEYS.map(stage => {
        const cards = pipeline.filter(c => (c.crm_stage || 'lead') === stage);
        return (
          <div key={stage}
            className={`crm-col${dragOver === stage ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(stage); }}
            onDragLeave={() => setDragOver(d => (d === stage ? null : d))}
            onDrop={e => {
              e.preventDefault(); setDragOver(null);
              const uid = e.dataTransfer.getData('text/plain');
              if (uid) onStageChange(uid, stage);
            }}>
            <div className="crm-col-header" style={{ borderTopColor: STAGE_COLORS[stage] }}>
              <span className="crm-col-dot" style={{ background: STAGE_COLORS[stage] }} />
              <span className="crm-col-title">{stageLabels[stage]}</span>
              <span className="crm-col-count">{cards.length}</span>
            </div>
            <div className="crm-col-body">
              {cards.length === 0 && <div className="crm-col-empty">{tc.noClientsInStage}</div>}
              {cards.map(c => (
                <CrmClientCard key={c.user_id} client={c} tagColors={tagColors} onClick={() => onOpenClient(c)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CrmActivityTimeline({ items, stageLabels, emptyText }) {
  const { t } = useLang();
  const tc = t.coachCrm;
  if (!items.length) return <p className="muted" style={{ fontSize: 13 }}>{emptyText}</p>;
  return (
    <div className="crm-timeline">
      {items.map(a => {
        const meta = CRM_ACTIVITY_META[a.activity_type] || { icon: Activity, color: '#64748b' };
        const Icon = meta.icon;
        const md = a.metadata || {};
        let detail = '';
        if (a.activity_type === 'stage_changed' && md.stage) detail = stageLabels[md.stage] || md.stage;
        else if (a.activity_type === 'appointment_scheduled' && md.title) detail = md.title;
        else if (a.activity_type === 'goal_set' && md.title_zh) detail = md.title_zh;
        return (
          <div key={a.id} className="crm-tl-item">
            <div className="crm-tl-icon" style={{ background: meta.color + '1c', color: meta.color }}>
              <Icon size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="crm-tl-title">
                {a.nickname ? `${a.nickname} · ` : ''}{tc.activityLabels[a.activity_type] || a.activity_type}
                {detail && <span style={{ fontWeight: 400, color: '#64748b' }}> — {detail}</span>}
              </div>
              <div className="crm-tl-sub">{new Date(a.occurred_at).toLocaleString()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CrmClientDrawer({ client, coachId, stageLabels, tagColors, onStageChange, onClose }) {
  const { t, lang } = useLang();
  const tc = t.coachCrm;
  const [tab, setTab] = useState('overview');
  const [notes, setNotes] = useState([]);
  const [activity, setActivity] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, a, g] = await Promise.all([
        axios.get(`/api/coach-notes?coach_id=${coachId}&user_id=${client.user_id}`).then(r => r.data.notes || []).catch(() => []),
        axios.get(`/api/client-activity?coach_id=${coachId}&user_id=${client.user_id}`).then(r => r.data.activities || []).catch(() => []),
        axios.get(`/api/client-goals?coach_id=${coachId}&user_id=${client.user_id}`).then(r => r.data.goals || []).catch(() => []),
      ]);
      setNotes(n); setActivity(a); setGoals(g);
    } finally { setLoading(false); }
  }, [coachId, client.user_id]);

  useEffect(() => { load(); }, [load]);

  const addNote = async () => {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      await axios.post('/api/coach-notes', { coach_id: parseInt(coachId), user_id: client.user_id, content: noteDraft.trim() });
      setNoteDraft('');
      load();
    } catch (e) { alert(e.response?.data?.error || 'Save failed'); }
    finally { setSavingNote(false); }
  };

  const togglePin = async (n) => {
    try { await axios.put(`/api/coach-notes/${n.id}`, { is_pinned: !n.is_pinned }); load(); }
    catch (e) { console.error(e); }
  };

  const delNote = async (n) => {
    if (!confirm(tc.confirmDeleteNote)) return;
    try { await axios.delete(`/api/coach-notes/${n.id}`); load(); }
    catch (e) { console.error(e); }
  };

  const goalProgress = (g) => {
    const base = parseFloat(g.baseline_value), cur = parseFloat(g.current_value), tgt = parseFloat(g.target_value);
    if (isNaN(base) || isNaN(cur) || isNaN(tgt) || base === tgt) return null;
    return Math.max(0, Math.min(1, (base - cur) / (base - tgt)));
  };

  const stage = client.crm_stage || 'lead';
  const delta = crmBioAgeDelta(client);
  const dStage = crmDaysSince(client.stage_changed_at);
  const DRAWER_TABS = [
    { id: 'overview', label: tc.drawerOverview },
    { id: 'notes',    label: `${tc.drawerNotes}${notes.length ? ` (${notes.length})` : ''}` },
    { id: 'activity', label: tc.drawerActivity },
    { id: 'goals',    label: `${tc.drawerGoals}${goals.length ? ` (${goals.length})` : ''}` },
  ];

  return (
    <div className="crm-drawer-overlay" onClick={onClose}>
      <div className="crm-drawer" onClick={e => e.stopPropagation()}>
        <div className="crm-drawer-header">
          <CrmAvatar name={client.nickname || client.user_id} url={client.avatar_url} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {client.nickname || client.user_id}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.user_id}</div>
          </div>
          <select className="inline-select" value={stage}
            style={{ color: STAGE_COLORS[stage], fontWeight: 600 }}
            onChange={e => onStageChange(client.user_id, e.target.value)}>
            {STAGE_KEYS.map(k => <option key={k} value={k}>{stageLabels[k]}</option>)}
          </select>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="crm-drawer-tabs">
          {DRAWER_TABS.map(dt => (
            <button key={dt.id} className={`crm-drawer-tab${tab === dt.id ? ' active' : ''}`} onClick={() => setTab(dt.id)}>
              {dt.label}
            </button>
          ))}
        </div>

        <div className="crm-drawer-body">
          {loading && <p className="muted" style={{ fontSize: 13 }}>{tc.loading}</p>}

          {!loading && tab === 'overview' && (
            <>
              <div className="crm-statbox-row" style={{ marginBottom: 14 }}>
                <div className="crm-statbox">
                  <b>{client.chrono_age ?? '—'}</b>
                  <span>{tc.chronoAge}</span>
                </div>
                <div className="crm-statbox">
                  <b>{client.latest_bio_age ? parseFloat(client.latest_bio_age).toFixed(1) : '—'}</b>
                  <span>{tc.bioAge}</span>
                </div>
                <div className="crm-statbox">
                  <b style={{ color: delta === null ? undefined : delta < 0 ? '#10b981' : '#ef4444' }}>
                    {delta === null ? '—' : (delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1))}
                  </b>
                  <span>{tc.deltaLabel}</span>
                </div>
              </div>
              <div className="crm-statbox-row" style={{ marginBottom: 14, gridTemplateColumns: '1fr 1fr' }}>
                <div className="crm-statbox">
                  <b style={{ fontSize: 14 }}>{client.last_scan_at ? new Date(client.last_scan_at).toLocaleDateString() : tc.neverScanned}</b>
                  <span>{tc.colLastScan}</span>
                </div>
                <div className="crm-statbox">
                  <b style={{ fontSize: 14 }}>{dStage !== null ? tc.daysInStage(dStage) : '—'}</b>
                  <span>{stageLabels[stage]}</span>
                </div>
              </div>
              {(client.crm_tags || []).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="form-label-text">{tc.tagsLabel}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {client.crm_tags.map(tag => (
                      <span key={tag} className="tag-chip" style={{ fontSize: 11, background: (tagColors[tag] || '#6375EC') + '1c', color: tagColors[tag] || '#6375EC' }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {client.note && (
                <div>
                  <div className="form-label-text">{tc.stageNoteLabel}</div>
                  <div style={{ fontSize: 13, color: '#475569', background: '#f8fafc', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                    {client.note}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && tab === 'notes' && (
            <>
              <div style={{ marginBottom: 14 }}>
                <textarea className="form-input" rows={3} value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  placeholder={tc.notePlaceholder}
                  style={{ width: '100%', resize: 'vertical' }} />
                <button className="btn-primary" style={{ marginTop: 8, padding: '6px 14px', fontSize: 12 }}
                  disabled={savingNote || !noteDraft.trim()} onClick={addNote}>
                  <Plus size={13} /> {tc.addNote}
                </button>
              </div>
              {notes.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{tc.noNotes}</p>}
              {notes.map(n => (
                <div key={n.id} className={`crm-note${n.is_pinned ? ' pinned' : ''}`}>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.content}</div>
                  <div className="crm-note-meta">
                    <span>{new Date(n.created_at).toLocaleString()}</span>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => togglePin(n)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px 4px', fontSize: 11, fontWeight: 600, color: n.is_pinned ? '#d97706' : '#94a3b8' }}>
                      {n.is_pinned ? tc.unpin : tc.pin}
                    </button>
                    <button className="icon-btn danger" onClick={() => delNote(n)}><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
            </>
          )}

          {!loading && tab === 'activity' && (
            <CrmActivityTimeline items={activity} stageLabels={stageLabels} emptyText={tc.noActivity} />
          )}

          {!loading && tab === 'goals' && (
            <>
              {goals.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{tc.noGoals}</p>}
              {goals.map(g => {
                const prog = goalProgress(g);
                const statusColor = g.status === 'achieved' ? '#10b981' : g.status === 'cancelled' ? '#6b7280' : '#3b82f6';
                return (
                  <div key={g.id} className="crm-note" style={{ borderColor: 'var(--border)', background: '#fff' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>
                        {(lang === 'en' && g.title_en) ? g.title_en : g.title_zh}
                      </span>
                      <Badge color={statusColor}>{tc.goalStatus[g.status] || g.status}</Badge>
                    </div>
                    {prog !== null && (
                      <div style={{ marginTop: 8 }}>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${Math.round(prog * 100)}%`, background: statusColor }} />
                        </div>
                      </div>
                    )}
                    <div className="crm-note-meta" style={{ gap: 14 }}>
                      {g.baseline_value != null && <span>{tc.goalBaseline}: <b>{g.baseline_value}</b></span>}
                      {g.current_value != null && <span>{tc.goalCurrent}: <b>{g.current_value}</b></span>}
                      {g.target_value != null && <span>{tc.goalTarget}: <b>{g.target_value}{g.target_unit ? ` ${g.target_unit}` : ''}</b></span>}
                      {g.target_date && <span>{tc.goalDue}: {new Date(g.target_date).toLocaleDateString()}</span>}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignRecipientsModal({ campaign, onClose }) {
  const { t } = useLang();
  const tc = t.coachCrm;
  const [recips, setRecips] = useState(null);

  useEffect(() => {
    axios.get(`/api/bulk-campaigns/${campaign.id}/recipients`)
      .then(r => setRecips(r.data.recipients || []))
      .catch(() => setRecips([]));
  }, [campaign.id]);

  const STATUS_COLOR = { sent: '#10b981', pending: '#f59e0b', failed: '#ef4444' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{tc.modalRecipients(campaign.title)}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {recips === null ? (
            <p className="muted" style={{ fontSize: 13, padding: 20 }}>{tc.loading}</p>
          ) : (
            <table className="data-table">
              <thead><tr><th>{tc.colUser}</th><th>{tc.colStatus}</th><th>{tc.colSent}</th></tr></thead>
              <tbody>
                {recips.length === 0 && <tr><td colSpan={3} className="empty-row">—</td></tr>}
                {recips.map(r => (
                  <tr key={r.user_id}>
                    <td>
                      <div className="avatar-cell">
                        <CrmAvatar name={r.nickname || r.user_id} url={r.avatar_url} size={24} />
                        <span style={{ fontSize: 13 }}>{r.nickname || r.user_id}</span>
                      </div>
                    </td>
                    <td><Badge color={STATUS_COLOR[r.status] || '#64748b'}>{r.status}</Badge></td>
                    <td style={{ fontSize: 11, color: '#64748b' }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{tc.cancel}</button>
        </div>
      </div>
    </div>
  );
}

export function CoachCRMTab({ coaches, users }) {
  const { t } = useLang();
  const tc = t.coachCrm;

  const stageLabels = {
    lead: tc.stageLead, onboarding: tc.stageOnboarding, active: tc.stageActive,
    at_risk: tc.stageAtRisk, churned: tc.stageChurned, graduated: tc.stageGraduated,
  };
  const [sub, setSub] = useState('pipeline');
  const [selectedCoachId, setSelectedCoachId] = useState('');
  const [pipeline, setPipeline] = useState([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [view, setView] = useState('board');
  const [searchQ, setSearchQ] = useState('');
  const [coachTags, setCoachTags] = useState([]);
  const [drawerClient, setDrawerClient] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [recipCampaign, setRecipCampaign] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [kpiRows, setKpiRows] = useState([]);
  const [kpiLoading, setKpiLoading] = useState(false);
  const [kpiSort, setKpiSort] = useState({ key: 'total_clients', dir: 'desc' });
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupKpis, setGroupKpis] = useState(null);
  const [groupKpiLoading, setGroupKpiLoading] = useState(false);
  const [npsRows, setNpsRows] = useState([]);
  const [npsLoading, setNpsLoading] = useState(false);
  const [npsCoachFilter, setNpsCoachFilter] = useState('');
  const [npsStart, setNpsStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [npsEnd, setNpsEnd] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [campaignModal, setCampaignModal] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ title: '', content: '', stage: '', template_id: '' });
  const [sending, setSending] = useState(null);
  const [feed, setFeed] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);

  const loadPipeline = useCallback(async (coachId) => {
    if (!coachId) return;
    setPipelineLoading(true);
    try {
      const [pr, tr] = await Promise.all([
        axios.get(`/api/client-pipeline?coach_id=${coachId}`),
        axios.get(`/api/coach-tags?coach_id=${coachId}`).catch(() => ({ data: { tags: [] } })),
      ]);
      setPipeline(pr.data.clients || []);
      setCoachTags(tr.data.tags || []);
    } catch (e) { console.error(e); }
    finally { setPipelineLoading(false); }
  }, []);

  const loadCampaigns = useCallback(async (coachId) => {
    if (!coachId) return;
    setCampaignsLoading(true);
    try {
      const [cr, tr] = await Promise.all([
        axios.get(`/api/bulk-campaigns?coach_id=${coachId}`),
        axios.get(`/api/message-templates?coach_id=${coachId}`).catch(() => ({ data: { templates: [] } })),
      ]);
      setCampaigns(cr.data.campaigns || []);
      setTemplates(tr.data.templates || []);
    } catch (e) { console.error(e); }
    finally { setCampaignsLoading(false); }
  }, []);

  const loadFeed = useCallback(async (coachId) => {
    if (!coachId) return;
    setFeedLoading(true);
    try {
      const [f, u] = await Promise.all([
        axios.get(`/api/coach-activity-feed?coach_id=${coachId}&limit=50`).then(r => r.data.activities || []).catch(() => []),
        axios.get(`/api/appointments/upcoming?coach_id=${coachId}`).then(r => r.data.appointments || []).catch(() => []),
      ]);
      setFeed(f); setUpcoming(u);
    } finally { setFeedLoading(false); }
  }, []);

  const loadKPIs = useCallback(async () => {
    setKpiLoading(true);
    try {
      const rows = await Promise.all(
        coaches.map(c => axios.get(`/api/coach-kpis?coach_id=${c.id}&period=${period}`)
          .then(r => ({ ...(r.data.kpis || {}), coach_id: c.id, coach_name: c.name }))
          .catch(() => ({ coach_id: c.id, coach_name: c.name })))
      );
      setKpiRows(rows);
    } catch (e) { console.error(e); }
    finally { setKpiLoading(false); }
  }, [coaches, period]);

  const loadNPS = useCallback(async () => {
    setNpsLoading(true);
    try {
      const params = new URLSearchParams();
      if (npsStart) params.set('start', npsStart);
      if (npsEnd) params.set('end', npsEnd);
      const r = await axios.get(`/api/nps-surveys?${params}`);
      setNpsRows(r.data.surveys || []);
    } catch (e) { console.error(e); }
    finally { setNpsLoading(false); }
  }, [npsStart, npsEnd]);

  const loadGroupKPIs = useCallback(async () => {
    if (!selectedGroupId) return;
    setGroupKpiLoading(true);
    try {
      const r = await axios.get(`/api/coach-group-kpis?group_id=${selectedGroupId}&period=${period}`);
      setGroupKpis(r.data.kpis || null);
    } catch (e) { console.error(e); }
    finally { setGroupKpiLoading(false); }
  }, [selectedGroupId, period]);

  useEffect(() => {
    const channelIds = [...new Set(coaches.map(c => c.channel_id).filter(Boolean))];
    if (!channelIds.length) return;
    Promise.all(
      channelIds.map(cid =>
        axios.get(`/api/coach-groups?channel_id=${cid}`)
          .then(r => r.data.groups || [])
          .catch(() => [])
      )
    ).then(results => setGroups(results.flat()));
  }, [coaches]);

  // Auto-select the top-performing coach (most clients) on first load
  useEffect(() => {
    if (coaches.length && !selectedCoachId) {
      const top = [...coaches].sort((a, b) => (parseInt(b.user_count) || 0) - (parseInt(a.user_count) || 0))[0];
      if (top) setSelectedCoachId(String(top.id));
    }
  }, [coaches, selectedCoachId]);

  // Auto-select the largest group on first load
  useEffect(() => {
    if (groups.length && !selectedGroupId) {
      const top = [...groups].sort((a, b) => (parseInt(b.coach_count) || 0) - (parseInt(a.coach_count) || 0))[0];
      if (top) setSelectedGroupId(String(top.id));
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (sub === 'pipeline' && selectedCoachId) loadPipeline(selectedCoachId);
    if (sub === 'campaigns' && selectedCoachId) loadCampaigns(selectedCoachId);
    if (sub === 'activity' && selectedCoachId) loadFeed(selectedCoachId);
    if (sub === 'performance') loadKPIs();
    if (sub === 'nps') loadNPS();
    if (sub === 'groups' && selectedGroupId) {
      loadGroupKPIs();
      loadKPIs();
    }
  }, [sub, selectedCoachId, loadPipeline, loadCampaigns, loadFeed, loadKPIs, loadNPS, loadGroupKPIs, selectedGroupId]);

  const handleCoachChange = (e) => {
    const id = e.target.value;
    setSelectedCoachId(id);
    setDrawerClient(null);
    if (sub === 'pipeline') loadPipeline(id);
    if (sub === 'campaigns') loadCampaigns(id);
    if (sub === 'activity') loadFeed(id);
  };

  const handleStageChange = async (userId, newStage) => {
    const client = pipeline.find(c => c.user_id === userId);
    if (!client || (client.crm_stage || 'lead') === newStage) return;
    const prev = pipeline;
    const now = new Date().toISOString();
    setPipeline(p => p.map(c => c.user_id === userId ? { ...c, crm_stage: newStage, stage_changed_at: now } : c));
    setDrawerClient(d => d && d.user_id === userId ? { ...d, crm_stage: newStage, stage_changed_at: now } : d);
    try {
      await axios.post('/api/client-pipeline', {
        coach_id: parseInt(selectedCoachId), user_id: userId, stage: newStage, note: client.note || undefined,
      });
    } catch (e) {
      setPipeline(prev);
      setDrawerClient(d => d && d.user_id === userId ? { ...d, crm_stage: client.crm_stage, stage_changed_at: client.stage_changed_at } : d);
      alert(tc.moveFailed);
    }
  };

  const sendCampaign = async (id) => {
    setSending(id);
    try {
      await axios.post(`/api/bulk-campaigns/${id}/send`);
      if (selectedCoachId) loadCampaigns(selectedCoachId);
    } catch (e) { console.error(e); }
    finally { setSending(null); }
  };

  const createCampaign = async () => {
    if (!selectedCoachId || !newCampaign.title || !newCampaign.content) return;
    try {
      const filter = newCampaign.stage ? { stage: [newCampaign.stage] } : {};
      await axios.post('/api/bulk-campaigns', {
        coach_id: parseInt(selectedCoachId),
        title: newCampaign.title,
        content: newCampaign.content,
        target_filter: filter,
        template_id: newCampaign.template_id ? parseInt(newCampaign.template_id) : undefined,
      });
      setCampaignModal(false);
      setNewCampaign({ title: '', content: '', stage: '', template_id: '' });
      loadCampaigns(selectedCoachId);
    } catch (e) { console.error(e); }
  };

  const applyTemplate = (tplId) => {
    setNewCampaign(p => {
      const tpl = templates.find(x => String(x.id) === String(tplId));
      if (!tpl) return { ...p, template_id: tplId };
      return {
        ...p,
        template_id: tplId,
        title: p.title || tpl.title,
        content: tpl.content_zh || tpl.content_en || p.content,
      };
    });
  };

  // Tag name → color map for chips
  const tagColors = {};
  coachTags.forEach(tg => { tagColors[tg.name] = tg.color_hex; });

  // Search filter over pipeline
  const q = searchQ.trim().toLowerCase();
  const visiblePipeline = q
    ? pipeline.filter(c =>
        (c.nickname || '').toLowerCase().includes(q) ||
        String(c.user_id).toLowerCase().includes(q) ||
        (c.crm_tags || []).some(tag => tag.toLowerCase().includes(q)))
    : pipeline;

  // Pipeline summary stats
  const scannedCount = pipeline.filter(c => c.last_scan_at).length;
  const atRiskCount = pipeline.filter(c => (c.crm_stage || 'lead') === 'at_risk').length;
  const activeCount = pipeline.filter(c => (c.crm_stage || 'lead') === 'active').length;
  const deltas = pipeline.map(crmBioAgeDelta).filter(d => d !== null);
  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

  // Performance: sorting + totals
  const sortedKpis = [...kpiRows].sort((a, b) => {
    if (kpiSort.key === 'coach_name') {
      const cmp = String(a.coach_name || '').localeCompare(String(b.coach_name || ''));
      return kpiSort.dir === 'asc' ? cmp : -cmp;
    }
    const av = parseFloat(a[kpiSort.key]) || 0;
    const bv = parseFloat(b[kpiSort.key]) || 0;
    return kpiSort.dir === 'asc' ? av - bv : bv - av;
  });
  const kpiTotals = kpiRows.reduce((acc, r) => {
    ['total_clients', 'active_clients', 'at_risk_count', 'scans_facilitated', 'plans_assigned', 'messages_sent', 'appointments_held'].forEach(k => {
      acc[k] = (acc[k] || 0) + (parseInt(r[k]) || 0);
    });
    acc.commission_cny = (acc.commission_cny || 0) + (parseFloat(r.commission_cny) || 0);
    const n = parseFloat(r.avg_nps_score);
    if (!isNaN(n)) { acc._npsSum += n; acc._npsCnt++; }
    return acc;
  }, { _npsSum: 0, _npsCnt: 0 });
  const kpiChartData = kpiRows.map(r => ({
    name: r.coach_name,
    clients: parseInt(r.total_clients) || 0,
    scans: parseInt(r.scans_facilitated) || 0,
  }));
  const SortTh = ({ k, children }) => (
    <th className="th-sort" onClick={() => setKpiSort(s => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}>
      {children}{kpiSort.key === k ? (kpiSort.dir === 'desc' ? ' ▾' : ' ▴') : ''}
    </th>
  );

  // NPS aggregates (respect coach filter)
  const filteredNps = npsCoachFilter ? npsRows.filter(r => String(r.coach_id) === npsCoachFilter) : npsRows;
  const promoters   = filteredNps.filter(r => r.score >= 9).length;
  const passives    = filteredNps.filter(r => r.score >= 7 && r.score <= 8).length;
  const detractors  = filteredNps.filter(r => r.score !== null && r.score <= 6).length;
  const responded   = promoters + passives + detractors;
  const npsScore    = responded > 0 ? Math.round(((promoters - detractors) / responded) * 100) : null;
  const responseRate = filteredNps.length > 0 ? Math.round((responded / filteredNps.length) * 100) : null;
  const npsHist = Array.from({ length: 11 }, (_, s) => ({
    score: String(s),
    count: filteredNps.filter(r => r.score === s).length,
    fill: s >= 9 ? '#10b981' : s >= 7 ? '#f59e0b' : '#ef4444',
  }));

  // Campaign aggregates
  const campSent = campaigns.filter(c => c.status === 'sent').length;
  const campDrafts = campaigns.filter(c => c.status === 'draft').length;
  const campReach = campaigns.reduce((a, c) => a + (parseInt(c.recipient_count) || 0), 0);

  const SUB_TABS = [
    { id: 'pipeline',    label: tc.subPipeline },
    { id: 'campaigns',   label: tc.subCampaigns },
    { id: 'activity',    label: tc.subActivity },
    { id: 'performance', label: tc.subPerformance },
    { id: 'nps',         label: tc.subNps },
    { id: 'groups',      label: tc.subGroups },
  ];

  return (
    <div>
      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {SUB_TABS.map(s => (
          <button key={s.id} className={`subtab-btn${sub === s.id ? ' active' : ''}`} onClick={() => setSub(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Coach selector (pipeline + campaigns + activity) */}
      {(sub === 'pipeline' || sub === 'campaigns' || sub === 'activity') && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Filter size={14} style={{ color: '#64748b' }} />
          <select value={selectedCoachId} onChange={handleCoachChange}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
            <option value="">{tc.selectCoach}</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {sub === 'pipeline' && selectedCoachId && (
            <>
              <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder={tc.searchClients}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, width: 200 }} />
              <span style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className={`subtab-btn${view === 'board' ? ' active' : ''}`} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => setView('board')}>
                  <Layout size={12} /> {tc.viewBoard}
                </button>
                <button className={`subtab-btn${view === 'table' ? ' active' : ''}`} style={{ padding: '5px 12px', fontSize: 12 }}
                  onClick={() => setView('table')}>
                  <ClipboardList size={12} /> {tc.viewTable}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Pipeline sub-tab ── */}
      {sub === 'pipeline' && (
        <div>
          {!selectedCoachId ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.selectCoachPrompt}</p>
          ) : pipelineLoading ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.loading}</p>
          ) : (
            <>
              {/* Summary stats */}
              <div className="stat-row" style={{ marginBottom: 16 }}>
                <StatCard icon={Users}      label={tc.colTotalClients} value={pipeline.length}  color="#3b82f6" />
                <StatCard icon={Check}      label={tc.colActive}       value={activeCount}      color="#10b981" />
                <StatCard icon={AlertCircle} label={tc.colAtRisk}      value={atRiskCount}      color="#ef4444" />
                <StatCard icon={Activity}   label={tc.statAvgDelta}
                  value={avgDelta === null ? '—' : (avgDelta > 0 ? `+${avgDelta.toFixed(1)}` : avgDelta.toFixed(1))}
                  color={avgDelta !== null && avgDelta < 0 ? '#10b981' : '#f59e0b'} />
                <StatCard icon={TrendingUp} label={tc.statScanned}
                  value={pipeline.length ? `${Math.round((scannedCount / pipeline.length) * 100)}%` : '—'}
                  color="#8b5cf6" />
              </div>

              {view === 'board' ? (
                <CrmKanban pipeline={visiblePipeline} stageLabels={stageLabels} tagColors={tagColors}
                  onStageChange={handleStageChange} onOpenClient={setDrawerClient} />
              ) : (
                <div className="card">
                  <div className="table-toolbar">
                    <span className="table-count">{tc.countClients(visiblePipeline.length)}</span>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{tc.colName}</th>
                        <th>{tc.colStage}</th>
                        <th>{tc.colTags}</th>
                        <th>{tc.colBioAgeDelta}</th>
                        <th>{tc.colLastScan}</th>
                        <th>{tc.colDaysInStage}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePipeline.length === 0 && <tr><td colSpan={7} className="empty-row">—</td></tr>}
                      {visiblePipeline.map(c => {
                        const stage = c.crm_stage || 'lead';
                        const delta = crmBioAgeDelta(c);
                        const dStage = crmDaysSince(c.stage_changed_at);
                        return (
                          <tr key={c.user_id}>
                            <td>
                              <div className="avatar-cell">
                                <CrmAvatar name={c.nickname || c.user_id} url={c.avatar_url} size={26} />
                                <span style={{ fontWeight: 500 }}>{c.nickname || c.user_id}</span>
                              </div>
                            </td>
                            <td>
                              <select className="inline-select" value={stage}
                                style={{ color: STAGE_COLORS[stage], fontWeight: 600 }}
                                onChange={e => handleStageChange(c.user_id, e.target.value)}>
                                {STAGE_KEYS.map(k => <option key={k} value={k}>{stageLabels[k]}</option>)}
                              </select>
                            </td>
                            <td>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {(c.crm_tags || []).length === 0 && <span className="muted" style={{ fontSize: 11 }}>—</span>}
                                {(c.crm_tags || []).map(tag => (
                                  <span key={tag} className="tag-chip" style={{ background: (tagColors[tag] || '#6375EC') + '1c', color: tagColors[tag] || '#6375EC' }}>{tag}</span>
                                ))}
                              </div>
                            </td>
                            <td style={{ fontWeight: 600, color: delta === null ? '#94a3b8' : delta < 0 ? '#10b981' : '#ef4444' }}>
                              {delta !== null ? (delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)) : '—'}
                            </td>
                            <td style={{ fontSize: 11, color: '#64748b' }}>
                              {c.last_scan_at ? new Date(c.last_scan_at).toLocaleDateString() : '—'}
                            </td>
                            <td style={{ fontSize: 11, color: '#64748b' }}>
                              {dStage !== null ? tc.daysInStage(dStage) : '—'}
                            </td>
                            <td>
                              <button className="icon-btn" title={tc.drawerOverview} onClick={() => setDrawerClient(c)}>
                                <Eye size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {drawerClient && (
            <CrmClientDrawer
              client={drawerClient}
              coachId={selectedCoachId}
              stageLabels={stageLabels}
              tagColors={tagColors}
              onStageChange={handleStageChange}
              onClose={() => setDrawerClient(null)}
            />
          )}
        </div>
      )}

      {/* ── Campaigns sub-tab ── */}
      {sub === 'campaigns' && (
        <div>
          {!selectedCoachId ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.selectCoachCampaignsPrompt}</p>
          ) : (
            <>
              <div className="stat-row" style={{ marginBottom: 16 }}>
                <StatCard icon={Send}     label={tc.statCampaigns}     value={campaigns.length} color="#3b82f6" />
                <StatCard icon={Check}    label={tc.statSentCampaigns} value={campSent}         color="#10b981" />
                <StatCard icon={FileText} label={tc.statDrafts}        value={campDrafts}       color="#f59e0b" />
                <StatCard icon={Users}    label={tc.statReach}         value={campReach}        color="#8b5cf6" />
              </div>
              <div className="card">
                <div className="table-toolbar">
                  <span className="table-count">{tc.countCampaigns(campaigns.length)}</span>
                  <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }}
                    onClick={() => setCampaignModal(true)}>
                    <Plus size={13} /> {tc.newCampaign}
                  </button>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{tc.colTitle}</th>
                      <th>{tc.colStatus}</th>
                      <th>{tc.colDelivery}</th>
                      <th>{tc.colCreated}</th>
                      <th>{tc.colActions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignsLoading ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8' }}>{tc.loading}</td></tr>
                    ) : campaigns.length === 0 ? (
                      <tr><td colSpan={5} className="empty-row">—</td></tr>
                    ) : campaigns.map(c => {
                      const statusLabel = tc['status' + c.status.charAt(0).toUpperCase() + c.status.slice(1)] || c.status;
                      const pct = c.recipient_count > 0 ? Math.round((c.sent_count / c.recipient_count) * 100) : 0;
                      return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 500 }}>{c.title}</td>
                        <td>
                          <span style={{
                            background: c.status === 'sent' ? '#d1fae5' : c.status === 'sending' ? '#fef3c7' : c.status === 'failed' ? '#fee2e2' : '#f1f5f9',
                            color: c.status === 'sent' ? '#059669' : c.status === 'sending' ? '#d97706' : c.status === 'failed' ? '#dc2626' : '#64748b',
                            padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                          }}>{statusLabel}</span>
                        </td>
                        <td style={{ minWidth: 130 }}>
                          {c.recipient_count > 0 ? (
                            <>
                              <div className="progress-track">
                                <div className="progress-fill" style={{
                                  width: `${pct}%`,
                                  background: c.status === 'failed' ? '#ef4444' : c.status === 'sent' ? '#10b981' : '#3b82f6',
                                }} />
                              </div>
                              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>
                                {c.sent_count}/{c.recipient_count}
                              </div>
                            </>
                          ) : <span className="muted" style={{ fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(c.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {c.status === 'draft' && (
                              <button className="btn-primary" style={{ padding: '4px 10px', fontSize: 11 }}
                                disabled={sending === c.id}
                                onClick={() => sendCampaign(c.id)}>
                                <Send size={11} /> {sending === c.id ? tc.sending : tc.send}
                              </button>
                            )}
                            <button className="icon-btn" title={tc.viewRecipients} onClick={() => setRecipCampaign(c)}>
                              <Eye size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {recipCampaign && <CampaignRecipientsModal campaign={recipCampaign} onClose={() => setRecipCampaign(null)} />}

          {/* New Campaign Modal */}
          {campaignModal && (
            <div className="modal-overlay" onClick={() => setCampaignModal(false)}>
              <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <span className="modal-title">{tc.modalNewCampaign}</span>
                  <button className="icon-btn" onClick={() => setCampaignModal(false)}><X size={16} /></button>
                </div>
                <div className="modal-body">
                  {templates.length > 0 && (
                    <>
                      <label className="form-label">{tc.labelTemplate}</label>
                      <select className="form-input" value={newCampaign.template_id}
                        onChange={e => applyTemplate(e.target.value)}>
                        <option value="">{tc.noTemplate}</option>
                        {templates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.title}</option>)}
                      </select>
                    </>
                  )}
                  <label className="form-label" style={templates.length > 0 ? { marginTop: 12 } : undefined}>{tc.labelTitle}</label>
                  <input className="form-input" value={newCampaign.title}
                    onChange={e => setNewCampaign(p => ({ ...p, title: e.target.value }))}
                    placeholder={tc.labelTitle} />
                  <label className="form-label" style={{ marginTop: 12 }}>{tc.labelContent}</label>
                  <textarea className="form-input" rows={4} value={newCampaign.content}
                    onChange={e => setNewCampaign(p => ({ ...p, content: e.target.value }))}
                    placeholder={tc.labelContent} />
                  <label className="form-label" style={{ marginTop: 12 }}>{tc.labelStageFilter}</label>
                  <select className="form-input" value={newCampaign.stage}
                    onChange={e => setNewCampaign(p => ({ ...p, stage: e.target.value }))}>
                    <option value="">{tc.allClients}</option>
                    {STAGE_KEYS.map(k => <option key={k} value={k}>{stageLabels[k]}</option>)}
                  </select>
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={() => setCampaignModal(false)}>{tc.cancel}</button>
                  <button className="btn-primary" onClick={createCampaign}>{tc.createDraft}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Activity sub-tab ── */}
      {sub === 'activity' && (
        <div>
          {!selectedCoachId ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.selectCoachPrompt}</p>
          ) : feedLoading ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.loading}</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ padding: 18 }}>
                <div className="card-title" style={{ marginBottom: 14 }}>{tc.recentActivity}</div>
                <CrmActivityTimeline items={feed} stageLabels={stageLabels} emptyText={tc.noActivity} />
              </div>
              <div className="card" style={{ padding: 18 }}>
                <div className="card-title" style={{ marginBottom: 14 }}>{tc.upcomingAppts}</div>
                {upcoming.length === 0 && <p className="muted" style={{ fontSize: 13 }}>{tc.noUpcomingAppts}</p>}
                {upcoming.map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div className="crm-tl-icon" style={{ background: '#8b5cf61c', color: '#8b5cf6' }}>
                      {a.format === 'video' ? <Video size={13} /> : <Calendar size={13} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {a.nickname} · {new Date(a.scheduled_at).toLocaleString()} · {a.duration_min}{tc.minutes}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Performance sub-tab ── */}
      {sub === 'performance' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: '#64748b' }}>{tc.labelPeriod}</label>
            <input type="month" value={period}
              onChange={e => setPeriod(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={loadKPIs}>
              {tc.load}
            </button>
          </div>

          {kpiChartData.length > 1 && (
            <div className="card" style={{ marginBottom: 16, padding: 18 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>{tc.chartClientsScans}</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={kpiChartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="clients" name={tc.colTotalClients} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="scans"   name={tc.colScans}        fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <div className="card-title">{tc.perfTitle(period)}</div>
            {kpiLoading ? (
              <p style={{ color: '#94a3b8', fontSize: 13, padding: '0 18px 18px' }}>{tc.loading}</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <SortTh k="coach_name">{tc.colCoach}</SortTh>
                    <SortTh k="total_clients">{tc.colTotalClients}</SortTh>
                    <SortTh k="active_clients">{tc.colActive}</SortTh>
                    <SortTh k="at_risk_count">{tc.colAtRisk}</SortTh>
                    <SortTh k="scans_facilitated">{tc.colScans}</SortTh>
                    <SortTh k="plans_assigned">{tc.colPlansAssigned}</SortTh>
                    <SortTh k="messages_sent">{tc.colMessages}</SortTh>
                    <SortTh k="appointments_held">{tc.colApptsHeld}</SortTh>
                    <SortTh k="avg_nps_score">{tc.colAvgNps}</SortTh>
                    <SortTh k="commission_cny">{tc.colCommission}</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedKpis.map(r => (
                    <tr key={r.coach_id}>
                      <td style={{ fontWeight: 500 }}>{r.coach_name}</td>
                      <td>{r.total_clients ?? '—'}</td>
                      <td>{r.active_clients ?? '—'}</td>
                      <td style={{ color: r.at_risk_count > 0 ? '#ef4444' : undefined }}>
                        {r.at_risk_count ?? '—'}
                      </td>
                      <td>{r.scans_facilitated ?? '—'}</td>
                      <td>{r.plans_assigned ?? '—'}</td>
                      <td>{r.messages_sent ?? '—'}</td>
                      <td>{r.appointments_held ?? '—'}</td>
                      <td style={{ color: r.avg_nps_score >= 8 ? '#10b981' : r.avg_nps_score < 6 ? '#ef4444' : undefined }}>
                        {r.avg_nps_score != null ? parseFloat(r.avg_nps_score).toFixed(1) : '—'}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {r.commission_cny != null ? `¥${parseFloat(r.commission_cny).toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {kpiRows.length > 1 && (
                    <tr style={{ background: '#f8fafc' }}>
                      <td style={{ fontWeight: 700 }}>{tc.totalsRow}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.total_clients ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.active_clients ?? 0}</td>
                      <td style={{ fontWeight: 700, color: kpiTotals.at_risk_count > 0 ? '#ef4444' : undefined }}>{kpiTotals.at_risk_count ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.scans_facilitated ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.plans_assigned ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.messages_sent ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals.appointments_held ?? 0}</td>
                      <td style={{ fontWeight: 700 }}>{kpiTotals._npsCnt ? (kpiTotals._npsSum / kpiTotals._npsCnt).toFixed(1) : '—'}</td>
                      <td style={{ fontWeight: 700 }}>¥{(kpiTotals.commission_cny || 0).toLocaleString()}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Groups sub-tab ── */}
      {sub === 'groups' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
            <Filter size={14} style={{ color: '#64748b' }} />
            <select value={selectedGroupId} onChange={e => { setSelectedGroupId(e.target.value); setGroupKpis(null); }}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
              <option value="">{tc.selectGroup}</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}{g.type ? ` (${g.type})` : ''}</option>)}
            </select>
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={loadGroupKPIs}>{tc.load}</button>
          </div>

          {groups.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.noGroups}</p>
          ) : !selectedGroupId ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.selectGroup}</p>
          ) : groupKpiLoading ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>{tc.loading}</p>
          ) : groupKpis ? (
            <>
              <div className="stat-row" style={{ marginBottom: 16 }}>
                <StatCard icon={Users}   label={tc.colTotalClients} value={groupKpis.total_clients ?? 0}  color="#3b82f6" />
                <StatCard icon={Users}   label={tc.colActive}       value={groupKpis.active_clients ?? 0} color="#10b981" />
                <StatCard icon={Users}   label={tc.colAtRisk}       value={groupKpis.at_risk_count ?? 0}  color="#ef4444" />
                <StatCard icon={UserCog} label={tc.colCoachCount}   value={groupKpis.coach_count ?? 0}    color="#8b5cf6" />
              </div>
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="card-title">{tc.groupPerfTitle(groups.find(g => String(g.id) === String(selectedGroupId))?.name || '', period)}</div>
                <table className="data-table">
                  <thead><tr>
                    <th>{tc.colScans}</th>
                    <th>{tc.colPlansAssigned}</th>
                    <th>{tc.colMessages}</th>
                    <th>{tc.colApptsHeld}</th>
                    <th>{tc.colAvgNps}</th>
                    <th>{tc.colCommission}</th>
                  </tr></thead>
                  <tbody>
                    <tr>
                      <td>{groupKpis.scans_facilitated ?? '—'}</td>
                      <td>{groupKpis.plans_assigned ?? '—'}</td>
                      <td>{groupKpis.messages_sent ?? '—'}</td>
                      <td>{groupKpis.appointments_held ?? '—'}</td>
                      <td style={{ color: groupKpis.avg_nps_score >= 8 ? '#10b981' : groupKpis.avg_nps_score < 6 ? '#ef4444' : undefined }}>
                        {groupKpis.avg_nps_score != null ? parseFloat(groupKpis.avg_nps_score).toFixed(1) : '—'}
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {groupKpis.commission_cny != null ? `¥${parseFloat(groupKpis.commission_cny).toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Per-coach breakdown */}
              {coaches.filter(c => String(c.group_id) === String(selectedGroupId)).length > 0 && (
                <div className="card">
                  <div className="card-title">{tc.colCoach} — {tc.colTotalClients}</div>
                  <table className="data-table">
                    <thead><tr>
                      <th>{tc.colCoach}</th>
                      <th>{tc.colTotalClients}</th>
                      <th>{tc.colActive}</th>
                      <th>{tc.colScans}</th>
                      <th>{tc.colAvgNps}</th>
                      <th>{tc.colCommission}</th>
                    </tr></thead>
                    <tbody>
                      {coaches.filter(c => String(c.group_id) === String(selectedGroupId)).map(c => {
                        const r = kpiRows.find(k => k.coach_id === c.id) || {};
                        return (
                          <tr key={c.id}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td>{r.kpis?.total_clients ?? r.total_clients ?? '—'}</td>
                            <td>{r.kpis?.active_clients ?? r.active_clients ?? '—'}</td>
                            <td>{r.kpis?.scans_facilitated ?? r.scans_facilitated ?? '—'}</td>
                            <td>{(r.kpis?.avg_nps_score ?? r.avg_nps_score) != null ? parseFloat(r.kpis?.avg_nps_score ?? r.avg_nps_score).toFixed(1) : '—'}</td>
                            <td>{(r.kpis?.commission_cny ?? r.commission_cny) != null ? `¥${parseFloat(r.kpis?.commission_cny ?? r.commission_cny).toLocaleString()}` : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── NPS sub-tab ── */}
      {sub === 'nps' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 13, color: '#64748b' }}>{tc.labelFrom}</label>
            <input type="date" value={npsStart} onChange={e => setNpsStart(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <label style={{ fontSize: 13, color: '#64748b' }}>{tc.labelTo}</label>
            <input type="date" value={npsEnd} onChange={e => setNpsEnd(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
            <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={loadNPS}>
              {tc.load}
            </button>
            <span style={{ flex: 1 }} />
            <select value={npsCoachFilter} onChange={e => setNpsCoachFilter(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
              <option value="">{tc.allCoaches}</option>
              {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Aggregate cards */}
          <div className="stat-row" style={{ marginBottom: 16 }}>
            <div className="stat-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: npsScore === null ? '#94a3b8' : npsScore >= 50 ? '#10b981' : npsScore >= 0 ? '#f59e0b' : '#ef4444' }}>
                {npsScore ?? '—'}
              </div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{tc.npsScore}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#10b981' }}>{promoters}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{tc.promoters}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#f59e0b' }}>{passives}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{tc.passives}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{detractors}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{tc.detractors}</div>
            </div>
            <div className="stat-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{responseRate !== null ? `${responseRate}%` : '—'}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{tc.responseRate}</div>
            </div>
          </div>

          {responded > 0 && (
            <div className="card" style={{ marginBottom: 16, padding: 18 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>{tc.scoreDist}</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={npsHist} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="score" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {npsHist.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <div className="table-toolbar">
              <span className="table-count">{tc.countResponses(filteredNps.length)}</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{tc.colCoach}</th>
                  <th>{tc.colUser}</th>
                  <th>{tc.colType}</th>
                  <th>{tc.colScore}</th>
                  <th>{tc.colFeedback}</th>
                  <th>{tc.colRespondedAt}</th>
                </tr>
              </thead>
              <tbody>
                {npsLoading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: '#94a3b8' }}>{tc.loading}</td></tr>
                ) : filteredNps.map(r => {
                  const coach = coaches.find(c => c.id === r.coach_id);
                  const scoreColor = r.score >= 9 ? '#10b981' : r.score >= 7 ? '#f59e0b' : r.score !== null ? '#ef4444' : '#94a3b8';
                  return (
                    <tr key={r.id}>
                      <td>{coach?.name || r.coach_id}</td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>{r.user_id}</td>
                      <td style={{ fontSize: 11 }}>{r.survey_type}</td>
                      <td>
                        {r.score !== null ? (
                          <span style={{ fontWeight: 700, color: scoreColor, fontSize: 15 }}>{r.score}</span>
                        ) : <span style={{ color: '#94a3b8' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 11, color: '#475569', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.feedback_text || '—'}
                      </td>
                      <td style={{ fontSize: 11, color: '#64748b' }}>
                        {r.responded_at ? new Date(r.responded_at).toLocaleString() : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
