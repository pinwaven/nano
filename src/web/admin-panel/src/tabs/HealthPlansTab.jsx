import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { Plus, Pencil, Trash2, X, RefreshCcw } from 'lucide-react';
import { useLang, LangCtx, Badge } from '../shared.jsx';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_AGES = ['CellularAge', 'MetabolicAge', 'MicroVascularAge', 'ResilienceAge'];
const DEFAULT_DAILY_TASKS = [
  { key: 'dots',      label_zh: '服用原粒', label_en: 'Dots',      enabled: true },
  { key: 'weight',    label_zh: '记录体重', label_en: 'Weight',    enabled: true },
  { key: 'questions', label_zh: '每日问答', label_en: 'Questions', enabled: true },
];

// ── Main Component ────────────────────────────────────────────────────────────

function HealthPlansTab({ dots, healthPlanTemplates, onRefresh }) {
  const { lang } = useContext(LangCtx);
  const isZh = lang === 'zh';
  const [subTab, setSubTab] = useState('templates');
  const [modal, setModal] = useState(null); // null | 'add' | 'edit'
  const [modalTab, setModalTab] = useState('basics');
  const [editingTpl, setEditingTpl] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [userPlans, setUserPlans] = useState([]);
  const [userPlansLoading, setUserPlansLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');

  const loadUserPlans = async () => {
    setUserPlansLoading(true);
    try {
      const res = await axios.get('/api/health-plans?all=true');
      setUserPlans(res.data.plans || []);
    } catch (e) { console.error(e); }
    finally { setUserPlansLoading(false); }
  };

  useEffect(() => { if (subTab === 'users' && userPlans.length === 0) loadUserPlans(); }, [subTab]);

  const parseJsonArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

  const openAdd = () => {
    setForm({ key_name: '', name_zh: '', name_en: '', desc_zh: '', desc_en: '', goal_zh: '', goal_en: '', duration_weeks: 4, sort_order: 0, target_sub_ages: [], recommended_dot_ids: [], milestones: [], reminders: [], daily_tasks: DEFAULT_DAILY_TASKS, is_active: true });
    setEditingTpl(null);
    setModalTab('basics');
    setModal('add');
  };

  const openEdit = (tpl) => {
    setForm({
      ...tpl,
      target_sub_ages: tpl.target_sub_ages || [],
      recommended_dot_ids: tpl.recommended_dot_ids || [],
      milestones: parseJsonArr(tpl.milestones),
      reminders: parseJsonArr(tpl.reminders),
      daily_tasks: (() => {
        const saved = parseJsonArr(tpl.daily_tasks);
        if (saved.length === 0) return DEFAULT_DAILY_TASKS;
        return DEFAULT_DAILY_TASKS.map(def => saved.find(s => s.key === def.key) || def);
      })(),
    });
    setEditingTpl(tpl);
    setModalTab('basics');
    setModal('edit');
  };

  const addReminder = () => setForm(f => ({ ...f, reminders: [...(f.reminders || []), { time: '08:00', label_zh: '', label_en: '', message_zh: '', message_en: '' }] }));
  const removeReminder = (idx) => setForm(f => ({ ...f, reminders: f.reminders.filter((_, i) => i !== idx) }));
  const updateReminder = (idx, field, value) => setForm(f => { const u = [...(f.reminders || [])]; u[idx] = { ...u[idx], [field]: value }; return { ...f, reminders: u }; });

  const addMilestone = () => setForm(f => ({ ...f, milestones: [...(f.milestones || []), { week: 1, label_zh: '', label_en: '' }] }));
  const removeMilestone = (idx) => setForm(f => ({ ...f, milestones: f.milestones.filter((_, i) => i !== idx) }));
  const updateMilestone = (idx, field, value) => setForm(f => { const u = [...(f.milestones || [])]; u[idx] = { ...u[idx], [field]: value }; return { ...f, milestones: u }; });

  const toggleSubAge = (key) => {
    setForm(f => ({ ...f, target_sub_ages: f.target_sub_ages.includes(key) ? f.target_sub_ages.filter(s => s !== key) : [...f.target_sub_ages, key] }));
  };

  const toggleDot = (id) => {
    setForm(f => ({ ...f, recommended_dot_ids: f.recommended_dot_ids.includes(id) ? f.recommended_dot_ids.filter(d => d !== id) : [...f.recommended_dot_ids, id] }));
  };

  const updateDailyTask = (key, field, value) => {
    setForm(f => ({ ...f, daily_tasks: (f.daily_tasks || DEFAULT_DAILY_TASKS).map(t => t.key === key ? { ...t, [field]: value } : t) }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form, milestones: form.milestones || [], reminders: form.reminders || [], daily_tasks: form.daily_tasks || DEFAULT_DAILY_TASKS };
      if (modal === 'add') await axios.post('/api/health-plan-templates', payload);
      else await axios.put(`/api/health-plan-templates/${editingTpl.id}`, payload);
      setModal(null);
      onRefresh();
    } catch (e) { alert(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const deleteTpl = async (tpl) => {
    if (!window.confirm(isZh ? `确认删除「${tpl.name_zh}」？此操作不可撤销。` : `Delete "${tpl.name_en}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/health-plan-templates/${tpl.id}`);
      onRefresh();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const filteredUserPlans = userPlans.filter(p => p.status === statusFilter);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['templates', 'users'].map(s => (
          <button key={s} className={`subtab-btn${subTab === s ? ' active' : ''}`} onClick={() => setSubTab(s)}>
            {s === 'templates' ? (isZh ? '方案模板' : 'Templates') : (isZh ? '用户方案' : 'User Plans')}
          </button>
        ))}
      </div>

      {subTab === 'templates' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{healthPlanTemplates.length} {isZh ? '个模板' : 'templates'}</span>
            <button className="btn-primary" onClick={openAdd}>
              <Plus size={14} /> {isZh ? '添加模板' : 'Add Template'}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{isZh ? '标识' : 'Key'}</th>
                <th>{isZh ? '名称' : 'Name'}</th>
                <th>{isZh ? '周期' : 'Duration'}</th>
                <th>{isZh ? '目标维度' : 'Target Sub-Ages'}</th>
                <th>{isZh ? '排序' : 'Order'}</th>
                <th>{isZh ? '状态' : 'Status'}</th>
                <th>{isZh ? '在用' : 'Enrolled'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {healthPlanTemplates.length === 0 && <tr><td colSpan={8} className="empty-row">{isZh ? '暂无模板' : 'No templates yet'}</td></tr>}
              {healthPlanTemplates.map(tpl => (
                <tr key={tpl.id}>
                  <td><code className="code-tag">{tpl.key_name}</code></td>
                  <td>
                    <div className="bold">{isZh ? tpl.name_zh : tpl.name_en}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{isZh ? tpl.name_en : tpl.name_zh}</div>
                  </td>
                  <td>{tpl.duration_weeks}w</td>
                  <td className="muted" style={{ fontSize: 11 }}>{(tpl.target_sub_ages || []).map(s => s.replace('Age', '')).join(', ')}</td>
                  <td className="muted">{tpl.sort_order}</td>
                  <td>
                    <Badge color={tpl.is_active ? '#10b981' : '#94a3b8'}>
                      {tpl.is_active ? (isZh ? '启用' : 'Active') : (isZh ? '停用' : 'Inactive')}
                    </Badge>
                  </td>
                  <td>{tpl.active_enrollments || 0}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => openEdit(tpl)}><Pencil size={13} /></button>
                      <button className="icon-btn danger" onClick={() => deleteTpl(tpl)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'users' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {['active', 'completed', 'abandoned', 'paused'].map(s => (
                <button key={s} className={`subtab-btn${statusFilter === s ? ' active' : ''}`} style={{ fontSize: 11 }} onClick={() => setStatusFilter(s)}>
                  {s}
                </button>
              ))}
            </div>
            <button className="icon-btn" onClick={loadUserPlans}><RefreshCcw size={13} /></button>
          </div>
          {userPlansLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>{isZh ? '加载中…' : 'Loading…'}</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{isZh ? '用户' : 'User'}</th>
                  <th>{isZh ? '方案' : 'Plan'}</th>
                  <th>{isZh ? '类型' : 'Type'}</th>
                  <th>{isZh ? '来源' : 'Source'}</th>
                  <th>{isZh ? '打卡数' : 'Check-ins'}</th>
                  <th>{isZh ? '进度' : 'Progress'}</th>
                  <th>{isZh ? '开始日期' : 'Start Date'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUserPlans.length === 0 && <tr><td colSpan={7} className="empty-row">{isZh ? '暂无数据' : 'No data'}</td></tr>}
                {filteredUserPlans.map(p => {
                  const weeksElapsed = Math.max(0, Math.floor((Date.now() - new Date(p.start_date).getTime()) / (7 * 86400000)));
                  const totalWeeks = p.duration_weeks || p.template_duration_weeks || 4;
                  return (
                    <tr key={p.id}>
                      <td className="bold">{p.user_nickname || p.user_id}</td>
                      <td>{isZh ? (p.name_zh || p.custom_name_zh) : (p.name_en || p.custom_name_en)}</td>
                      <td><Badge color={p.plan_type === 'primary' ? '#6375EC' : '#10b981'}>{p.plan_type}</Badge></td>
                      <td className="muted" style={{ fontSize: 11 }}>{p.source}</td>
                      <td>{p.checkin_count || 0}</td>
                      <td className="muted" style={{ fontSize: 11 }}>{weeksElapsed}/{totalWeeks}w</td>
                      <td className="muted" style={{ fontSize: 11 }}>{p.start_date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-tabbed" style={{ width: 700 }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="modal-header">
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {modal === 'add' ? (isZh ? '添加方案模板' : 'Add Plan Template') : (isZh ? '编辑方案模板' : 'Edit Plan Template')}
                </div>
                {modal === 'edit' && editingTpl && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}><code>{editingTpl.key_name}</code></div>
                )}
              </div>
              <button className="icon-btn" onClick={() => setModal(null)}><X size={16} /></button>
            </div>

            {/* Tab nav */}
            <div className="modal-nav">
              {[
                { key: 'basics',   zh: '基本信息', en: 'Basics'   },
                { key: 'content',  zh: '描述内容', en: 'Content'  },
                { key: 'targets',  zh: '目标配置', en: 'Targets'  },
                { key: 'schedule', zh: '日程提醒', en: 'Schedule' },
              ].map(t => (
                <button key={t.key} className={`modal-nav-tab${modalTab === t.key ? ' active' : ''}`} onClick={() => setModalTab(t.key)}>
                  {isZh ? t.zh : t.en}
                </button>
              ))}
            </div>

            {/* Tab body */}
            <div className="modal-body">

              {/* ── Basics ── */}
              {modalTab === 'basics' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '标识与周期' : 'Identity & Duration'}</div>
                    <div className="form-row-3">
                      <label className="form-field">
                        <span>{isZh ? '标识符' : 'Key Name'}</span>
                        <input value={form.key_name || ''} onChange={e => setForm(f => ({ ...f, key_name: e.target.value }))} placeholder="e.g. weight_loss" disabled={modal === 'edit'} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '周期（周）' : 'Weeks'}</span>
                        <input type="number" min={1} value={form.duration_weeks || 4} onChange={e => setForm(f => ({ ...f, duration_weeks: parseInt(e.target.value) || 4 }))} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '排序' : 'Order'}</span>
                        <input type="number" value={form.sort_order ?? 0} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '名称' : 'Name'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <input value={form.name_zh || ''} onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} placeholder={isZh ? '代谢减重' : 'e.g. 代谢减重'} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <input value={form.name_en || ''} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))} placeholder="e.g. Metabolic Weight Loss" />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '方案目标（简短一句话）' : 'Goal (one-liner)'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <input value={form.goal_zh || ''} onChange={e => setForm(f => ({ ...f, goal_zh: e.target.value }))} placeholder={isZh ? '降低代谢年龄，改善体脂比例' : ''} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <input value={form.goal_en || ''} onChange={e => setForm(f => ({ ...f, goal_en: e.target.value }))} placeholder="Reduce metabolic age and improve body composition" />
                      </label>
                    </div>
                  </div>

                  <div className="form-section">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                      {isZh ? '启用此模板（用户可见）' : 'Template is active (visible to users)'}
                    </label>
                  </div>
                </>
              )}

              {/* ── Content ── */}
              {modalTab === 'content' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '详细描述' : 'Description'}</div>
                    <div className="form-row-2">
                      <label className="form-field">
                        <span>{isZh ? '中文' : 'Chinese'}</span>
                        <textarea className="form-field-textarea" rows={12} value={form.desc_zh || ''} onChange={e => setForm(f => ({ ...f, desc_zh: e.target.value }))} placeholder={isZh ? '介绍方案的背景、适用人群和预期效果…' : ''} />
                      </label>
                      <label className="form-field">
                        <span>{isZh ? '英文' : 'English'}</span>
                        <textarea className="form-field-textarea" rows={12} value={form.desc_en || ''} onChange={e => setForm(f => ({ ...f, desc_en: e.target.value }))} placeholder="Describe the plan background, target audience, and expected outcomes…" />
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* ── Targets ── */}
              {modalTab === 'targets' && (
                <>
                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '目标生理年龄维度' : 'Target Bio-Age Dimensions'}</div>
                    <p className="form-section-hint" style={{ marginBottom: 10 }}>
                      {isZh ? '选择此方案主要改善的维度，将显示在方案卡片和用户详情中。' : 'Select which sub-age dimensions this plan targets. Shown on the plan card and user detail.'}
                    </p>
                    <div className="chips-grid">
                      {SUB_AGES.map(s => (
                        <button key={s} type="button"
                          className={`subtab-btn${(form.target_sub_ages || []).includes(s) ? ' active' : ''}`}
                          onClick={() => toggleSubAge(s)}>
                          {s.replace('Age', '')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '推荐原粒' : 'Recommended Dots'}</div>
                    <p className="form-section-hint" style={{ marginBottom: 10 }}>
                      {isZh ? '选择方案期间推荐使用的原粒，将显示在用户方案指导页。' : 'Select dots recommended during this plan. Shown in the guidance tab.'}
                    </p>
                    <div className="chips-grid">
                      {dots.map(d => (
                        <button key={d.id} type="button"
                          className={`subtab-btn${(form.recommended_dot_ids || []).includes(d.id) ? ' active' : ''}`}
                          onClick={() => toggleDot(d.id)}
                          style={{ fontSize: 11 }}>
                          {d.key_name} · {isZh && d.name_zh ? d.name_zh : d.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-section">
                    <div className="form-section-title">{isZh ? '每日任务' : 'Daily Tasks'}</div>
                    <p className="form-section-hint" style={{ marginBottom: 10 }}>
                      {isZh ? '配置用户每日需完成的打卡任务，显示在方案卡片上。' : 'Configure daily check-in tasks shown on the plan card for users in this plan.'}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(form.daily_tasks || DEFAULT_DAILY_TASKS).map(task => (
                        <div key={task.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                          <input type="checkbox" checked={!!task.enabled}
                            onChange={e => updateDailyTask(task.key, 'enabled', e.target.checked)}
                            style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }} />
                          <span style={{ width: 80, fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>
                            {task.key === 'dots' ? '💊 dots' : task.key === 'weight' ? '⚖️ weight' : '📋 questions'}
                          </span>
                          <input type="text" value={task.label_zh || ''} placeholder={isZh ? '中文标签' : 'Chinese label'}
                            onChange={e => updateDailyTask(task.key, 'label_zh', e.target.value)}
                            disabled={!task.enabled}
                            className="si-input" style={{ flex: 1 }} />
                          <input type="text" value={task.label_en || ''} placeholder={isZh ? '英文标签' : 'English label'}
                            onChange={e => updateDailyTask(task.key, 'label_en', e.target.value)}
                            disabled={!task.enabled}
                            className="si-input" style={{ flex: 1 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── Schedule ── */}
              {modalTab === 'schedule' && (
                <>
                  <div className="form-section">
                    <div className="form-section-header">
                      <div>
                        <div className="form-section-title">{isZh ? '里程碑' : 'Milestones'}</div>
                        <p className="form-section-hint">{isZh ? '在特定周数提示用户做 Kino 检测或回顾进展' : 'Prompt users to do a Kino scan or review progress at specific weeks'}</p>
                      </div>
                      <button type="button" className="btn-secondary btn-sm" onClick={addMilestone}>
                        + {isZh ? '添加里程碑' : 'Add Milestone'}
                      </button>
                    </div>
                    {(form.milestones || []).length === 0 && (
                      <p className="form-empty-hint">{isZh ? '暂无里程碑' : 'No milestones yet.'}</p>
                    )}
                    {(form.milestones || []).map((m, idx) => (
                      <div key={idx} className="schedule-item">
                        <div className="schedule-item-row">
                          <span className="si-label">{isZh ? '第' : 'Wk'}</span>
                          <input type="number" min={1} value={m.week ?? 1}
                            onChange={e => updateMilestone(idx, 'week', parseInt(e.target.value) || 1)}
                            className="si-input si-week" />
                          <input type="text" placeholder={isZh ? '标签（中文）' : 'Label (Chinese)'}
                            value={m.label_zh || ''} onChange={e => updateMilestone(idx, 'label_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '标签（英文）' : 'Label (English)'}
                            value={m.label_en || ''} onChange={e => updateMilestone(idx, 'label_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" onClick={() => removeMilestone(idx)}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="form-section">
                    <div className="form-section-header">
                      <div>
                        <div className="form-section-title">{isZh ? '每日提醒' : 'Daily Reminders'}</div>
                        <p className="form-section-hint">{isZh ? '加入方案时自动为用户创建每日定时提醒' : 'Auto-created for users when they join this plan'}</p>
                      </div>
                      <button type="button" className="btn-secondary btn-sm" onClick={addReminder}>
                        + {isZh ? '添加提醒' : 'Add Reminder'}
                      </button>
                    </div>
                    {(form.reminders || []).length === 0 && (
                      <p className="form-empty-hint">{isZh ? '暂无提醒' : 'No reminders configured.'}</p>
                    )}
                    {(form.reminders || []).map((r, idx) => (
                      <div key={idx} className="schedule-item">
                        <div className="schedule-item-row">
                          <span className="si-label">{isZh ? '时间' : 'Time'}</span>
                          <input type="time" value={r.time || '08:00'}
                            onChange={e => updateReminder(idx, 'time', e.target.value)}
                            className="si-input si-time" />
                          <input type="text" placeholder={isZh ? '标签（中文）' : 'Label (Chinese)'}
                            value={r.label_zh || ''} onChange={e => updateReminder(idx, 'label_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '标签（英文）' : 'Label (English)'}
                            value={r.label_en || ''} onChange={e => updateReminder(idx, 'label_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" onClick={() => removeReminder(idx)}>×</button>
                        </div>
                        <div className="schedule-item-row">
                          <span className="si-label" style={{ width: 28, textAlign: 'right' }}>{isZh ? '内容' : 'Msg'}</span>
                          <input type="text" placeholder={isZh ? '提醒内容（中文）' : 'Message (Chinese)'}
                            value={r.message_zh || ''} onChange={e => updateReminder(idx, 'message_zh', e.target.value)}
                            className="si-input" />
                          <input type="text" placeholder={isZh ? '提醒内容（英文）' : 'Message (English)'}
                            value={r.message_en || ''} onChange={e => updateReminder(idx, 'message_en', e.target.value)}
                            className="si-input" />
                          <button type="button" className="schedule-item-del" style={{ visibility: 'hidden' }} tabIndex={-1}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

            </div>

            {/* Footer */}
            <div className="modal-footer-bar">
              <button className="btn-secondary" onClick={() => setModal(null)}>{isZh ? '取消' : 'Cancel'}</button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? (isZh ? '保存中…' : 'Saving…') : (isZh ? '保存' : 'Save')}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}

export { HealthPlansTab };
