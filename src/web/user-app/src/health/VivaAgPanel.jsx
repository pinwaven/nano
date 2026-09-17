// The Viva AG subtab — components/viva-ag-panel. Jobs list/create/cancel with the daily quota,
// the "needs your input" hand-off to the chat questionnaire, the dots_formulation progress
// card, the shared <HealthDocuments>, and the in-app viewer for .md/.txt artifacts (mdToHtml
// with links neutralised — the file was written by an EXTERNAL system). Polls every 15 s only
// while a job is active, and never while the tab is hidden.
import { useCallback, useEffect, useRef, useState } from 'react';
import markdown from '@mini/markdown.js';
import { api, q } from '../api.js';
import { useLang } from '../i18n/index.js';
import { ui } from '../components/ui/ui.js';
import { rpxToPx } from '../chat/messages.js';
import HealthDocuments from './HealthDocuments.jsx';

const { mdToHtml } = markdown;
const RESULT_TEXT_EXTENSIONS = ['md', 'txt'];
const MAX_REPORT_CHARS = 120000;
const POLL_MS = 15000;

export default function VivaAgPanel({ userId, visible, onGoToChat }) {
  const { lang, t: T } = useLang();
  const t = T.ag;
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [commandKey, setCommandKey] = useState('');
  const [commandText, setCommandText] = useState('');
  const [meta, setMeta] = useState({ hasActive: false, dailyLimit: 3, dailyUsed: 0, dailyLimitReached: false, expiryDisplay: '' });
  const [formulation, setFormulation] = useState(null);
  const [detailJob, setDetailJob] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [report, setReport] = useState(null); // { title, html, truncated }
  const timer = useRef(null);

  const presets = [
    { key: 'full_analysis', label: t.presetFull }, { key: 'document_review', label: t.presetDocs },
    { key: 'risk_screen', label: t.presetRisk }, { key: 'dots_formulation', label: t.presetDots },
  ];
  const statusLabel = s => ({ queued: t.stQueued, claimed: t.stClaimed, processing: t.stProcessing, awaiting_input: t.stAwaitingInput, completed: t.stCompleted, failed: t.stFailed, cancelled: t.stCancelled }[s] || s);
  const sizeLabel = bytes => { if (!bytes) return ''; const mb = bytes / (1024 * 1024); return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; };
  const decorate = job => ({
    ...job,
    files: (job.result_files || []).map(f => ({ ...f, extLabel: String(f.ext || '').toUpperCase(), sizeLabel: sizeLabel(f.size_bytes) })),
    statusLabel: statusLabel(job.status),
    summaryPreview: job.result_summary ? (job.result_summary.length > 60 ? job.result_summary.slice(0, 60) + '…' : job.result_summary) : '',
  });
  const decorateFormulation = f => {
    const map = { valid: { label: t.fmValid, hint: t.fmValidHint }, invalid: { label: t.fmInvalid, hint: t.fmInvalidHint }, approved: { label: t.fmApproved, hint: t.fmApprovedHint }, rejected: { label: t.fmRejected, hint: t.fmRejectedHint }, committed: { label: t.fmCommitted, hint: t.fmCommittedHint } };
    const m = map[f.status] || { label: f.status, hint: '' };
    return { ...f, statusLabel: m.label, statusHint: m.hint, total_dots: f.total_dots ? String(t.fmDots).replace('{n}', f.total_dots) : '' };
  };

  const loadFormulation = useCallback(async () => {
    if (!userId) return;
    try { const res = await api.get(`/viva-ag/formulation?openid=${q(userId)}`); const f = (res?.formulations || [])[0] || null; setFormulation(f ? decorateFormulation(f) : null); }
    catch { setFormulation(null); }
  }, [userId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadJobs = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/viva-ag/jobs?openid=${q(userId)}`);
      setJobs((res?.jobs || []).map(decorate));
      loadFormulation();
      setMeta({ hasActive: !!res?.has_active, dailyLimit: res?.daily_limit ?? 3, dailyUsed: res?.daily_used ?? 0, dailyLimitReached: !!res?.daily_limit_reached, expiryDisplay: (res?.viva_ag_expires_at || '').slice(0, 10) });
      setJobsLoading(false);
    } catch { setJobsLoading(false); }
  }, [userId, loadFormulation, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => {
    const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
    if (meta.hasActive && visible && document.visibilityState === 'visible') { if (!timer.current) timer.current = setInterval(loadJobs, POLL_MS); } else stop();
    const onVis = () => { if (document.visibilityState !== 'visible') stop(); else if (meta.hasActive && visible && !timer.current) timer.current = setInterval(loadJobs, POLL_MS); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, [meta.hasActive, visible, loadJobs]);

  const awaitingJob = jobs.find(j => j.status === 'awaiting_input') || null;
  const canSubmit = !meta.hasActive && !submitting && !meta.dailyLimitReached && !!(commandKey || commandText.trim());
  const quotaLeftText = String(t.quotaLeft || '').replace('{n}', Math.max(0, meta.dailyLimit - meta.dailyUsed));

  const submitJob = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await api.post('/viva-ag/jobs', { openid: userId, command_key: commandKey || undefined, command: commandText.trim() || undefined });
      if (!res?.success) {
        setSubmitting(false);
        const reason = res?.reason;
        if (reason === 'daily_limit_reached') return ui.toast(t.errDailyLimit.replace('{n}', res.limit || meta.dailyLimit));
        if (reason === 'job_already_active') return ui.toast(t.oneAtATime);
        if (reason === 'viva_ag_inactive' || reason === 'viva_inactive') return ui.toast(t.errNoAccess);
        return ui.toast(t.errGeneric);
      }
      setSubmitting(false); setCommandText(''); setCommandKey('');
      ui.toast(t.okSubmitted); loadJobs();
    } catch { setSubmitting(false); ui.toast(t.errNetwork); }
  };

  const openResultFile = async (job, index) => {
    if (downloading || !job) return;
    setDownloading(true);
    try {
      const res = await api.get(`/viva-ag/jobs/result-url?openid=${q(userId)}&job_uid=${q(job.job_uid)}&index=${Number(index) || 0}`);
      if (!res?.success) throw new Error(res?.reason || 'no url');
      const { url, file_type: ft, filename } = res;
      if (RESULT_TEXT_EXTENSIONS.includes(ft)) {
        const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status);
        let text = await r.text();
        if (!text.trim()) { ui.toast(t.errReportEmpty); return; }
        const truncated = text.length > MAX_REPORT_CHARS;
        if (truncated) text = text.slice(0, MAX_REPORT_CHARS);
        const neutral = String(text).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, tx, href) => `${tx} (${href})`);
        const html = ft === 'md' ? mdToHtml(neutral) : '<pre>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>';
        setReport({ title: filename || '', html, truncated });
      } else {
        window.open(url, '_blank', 'noopener');
      }
    } catch { ui.toast(t.errGeneric); }
    finally { setDownloading(false); }
  };

  const cancelJob = async () => {
    if (!detailJob) return;
    try { await api.post('/viva-ag/jobs/cancel', { openid: userId, job_uid: detailJob.job_uid }); setDetailJob(null); loadJobs(); }
    catch { ui.toast(t.errGeneric); }
  };

  return (
    <div className="ag-root">
      <div className="ag-scroll uh-scroll">
        <div className="ag-hero">
          <div className="ag-hero-badge"><span>VIVA AG</span></div>
          <span className="ag-hero-desc">{t.heroDesc}</span>
          {meta.expiryDisplay && <span className="ag-hero-expiry">{t.validUntil} {meta.expiryDisplay}</span>}
        </div>
        {awaitingJob && (
          <div className="ag-section">
            <div className="ag-ask">
              <span className="ag-ask-title">{t.askTitle}</span>
              <span className="ag-ask-body">{t.askBody}</span>
              {awaitingJob.awaiting_input_expires_at && <span className="ag-ask-deadline">{String(t.askDeadline || '').replace('{n}', awaitingJob.awaiting_input_expires_at.slice(0, 10))}</span>}
              <div className="ag-ask-cta" onClick={() => onGoToChat?.('viva_ag_questionnaire')}>{t.askCta}</div>
            </div>
          </div>
        )}
        <HealthDocuments userId={userId} canUpload />
        {formulation && (
          <div className="ag-section">
            <span className="ag-section-title">{t.fmTitle}</span>
            <div className={`ag-fm ag-fm-${formulation.status}`}>
              <div className="ag-fm-head"><span className="ag-fm-status">{formulation.statusLabel}</span>{formulation.total_dots && <span className="ag-fm-dots">{formulation.total_dots}</span>}</div>
              <span className="ag-fm-hint">{formulation.statusHint}</span>
              {formulation.rationale && <span className="ag-fm-rationale">{formulation.rationale}</span>}
            </div>
          </div>
        )}
        <div className="ag-section">
          <span className="ag-section-title">{t.newAnalysis}</span>
          <div className="ag-chips">
            {presets.map(p => <div key={p.key} className={`ag-chip${commandKey === p.key ? ' ag-chip-on' : ''}`} onClick={() => setCommandKey(k => (k === p.key ? '' : p.key))}><span>{p.label}</span></div>)}
          </div>
          <textarea className="ag-input" value={commandText} onChange={e => setCommandText(e.target.value)} placeholder={t.commandPlaceholder} maxLength={2000} rows={3} />
          <div className={`ag-submit${canSubmit ? '' : ' ag-submit-off'}`} onClick={submitJob}><span>{submitting ? t.submitting : t.submit}</span></div>
          {meta.hasActive ? <span className="ag-note">{t.oneAtATime}</span>
            : meta.dailyLimitReached ? <span className="ag-note">{t.quotaUsedUp}</span>
            : !commandKey && !commandText ? <span className="ag-note">{t.pickSomething}</span>
            : <span className="ag-note">{quotaLeftText}</span>}
        </div>
        <div className="ag-section">
          <span className="ag-section-title">{t.history}</span>
          {jobsLoading ? <div className="ag-muted">{t.loading}</div>
            : jobs.length === 0 ? <div className="ag-muted">{t.noJobs}</div>
            : jobs.map(item => (
              <div key={item.job_uid} className="ag-job" onClick={() => setDetailJob(item)}>
                <div className="ag-job-head"><span className={`ag-pill ag-pill-${item.status}`}>{item.statusLabel}</span><span className="ag-job-date">{item.created_at}</span></div>
                <span className="ag-job-cmd">{item.command}</span>
                {item.progress_note ? <span className="ag-job-note">{item.progress_note}</span> : item.result_summary ? <span className="ag-job-note">{item.summaryPreview}</span> : null}
                {item.files.length > 0 && (
                  <div className="ag-file-chips">
                    {item.files.map(f => <div key={f.index} className="ag-file-chip" onClick={e => { e.stopPropagation(); openResultFile(item, f.index); }}><span className="ag-file-ext">{f.extLabel}</span><span className="ag-file-name">{f.filename}</span></div>)}
                  </div>
                )}
              </div>
            ))}
        </div>
        <div style={{ height: 100 }} />
      </div>

      {detailJob && (
        <div className="ag-sheet-mask" onClick={() => setDetailJob(null)}>
          <div className="ag-sheet" onClick={e => e.stopPropagation()}>
            <div className="ag-sheet-head"><span className={`ag-pill ag-pill-${detailJob.status}`}>{detailJob.statusLabel}</span><span className="ag-sheet-close" onClick={() => setDetailJob(null)}>✕</span></div>
            <span className="ag-sheet-date">{detailJob.created_at}</span>
            <span className="ag-sheet-cmd">{detailJob.command}</span>
            {detailJob.result_summary ? <span className="ag-sheet-body">{detailJob.result_summary}</span>
              : detailJob.error_reason ? <span className="ag-sheet-body ag-sheet-err">{t.failed}</span>
              : detailJob.progress_note ? <span className="ag-sheet-body">{detailJob.progress_note}</span>
              : <span className="ag-sheet-body ag-muted">{t.inProgress}</span>}
            {detailJob.files.length > 0 && (
              <div className="ag-filelist">
                <span className="ag-filelist-title">{t.reports}</span>
                {detailJob.files.map(f => (
                  <div key={f.index} className="ag-file-row" onClick={() => openResultFile(detailJob, f.index)}>
                    <span className="ag-file-ext">{f.extLabel}</span>
                    <div className="ag-file-row-main"><span className="ag-file-row-name">{f.filename}</span>{f.sizeLabel && <span className="ag-file-row-size">{f.sizeLabel}</span>}</div>
                    <span className="ag-file-row-go">{downloading ? t.opening : t.openReport}</span>
                  </div>
                ))}
              </div>
            )}
            {detailJob.status === 'queued' && <div className="ag-sheet-btn ag-sheet-btn-ghost" onClick={cancelJob}><span>{t.cancel}</span></div>}
          </div>
        </div>
      )}
      {report && (
        <div className="ag-viewer">
          <div className="ag-viewer-head"><span className="ag-viewer-title">{report.title}</span><span className="ag-viewer-close" onClick={() => setReport(null)}>✕</span></div>
          <div className="ag-viewer-body uh-scroll">
            <div className="msg-html" dangerouslySetInnerHTML={{ __html: rpxToPx(report.html) }} />
            {report.truncated && <span className="ag-viewer-trunc">{t.reportTruncated}</span>}
            <div style={{ height: 60 }} />
          </div>
        </div>
      )}
    </div>
  );
}
