import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { marked } from 'marked';
import {
  X, Check, Trash2, Plus, Pencil, ChevronDown, ChevronUp, ChevronRight,
  Upload, Video, FileText, BookOpen, Play, Target, TrendingUp,
  GraduationCap, Award, ClipboardList, Users, Download,
} from 'lucide-react';
import { useLang, fmt, fmtDate, Badge, StatCard, UserPicker } from '../shared.jsx';
import { formatOrdinal, renderCertificate, DEFAULT_TEMPLATE_LAYOUT, LAYOUT_FIELDS, resolveDisplayName, NAME_DISPLAY_MODES } from '../utils/certRender.js';

// ── Academy helpers ───────────────────────────────────────────────────────────

function uploadToOSS(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(file);
  });
}

function fmtBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Academy modals ────────────────────────────────────────────────────────────

function CourseModal({ course, courses = [], onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const isEdit = !!course?.id;
  const [form, setForm] = useState({
    title: course?.title || '',
    description: course?.description || '',
    status: course?.status || 'draft',
    level: course?.level || 'foundation',
    credit_value: course?.credit_value ?? 10,
    prerequisite_course_id: course?.prerequisite_course_id || '',
  });
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(ta.titleRequired); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      let oss_key = course?.oss_key || null;
      if (file) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'video', filename: file.name } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        const { url, key } = presignRes.data;
        await uploadToOSS(url, file, setProgress);
        oss_key = key;
      }
      const payload = {
        ...form,
        oss_key,
        credit_value: Number.isNaN(parseInt(form.credit_value)) ? 10 : parseInt(form.credit_value),
        prerequisite_course_id: form.prerequisite_course_id ? parseInt(form.prerequisite_course_id) : null,
      };
      if (isEdit) {
        await axios.put(`/api/academy/courses/${course.id}`, payload);
      } else {
        await axios.post('/api/academy/courses', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || ta.uploadFailed);
    } finally { setBusy(false); }
  };

  const LEVELS = ['foundation', 'intermediate', 'advanced', 'expert'];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? ta.editCourse : ta.uploadCourse}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Introduction to Longevity" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.description}</span>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{ta.status}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.status} onChange={e => set('status', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="draft">{ta.draft}</option>
                  <option value="published">{ta.published}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ta.level}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.level} onChange={e => set('level', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  {LEVELS.map(lv => <option key={lv} value={lv}>{lv.charAt(0).toUpperCase() + lv.slice(1)}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ta.creditsOnCompletion}</span>
              <input type="number" min={0} value={form.credit_value} onChange={e => set('credit_value', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{ta.prerequisite}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.prerequisite_course_id} onChange={e => set('prerequisite_course_id', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">— None —</option>
                  {courses.filter(c => c.id !== course?.id).map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.videoFile} (Course Overview, optional)</span>
              <label className="upload-zone">
                <input type="file" accept="video/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">
                  {file ? file.name : (course?.oss_key ? ta.replaceVideo : ta.selectVideo)}
                </span>
              </label>
              {busy && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteCourseConfirm({ course, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/academy/courses/${course.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.academy.deleteCourse}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>{t.academy.deleteCourseWarning(course.title)}</p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryModal({ onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { setError(ta.titleRequired); return; }
    if (!file) { setError(ta.fileRequired); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      const presignRes = await axios.get('/api/oss/presign', { params: { type: 'markdown', filename: file.name } });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
      const { url, key } = presignRes.data;
      await uploadToOSS(url, file, setProgress);
      await axios.post('/api/academy/library', { title, oss_key: key, file_size: file.size });
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || ta.uploadFailed);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ta.uploadDoc}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Longevity Nutrition Guide" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.mdFile}</span>
              <label className="upload-zone">
                <input type="file" accept=".md,text/markdown,text/plain" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">{file ? file.name : ta.selectMd}</span>
              </label>
              {busy && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteLibraryItemConfirm({ item, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/academy/library/${item.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.academy.deleteDoc}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>{t.academy.deleteDocWarning(item.title)}</p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Video player modal ────────────────────────────────────────────────────────

function VideoPlayerModal({ course, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/oss/presign', { params: { action: 'get', key: course.oss_key } })
      .then(res => setUrl(res.data.url))
      .catch(() => setError('Could not load video URL.'));
  }, [course.oss_key]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-video" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span><Video size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{course.title}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ padding: 0 }}>
          {error && <p style={{ padding: 20, color: '#dc2626' }}>{error}</p>}
          {!error && !url && <p style={{ padding: 20, color: 'var(--muted)' }}>Loading…</p>}
          {url && (
            <video
              src={url}
              controls
              autoPlay
              style={{ width: '100%', display: 'block', background: '#000', maxHeight: '70vh' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function MarkdownViewerModal({ item, onClose }) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const presign = await axios.get('/api/oss/presign', { params: { action: 'get', key: item.oss_key } });
        const raw = await fetch(presign.data.url);
        if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
        const text = await raw.text();
        setHtml(marked.parse(text));
      } catch (err) {
        setError(`Could not load document: ${err.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [item.oss_key]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-markdown" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span><BookOpen size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />{item.title}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body md-body">
          {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
          {error   && <p style={{ color: '#dc2626' }}>{error}</p>}
          {!loading && !error && <div dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      </div>
    </div>
  );
}

// ── Lesson modal ──────────────────────────────────────────────────────────────

function LessonModal({ lesson, courseId, onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const isEdit = !!lesson?.id;
  const [form, setForm] = useState({
    title: lesson?.title || '',
    description: lesson?.description || '',
    sort_order: lesson?.sort_order ?? 0,
    content_type: lesson?.content_type || 'video',
    text_content: lesson?.text_content || '',
    credit_value: lesson?.credit_value ?? 5,
    min_watch_seconds: lesson?.min_watch_seconds || '',
  });
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(ta.titleRequired); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      let oss_key = lesson?.oss_key || null;
      if (file) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'video', filename: file.name } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        const { url, key } = presignRes.data;
        await uploadToOSS(url, file, setProgress);
        oss_key = key;
      }
      const payload = {
        ...form,
        oss_key,
        credit_value: Number.isNaN(parseInt(form.credit_value)) ? 5 : parseInt(form.credit_value),
        min_watch_seconds: form.min_watch_seconds ? parseInt(form.min_watch_seconds) : null,
      };
      if (isEdit) {
        await axios.put(`/api/academy/lessons/${lesson.id}`, payload);
      } else {
        await axios.post('/api/academy/lessons', { ...payload, course_id: courseId });
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message || ta.uploadFailed);
    } finally { setBusy(false); }
  };

  const CONTENT_TYPES = [
    { value: 'video', label: 'Video', icon: '🎬' },
    { value: 'text', label: 'Text', icon: '📄' },
    { value: 'interactive', label: 'Interactive (Case Study)', icon: '🧩' },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span>{isEdit ? ta.editLesson : ta.addLesson}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Introduction to NMN" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.description}</span>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{ta.contentType}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {CONTENT_TYPES.map(ct => (
                  <button key={ct.value} type="button"
                    onClick={() => set('content_type', ct.value)}
                    style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                      border: form.content_type === ct.value ? '2px solid #6366f1' : '1px solid #e2e8f0',
                      background: form.content_type === ct.value ? '#eef2ff' : 'transparent',
                      color: form.content_type === ct.value ? '#6366f1' : 'inherit',
                    }}>
                    {ct.icon} {ct.label}
                  </button>
                ))}
              </div>
            </label>
            <label className="form-field">
              <span>{ta.credits}</span>
              <input type="number" min={0} value={form.credit_value} onChange={e => set('credit_value', e.target.value)} />
            </label>
            <label className="form-field">
              <span>Sort Order</span>
              <input type="number" min={0} value={form.sort_order} onChange={e => set('sort_order', parseInt(e.target.value) || 0)} />
            </label>

            {form.content_type === 'video' && (
              <>
                <label className="form-field">
                  <span>{ta.minWatchSeconds}</span>
                  <input type="number" min={0} value={form.min_watch_seconds} onChange={e => set('min_watch_seconds', e.target.value)} placeholder="Optional" />
                </label>
                <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span className="form-label-text">{ta.videoFile}</span>
                  <label className="upload-zone">
                    <input type="file" accept="video/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
                    <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                    <span className="upload-zone-hint">
                      {file ? file.name : (lesson?.oss_key ? ta.replaceVideo : ta.selectVideo)}
                    </span>
                  </label>
                  {busy && (
                    <div className="upload-progress">
                      <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                </div>
              </>
            )}

            {(form.content_type === 'text' || form.content_type === 'interactive') && (
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>{form.content_type === 'interactive' ? ta.interactiveContext : ta.textContent}</span>
                <textarea
                  value={form.text_content}
                  onChange={e => set('text_content', e.target.value)}
                  rows={10}
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
                  placeholder={form.content_type === 'interactive'
                    ? 'Provide background reading coaches should study before the case study scenario...'
                    : 'Write the lesson content here. Markdown is supported in the mini-app.'}
                />
              </label>
            )}
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteLessonConfirm({ lesson, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/academy/lessons/${lesson.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.academy.deleteLesson}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>{t.academy.deleteLessonWarning(lesson.title)}</p>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button className="btn-danger" onClick={handleDelete} disabled={busy}>
              <Trash2 size={14} />{busy ? t.modal.deleting : t.modal.delete}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quiz editor ───────────────────────────────────────────────────────────────

function QuizEditorSection({ lessonId }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/academy/lessons/${lessonId}`);
      setQuestions(res.data.quiz_questions || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [lessonId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (qId) => {
    try { await axios.delete(`/api/academy/lesson-quizzes/${qId}`); load(); } catch { /* silent */ }
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>
          Quiz Questions ({loading ? '…' : questions.length})
        </span>
        <button className="btn-primary" style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={() => setModal({ type: 'add' })}>
          <Plus size={11} /> Add Question
        </button>
      </div>
      {questions.map((q, i) => (
        <div key={q.id} style={{ background: '#f8fafc', borderRadius: 6, padding: '8px 10px', marginBottom: 6, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ flex: 1 }}>
              {q.scenario && <div style={{ color: '#64748b', marginBottom: 4, fontStyle: 'italic' }}>📋 {q.scenario.slice(0, 100)}{q.scenario.length > 100 ? '…' : ''}</div>}
              <div style={{ fontWeight: 600 }}>Q{i + 1}: {q.question}</div>
              <div style={{ marginTop: 4, color: '#475569' }}>
                {(q.options || []).map((o, oi) => (
                  <span key={oi} style={{ marginRight: 12, color: o.is_correct ? '#10b981' : 'inherit' }}>
                    {o.is_correct ? '✓ ' : ''}{o.text}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" onClick={() => setModal({ type: 'edit', question: q })}><Pencil size={11} /></button>
              <button className="icon-btn danger" onClick={() => handleDelete(q.id)}><Trash2 size={11} /></button>
            </div>
          </div>
        </div>
      ))}
      {modal && (
        <QuizQuestionModal
          lessonId={lessonId}
          question={modal.question || null}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function QuizQuestionModal({ lessonId, question, onClose, onSave }) {
  const isEdit = !!question?.id;
  const emptyOpt = () => ({ text: '', is_correct: false, explanation: '' });
  const [form, setForm] = useState({
    scenario: question?.scenario || '',
    question: question?.question || '',
    credit_value: question?.credit_value ?? 5,
    sort_order: question?.sort_order ?? 0,
  });
  const [options, setOptions] = useState(
    question?.options?.length ? question.options.map(o => ({ ...o })) : [emptyOpt(), emptyOpt(), emptyOpt(), emptyOpt()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setOpt = (i, k, v) => setOptions(opts => opts.map((o, idx) => idx === i ? { ...o, [k]: v } : o));
  const setCorrect = (i) => setOptions(opts => opts.map((o, idx) => ({ ...o, is_correct: idx === i })));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.question.trim()) { setError('Question is required'); return; }
    if (!options.some(o => o.is_correct)) { setError('Mark one option as correct'); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...form, lesson_id: lessonId, options, credit_value: Number.isNaN(parseInt(form.credit_value)) ? 5 : parseInt(form.credit_value) };
      if (isEdit) await axios.put(`/api/academy/lesson-quizzes/${question.id}`, payload);
      else await axios.post('/api/academy/lesson-quizzes', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <span>{isEdit ? 'Edit Quiz Question' : 'Add Quiz Question'}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Case Study Scenario (optional context)</span>
              <textarea value={form.scenario} onChange={e => setForm(f => ({ ...f, scenario: e.target.value }))}
                rows={3} style={{ resize: 'vertical' }} placeholder="A coach's client reports feeling fatigued despite good sleep. Their GDF-15 is 890 pg/mL…" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Question *</span>
              <textarea value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                rows={2} style={{ resize: 'vertical' }} placeholder="Based on this profile, which supplement should be prioritized?" />
            </label>
            <label className="form-field">
              <span>Credits for Correct Answer</span>
              <input type="number" min={0} value={form.credit_value} onChange={e => setForm(f => ({ ...f, credit_value: e.target.value }))} />
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#475569' }}>Answer Options (mark the correct one)</div>
            {options.map((o, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                <input type="radio" name="correct" checked={o.is_correct} onChange={() => setCorrect(i)}
                  style={{ marginTop: 6, flexShrink: 0, accentColor: '#10b981' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <input value={o.text} onChange={e => setOpt(i, 'text', e.target.value)}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    style={{ fontSize: 13, padding: '4px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: 'var(--input-bg, white)' }} />
                  {o.is_correct && (
                    <input value={o.explanation} onChange={e => setOpt(i, 'explanation', e.target.value)}
                      placeholder="Explanation shown after coach answers (optional)"
                      style={{ fontSize: 12, padding: '3px 8px', borderRadius: 4, border: '1px solid #e2e8f0', background: '#f0fdf4', color: '#15803d' }} />
                  )}
                </div>
              </div>
            ))}
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? 'Saving…' : 'Save Question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Certificate template layout editor ─────────────────────────────────────────

const LAYOUT_FIELD_LABELS = {
  name: 'Name', certificate_number: 'Cert. Number', validity_date: 'Validity Date', issue_date: 'Issue Date',
};
const LAYOUT_FIELD_SAMPLE = {
  name: 'Jane Doe', certificate_number: 'NO.SAMPLE0001',
  validity_date: 'Validity Date: 31st Dec 2027', issue_date: 'Awarded on 19th Jun 2026',
};

const LAYOUT_MIN_FONT_PCT = 0.5;
const LAYOUT_MAX_FONT_PCT = 15;

function TemplateLayoutEditor({ imageUrl, layout, onChange }) {
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const containerRef = React.useRef(null);
  const resizeStartRef = React.useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [imageUrl]);

  const setField = (field, patch) => onChange({ ...layout, [field]: { ...layout[field], ...patch } });

  const handlePointerDown = (field) => (e) => {
    e.preventDefault();
    setDragging(field);
    e.target.setPointerCapture(e.pointerId);
  };
  const handleResizePointerDown = (field) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cfg = layout[field] || DEFAULT_TEMPLATE_LAYOUT[field];
    resizeStartRef.current = { y: e.clientY, fontSizePct: cfg.fontSizePct };
    setResizing(field);
    e.target.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (dragging) {
      const xPct = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
      setField(dragging, { xPct, yPct });
    } else if (resizing && resizeStartRef.current) {
      const deltaY = e.clientY - resizeStartRef.current.y;
      const deltaPct = (deltaY / rect.height) * 100;
      const fontSizePct = Math.min(LAYOUT_MAX_FONT_PCT, Math.max(LAYOUT_MIN_FONT_PCT, resizeStartRef.current.fontSizePct + deltaPct));
      setField(resizing, { fontSizePct });
    }
  };
  const handlePointerUp = () => {
    setDragging(null);
    setResizing(null);
    resizeStartRef.current = null;
  };

  if (!imageUrl) return null;

  return (
    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
      <span className="form-label-text">Certificate Text Layout</span>
      <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>
        Drag a marker to position it; drag its bottom-right handle to resize the text.
      </p>
      <div
        ref={containerRef}
        style={{ position: 'relative', width: '100%', userSelect: 'none', border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img src={imageUrl} alt="Certificate template" style={{ width: '100%', display: 'block' }} draggable={false} />
        {LAYOUT_FIELDS.map((field) => {
          const cfg = layout[field] || DEFAULT_TEMPLATE_LAYOUT[field];
          if (!cfg.enabled) return null;
          const fontSizePx = containerHeight ? (cfg.fontSizePct / 100) * containerHeight : 11;
          // Must mirror ctx.textAlign anchoring in renderCertificate(): canvas anchors the
          // text's left/center/right edge exactly at (xPct, yPct), so the drag handle here
          // needs the same horizontal anchor or the marker position won't match the render.
          const hTranslate = cfg.align === 'left' ? '0%' : cfg.align === 'right' ? '-100%' : '-50%';
          return (
            <div
              key={field}
              onPointerDown={handlePointerDown(field)}
              style={{
                position: 'absolute', left: `${cfg.xPct}%`, top: `${cfg.yPct}%`,
                transform: `translate(${hTranslate}, -50%)`, cursor: 'grab',
                background: 'rgba(99,102,241,0.15)', border: '1px dashed #6366f1',
                borderRadius: 4, padding: '2px 10px 2px 6px', fontSize: fontSizePx, lineHeight: 1.15,
                textAlign: cfg.align || 'center',
                color: cfg.color || '#1a1a1a', fontWeight: cfg.fontWeight, whiteSpace: 'nowrap', touchAction: 'none',
              }}
            >
              {LAYOUT_FIELD_SAMPLE[field]}
              <span
                onPointerDown={handleResizePointerDown(field)}
                title="Drag to resize"
                style={{
                  position: 'absolute', right: -6, bottom: -6, width: 12, height: 12,
                  background: '#6366f1', border: '1px solid #fff', borderRadius: '50%',
                  cursor: 'nwse-resize', touchAction: 'none',
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        {LAYOUT_FIELDS.map((field) => {
          const cfg = layout[field] || DEFAULT_TEMPLATE_LAYOUT[field];
          return (
            <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!!cfg.enabled}
                onChange={(e) => setField(field, { enabled: e.target.checked })}
                style={{ accentColor: '#6366f1' }}
              />
              {LAYOUT_FIELD_LABELS[field]}
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Certification modals ──────────────────────────────────────────────────────

const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
const TIER_COLORS = { bronze: '#cd7f32', silver: '#94a3b8', gold: '#f59e0b', platinum: '#8b5cf6' };

function CertificationModal({ cert, courses = [], onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const isEdit = !!cert?.id;
  const [form, setForm] = useState({
    title: cert?.title || '',
    description: cert?.description || '',
    tier: cert?.tier || '',
    min_credits: cert?.min_credits ?? 0,
    badge_image_url: cert?.badge_image_url || '',
    is_active: cert?.is_active !== false,
    cert_number_prefix: cert?.cert_number_prefix || '',
    issuing_org: cert?.issuing_org || '',
    school_org: cert?.school_org || '',
    course_display_name: cert?.course_display_name || '',
    issue_date: cert?.issue_date ? cert.issue_date.slice(0, 10) : '',
    validity_date: cert?.validity_date ? cert.validity_date.slice(0, 10) : '',
  });
  const [templateFile, setTemplateFile] = useState(null);
  const [templateOssKey, setTemplateOssKey] = useState(cert?.template_image_oss_key || '');
  const [templateLayout, setTemplateLayout] = useState({ ...DEFAULT_TEMPLATE_LAYOUT, ...(cert?.template_layout || {}) });
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedCourseIds, setSelectedCourseIds] = useState(cert?.required_course_ids || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleCourse = (id) => setSelectedCourseIds(ids =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
  );

  // Keep a local object URL for the layout editor preview: a newly-picked
  // file previews instantly; an already-uploaded template is fetched once
  // through the same-origin proxy (auth header required, so <img src> alone can't load it).
  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    if (templateFile) {
      objectUrl = URL.createObjectURL(templateFile);
      setTemplatePreviewUrl(objectUrl);
    } else if (isEdit && templateOssKey) {
      axios.get(`/api/academy/certifications/${cert.id}/template-image`, { responseType: 'blob' })
        .then((res) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(res.data);
          setTemplatePreviewUrl(objectUrl);
        })
        .catch(() => { if (!cancelled) setTemplatePreviewUrl(null); });
    } else {
      setTemplatePreviewUrl(null);
    }
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [templateFile, templateOssKey, isEdit, cert?.id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(ta.titleRequired); return; }
    setBusy(true); setError(''); setUploadProgress(0);
    try {
      let template_image_oss_key = templateOssKey;
      if (templateFile) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'cert', filename: templateFile.name } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        await uploadToOSS(presignRes.data.url, templateFile, setUploadProgress);
        template_image_oss_key = presignRes.data.key;
      }
      const payload = {
        ...form,
        required_course_ids: selectedCourseIds,
        min_credits: parseInt(form.min_credits) || 0,
        template_image_oss_key: template_image_oss_key || null,
        template_layout: templateLayout,
      };
      if (isEdit) await axios.put(`/api/academy/certifications/${cert.id}`, payload);
      else await axios.post('/api/academy/certifications', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span>{isEdit ? ta.editCert : ta.newCert}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. PRECISION LONGEVITY PRACTITIONER" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.description}</span>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{ta.tier}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))} className="inline-select" style={{ width: '100%' }}>
                  <option value="">— {ta.noTier} —</option>
                  {TIERS.map(tier => <option key={tier} value={tier} style={{ color: TIER_COLORS[tier] }}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ta.minCredits}</span>
              <input type="number" min={0} value={form.min_credits} onChange={e => setForm(f => ({ ...f, min_credits: e.target.value }))} />
            </label>
            <label className="form-field">
              <span>{ta.certNumberPrefix}</span>
              <input value={form.cert_number_prefix} onChange={e => setForm(f => ({ ...f, cert_number_prefix: e.target.value }))} placeholder="e.g. AEVIVA" />
            </label>
            <label className="form-field">
              <span>{ta.certIssueDate}</span>
              <input
                type="date"
                value={form.issue_date}
                onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: 11 }}>{ta.certDatesSharedHint}</span>
            </label>
            <label className="form-field">
              <span>{ta.certValidityDate}</span>
              <input type="date" value={form.validity_date} onChange={e => setForm(f => ({ ...f, validity_date: e.target.value }))} />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.courseDisplayName}</span>
              <input value={form.course_display_name} onChange={e => setForm(f => ({ ...f, course_display_name: e.target.value }))} placeholder="e.g. 谢克曼长寿管理实操班" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.issuingOrg}</span>
              <textarea value={form.issuing_org} onChange={e => setForm(f => ({ ...f, issuing_org: e.target.value }))} rows={2} style={{ resize: 'vertical' }} placeholder="e.g. RANDY W. SCHEKMAN INTERNATIONAL HEALTH EDUCATION COLLEGE LIMITED" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.schoolOrg}</span>
              <input value={form.school_org} onChange={e => setForm(f => ({ ...f, school_org: e.target.value }))} placeholder="e.g. AEVIVA LONGEVITY INSTITUTE" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Badge Image URL (optional)</span>
              <input value={form.badge_image_url} onChange={e => setForm(f => ({ ...f, badge_image_url: e.target.value }))} placeholder="https://…" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.templateImage}</span>
              <label className="upload-zone">
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setTemplateFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">
                  {templateFile ? templateFile.name : (templateOssKey ? ta.replaceTemplateImage : ta.selectTemplateImage)}
                </span>
              </label>
              {busy && templateFile && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
            </div>
            <TemplateLayoutEditor imageUrl={templatePreviewUrl} layout={templateLayout} onChange={setTemplateLayout} />
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.requiredCourses}</span>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}>
                {courses.length === 0 && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{ta.noCourses}</p>}
                {courses.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={selectedCourseIds.includes(c.id)}
                      onChange={() => toggleCourse(c.id)} style={{ accentColor: '#6366f1' }} />
                    <span>{c.title}</span>
                    <Badge color="#94a3b8" style={{ fontSize: 10 }}>{c.level}</Badge>
                  </label>
                ))}
              </div>
            </div>
            {isEdit && (
              <label className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                <span>{ta.active}</span>
              </label>
            )}
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EnrollModal({ courses = [], onClose, onSave, prefilledUserId = '', prefilledUserName = '' }) {
  const { t } = useLang();
  const ta = t.academy;
  const [selectedUser, setSelectedUser] = useState(
    prefilledUserId ? { user_id: prefilledUserId, nickname: prefilledUserName } : null
  );
  const [courseId, setCourseId] = useState('');
  const [cohort, setCohort] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedUser?.user_id) { setError('Please select a user'); return; }
    if (!courseId) { setError(ta.selectCourseRequired); return; }
    setSaving(true); setError('');
    try {
      await axios.post('/api/academy/enrollments', {
        user_id: selectedUser.user_id,
        course_id: Number(courseId),
        cohort: cohort || undefined,
        notes: notes || undefined,
      });
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ta.enrollTitle}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSave} className="modal-body">
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <UserPicker value={selectedUser} onChange={setSelectedUser} label={`${ta.userOpenid} *`} />
            </div>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.selectCourse} *</span>
              <select value={courseId} onChange={e => setCourseId(e.target.value)} required>
                <option value="">— {ta.selectCourse} —</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.cohort}</span>
              <input value={cohort} onChange={e => setCohort(e.target.value)} placeholder="e.g. 第一期" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Notes</span>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ resize: 'vertical' }} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? '…' : t.modal.save}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function GrantCertModal({ certifications, onClose, onSave, prefilledUserId = '', prefilledUserName = '' }) {
  const { t } = useLang();
  const ta = t.academy;
  const [selectedUser, setSelectedUser] = useState(
    prefilledUserId ? { user_id: prefilledUserId, nickname: prefilledUserName } : null
  );
  const [form, setForm] = useState({
    certification_id: '',
    certificate_number: '',
    assessment_period: '',
    score: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [certPreviewBlob, setCertPreviewBlob] = useState(null);
  const [certPreviewUrl, setCertPreviewUrl] = useState('');
  const [nameDisplayMode, setNameDisplayMode] = useState('en');
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const selectedCert = certifications.find(c => String(c.id) === String(form.certification_id));

  const handleGenerate = async () => {
    if (!selectedCert?.template_image_oss_key) { setError('Selected template has no background image'); return; }
    if (!form.certificate_number.trim()) { setError(ta.certNumber + ' is required'); return; }
    setGenerating(true); setError('');
    let imageObjectUrl = null;
    try {
      const imgRes = await axios.get(`/api/academy/certifications/${selectedCert.id}/template-image`, { responseType: 'blob' });
      imageObjectUrl = URL.createObjectURL(imgRes.data);
      const blob = await renderCertificate({
        imageObjectUrl,
        layout: { ...DEFAULT_TEMPLATE_LAYOUT, ...(selectedCert.template_layout || {}) },
        values: {
          name: resolveDisplayName(selectedUser?.nickname || '', nameDisplayMode),
          certificate_number: `NO.${form.certificate_number}`,
          validity_date: selectedCert.validity_date ? `Validity Date: ${formatOrdinal(selectedCert.validity_date.slice(0, 10))}` : '',
          issue_date: selectedCert.issue_date ? `Awarded on ${formatOrdinal(selectedCert.issue_date.slice(0, 10))}` : '',
        },
      });
      if (certPreviewUrl) URL.revokeObjectURL(certPreviewUrl);
      setCertPreviewBlob(blob);
      setCertPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedUser?.user_id) { setError('Please select a user'); return; }
    if (!form.certification_id) { setError('Please select a certification template'); return; }
    setSaving(true);
    setError('');
    try {
      let cert_oss_key;
      if (certPreviewBlob) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'cert', filename: 'certificate.png' } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        await uploadToOSS(presignRes.data.url, certPreviewBlob, () => {});
        cert_oss_key = presignRes.data.key;
      }
      const payload = {
        user_id: selectedUser.user_id,
        certification_id: Number(form.certification_id),
        certificate_number: form.certificate_number || undefined,
        score: form.score !== '' ? Number(form.score) : undefined,
        assessment_period: form.assessment_period || undefined,
        notes: form.notes || undefined,
        cert_oss_key,
      };
      await axios.post('/api/academy/coach-certifications', payload);
      onSave();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ta.grantCertTitle}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); handleSave(); }} className="modal-body">
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <UserPicker value={selectedUser} onChange={setSelectedUser} label={`${ta.userOpenid} *`} />
            </div>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.selectCertTemplate} *</span>
              <select value={form.certification_id} onChange={e => set('certification_id', e.target.value)} required>
                <option value="">— {ta.selectCertTemplate} —</option>
                {certifications.map(c => (
                  <option key={c.id} value={c.id}>{c.title}{c.tier ? ` (${c.tier})` : ''}</option>
                ))}
              </select>
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.certNumber}</span>
              <input value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)}
                placeholder="e.g. AEVIVA20260614001" />
            </label>
            {selectedCert && (
              <div className="form-field" style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted)' }}>
                {ta.issueDate}: {selectedCert.issue_date ? fmtDate(selectedCert.issue_date) : '—'}
                {' · '}
                {ta.expiryDate}: {selectedCert.validity_date ? fmtDate(selectedCert.validity_date) : '—'}
                {' — '}{ta.certDatesEditHint}
              </div>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.assessmentPeriod}</span>
              <input value={form.assessment_period} onChange={e => set('assessment_period', e.target.value)}
                placeholder="e.g. 【第一期】2026年6月14日" />
            </label>
            <label className="form-field">
              <span>{ta.certScore}</span>
              <input type="number" min={0} max={100} value={form.score} onChange={e => set('score', e.target.value)} placeholder="Optional" />
            </label>
            {selectedCert?.template_image_oss_key && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span className="form-label-text">{ta.certPreview}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span>{ta.nameDisplay}</span>
                    <div className="select-wrap">
                      <select value={nameDisplayMode} onChange={e => setNameDisplayMode(e.target.value)} className="inline-select">
                        {NAME_DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <ChevronDown size={11} className="select-chevron" />
                    </div>
                  </label>
                  <button type="button" className="btn-secondary" onClick={handleGenerate} disabled={generating}>
                    {generating ? '…' : ta.generateCertificate}
                  </button>
                </div>
                {certPreviewUrl && (
                  <img src={certPreviewUrl} alt="Certificate preview" style={{ width: '100%', marginTop: 8, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                )}
              </div>
            )}
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Notes</span>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} style={{ resize: 'vertical' }} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? '…' : t.modal.save}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IssuedCertModal({ issued, onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const [form, setForm] = useState({
    certificate_number: issued?.certificate_number || '',
    assessment_period: issued?.assessment_period || '',
    score: issued?.score ?? '',
    is_revoked: issued?.is_revoked || false,
    notes: issued?.notes || '',
  });
  const [certFile, setCertFile] = useState(null);
  const [certOssKey, setCertOssKey] = useState(issued?.cert_oss_key || '');
  const [certPreviewBlob, setCertPreviewBlob] = useState(null);
  const [certPreviewUrl, setCertPreviewUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [nameDisplayMode, setNameDisplayMode] = useState('en');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!issued?.template_image_oss_key) { setError('This template has no background image'); return; }
    if (!form.certificate_number.trim()) { setError(ta.certNumber + ' is required'); return; }
    setGenerating(true); setError('');
    let imageObjectUrl = null;
    try {
      const imgRes = await axios.get(`/api/academy/certifications/${issued.certification_id}/template-image`, { responseType: 'blob' });
      imageObjectUrl = URL.createObjectURL(imgRes.data);
      const blob = await renderCertificate({
        imageObjectUrl,
        layout: { ...DEFAULT_TEMPLATE_LAYOUT, ...(issued.template_layout || {}) },
        values: {
          name: resolveDisplayName(issued?.nickname || '', nameDisplayMode),
          certificate_number: `NO.${form.certificate_number}`,
          validity_date: issued.expiry_date ? `Validity Date: ${formatOrdinal(issued.expiry_date.slice(0, 10))}` : '',
          issue_date: issued.issue_date ? `Awarded on ${formatOrdinal(issued.issue_date.slice(0, 10))}` : '',
        },
      });
      if (certPreviewUrl) URL.revokeObjectURL(certPreviewUrl);
      setCertPreviewBlob(blob);
      setCertPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      setGenerating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.certificate_number.trim()) { setError(ta.certNumber + ' is required'); return; }
    setBusy(true); setError(''); setProgress(0);
    try {
      let cert_oss_key = certOssKey;
      if (certPreviewBlob) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'cert', filename: 'certificate.png' } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        await uploadToOSS(presignRes.data.url, certPreviewBlob, setProgress);
        cert_oss_key = presignRes.data.key;
      } else if (certFile) {
        const presignRes = await axios.get('/api/oss/presign', { params: { type: 'cert', filename: certFile.name } });
        if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.uploadFailed);
        await uploadToOSS(presignRes.data.url, certFile, setProgress);
        cert_oss_key = presignRes.data.key;
      }
      const payload = {
        ...form,
        score: form.score !== '' ? parseInt(form.score) : null,
        cert_oss_key: cert_oss_key || null,
      };
      await axios.put(`/api/academy/coach-certifications/${issued.id}`, payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span>{ta.editIssuedCert}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {issued.cert_title} — {issued.nickname || issued.user_id}
          </div>
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.certNumber} *</span>
              <input value={form.certificate_number} onChange={e => setForm(f => ({ ...f, certificate_number: e.target.value }))} placeholder="e.g. AEVIVA202405200001" />
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--muted)' }}>
              {ta.issueDate}: {issued.issue_date ? fmtDate(issued.issue_date) : '—'}
              {' · '}
              {ta.expiryDate}: {issued.expiry_date ? fmtDate(issued.expiry_date) : '—'}
              {' — '}{ta.certDatesEditHint}
            </div>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.assessmentPeriod}</span>
              <input value={form.assessment_period} onChange={e => setForm(f => ({ ...f, assessment_period: e.target.value }))} placeholder="e.g. 【第一期】2026年6月14日" />
            </label>
            <label className="form-field">
              <span>{ta.certScore}</span>
              <input type="number" min={0} max={100} value={form.score} onChange={e => setForm(f => ({ ...f, score: e.target.value }))} placeholder="Optional" />
            </label>
            <label className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.is_revoked} onChange={e => setForm(f => ({ ...f, is_revoked: e.target.checked }))} />
              <span>{ta.revoked}</span>
            </label>
            {issued?.template_image_oss_key && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span className="form-label-text">{ta.certPreview}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span>{ta.nameDisplay}</span>
                    <div className="select-wrap">
                      <select value={nameDisplayMode} onChange={e => setNameDisplayMode(e.target.value)} className="inline-select">
                        {NAME_DISPLAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <ChevronDown size={11} className="select-chevron" />
                    </div>
                  </label>
                  <button type="button" className="btn-secondary" onClick={handleGenerate} disabled={generating}>
                    {generating ? '…' : ta.generateCertificate}
                  </button>
                </div>
                {certPreviewUrl && (
                  <img src={certPreviewUrl} alt="Certificate preview" style={{ width: '100%', marginTop: 8, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                )}
              </div>
            )}
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ta.certFile}</span>
              <label className="upload-zone">
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setCertFile(e.target.files[0])} />
                <Upload size={18} style={{ marginBottom: 6, color: 'var(--muted)' }} />
                <span className="upload-zone-hint">
                  {certFile ? certFile.name : (certOssKey ? ta.replaceCertFile : ta.selectCertFile)}
                </span>
              </label>
              {busy && certFile && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>Notes</span>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? ta.uploading : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CertPreviewModal({ issued, onClose }) {
  const { t } = useLang();
  const ta = t.academy;
  const [imgUrl, setImgUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;

    (async () => {
      try {
        if (issued?.cert_oss_key) {
          const presignRes = await axios.get('/api/oss/presign', { params: { action: 'get', key: issued.cert_oss_key } });
          if (!presignRes.data.success) throw new Error(presignRes.data.error || ta.certLoadFailed);
          if (cancelled) return;
          setImgUrl(presignRes.data.url);
          setDownloadUrl(presignRes.data.url);
        } else if (issued?.template_image_oss_key) {
          const imgRes = await axios.get(`/api/academy/certifications/${issued.certification_id}/template-image`, { responseType: 'blob' });
          const templateObjectUrl = URL.createObjectURL(imgRes.data);
          const blob = await renderCertificate({
            imageObjectUrl: templateObjectUrl,
            layout: { ...DEFAULT_TEMPLATE_LAYOUT, ...(issued.template_layout || {}) },
            values: {
              name: resolveDisplayName(issued?.nickname || '', 'en'),
              certificate_number: issued.certificate_number ? `NO.${issued.certificate_number}` : '',
              validity_date: issued.expiry_date ? `Validity Date: ${formatOrdinal(issued.expiry_date.slice(0, 10))}` : '',
              issue_date: issued.issue_date ? `Awarded on ${formatOrdinal(issued.issue_date.slice(0, 10))}` : '',
            },
          });
          URL.revokeObjectURL(templateObjectUrl);
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setImgUrl(objectUrl);
          setDownloadUrl(objectUrl);
        } else {
          setError(ta.noCertImage);
        }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message || ta.certLoadFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [issued]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span>{ta.viewCertificate} — {issued.certificate_number}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {issued.cert_title} — {issued.nickname || issued.user_id}
          </div>
          {loading && <div className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>{ta.generatingPreview}</div>}
          {!loading && error && <div className="form-error">{error}</div>}
          {!loading && !error && imgUrl && (
            <img src={imgUrl} alt="Certificate" style={{ width: '100%', borderRadius: 6, border: '1px solid #e2e8f0' }} />
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
          {!loading && !error && downloadUrl && (
            <a
              href={downloadUrl}
              download={`${issued.certificate_number || 'certificate'}.png`}
              target="_blank"
              rel="noreferrer"
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              <Download size={14} />{ta.downloadCertificate}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Learning path modals ──────────────────────────────────────────────────────

function LearningPathModal({ path, courses = [], onClose, onSave }) {
  const { t } = useLang();
  const ta = t.academy;
  const isEdit = !!path?.id;
  const [form, setForm] = useState({
    title: path?.title || '',
    description: path?.description || '',
    tier: path?.tier || 'foundation',
    sort_order: path?.sort_order ?? 0,
    is_active: path?.is_active !== false,
  });
  const [orderedCourseIds, setOrderedCourseIds] = useState(
    path?.courses?.map(c => c.course_id) || []
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggleCourse = (id) => setOrderedCourseIds(ids =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
  );
  const moveUp = (i) => setOrderedCourseIds(ids => {
    if (i === 0) return ids;
    const next = [...ids]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next;
  });
  const moveDown = (i) => setOrderedCourseIds(ids => {
    if (i >= ids.length - 1) return ids;
    const next = [...ids]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError(ta.titleRequired); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...form, sort_order: parseInt(form.sort_order) || 0, course_ids: orderedCourseIds };
      if (isEdit) await axios.put(`/api/academy/learning-paths/${path.id}`, payload);
      else await axios.post('/api/academy/learning-paths', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setBusy(false); }
  };

  const LEVELS = ['foundation', 'intermediate', 'advanced', 'expert'];
  const courseMap = Object.fromEntries(courses.map(c => [c.id, c]));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span>{isEdit ? ta.editPath : ta.newPath}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.title}</span>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Foundation Track" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ta.description}</span>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-field">
              <span>{ta.tier}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.tier} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))} className="inline-select" style={{ width: '100%' }}>
                  {LEVELS.map(lv => <option key={lv} value={lv}>{lv.charAt(0).toUpperCase() + lv.slice(1)}</option>)}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.modal.sortOrder}</span>
              <input type="number" min={0} value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#475569' }}>{ta.pathCoursesLabel}</div>
            {orderedCourseIds.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
                {orderedCourseIds.map((cid, i) => {
                  const c = courseMap[cid];
                  return c ? (
                    <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: i < orderedCourseIds.length - 1 ? '1px solid #f1f5f9' : 'none', background: 'white', fontSize: 13 }}>
                      <span style={{ color: '#94a3b8', minWidth: 20, fontSize: 11 }}>{i + 1}.</span>
                      <span style={{ flex: 1 }}>{c.title}</span>
                      <Badge color="#94a3b8" style={{ fontSize: 10 }}>{c.level}</Badge>
                      <button type="button" className="icon-btn" onClick={() => moveUp(i)} disabled={i === 0}><ChevronUp size={12} /></button>
                      <button type="button" className="icon-btn" onClick={() => moveDown(i)} disabled={i === orderedCourseIds.length - 1}><ChevronDown size={12} /></button>
                      <button type="button" className="icon-btn danger" onClick={() => toggleCourse(cid)}><X size={11} /></button>
                    </div>
                  ) : null;
                })}
              </div>
            )}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, maxHeight: 180, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{ta.clickToAddCourses}</div>
              {courses.filter(c => !orderedCourseIds.includes(c.id)).map(c => (
                <button key={c.id} type="button" onClick={() => toggleCourse(c.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left', padding: '4px 6px', borderRadius: 4, fontSize: 13, cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <Plus size={11} style={{ color: '#6366f1' }} />
                  <span style={{ flex: 1 }}>{c.title}</span>
                  <Badge color="#94a3b8" style={{ fontSize: 10 }}>{c.level}</Badge>
                </button>
              ))}
              {courses.filter(c => !orderedCourseIds.includes(c.id)).length === 0 && (
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>{ta.allCoursesAdded}</p>
              )}
            </div>
          </div>

          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Academy tab ───────────────────────────────────────────────────────────────

const TIER_COLORS_AC = { foundation: '#94a3b8', intermediate: '#3b82f6', advanced: '#8b5cf6', expert: '#f59e0b' };
const CERT_TIER_COLORS = { bronze: '#cd7f32', silver: '#94a3b8', gold: '#f59e0b', platinum: '#8b5cf6' };

function TierBadge({ credits }) {
  const tier = credits >= 700 ? 'expert' : credits >= 300 ? 'advanced' : credits >= 100 ? 'intermediate' : 'foundation';
  return <Badge color={TIER_COLORS_AC[tier]}>{tier.charAt(0).toUpperCase() + tier.slice(1)}</Badge>;
}

function AcademyTab() {
  const { t } = useLang();
  const ta = t.academy;
  const [subTab, setSubTab] = useState('courses');
  const [courses, setCourses] = useState([]);
  const [library, setLibrary] = useState([]);
  const [progress, setProgress] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [issued, setIssued] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [paths, setPaths] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [expandedCourse, setExpandedCourse] = useState(null);
  const [expandedLesson, setExpandedLesson] = useState(null);
  const [lessonMap, setLessonMap] = useState({});
  const [lessonLoading, setLessonLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, lRes, pRes, certRes, pathRes, lbRes, issuedRes, enrollRes] = await Promise.allSettled([
        axios.get('/api/academy/courses'),
        axios.get('/api/academy/library'),
        axios.get('/api/academy/course-progress'),
        axios.get('/api/academy/certifications'),
        axios.get('/api/academy/learning-paths'),
        axios.get('/api/academy/leaderboard'),
        axios.get('/api/academy/issued-certifications'),
        axios.get('/api/academy/enrollments'),
      ]);
      setCourses(cRes.status === 'fulfilled' ? (cRes.value.data.courses || []) : []);
      setLibrary(lRes.status === 'fulfilled' ? (lRes.value.data.items || []) : []);
      setProgress(pRes.status === 'fulfilled' ? (pRes.value.data.progress || []) : []);
      setCertifications(certRes.status === 'fulfilled' ? (certRes.value.data.certifications || []) : []);
      setPaths(pathRes.status === 'fulfilled' ? (pathRes.value.data.paths || []) : []);
      setLeaderboard(lbRes.status === 'fulfilled' ? (lbRes.value.data.leaderboard || []) : []);
      setIssued(issuedRes.status === 'fulfilled' ? (issuedRes.value.data.issued || []) : []);
      setEnrollments(enrollRes.status === 'fulfilled' ? (enrollRes.value.data.enrollments || []) : []);
    } catch (err) { console.error('Academy fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const closeAndRefresh = () => { setModal(null); fetchData(); };

  const loadLessons = useCallback(async (courseId) => {
    setLessonLoading(true);
    try {
      const res = await axios.get('/api/academy/lessons', { params: { course_id: courseId } });
      setLessonMap(m => ({ ...m, [courseId]: res.data.lessons || [] }));
    } catch { /* silent */ }
    finally { setLessonLoading(false); }
  }, []);

  const toggleExpand = (courseId) => {
    if (expandedCourse === courseId) { setExpandedCourse(null); setExpandedLesson(null); }
    else { setExpandedCourse(courseId); setExpandedLesson(null); if (!lessonMap[courseId]) loadLessons(courseId); }
  };

  const refreshLessons = (courseId) => { loadLessons(courseId); fetchData(); };

  const publishedCount = courses.filter(c => c.status === 'published').length;
  const totalLessons = courses.reduce((s, c) => s + (c.lesson_count || 0), 0);
  const openVideo = (course) => setModal({ type: 'play-video', course });
  const openDoc = (item) => setModal({ type: 'view-doc', item });

  const CONTENT_TYPE_ICON = { video: '🎬', text: '📄', interactive: '🧩' };

  return (
    <>
      <div className="stat-row">
        <StatCard icon={GraduationCap} label={ta.totalCourses}    value={courses.length}        color="#6366f1" />
        <StatCard icon={Video}          label={ta.published}       value={publishedCount}        color="#10b981" />
        <StatCard icon={Award}          label="Certifications"     value={certifications.length} color="#f59e0b" />
        <StatCard icon={BookOpen}       label={ta.totalLessons}    value={totalLessons}          color="#3b82f6" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'courses' ? ' active' : ''}`} onClick={() => setSubTab('courses')}>
          <Video size={13} />{ta.coursesTab}
        </button>
        <button className={`subtab-btn${subTab === 'library' ? ' active' : ''}`} onClick={() => setSubTab('library')}>
          <FileText size={13} />{ta.libraryTab}
        </button>
        <button className={`subtab-btn${subTab === 'certifications' ? ' active' : ''}`} onClick={() => setSubTab('certifications')}>
          <Award size={13} />{ta.certificationsTab}
        </button>
        <button className={`subtab-btn${subTab === 'enrollments' ? ' active' : ''}`} onClick={() => setSubTab('enrollments')}>
          <Users size={13} />{ta.enrollTab}
        </button>
        <button className={`subtab-btn${subTab === 'issued' ? ' active' : ''}`} onClick={() => setSubTab('issued')}>
          <GraduationCap size={13} />{ta.issuedTab}
        </button>
        <button className={`subtab-btn${subTab === 'paths' ? ' active' : ''}`} onClick={() => setSubTab('paths')}>
          <Target size={13} />{ta.pathsTab}
        </button>
        <button className={`subtab-btn${subTab === 'progress' ? ' active' : ''}`} onClick={() => setSubTab('progress')}>
          <TrendingUp size={13} />{ta.progressTab}
        </button>
      </div>

      {subTab === 'courses' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countCourses(courses.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-course' })}>
              <Upload size={14} />{ta.uploadCourse}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.level}</th>
                <th>{ta.credits}</th>
                <th>{ta.status}</th>
                <th>{ta.lessons}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && courses.length === 0 && (
                <tr><td colSpan={7} className="empty-row">{ta.noCourses}</td></tr>
              )}
              {courses.map(c => (
                <React.Fragment key={c.id}>
                  <tr>
                    <td className="muted mono">{c.id}</td>
                    <td>
                      <div className="bold">{c.title}</div>
                      {c.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{c.description.slice(0, 80)}{c.description.length > 80 ? '…' : ''}</div>}
                      {c.prerequisite_title && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Prereq: {c.prerequisite_title}</div>}
                    </td>
                    <td><Badge color={TIER_COLORS_AC[c.level] || '#94a3b8'}>{c.level}</Badge></td>
                    <td className="muted">{c.credit_value} cr</td>
                    <td>
                      <Badge color={c.status === 'published' ? '#10b981' : '#94a3b8'}>
                        {c.status === 'published' ? ta.published : ta.draft}
                      </Badge>
                    </td>
                    <td className="muted">{ta.lessonCount(c.lesson_count || 0)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn" title={expandedCourse === c.id ? ta.collapseLessons : ta.expandLessons} onClick={() => toggleExpand(c.id)}>
                          {expandedCourse === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {c.oss_key && (
                          <button className="icon-btn" title={ta.viewVideo} onClick={() => openVideo(c)}>
                            <Play size={14} />
                          </button>
                        )}
                        <button className="icon-btn" title={ta.editCourse} onClick={() => setModal({ type: 'edit-course', course: c })}>
                          <Pencil size={14} />
                        </button>
                        <button className="icon-btn danger" title={ta.deleteCourse} onClick={() => setModal({ type: 'delete-course', course: c })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedCourse === c.id && (
                    <tr key={`${c.id}-lessons`}>
                      <td colSpan={7} style={{ padding: 0, background: 'var(--bg)' }}>
                        <div style={{ padding: '12px 20px 16px 40px', borderLeft: '3px solid #6366f1' }}>
                          <div className="table-toolbar" style={{ marginBottom: 8 }}>
                            <span className="table-count">{ta.lessons} — {ta.lessonCount((lessonMap[c.id] || []).length)}</span>
                            <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }}
                              onClick={() => setModal({ type: 'add-lesson', courseId: c.id })}>
                              <Plus size={12} />{ta.addLesson}
                            </button>
                          </div>
                          {lessonLoading && !lessonMap[c.id] && <p className="muted" style={{ fontSize: 12 }}>Loading…</p>}
                          {(lessonMap[c.id] || []).length === 0 && !lessonLoading && (
                            <p className="muted" style={{ fontSize: 12 }}>{ta.noLessons}</p>
                          )}
                          {(lessonMap[c.id] || []).length > 0 && (
                            <table className="data-table" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>{ta.title.replace(' *', '')}</th>
                                  <th>{ta.contentType}</th>
                                  <th>{ta.credits}</th>
                                  <th>Quiz</th>
                                  <th></th>
                                </tr>
                              </thead>
                              <tbody>
                                {(lessonMap[c.id] || []).map((l, idx) => (
                                  <React.Fragment key={l.id}>
                                    <tr>
                                      <td className="muted mono">{idx + 1}</td>
                                      <td>
                                        <div className="bold">{l.title}</div>
                                        {l.description && <div className="muted" style={{ fontSize: 11 }}>{l.description.slice(0, 60)}{l.description.length > 60 ? '…' : ''}</div>}
                                      </td>
                                      <td><span title={l.content_type}>{CONTENT_TYPE_ICON[l.content_type] || '🎬'} {l.content_type}</span></td>
                                      <td className="muted">{l.credit_value} cr</td>
                                      <td>{l.has_quiz ? <Badge color="#10b981">✓ Quiz</Badge> : <span className="muted">—</span>}</td>
                                      <td>
                                        <div className="row-actions">
                                          <button className="icon-btn" title="Edit Quiz Questions"
                                            onClick={() => setExpandedLesson(expandedLesson === l.id ? null : l.id)}>
                                            <ClipboardList size={11} />
                                          </button>
                                          {l.oss_key && (
                                            <button className="icon-btn" title={ta.viewVideo} onClick={() => setModal({ type: 'play-video', course: { ...l, title: `${c.title} — ${l.title}` } })}>
                                              <Play size={12} />
                                            </button>
                                          )}
                                          <button className="icon-btn" title={ta.editLesson} onClick={() => setModal({ type: 'edit-lesson', lesson: l, courseId: c.id })}>
                                            <Pencil size={12} />
                                          </button>
                                          <button className="icon-btn danger" title={ta.deleteLesson} onClick={() => setModal({ type: 'delete-lesson', lesson: l, courseId: c.id })}>
                                            <Trash2 size={12} />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                    {expandedLesson === l.id && (
                                      <tr key={`${l.id}-quiz`}>
                                        <td colSpan={6} style={{ padding: '0 0 0 24px', background: '#f8fafc' }}>
                                          <QuizEditorSection lessonId={l.id} />
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'library' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countDocs(library.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-doc' })}>
              <Upload size={14} />{ta.uploadDoc}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.fileSize}</th>
                <th>{t.table.joined}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && library.length === 0 && (
                <tr><td colSpan={5} className="empty-row">{ta.noDocs}</td></tr>
              )}
              {library.map(item => (
                <tr key={item.id}>
                  <td className="muted mono">{item.id}</td>
                  <td className="bold">{item.title}</td>
                  <td className="muted">{fmtBytes(item.file_size)}</td>
                  <td className="muted">{fmtDate(item.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={ta.viewDoc} onClick={() => openDoc(item)}>
                        <BookOpen size={14} />
                      </button>
                      <button className="icon-btn danger" title={ta.deleteDoc} onClick={() => setModal({ type: 'delete-doc', item })}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'certifications' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countCerts(certifications.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-cert' })}>
              <Plus size={14} />{ta.newCert}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.tier}</th>
                <th>{ta.requiredCourses.split(' (')[0]}</th>
                <th>{ta.minCredits.replace(' Required', '')}</th>
                <th>{ta.active}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {certifications.length === 0 && (
                <tr><td colSpan={6} className="empty-row">{ta.noCerts}</td></tr>
              )}
              {certifications.map(cert => (
                <tr key={cert.id}>
                  <td>
                    <div className="bold">{cert.title}</div>
                    {cert.description && <div className="muted" style={{ fontSize: 12 }}>{cert.description.slice(0, 80)}</div>}
                  </td>
                  <td>{cert.tier ? <Badge color={CERT_TIER_COLORS[cert.tier] || '#94a3b8'}>{cert.tier}</Badge> : <span className="muted">—</span>}</td>
                  <td className="muted">{ta.countCourses((cert.required_course_ids || []).length)}</td>
                  <td className="muted">{cert.min_credits}</td>
                  <td>{cert.is_active ? <Badge color="#10b981">{ta.active}</Badge> : <Badge color="#94a3b8">—</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => setModal({ type: 'edit-cert', cert })}><Pencil size={14} /></button>
                      <button className="icon-btn danger" onClick={async () => {
                        if (!confirm(`Delete "${cert.title}"?`)) return;
                        try { await axios.delete(`/api/academy/certifications/${cert.id}`); fetchData(); } catch { /* silent */ }
                      }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'enrollments' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countEnrolled(enrollments.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'enroll' })}>
              + {ta.enrollBtn}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.selectCourse}</th>
                <th>{ta.cohort}</th>
                <th>{ta.enrolledAt}</th>
                <th>Progress</th>
                <th>{ta.enrollStatus}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.length === 0 && (
                <tr><td colSpan={7} className="empty-row">{ta.noEnrolled}</td></tr>
              )}
              {enrollments.map(row => (
                <tr key={row.id}>
                  <td>
                    <div className="bold">{row.nickname || '—'}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{row.user_id?.slice(0, 18)}…</div>
                  </td>
                  <td className="muted">{row.course_title || '—'}</td>
                  <td>{row.cohort ? <Badge color="#6366f1">{row.cohort}</Badge> : <span className="muted">—</span>}</td>
                  <td className="muted">{row.enrolled_at ? row.enrolled_at.slice(0, 10) : '—'}</td>
                  <td>
                    <span style={{ fontSize: 12 }}>{row.completed_lessons} lessons · {row.total_credits} cr</span>
                  </td>
                  <td>
                    {row.status === 'active'
                      ? <Badge color="#10b981">Active</Badge>
                      : <Badge color="#94a3b8">{ta.inactive}</Badge>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={ta.grantCertBtn}
                        onClick={() => setModal({ type: 'grant-cert', userId: row.user_id, userName: row.nickname })}>
                        <Award size={14} />
                      </button>
                      <button className="icon-btn" title={row.status === 'active' ? ta.deactivate : ta.reactivate}
                        onClick={async () => {
                          await axios.put(`/api/academy/enrollments/${row.id}`, { status: row.status === 'active' ? 'inactive' : 'active' });
                          fetchData();
                        }}>
                        {row.status === 'active' ? <X size={14} /> : <Check size={14} />}
                      </button>
                      <button className="icon-btn danger" title="Remove"
                        onClick={async () => {
                          if (!confirm(`Remove ${row.nickname || row.user_id} from Academy?`)) return;
                          await axios.delete(`/api/academy/enrollments/${row.id}`);
                          fetchData();
                        }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'issued' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countIssued(issued.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'grant-cert' })}>
              + {ta.grantCertBtn}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{ta.title.replace(' *', '')}</th>
                <th>Coach</th>
                <th>{ta.certNumber}</th>
                <th>{ta.issueDate}</th>
                <th>{ta.assessmentPeriod}</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {issued.length === 0 && (
                <tr><td colSpan={7} className="empty-row">{ta.noIssued}</td></tr>
              )}
              {issued.map(row => (
                <tr key={row.id}>
                  <td className="bold">{row.cert_title}</td>
                  <td>
                    <div style={{ fontSize: 13 }}>{row.nickname || '—'}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>{row.user_id?.slice(0, 16)}</div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {row.certificate_number
                      ? (
                        <span
                          role="button"
                          tabIndex={0}
                          title={ta.viewCertificate}
                          onClick={() => setModal({ type: 'view-cert', issued: row })}
                          style={{ color: '#6366f1', cursor: 'pointer', textDecoration: 'underline dotted' }}
                        >
                          {row.certificate_number}
                        </span>
                      )
                      : <span className="muted">—</span>}
                  </td>
                  <td className="muted">{row.issue_date ? row.issue_date.slice(0, 10) : '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{row.assessment_period || '—'}</td>
                  <td>
                    {row.is_revoked
                      ? <Badge color="#ef4444">{ta.revokedBadge}</Badge>
                      : row.certificate_number
                        ? <Badge color="#10b981">{ta.valid}</Badge>
                        : <Badge color="#f59e0b">Pending</Badge>}
                  </td>
                  <td>
                    <button className="icon-btn" title={ta.editIssuedCert} onClick={() => setModal({ type: 'edit-issued', issued: row })}>
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'paths' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{ta.countPaths(paths.length)}</span>
            <button className="btn-primary" onClick={() => setModal({ type: 'add-path' })}>
              <Plus size={14} />{ta.newPath}
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{ta.title.replace(' *', '')}</th>
                <th>{ta.tier}</th>
                <th>{ta.lessons}</th>
                <th>{ta.active}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paths.length === 0 && (
                <tr><td colSpan={5} className="empty-row">{ta.noPaths}</td></tr>
              )}
              {paths.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="bold">{p.title}</div>
                    {p.description && <div className="muted" style={{ fontSize: 12 }}>{p.description.slice(0, 80)}</div>}
                  </td>
                  <td><Badge color={TIER_COLORS_AC[p.tier] || '#94a3b8'}>{p.tier}</Badge></td>
                  <td className="muted">{ta.countCourses((p.courses || []).length)}</td>
                  <td>{p.is_active ? <Badge color="#10b981">{ta.active}</Badge> : <Badge color="#94a3b8">—</Badge>}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" onClick={() => setModal({ type: 'edit-path', path: p })}><Pencil size={14} /></button>
                      <button className="icon-btn danger" onClick={async () => {
                        if (!confirm(`Delete path "${p.title}"?`)) return;
                        try { await axios.delete(`/api/academy/learning-paths/${p.id}`); fetchData(); } catch { /* silent */ }
                      }}><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'progress' && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="card" style={{ flex: '1 1 500px' }}>
            <div className="table-toolbar"><span className="table-count">{ta.courseProgress}</span></div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>{ta.title.replace(' *', '')}</th>
                  <th>{ta.level}</th>
                  <th>{ta.totalLessons}</th>
                  <th>{ta.coachesStarted}</th>
                  <th>{ta.avgQuizScore}</th>
                  <th>{ta.creditsAwarded}</th>
                </tr>
              </thead>
              <tbody>
                {!loading && progress.length === 0 && (
                  <tr><td colSpan={6} className="empty-row">{ta.noProgress}</td></tr>
                )}
                {progress.map(p => (
                  <tr key={p.course_id}>
                    <td className="bold">{p.title}</td>
                    <td><Badge color={TIER_COLORS_AC[p.level] || '#94a3b8'}>{p.level}</Badge></td>
                    <td className="muted">{p.total_lessons}</td>
                    <td className="muted">{p.coaches_started}</td>
                    <td className="muted">{p.avg_quiz_score ? `${p.avg_quiz_score}%` : '—'}</td>
                    <td className="muted">{p.total_credits_awarded || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ flex: '0 0 300px' }}>
            <div className="table-toolbar"><span className="table-count">{ta.leaderboard}</span></div>
            {leaderboard.length === 0 && <p className="muted" style={{ padding: '12px 16px', fontSize: 13 }}>{ta.noData}</p>}
            {leaderboard.map((coach, i) => (
              <div key={coach.coach_user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 700, color: i < 3 ? ['#f59e0b', '#94a3b8', '#cd7f32'][i] : '#cbd5e1', minWidth: 20, fontSize: 13 }}>
                  {i + 1}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{coach.name || coach.coach_user_id.slice(0, 12)}</div>
                  <TierBadge credits={coach.total_credits} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#6366f1' }}>{coach.total_credits} cr</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{coach.completed_lessons} lessons</div>
                </div>
                <button className="icon-btn" title={ta.grantCertBtn}
                  onClick={() => setModal({ type: 'grant-cert', userId: coach.coach_user_id, userName: coach.name })}>
                  <Award size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal?.type === 'play-video'    && <VideoPlayerModal course={modal.course} onClose={() => setModal(null)} />}
      {modal?.type === 'add-course'    && <CourseModal course={null} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit-course'   && <CourseModal course={modal.course} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete-course' && <DeleteCourseConfirm course={modal.course} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'view-doc'      && <MarkdownViewerModal item={modal.item} onClose={() => setModal(null)} />}
      {modal?.type === 'add-doc'       && <LibraryModal onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'delete-doc'    && <DeleteLibraryItemConfirm item={modal.item} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />}
      {modal?.type === 'add-lesson'    && <LessonModal lesson={null} courseId={modal.courseId} onClose={() => setModal(null)} onSave={() => { setModal(null); refreshLessons(modal.courseId); }} />}
      {modal?.type === 'edit-lesson'   && <LessonModal lesson={modal.lesson} courseId={modal.courseId} onClose={() => setModal(null)} onSave={() => { setModal(null); refreshLessons(modal.courseId); }} />}
      {modal?.type === 'delete-lesson' && <DeleteLessonConfirm lesson={modal.lesson} onClose={() => setModal(null)} onConfirm={() => { setModal(null); refreshLessons(modal.courseId); }} />}
      {modal?.type === 'add-cert'      && <CertificationModal cert={null} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit-cert'     && <CertificationModal cert={modal.cert} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'enroll'        && <EnrollModal courses={courses} prefilledUserId={modal.userId || ''} prefilledUserName={modal.userName || ''} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'grant-cert'    && <GrantCertModal certifications={certifications} prefilledUserId={modal.userId || ''} prefilledUserName={modal.userName || ''} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit-issued'   && <IssuedCertModal issued={modal.issued} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'view-cert'     && <CertPreviewModal issued={modal.issued} onClose={() => setModal(null)} />}
      {modal?.type === 'add-path'      && <LearningPathModal path={null} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
      {modal?.type === 'edit-path'     && <LearningPathModal path={modal.path} courses={courses} onClose={() => setModal(null)} onSave={closeAndRefresh} />}
    </>
  );
}

export { AcademyTab };
