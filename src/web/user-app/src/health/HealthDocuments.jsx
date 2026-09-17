// 健康文档 — components/health-documents (twin layer 3). One component, two hosts (the Digital
// Twin subtab and the Viva AG panel). A coach reads, never writes (canUpload=false hides upload
// and delete). Upload: presign → raw PUT with EXACTLY the presign's content type (§35) →
// register. <input type=file> replaces wx.chooseMessageFile / wx.chooseMedia.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q, putToOss } from '../api.js';
import { useLang } from '../i18n/index.js';
import { ui } from '../components/ui/ui.js';

const MAX_BYTES = 20 * 1024 * 1024;
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'bmp', 'gif'];
const ALLOWED_EXTENSIONS = DOC_EXTENSIONS.concat(IMAGE_EXTENSIONS);
const DOC_TYPES = ['lab_report', 'hospital_record', 'imaging', 'discharge_summary', 'prescription', 'genetic', 'microbiome', 'functional_test', 'other'];
const extOf = name => (String(name || '').includes('.') ? String(name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') : '');

function structuredV2Blocks(s) {
  if (!s || s.version !== 2 || !Array.isArray(s.sections)) return [];
  return s.sections.slice(0, 50).map((sec, i) => ({
    key: `s${i}`, title: sec && sec.title ? String(sec.title) : '',
    tables: (Array.isArray(sec && sec.tables) ? sec.tables : []).slice(0, 20).map((tbl, ti) => ({ key: `s${i}t${ti}`, columns: (tbl.columns || []).map(String), rows: (tbl.rows || []).slice(0, 200).map(r => (r || []).map(c => (c === null || c === undefined ? '' : String(c)))) })),
    pairs: (Array.isArray(sec && sec.pairs) ? sec.pairs : []).slice(0, 200).map(p => ({ label: String(p.label || ''), value: [p.value, p.note].filter(v => v !== undefined && v !== null && v !== '').map(String).join('  ') || '—' })),
  }));
}
function tagChips(tags, t, lang) {
  return (Array.isArray(tags) ? tags : []).slice(0, 60).map(x => {
    const isFact = x.kind === 'fact' && !!x.tag_key;
    const name = isFact ? (lang === 'en' ? (x.name_en || x.name_zh || x.text) : (x.name_zh || x.text)) : x.text;
    return { id: x.id, isFact, inactive: x.status === 'past' || x.status === 'stopped', category: t.tagCategory[x.category] || t.tagCategory.other, label: `${name}${x.value ? ` ${x.value}` : ''}`, status: x.status && t.tagStatus[x.status] ? t.tagStatus[x.status] : '', text: isFact && x.text && x.text !== name ? x.text : '' };
  });
}
function flattenStructured(node, depth = 0, key = '', out = []) {
  if (out.length >= 400) return out;
  if (node === null || node === undefined) { if (key) out.push({ depth, key, value: '—', isHead: false }); return out; }
  if (Array.isArray(node)) {
    if (key) out.push({ depth, key, value: '', isHead: true });
    node.forEach((n, i) => {
      if (n && typeof n === 'object') {
        const label = n.label || n.name || n.title || n.key;
        if (label && (n.value !== undefined || n.result !== undefined || n.note !== undefined)) {
          const val = [n.value, n.result].find(v => v !== undefined && v !== null && v !== '');
          out.push({ depth: depth + 1, key: String(label), value: `${val === undefined ? '' : val}${n.unit ? ` ${n.unit}` : ''}${n.note ? `  ${n.note}` : ''}`.trim() || '—', isHead: false });
          for (const k of Object.keys(n)) { if (['label', 'name', 'title', 'key', 'value', 'result', 'unit', 'note'].includes(k)) continue; flattenStructured(n[k], depth + 2, k, out); }
        } else flattenStructured(n, depth + 1, label ? String(label) : `#${i + 1}`, out);
      } else out.push({ depth: depth + 1, key: `#${i + 1}`, value: String(n), isHead: false });
    });
    return out;
  }
  if (typeof node === 'object') { if (key) out.push({ depth, key, value: '', isHead: true }); const inner = key ? depth + 1 : depth; for (const k of Object.keys(node)) flattenStructured(node[k], inner, k, out); return out; }
  out.push({ depth, key: key || '', value: String(node), isHead: false });
  return out;
}

export default function HealthDocuments({ userId, canUpload = true, coachId = '', onLoaded }) {
  const { lang, t: T } = useLang();
  const t = T.docs;
  const [documents, setDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const fileRef = useRef(null);
  const openIds = useRef(new Set());
  const scope = coachId ? `&coach_id=${q(coachId)}` : '';
  const today = new Date().toISOString().slice(0, 10);

  const typeLabel = useCallback(docType => ({ hospital_record: t.typeHospital, lab_report: t.typeLab, imaging: t.typeImaging, discharge_summary: t.typeDischarge, prescription: t.typePrescription, genetic: t.typeGenetic, microbiome: t.typeMicrobiome, functional_test: t.typeFunctional }[docType] || t.typeOther), [t]);
  const sizeLabel = bytes => { if (!bytes) return ''; const mb = bytes / (1024 * 1024); return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; };
  const extLabel = useCallback(ext => {
    if (!ext) return canUpload ? t.extNone : '';
    if (['queued', 'claimed', 'processing'].includes(ext.status)) return t.extPending;
    if (ext.status === 'failed') return t.extFailed;
    if (ext.status === 'rejected') return t.extRejected;
    if (ext.status !== 'completed') return '';
    const isZh = lang !== 'en';
    const bits = [];
    if (ext.accepted > 0) bits.push(isZh ? `${ext.accepted} 项指标` : `${ext.accepted} marker${ext.accepted === 1 ? '' : 's'}`);
    const kept = Math.max(0, (ext.items || 0) - (ext.accepted || 0));
    if (kept > 0) bits.push(isZh ? `${kept} 项按原文保存` : `${kept} item${kept === 1 ? '' : 's'} as printed`);
    if (ext.findings > 0) bits.push(isZh ? `${ext.findings} 条健康信息` : `${ext.findings} health detail${ext.findings === 1 ? '' : 's'}`);
    if (bits.length === 0) return isZh ? '未读取到指标' : 'No markers found';
    return isZh ? `已记录 ${bits.join('、')}` : `Recorded ${bits.join(', ')}`;
  }, [t, lang, canUpload]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get(`/health-documents?openid=${q(userId)}&include_structured=1${scope}`);
      const docs = (res?.documents || []).map(d => ({
        ...d, typeLabel: typeLabel(d.doc_type), sizeLabel: sizeLabel(d.size_bytes), extLabel: extLabel(d.extraction),
        extBusy: !!d.extraction && ['queued', 'claimed', 'processing'].includes(d.extraction.status),
        extDone: !!d.extraction && d.extraction.status === 'completed', extNone: !d.extraction,
        extFailed: !!d.extraction && d.extraction.status === 'failed',
        extMissingDate: !!d.extraction && d.extraction.status === 'completed' && !!d.extraction.missing_date && !d.doc_date,
        structuredRows: d.structured && d.structured.version !== 2 ? flattenStructured(d.structured) : [],
        structuredBlocks: structuredV2Blocks(d.structured), hasStructured: !!d.structured, structuredOpen: openIds.current.has(d.id),
        tagChips: tagChips(d.tags, t, lang),
      }));
      setDocuments(docs); setDocsLoading(false);
      const dates = docs.map(d => d.doc_date || (d.created_at ? String(d.created_at).slice(0, 10) : null)).filter(Boolean).sort();
      onLoaded?.({ count: docs.length, latestDate: dates.length ? dates[dates.length - 1] : null });
    } catch { setDocsLoading(false); }
  }, [userId, scope, typeLabel, extLabel, t, lang, onLoaded]);

  useEffect(() => { load(); }, [userId, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchDoc = async (id, body) => { const res = await api.patch(`/health-documents/${id}`, { openid: userId, ...body }); if (!res?.success) throw new Error(res?.error || 'failed'); return res; };

  const onPickDate = async (id, value) => { if (!canUpload || !value) return; try { await patchDoc(id, { doc_date: value, re_extract: true }); ui.toast(t.dateSaved); load(); } catch { ui.toast(t.errGeneric); } };
  const changeType = async id => {
    if (!canUpload) return;
    try {
      const r = await ui.actionSheet({ itemList: DOC_TYPES.map(typeLabel) });
      const docType = DOC_TYPES[r.tapIndex]; if (!docType) return;
      await patchDoc(id, { doc_type: docType }); ui.toast(t.typeSaved); load();
    } catch (e) { if (e?.message !== 'cancel') ui.toast(t.errGeneric); }
  };
  const toggleStructured = id => { if (openIds.current.has(id)) openIds.current.delete(id); else openIds.current.add(id); setDocuments(ds => ds.map(d => (d.id === id ? { ...d, structuredOpen: !d.structuredOpen } : d))); };
  const rerunExtraction = async id => { if (!canUpload) return; try { const res = await api.post(`/health-documents/${id}/extract`, { openid: userId }); if (!res?.success) throw new Error(); ui.toast(res.queued ? t.extRerunOk : t.extRerunBusy); load(); } catch { ui.toast(t.errGeneric); } };
  const rejectExtraction = async id => {
    if (!canUpload) return;
    const { confirm } = await ui.confirm({ title: t.extClearedTitle, content: t.extClearedBody });
    if (!confirm) return;
    try { await api.del(`/health-documents/${id}/extraction?openid=${q(userId)}`); ui.toast(t.extCleared); load(); } catch { ui.toast(t.errGeneric); }
  };
  const deleteDocument = async (id, name) => {
    if (!canUpload) return;
    const { confirm } = await ui.confirm({ title: name || '', content: t.deleteConfirm });
    if (!confirm) return;
    try { await api.del(`/health-documents/${id}?openid=${q(userId)}`); ui.toast(t.okDeleted); load(); } catch { ui.toast(t.errGeneric); }
  };
  const openDocument = async id => {
    const win = window.open('', '_blank');
    try {
      const res = await api.get(`/health-documents/${id}/url?openid=${q(userId)}${scope}`);
      if (!res?.success) throw new Error('no url');
      if (win) win.location.href = res.url; else window.open(res.url, '_blank');
    } catch { win?.close(); ui.toast(t.errOpen); }
  };
  const onFile = async e => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f || uploading) return;
    const ext = extOf(f.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) { await ui.confirm({ title: t.unsupportedTitle, content: t.unsupportedBody, showCancel: false, confirmText: t.gotIt }); return; }
    if (f.size > MAX_BYTES) { ui.toast(t.errTooLarge); return; }
    setUploading(true); setUploadStatus(t.preparing);
    try {
      const pre = await api.get(`/health-documents/presign?openid=${q(userId)}&filename=${q(f.name)}&size_bytes=${f.size}`);
      if (!pre?.success) throw new Error(pre?.error || 'presign failed');
      setUploadStatus(t.uploading);
      await putToOss(pre.put_url, f, pre.put_content_type);
      setUploadStatus(t.registering);
      const reg = await api.post('/health-documents', { openid: userId, oss_key: pre.key, filename: f.name, size_bytes: f.size, doc_type: 'other' });
      if (!reg?.success) throw new Error(reg?.error || 'register failed');
      setUploading(false); setUploadStatus(''); load();
    } catch { setUploading(false); setUploadStatus(''); ui.toast(t.errUpload); }
  };

  return (
    <div className="hd-root">
      <div className="hd-section">
        <div className="hd-section-head"><span className="hd-section-title">{t.documents}</span><span className="hd-section-count">{documents.length}</span></div>
        {canUpload && (
          <>
            <div className={`hd-upload-btn${uploading ? ' hd-btn-busy' : ''}`} onClick={() => !uploading && fileRef.current?.click()}><span>{uploading ? uploadStatus : t.uploadBtn}</span></div>
            <input ref={fileRef} type="file" style={{ display: 'none' }} accept={ALLOWED_EXTENSIONS.map(x => `.${x}`).join(',') + ',image/*'} onChange={onFile} />
            {uploading && <div className="hd-progress"><div className="hd-progress-bar" /></div>}
          </>
        )}
        {docsLoading ? <div className="hd-muted">{t.loading}</div>
          : documents.length === 0 ? (
            <div className="hd-empty"><span className="hd-empty-title">{canUpload ? t.noDocsTitle : t.noDocsOther}</span>{canUpload && <span className="hd-empty-hint">{t.noDocsHint}</span>}</div>
          ) : (
            <div>
              {documents.map(item => (
                <div key={item.id} className="hd-doc-wrap">
                  <div className="hd-doc">
                    <div className="hd-doc-main" onClick={() => openDocument(item.id)}>
                      <span className="hd-doc-name">{item.filename}</span>
                      <div className="hd-doc-meta">
                        {canUpload ? <span className="hd-doc-badge hd-doc-badge-tap" onClick={e => { e.stopPropagation(); changeType(item.id); }}>{item.typeLabel} ⌄</span> : <span className="hd-doc-badge">{item.typeLabel}</span>}
                        {item.doc_date && <span className="hd-doc-sub">{item.doc_date}</span>}
                        <span className="hd-doc-sub">{item.sizeLabel}</span>
                      </div>
                      {item.extLabel && <span className={`hd-doc-ext${item.extBusy || item.extNone ? ' hd-doc-ext-busy' : ''}`}>{item.extLabel}</span>}
                      {item.summary && <span className="hd-doc-summary">{item.summary}</span>}
                    </div>
                    {canUpload && <span className="hd-doc-del" onClick={() => deleteDocument(item.id, item.filename)}>{t.delete}</span>}
                  </div>
                  {canUpload && item.extMissingDate && (
                    <div className="hd-doc-fix">
                      <span className="hd-doc-fix-hint">{t.extMissingDateHint}</span>
                      <label className="hd-doc-action">{t.setDate}<input type="date" max={today} style={{ display: 'none' }} onChange={e => onPickDate(item.id, e.target.value)} /></label>
                    </div>
                  )}
                  {canUpload && (item.extDone || item.extNone || item.extFailed) ? (
                    <div className="hd-doc-actions">
                      <span className="hd-doc-action" onClick={() => rerunExtraction(item.id)}>{item.extNone ? t.extRun : item.extFailed ? t.extRetry : t.extRerun}</span>
                      {item.extDone && <span className="hd-doc-action hd-doc-action-warn" onClick={() => rejectExtraction(item.id)}>{t.extWrong}</span>}
                      {item.hasStructured && <span className="hd-doc-action" onClick={() => toggleStructured(item.id)}>{item.structuredOpen ? t.structuredHide : t.structuredShow}</span>}
                    </div>
                  ) : item.hasStructured ? (
                    <div className="hd-doc-actions"><span className="hd-doc-action" onClick={() => toggleStructured(item.id)}>{item.structuredOpen ? t.structuredHide : t.structuredShow}</span></div>
                  ) : null}
                  {item.tagChips.length > 0 && (
                    <div className="hd-tags">
                      {item.tagChips.map(tag => (
                        <div key={tag.id} className={`hd-tag ${tag.isFact ? 'hd-tag-fact' : 'hd-tag-desc'}${tag.inactive ? ' hd-tag-inactive' : ''}`}>
                          <span className="hd-tag-cat">{tag.category}</span><span className="hd-tag-label">{tag.label}</span>
                          {tag.status && <span className="hd-tag-status">{tag.status}</span>}
                          {!tag.isFact && <span className="hd-tag-status">{t.tagDescriptor}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {item.structuredOpen && (
                    <div className="hd-struct">
                      {item.structuredBlocks.map(sec => (
                        <div key={sec.key}>
                          {sec.title && <div className="hd-struct-row hd-struct-head"><span className="hd-struct-key">{sec.title}</span></div>}
                          {sec.tables.map(tbl => (
                            <div key={tbl.key} className="hd-table-wrap" style={{ overflowX: 'auto' }}>
                              <div className="hd-table">
                                <div className="hd-table-row hd-table-header">{tbl.columns.map((col, i) => <span key={i} className="hd-table-cell">{col}</span>)}</div>
                                {tbl.rows.map((row, ri) => <div key={ri} className="hd-table-row">{row.map((cell, ci) => <span key={ci} className="hd-table-cell">{cell}</span>)}</div>)}
                              </div>
                            </div>
                          ))}
                          {sec.pairs.map((pair, pi) => <div key={pi} className="hd-struct-row" style={{ paddingLeft: 12 }}><span className="hd-struct-key">{pair.label}</span><span className="hd-struct-val">{pair.value}</span></div>)}
                        </div>
                      ))}
                      {item.structuredRows.map((row, i) => (
                        <div key={i} className={`hd-struct-row${row.isHead ? ' hd-struct-head' : ''}`} style={{ paddingLeft: row.depth * 12 }}>
                          <span className="hd-struct-key">{row.key}</span>{!row.isHead && <span className="hd-struct-val">{row.value}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {canUpload && <span className="hd-footnote">{t.footnote}</span>}
            </div>
          )}
      </div>
    </div>
  );
}
