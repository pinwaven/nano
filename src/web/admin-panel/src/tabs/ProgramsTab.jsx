import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Users as UsersIcon, RefreshCw } from 'lucide-react';

// Content ▸ Programs — multi-day 打卡 programs (CLAUDE.md §42, docs/architecture/programs.md).
//
// A program is a per-day curriculum a COACH switches on for one client (coach app → client →
// 方案 → 打卡计划); there is no auto-enrollment. Channel bindings only scope which coaches may
// offer it (a bound channel or any of its sub-channels; none bound = every channel). Each day links
// an Academy lesson (the video) and a 'program_day' questionnaire (the 打卡), and carries the recap
// template rendered from that questionnaire's answers. The roster here is read-only.

const STATUS_COLOR = { draft: '#94a3b8', active: '#10b981', archived: '#f59e0b' };

function ProgramModal({ program, channels, onClose, onSave }) {
  const isEdit = !!program;
  const [form, setForm] = useState({
    key_name: program?.key_name || '',
    title_zh: program?.title_zh || '',
    title_en: program?.title_en || '',
    description_zh: program?.description_zh || '',
    description_en: program?.description_en || '',
    duration_days: program?.duration_days ?? 7,
    status: program?.status || 'draft',
    channel_ids: (program?.channels || []).map(c => c.id),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleChannel = (id) => setForm(f => ({
    ...f, channel_ids: f.channel_ids.includes(id) ? f.channel_ids.filter(x => x !== id) : [...f.channel_ids, id],
  }));

  const save = async () => {
    if (!form.title_zh.trim()) { setError('中文标题必填'); return; }
    if (!isEdit && !/^[a-z0-9_]{2,40}$/.test(form.key_name)) { setError('key_name: a-z, 0-9, _ (2–40)'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, duration_days: parseInt(form.duration_days) || 1 };
      const res = isEdit ? await axios.put(`/api/programs/${program.id}`, payload) : await axios.post('/api/programs', payload);
      if (!res.data.success) throw new Error(res.data.error || 'Save failed');
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Program' : 'New Program'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>key_name *</label>
              <input className="form-input" value={form.key_name} disabled={isEdit} onChange={e => setForm(f => ({ ...f, key_name: e.target.value }))} placeholder="viva_7day_v1" />
            </div>
            <div>
              <label>Days *</label>
              <input className="form-input" type="number" min={1} max={365} value={form.duration_days} onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))} />
            </div>
          </div>
          <label>Title (中文) *</label>
          <input className="form-input" value={form.title_zh} onChange={e => setForm(f => ({ ...f, title_zh: e.target.value }))} />
          <label>Title (EN)</label>
          <input className="form-input" value={form.title_en} onChange={e => setForm(f => ({ ...f, title_en: e.target.value }))} />
          <label>Description (中文)</label>
          <textarea className="form-input" rows={2} value={form.description_zh} onChange={e => setForm(f => ({ ...f, description_zh: e.target.value }))} />
          <label>Description (EN)</label>
          <textarea className="form-input" rows={2} value={form.description_en} onChange={e => setForm(f => ({ ...f, description_en: e.target.value }))} />
          <label>Status</label>
          <select className="form-input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            <option value="draft">draft — nobody is enrolled</option>
            <option value="active">active — coaches can activate it for their clients</option>
            <option value="archived">archived — no new activations; existing enrollments stay</option>
          </select>
          <label>Channels <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>— where coaches may activate it: a bound channel and all its sub-channels; leave empty for every channel</span></label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(channels || []).map(c => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: form.channel_ids.includes(c.id) ? '#dbeafe' : 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={form.channel_ids.includes(c.id)} onChange={() => toggleChannel(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// One program day. Lesson picker is course → lesson (both from the Academy); questionnaire picker
// is filtered to type 'program_day'; the recap template shows the selected questionnaire's keys.
function DayEditor({ program, day, courses, questionnaires, onSaved }) {
  const [form, setForm] = useState({
    title_zh: day.title_zh || '', title_en: day.title_en || '',
    intro_md_zh: day.intro_md_zh || '', intro_md_en: day.intro_md_en || '',
    lesson_id: day.lesson_id || '', questionnaire_id: day.questionnaire_id || '',
    summary_template_zh: day.summary_template_zh || '', summary_template_en: day.summary_template_en || '',
    checkin_label_zh: day.checkin_label_zh || '开始打卡', checkin_label_en: day.checkin_label_en || 'Start check-in',
  });
  const [courseId, setCourseId] = useState(day.lesson_course_id || '');
  const [lessons, setLessons] = useState([]);
  const [questionKeys, setQuestionKeys] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!courseId) { setLessons([]); return; }
    axios.get(`/api/academy/lessons?course_id=${courseId}`).then(r => setLessons(r.data.lessons || [])).catch(() => setLessons([]));
  }, [courseId]);

  useEffect(() => {
    if (!form.questionnaire_id) { setQuestionKeys([]); return; }
    axios.get(`/api/questionnaires/${form.questionnaire_id}/questions`)
      .then(r => setQuestionKeys((r.data.questions || []).map(q => ({ key: q.key, input_type: q.input_type, sliders: (q.config?.sliders || []).map(s => s.key) }))))
      .catch(() => setQuestionKeys([]));
  }, [form.questionnaire_id]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const res = await axios.put(`/api/programs/${program.id}/days/${day.day_index}`, {
        ...form,
        lesson_id: form.lesson_id === '' ? null : parseInt(form.lesson_id),
        questionnaire_id: form.questionnaire_id === '' ? null : parseInt(form.questionnaire_id),
      });
      if (!res.data.success) throw new Error(res.data.error || 'Save failed');
      onSaved();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const placeholders = questionKeys.flatMap(q => q.sliders.length ? q.sliders.map(s => `{{${q.key}.${s}}}`) : [`{{${q.key}}}`]);

  return (
    <div className="modal-body" style={{ padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 8 }}>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label>Title (中文)</label><input className="form-input" value={form.title_zh} onChange={e => setForm(f => ({ ...f, title_zh: e.target.value }))} /></div>
        <div><label>Title (EN)</label><input className="form-input" value={form.title_en} onChange={e => setForm(f => ({ ...f, title_en: e.target.value }))} /></div>
      </div>
      <label>Intro (中文, markdown) <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>— the prose above the lesson card; falls back to the title</span></label>
      <textarea className="form-input" rows={3} value={form.intro_md_zh} onChange={e => setForm(f => ({ ...f, intro_md_zh: e.target.value }))} />
      <label>Intro (EN, markdown)</label>
      <textarea className="form-input" rows={2} value={form.intro_md_en} onChange={e => setForm(f => ({ ...f, intro_md_en: e.target.value }))} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Lesson — course</label>
          <select className="form-input" value={courseId} onChange={e => { setCourseId(e.target.value); setForm(f => ({ ...f, lesson_id: '' })); }}>
            <option value="">(no lesson)</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}{c.status !== 'published' ? ` (${c.status})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label>Lesson — video</label>
          <select className="form-input" value={form.lesson_id} disabled={!courseId} onChange={e => setForm(f => ({ ...f, lesson_id: e.target.value }))}>
            <option value="">(none)</option>
            {lessons.map(l => <option key={l.id} value={l.id}>{l.title}{l.content_type !== 'video' ? ` (${l.content_type})` : ''}</option>)}
          </select>
        </div>
      </div>

      <label>打卡 questionnaire <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>— type program_day; author it under Content ▸ Questionnaires</span></label>
      <select className="form-input" value={form.questionnaire_id} onChange={e => setForm(f => ({ ...f, questionnaire_id: e.target.value }))}>
        <option value="">(no 打卡 — the day completes on tap)</option>
        {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name_zh || q.name} · {q.question_count} questions{q.is_active ? '' : ' (inactive)'}</option>)}
      </select>

      <label>Recap template (中文) <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>— posted after the 打卡; placeholders resolve from the answers</span></label>
      {placeholders.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'monospace', lineHeight: 1.8, wordBreak: 'break-all' }}>{placeholders.join('  ')}</div>
      )}
      <textarea className="form-input code-input" rows={7} value={form.summary_template_zh} onChange={e => setForm(f => ({ ...f, summary_template_zh: e.target.value }))} />
      <label>Recap template (EN)</label>
      <textarea className="form-input code-input" rows={4} value={form.summary_template_en} onChange={e => setForm(f => ({ ...f, summary_template_en: e.target.value }))} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label>Button label (中文)</label><input className="form-input" value={form.checkin_label_zh} onChange={e => setForm(f => ({ ...f, checkin_label_zh: e.target.value }))} /></div>
        <div><label>Button label (EN)</label><input className="form-input" value={form.checkin_label_en} onChange={e => setForm(f => ({ ...f, checkin_label_en: e.target.value }))} /></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : `Save Day ${day.day_index}`}</button>
      </div>
    </div>
  );
}

function DaysPanel({ program, courses, questionnaires }) {
  const [days, setDays] = useState([]);
  const [openDay, setOpenDay] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    axios.get(`/api/programs/${program.id}/days`).then(r => setDays(r.data.days || [])).catch(() => setDays([])).finally(() => setLoading(false));
  }, [program.id]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: 'var(--muted)', padding: 12 }}>Loading days…</div>;
  return (
    <div style={{ marginTop: 8 }}>
      {days.map(d => (
        <div key={d.day_index} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setOpenDay(openDay === d.day_index ? null : d.day_index)}>
            <span style={{ fontWeight: 600, minWidth: 56 }}>Day {d.day_index}</span>
            <span style={{ flex: 1 }}>{d.title_zh}</span>
            <span style={{ fontSize: 11, color: d.lesson_id ? '#2563eb' : 'var(--muted)' }}>{d.lesson_id ? `▶ ${d.lesson_title}` : 'no lesson'}</span>
            <span style={{ fontSize: 11, color: d.questionnaire_id ? '#059669' : 'var(--muted)' }}>{d.questionnaire_id ? `☑ ${d.questionnaire_name_zh || d.questionnaire_name}` : 'no 打卡'}</span>
            {openDay === d.day_index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
          {openDay === d.day_index && (
            <DayEditor program={program} day={d} courses={courses} questionnaires={questionnaires} onSaved={() => { load(); }} />
          )}
        </div>
      ))}
    </div>
  );
}

function EnrollmentsPanel({ program }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    axios.get(`/api/programs/${program.id}/enrollments`).then(r => setRows(r.data.enrollments || [])).catch(() => setRows([])).finally(() => setLoading(false));
  }, [program.id]);
  if (loading) return <div style={{ color: 'var(--muted)', padding: 12 }}>Loading…</div>;
  if (!rows.length) return <div style={{ color: 'var(--muted)', padding: 12 }}>No one enrolled yet — a coach activates the program for a client from the coach app (client → 方案 → 打卡计划).</div>;
  const n = program.duration_days;
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
    <table className="data-table" style={{ minWidth: 520 + n * 36 }}>
      <thead>
        <tr><th>User</th><th>Activated by</th><th>Status</th><th>Started</th><th>Next day</th>{Array.from({ length: n }, (_, i) => <th key={i} style={{ textAlign: 'center' }}>{i + 1}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map(e => {
          const byDay = Object.fromEntries((e.days || []).map(d => [d.day_index, d]));
          return (
            <tr key={e.id}>
              <td>{e.nickname || e.user_id}</td>
              <td style={{ color: 'var(--muted)' }}>{e.activated_by_name || '—'}</td>
              <td><span style={{ color: STATUS_COLOR[e.status === 'completed' ? 'active' : 'draft'] }}>{e.status}</span></td>
              <td>{e.started_on}</td>
              <td>{e.status === 'completed' ? '—' : e.current_day}</td>
              {Array.from({ length: n }, (_, i) => {
                const d = byDay[i + 1];
                const mark = !d ? '' : d.completed ? '✓' : (d.lesson_done || d.checkin_done) ? '◐' : '○';
                const stalled = d && !d.completed && d.stalled_days > 0;
                const title = !d ? '' : `offered ${d.offered_on}${stalled ? ` · open for ${d.stalled_days}d · nudged ${d.nudge_count}×` : ''}`;
                return <td key={i} style={{ textAlign: 'center', color: d?.completed ? '#10b981' : stalled ? '#f59e0b' : 'var(--muted)', fontWeight: stalled ? 700 : 400 }} title={title}>{mark}{stalled ? d.stalled_days : ''}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}

function ProgramsTab({ channels }) {
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [questionnaires, setQuestionnaires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);       // null | { program?: {} }
  const [open, setOpen] = useState({});            // program id -> 'days' | 'enrollments' | undefined

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      axios.get('/api/programs').then(r => r.data.programs || []),
      axios.get('/api/academy/courses').then(r => r.data.courses || []).catch(() => []),
      axios.get('/api/questionnaires?type=program_day').then(r => r.data.questionnaires || []).catch(() => []),
    ]).then(([p, c, q]) => { setPrograms(p); setCourses(c); setQuestionnaires(q); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!window.confirm(`Delete program "${p.title_zh}"? Only possible with no enrollments.`)) return;
    try {
      const res = await axios.delete(`/api/programs/${p.id}`);
      if (!res.data.success) alert(res.data.error || 'Delete failed');
      load();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const toggle = (id, panel) => setOpen(o => ({ ...o, [id]: o[id] === panel ? undefined : panel }));

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          Multi-day 打卡 programs delivered in the chat tab: one lesson + one check-in per day, one day per calendar day. A coach activates a program for a client from the coach app.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={load}><RefreshCw size={13} /></button>
          <button className="btn-primary" onClick={() => setModal({})}><Plus size={13} /> New Program</button>
        </div>
      </div>

      {loading && <div style={{ color: 'var(--muted)' }}>Loading…</div>}
      {!loading && programs.length === 0 && <div style={{ color: 'var(--muted)' }}>No programs yet.</div>}

      {programs.map(p => (
        <div key={p.id} className="card" style={{ marginBottom: 12, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {p.title_zh} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>{p.title_en}</span>
                <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 6px', borderRadius: 4, background: (STATUS_COLOR[p.status] || '#475569') + '22', color: STATUS_COLOR[p.status] || '#94a3b8' }}>{p.status}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                <code>{p.key_name}</code> · {p.duration_days} days · {(p.channels || []).length ? (p.channels || []).map(c => c.name).join(', ') : <span style={{ color: '#f59e0b' }}>no channel bound</span>} · {p.enrollment_count} enrolled, {p.completed_count} completed
              </div>
            </div>
            <button className="btn-secondary" onClick={() => toggle(p.id, 'days')}>Days {open[p.id] === 'days' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
            <button className="btn-secondary" onClick={() => toggle(p.id, 'enrollments')}><UsersIcon size={12} /> Roster</button>
            <button className="icon-btn" onClick={() => setModal({ program: p })}><Pencil size={14} /></button>
            <button className="icon-btn" onClick={() => remove(p)} disabled={p.enrollment_count > 0} title={p.enrollment_count > 0 ? 'Has enrollments — archive instead' : 'Delete'}><Trash2 size={14} /></button>
          </div>
          {open[p.id] === 'days' && <DaysPanel program={p} courses={courses} questionnaires={questionnaires} />}
          {open[p.id] === 'enrollments' && <EnrollmentsPanel program={p} />}
        </div>
      ))}

      {modal && <ProgramModal program={modal.program} channels={channels} onClose={() => setModal(null)} onSave={() => { setModal(null); load(); }} />}
    </div>
  );
}

export { ProgramsTab };
