import React, { useState, useEffect, useCallback, useContext } from 'react';
import axios from 'axios';
import { X, Plus, Pencil, Trash2, ChevronDown, ChevronUp, Send, Eye } from 'lucide-react';
import { LangCtx } from '../shared.jsx';

const INPUT_TYPES = ['text', 'button_select', 'date_picker', 'slider_group', 'multi_select'];
const SAVE_TARGETS = ['user_field', 'bio_data_field', 'biomarker'];

function GenerateQuestionnaireModal({ channels, onClose, onSave }) {
  const [topic, setTopic] = useState('');
  const [channelId, setChannelId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!topic.trim()) return;
    setGenerating(true); setError(''); setPreview(null);
    try {
      const res = await axios.post('/api/questionnaires/generate', { topic: topic.trim() });
      if (res.data.success) setPreview(res.data.questionnaire);
      else setError(res.data.error || 'Generation failed');
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setGenerating(false); }
  };

  const create = async () => {
    if (!preview) return;
    setSaving(true); setError('');
    try {
      const qRes = await axios.post('/api/questionnaires', {
        name: preview.name,
        name_zh: preview.name_zh || null,
        description: preview.description || null,
        description_zh: preview.description_zh || null,
        type: 'custom',
        channel_id: channelId === '' ? null : parseInt(channelId),
      });
      const qId = qRes.data.questionnaire.id;
      for (let i = 0; i < (preview.questions || []).length; i++) {
        const q = preview.questions[i];
        await axios.post(`/api/questionnaires/${qId}/questions`, {
          key: q.key,
          sort_order: i,
          input_type: q.input_type,
          prompt_zh: q.prompt_zh || '',
          prompt_en: q.prompt_en || '',
          config: q.config || {},
          completion_check: {},
        });
      }
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const INPUT_TYPE_COLOR = { text: '#6366f1', button_select: '#0ea5e9', date_picker: '#f59e0b', slider_group: '#10b981', multi_select: '#8b5cf6' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h3>✨ Generate Questionnaire with AI</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Describe the questionnaire topic</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="e.g. Sleep quality and recovery habits for longevity-focused users"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            disabled={generating || saving}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
          />
          <button className="btn-primary" onClick={generate} disabled={generating || saving || !topic.trim()} style={{ marginTop: 8 }}>
            {generating ? 'Generating…' : '✨ Generate'}
          </button>

          {preview && (
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #1e293b' }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>
                  {preview.name}
                  {preview.name_zh && <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>{preview.name_zh}</span>}
                </div>
                {preview.description && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{preview.description}</div>}
              </div>

              <label>Channel</label>
              <select className="form-input" value={channelId} onChange={e => setChannelId(e.target.value)}>
                <option value="">Global (all channels)</option>
                {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <div style={{ color: '#64748b', fontSize: 11, margin: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {(preview.questions || []).length} Questions
              </div>
              {(preview.questions || []).map((q, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#0f172a', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ color: '#475569', minWidth: 18, paddingTop: 1 }}>{i + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ marginBottom: 2 }}>{q.prompt_en}</div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>{q.prompt_zh}</div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: (INPUT_TYPE_COLOR[q.input_type] || '#475569') + '22', color: INPUT_TYPE_COLOR[q.input_type] || '#94a3b8', alignSelf: 'flex-start', whiteSpace: 'nowrap' }}>
                    {q.input_type}
                  </span>
                </div>
              ))}

              <div style={{ fontSize: 12, color: '#64748b', marginTop: 12 }}>
                Review the preview above. Click Create to save this questionnaire and all its questions.
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          {!preview && (
            <button className="btn-primary" onClick={generate} disabled={generating || !topic.trim()}>
              {generating ? 'Generating…' : '✨ Generate'}
            </button>
          )}
          {preview && (
            <button className="btn-primary" onClick={create} disabled={saving}>
              {saving ? 'Creating…' : 'Create Questionnaire'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionnaireModal({ questionnaire, channels, onClose, onSave }) {
  const isEdit = !!questionnaire;
  const [form, setForm] = useState({
    name: questionnaire?.name || '',
    name_zh: questionnaire?.name_zh || '',
    description: questionnaire?.description || '',
    description_zh: questionnaire?.description_zh || '',
    type: questionnaire?.type || 'custom',
    channel_id: questionnaire?.channel_id ?? '',
    is_active: questionnaire?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, channel_id: form.channel_id === '' ? null : parseInt(form.channel_id) };
      if (isEdit) await axios.put(`/api/questionnaires/${questionnaire.id}`, payload);
      else await axios.post('/api/questionnaires', payload);
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Questionnaire' : 'New Questionnaire'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Name (EN) *</label>
          <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <label>Name (中文)</label>
          <input className="form-input" value={form.name_zh} onChange={e => setForm(f => ({ ...f, name_zh: e.target.value }))} />
          <label>Description (EN)</label>
          <textarea className="form-input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <label>Description (中文)</label>
          <textarea className="form-input" rows={2} value={form.description_zh} onChange={e => setForm(f => ({ ...f, description_zh: e.target.value }))} />
          <label>Type</label>
          <select className="form-input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
            <option value="custom">Custom</option>
            <option value="onboarding">Onboarding</option>
          </select>
          <label>Channel</label>
          <select className="form-input" value={form.channel_id} onChange={e => setForm(f => ({ ...f, channel_id: e.target.value }))}>
            <option value="">Global (all channels)</option>
            {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function QuestionModal({ question, questionnaireId, onClose, onSave }) {
  const isEdit = !!question;
  const [inputType, setInputType] = useState(question?.input_type || 'text');
  const [form, setForm] = useState({
    key: question?.key || '',
    sort_order: question?.sort_order ?? 0,
    prompt_zh: question?.prompt_zh || '',
    prompt_en: question?.prompt_en || '',
    is_active: question?.is_active ?? true,
    save_target: question?.save_target || '',
    save_field: question?.save_field || '',
    save_biomarker_type: question?.save_biomarker_type || '',
    completion_check: question?.completion_check ? JSON.stringify(question.completion_check, null, 2) : '{}',
    config: question?.config ? JSON.stringify(question.config, null, 2) : '{}',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!form.key || !form.prompt_zh || !form.prompt_en) { setError('Key, prompt ZH and EN required'); return; }
    let completion_check, config;
    try { completion_check = JSON.parse(form.completion_check); } catch { setError('Invalid JSON in Completion Check'); return; }
    try { config = JSON.parse(form.config); } catch { setError('Invalid JSON in Config'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form, input_type: inputType, completion_check, config,
        save_target: form.save_target || null,
        save_field: form.save_field || null,
        save_biomarker_type: form.save_biomarker_type || null,
        sort_order: parseInt(form.sort_order) || 0,
      };
      if (isEdit) await axios.put(`/api/questionnaire-questions/${question.id}`, payload);
      else await axios.post(`/api/questionnaires/${questionnaireId}/questions`, payload);
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h3>{isEdit ? 'Edit Question' : 'New Question'}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>Key *</label>
              <input className="form-input" value={form.key} onChange={e => setForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. nickname" />
            </div>
            <div>
              <label>Sort Order</label>
              <input className="form-input" type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </div>
          </div>
          <label>Input Type *</label>
          <select className="form-input" value={inputType} onChange={e => setInputType(e.target.value)}>
            {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label>Prompt (中文) *</label>
          <textarea className="form-input" rows={2} value={form.prompt_zh} onChange={e => setForm(f => ({ ...f, prompt_zh: e.target.value }))} />
          <label>Prompt (EN) *</label>
          <textarea className="form-input" rows={2} value={form.prompt_en} onChange={e => setForm(f => ({ ...f, prompt_en: e.target.value }))} />
          <label>Save Target</label>
          <select className="form-input" value={form.save_target} onChange={e => setForm(f => ({ ...f, save_target: e.target.value }))}>
            <option value="">None (responses table only)</option>
            {SAVE_TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {(form.save_target === 'user_field' || form.save_target === 'bio_data_field') && (
            <>
              <label>Save Field (column / bio_data key)</label>
              <input className="form-input" value={form.save_field} onChange={e => setForm(f => ({ ...f, save_field: e.target.value }))} placeholder="e.g. nickname" />
            </>
          )}
          {form.save_target === 'biomarker' && (
            <>
              <label>Biomarker Type</label>
              <input className="form-input" value={form.save_biomarker_type} onChange={e => setForm(f => ({ ...f, save_biomarker_type: e.target.value }))} placeholder="e.g. body_composition" />
            </>
          )}
          <label>Completion Check (JSON) <span style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>— how miniapp detects if already answered</span></label>
          <textarea className="form-input code-input" rows={3} value={form.completion_check} onChange={e => setForm(f => ({ ...f, completion_check: e.target.value }))} />
          <label>Config (JSON) <span style={{ color: '#64748b', fontWeight: 400, fontSize: 11 }}>— input-type-specific options</span></label>
          <textarea className="form-input code-input" rows={6} value={form.config} onChange={e => setForm(f => ({ ...f, config: e.target.value }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            Active
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

// Types a human may assign. An allowlist, so a future type defaults to non-assignable.
// 'dynamic' and 'viva_ag' are generated at runtime FOR ONE PERSON — Viva's own mid-conversation
// follow-up, and a clarifying form the external AG agent pushed back to unblock one specific job.
// Assigning either to somebody else hands them questions written about a different person's
// situation. They still appear in the management list and the assignments filter; they just
// cannot be handed out.
const ASSIGNABLE_TYPES = ['onboarding', 'custom'];

function AssignModal({ questionnaires, users, coaches, onClose, onSave }) {
  const [questionnaireId, setQuestionnaireId] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [filterCoach, setFilterCoach] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredUsers = filterCoach
    ? users.filter(u => String(u.coach_id) === filterCoach)
    : users;

  const toggleUser = (uid) => setSelectedUsers(prev =>
    prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]
  );

  const save = async () => {
    if (!questionnaireId) { setError('Select a questionnaire'); return; }
    if (!selectedUsers.length) { setError('Select at least one user'); return; }
    setSaving(true); setError('');
    try {
      await axios.post('/api/questionnaire-assignments', {
        questionnaire_id: parseInt(questionnaireId),
        user_ids: selectedUsers,
      });
      onSave();
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Assign Questionnaire</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {error && <div className="error-banner">{error}</div>}
          <label>Questionnaire *</label>
          <select className="form-input" value={questionnaireId} onChange={e => setQuestionnaireId(e.target.value)}>
            <option value="">— select —</option>
            {questionnaires.filter(q => q.is_active && ASSIGNABLE_TYPES.includes(q.type)).map(q => (
              <option key={q.id} value={q.id}>{q.name}{q.type === 'onboarding' ? ' (onboarding)' : ''}</option>
            ))}
          </select>
          <label>Filter by Coach</label>
          <select className="form-input" value={filterCoach} onChange={e => setFilterCoach(e.target.value)}>
            <option value="">All coaches</option>
            {coaches.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Select Users ({selectedUsers.length} selected)</label>
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #1e293b', borderRadius: 6, padding: 4 }}>
            {filteredUsers.length === 0 && <div style={{ padding: 12, color: '#64748b', textAlign: 'center' }}>No users</div>}
            {filteredUsers.map(u => (
              <label key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, background: selectedUsers.includes(u.user_id) ? '#1e3a5f' : 'transparent' }}>
                <input type="checkbox" checked={selectedUsers.includes(u.user_id)} onChange={() => toggleUser(u.user_id)} />
                <span>{u.nickname || u.user_id}</span>
                <span style={{ color: '#64748b', fontSize: 11 }}>{u.channel_name || ''}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSelectedUsers(filteredUsers.map(u => u.user_id))}>Select all</button>
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setSelectedUsers([])}>Clear</button>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Sending…' : `Send to ${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`}</button>
        </div>
      </div>
    </div>
  );
}

function ResponsesModal({ assignment, onClose }) {
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`/api/questionnaire-responses?assignment_id=${assignment.id}`)
      .then(r => setResponses(r.data.responses || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [assignment.id]);

  const formatAnswer = (answer, inputType) => {
    if (Array.isArray(answer)) return answer.join(', ');
    if (typeof answer === 'object' && answer !== null) return JSON.stringify(answer);
    return String(answer ?? '—');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Responses — {assignment.user_nickname || assignment.user_id}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {loading && <div style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>Loading…</div>}
          {!loading && responses.length === 0 && <div style={{ color: '#64748b' }}>No responses yet.</div>}
          {responses.map(r => (
            <div key={r.id} style={{ marginBottom: 12, padding: '10px 12px', background: '#0f172a', borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{r.key} · {r.input_type}</div>
              <div style={{ fontSize: 13 }}>{r.prompt_en}</div>
              <div style={{ marginTop: 6, fontWeight: 600, color: '#93c5fd' }}>{formatAnswer(r.answer, r.input_type)}</div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>{new Date(r.answered_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = { pending: '#f59e0b', in_progress: '#3b82f6', completed: '#22c55e' };

function QuestionnairesTab({ channels, users, coaches }) {
  const [subTab, setSubTab] = useState('builder');
  const [questionnaires, setQuestionnaires] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [expandedQ, setExpandedQ] = useState(null);
  const [questions, setQuestions] = useState({});
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterQId, setFilterQId] = useState('');

  const fetchQuestionnaires = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/questionnaires');
      setQuestionnaires(res.data.questionnaires || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterQId) params.questionnaire_id = filterQId;
      if (filterStatus !== 'all') params.status = filterStatus;
      const res = await axios.get('/api/questionnaire-assignments', { params });
      setAssignments(res.data.assignments || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filterQId, filterStatus]);

  useEffect(() => { fetchQuestionnaires(); }, [fetchQuestionnaires]);
  useEffect(() => { if (subTab === 'assignments') fetchAssignments(); }, [subTab, fetchAssignments]);

  const loadQuestions = async (qid) => {
    if (questions[qid]) return;
    const res = await axios.get(`/api/questionnaires/${qid}/questions`);
    setQuestions(prev => ({ ...prev, [qid]: res.data.questions || [] }));
  };

  const toggleExpand = async (qid) => {
    if (expandedQ === qid) { setExpandedQ(null); return; }
    await loadQuestions(qid);
    setExpandedQ(qid);
  };

  const reorderQuestion = async (qid, questionId, dir) => {
    const qs = [...(questions[qid] || [])];
    const idx = qs.findIndex(q => q.id === questionId);
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === qs.length - 1)) return;
    const swapIdx = idx + dir;
    [qs[idx].sort_order, qs[swapIdx].sort_order] = [qs[swapIdx].sort_order, qs[idx].sort_order];
    [qs[idx], qs[swapIdx]] = [qs[swapIdx], qs[idx]];
    setQuestions(prev => ({ ...prev, [qid]: qs }));
    await axios.put('/api/questionnaire-questions/reorder', {
      items: [{ id: qs[idx].id, sort_order: qs[idx].sort_order }, { id: qs[swapIdx].id, sort_order: qs[swapIdx].sort_order }]
    });
  };

  const deleteQuestion = async (qid, questionId) => {
    if (!confirm('Delete this question?')) return;
    await axios.delete(`/api/questionnaire-questions/${questionId}`);
    setQuestions(prev => ({ ...prev, [qid]: prev[qid].filter(q => q.id !== questionId) }));
  };

  const deleteQuestionnaire = async (q) => {
    if (!confirm(`Deactivate "${q.name}"?`)) return;
    await axios.delete(`/api/questionnaires/${q.id}`);
    fetchQuestionnaires();
  };

  const closeAndRefreshBuilder = () => {
    setModal(null);
    fetchQuestionnaires();
    if (expandedQ) setQuestions(prev => { const n = { ...prev }; delete n[expandedQ]; return n; });
  };

  const closeAndRefreshAssignments = () => { setModal(null); fetchAssignments(); };

  return (
    <>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['builder', 'assignments'].map(st => (
          <button key={st} className={`subtab-btn${subTab === st ? ' active' : ''}`} onClick={() => setSubTab(st)}>
            {st === 'builder' ? 'Builder' : 'Assignments'}
          </button>
        ))}
      </div>

      {/* Builder sub-tab */}
      {subTab === 'builder' && (
        <div className="card">
          <div className="table-toolbar">
            <span style={{ fontWeight: 600 }}>Questionnaires ({questionnaires.length})</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => setModal({ type: 'generate-questionnaire' })}>
                ✨ Generate with AI
              </button>
              <button className="btn-primary" onClick={() => setModal({ type: 'new-questionnaire' })}>
                <Plus size={14} /> New Questionnaire
              </button>
            </div>
          </div>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>Loading…</div>}
          {!loading && questionnaires.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No questionnaires yet.</div>}
          {questionnaires.map(q => (
            <div key={q.id} style={{ borderTop: '1px solid #1e293b' }}>
              {/* Questionnaire header row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
                <button className="icon-btn" onClick={() => toggleExpand(q.id)}>
                  {expandedQ === q.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{q.name}</span>
                  {q.name_zh && <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>{q.name_zh}</span>}
                  <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 6px', borderRadius: 4, background: q.type === 'onboarding' ? '#1e3a5f' : '#1e293b', color: q.type === 'onboarding' ? '#93c5fd' : '#94a3b8' }}>{q.type}</span>
                  {!q.is_active && <span style={{ marginLeft: 6, fontSize: 11, color: '#ef4444' }}>inactive</span>}
                </div>
                <span style={{ fontSize: 11, color: '#64748b' }}>{q.channel_name || 'Global'}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{q.question_count} questions</span>
                <button className="icon-btn" title="Edit" onClick={() => setModal({ type: 'edit-questionnaire', questionnaire: q })}><Pencil size={14} /></button>
                <button className="icon-btn" title="Deactivate" onClick={() => deleteQuestionnaire(q)}><Trash2 size={14} /></button>
              </div>

              {/* Expanded question list */}
              {expandedQ === q.id && (
                <div style={{ background: '#0f172a', padding: '8px 16px 12px 40px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>Questions</span>
                    <button className="btn-primary" style={{ fontSize: 11, padding: '4px 10px' }} onClick={() => setModal({ type: 'new-question', questionnaireId: q.id })}>
                      <Plus size={12} /> Add Question
                    </button>
                  </div>
                  {(questions[q.id] || []).length === 0 && <div style={{ color: '#475569', fontSize: 12 }}>No questions yet.</div>}
                  {(questions[q.id] || []).map((qq, idx, arr) => (
                    <div key={qq.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: idx < arr.length - 1 ? '1px solid #1e293b' : 'none' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <button className="icon-btn" style={{ padding: 2 }} onClick={() => reorderQuestion(q.id, qq.id, -1)} disabled={idx === 0}><ChevronUp size={11} /></button>
                        <button className="icon-btn" style={{ padding: 2 }} onClick={() => reorderQuestion(q.id, qq.id, 1)} disabled={idx === arr.length - 1}><ChevronDown size={11} /></button>
                      </div>
                      <span style={{ fontSize: 11, color: '#475569', width: 20, textAlign: 'right' }}>{qq.sort_order}</span>
                      <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#1e293b', color: '#94a3b8', whiteSpace: 'nowrap' }}>{qq.input_type}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{qq.key}</div>
                        <div style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{qq.prompt_en}</div>
                      </div>
                      {qq.save_target && <span style={{ fontSize: 11, color: '#a78bfa', whiteSpace: 'nowrap' }}>{qq.save_target}</span>}
                      {!qq.is_active && <span style={{ fontSize: 11, color: '#ef4444' }}>off</span>}
                      <button className="icon-btn" onClick={() => setModal({ type: 'edit-question', question: qq, questionnaireId: q.id })}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => deleteQuestion(q.id, qq.id)}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Assignments sub-tab */}
      {subTab === 'assignments' && (
        <div className="card">
          <div className="table-toolbar">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select className="form-input" style={{ width: 'auto', fontSize: 12 }} value={filterQId} onChange={e => setFilterQId(e.target.value)}>
                <option value="">All questionnaires</option>
                {questionnaires.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
              {['all', 'pending', 'in_progress', 'completed'].map(s => (
                <button key={s} className={`subtab-btn${filterStatus === s ? ' active' : ''}`} onClick={() => setFilterStatus(s)} style={{ fontSize: 11 }}>
                  {s === 'all' ? 'All' : s.replace('_', ' ')}
                </button>
              ))}
            </div>
            <button className="btn-primary" onClick={() => setModal({ type: 'assign' })}>
              <Send size={14} /> Assign
            </button>
          </div>
          <table className="data-table">
            <thead><tr>
              <th>User</th><th>Questionnaire</th><th>Assigned by</th><th>Status</th><th>Assigned</th><th>Completed</th><th></th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="empty-row">Loading…</td></tr>}
              {!loading && assignments.length === 0 && <tr><td colSpan={7} className="empty-row">No assignments found.</td></tr>}
              {assignments.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 500 }}>{a.user_nickname || a.user_id}</td>
                  <td>
                    {a.name}
                    <span style={{ marginLeft: 6, fontSize: 11, color: '#64748b' }}>{a.type === 'onboarding' ? '(onboarding)' : ''}</span>
                  </td>
                  <td style={{ fontSize: 12, color: '#64748b' }}>{a.assigned_by_name || a.assigned_by || <span style={{ color: '#475569' }}>system</span>}</td>
                  <td>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: STATUS_COLORS[a.status] + '22', color: STATUS_COLORS[a.status] }}>
                      {a.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(a.assigned_at).toLocaleDateString()}</td>
                  <td style={{ fontSize: 11, color: '#94a3b8' }}>{a.completed_at ? new Date(a.completed_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <button className="icon-btn" title="View responses" onClick={() => setModal({ type: 'responses', assignment: a })}><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'generate-questionnaire' && (
        <GenerateQuestionnaireModal channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {modal?.type === 'new-questionnaire' && (
        <QuestionnaireModal channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {modal?.type === 'edit-questionnaire' && (
        <QuestionnaireModal questionnaire={modal.questionnaire} channels={channels} onClose={() => setModal(null)} onSave={closeAndRefreshBuilder} />
      )}
      {(modal?.type === 'new-question' || modal?.type === 'edit-question') && (
        <QuestionModal
          question={modal.type === 'edit-question' ? modal.question : null}
          questionnaireId={modal.questionnaireId}
          onClose={() => setModal(null)}
          onSave={() => {
            setModal(null);
            setQuestions(prev => { const n = { ...prev }; delete n[modal.questionnaireId]; return n; });
            loadQuestions(modal.questionnaireId);
            fetchQuestionnaires();
          }}
        />
      )}
      {modal?.type === 'assign' && (
        <AssignModal questionnaires={questionnaires} users={users} coaches={coaches} onClose={() => setModal(null)} onSave={closeAndRefreshAssignments} />
      )}
      {modal?.type === 'responses' && (
        <ResponsesModal assignment={modal.assignment} onClose={() => setModal(null)} />
      )}
    </>
  );
}

export { QuestionnairesTab };
