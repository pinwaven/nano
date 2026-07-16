import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  X, Check, Trash2, Plus, Pencil, ChevronDown, ChevronUp,
  Package, ShoppingBag, Building2, Layers, Archive, Box,
  Image as ImageIcon, Eye, Upload, Sparkles,
} from 'lucide-react';
import { useLang, fmt, fmtDate, Badge, StatCard } from '../shared.jsx';
import GcnInventoryEmbed from './GcnInventoryEmbed.jsx';

// Channels whose SKU/inventory/shipping are managed entirely in GCN (see CLAUDE.md
// §19) — kept as a literal set rather than a per-channel config flag since GCN
// integration is currently a single sector, matching the gate already established
// for the aeviva miniapp Store tab.
const GCN_LINKED_CHANNEL_KEYS = new Set(['aeviva', 'aeviva-china']);

// ── uploadToOSS helper ────────────────────────────────────────────────────────

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

// ── HTML description field (shared by inventory + store item modals) ──────────

function sanitizeDescHtml(html) {
  return String(html)
    .replace(/<\/?(script|iframe|object|embed|link|meta)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(src|href)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '');
}

function HtmlDescField({ label, value, onChange, placeholder, category }) {
  const { t } = useLang();
  const tm = t.modal;
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  const handlePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'image', filename: file.name, category },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || 'Upload failed');
      const { url, get_url } = presignRes.data;
      await uploadToOSS(url, file, setUploadProgress);
      const imgTag = `<img src="${get_url}" />`;
      const ta = textareaRef.current;
      const pos = ta && document.activeElement !== ta && ta.selectionStart === 0 && ta.selectionEnd === 0
        ? value.length
        : (ta?.selectionEnd ?? value.length);
      const before = value.slice(0, pos);
      const after = value.slice(pos);
      const sep = before && !before.endsWith('\n') ? '\n' : '';
      onChange(`${before}${sep}${imgTag}${after.startsWith('\n') || !after ? '' : '\n'}${after}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Upload failed');
    } finally { setUploading(false); }
  };

  return (
    <div className="form-field" style={{ gridColumn: '1 / -1' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {label}
        <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>{tm.descHtmlHint}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-secondary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <ImageIcon size={12} />
          {uploading ? `${uploadProgress}%` : tm.insertImage}
        </button>
        <button type="button" className="btn-secondary btn-sm"
          style={showPreview ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
          onClick={() => setShowPreview(p => !p)}>
          <Eye size={12} />
          {tm.previewHtml}
        </button>
      </span>
      <textarea ref={textareaRef} className="form-field-textarea" rows={4} value={value}
        onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePick} />
      {error && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 400 }}>{error}</span>}
      {showPreview && (
        <div className="html-desc-preview" dangerouslySetInnerHTML={{ __html: sanitizeDescHtml(value || '') }} />
      )}
    </div>
  );
}

// ── Channel Inventory ─────────────────────────────────────────────────────────

const EMPTY_INV_ITEM = {
  key_name: '', name_en: '', name_zh: '', desc_en: '', desc_zh: '',
  item_type: 'physical', unit_en: '', unit_zh: '',
  price_cny: '', price_usd: '', price_credits: '', stock_quantity: '',
  tag: '', sort_order: 0, active: true, image_url: '', store_item_id: null, show_in_store: false, sku_id: '',
};

function ChannelInventoryItemModal({ item, channelId, skus = [], onClose, onSave }) {
  const { t } = useLang();
  const ti = t.inventory;
  const isEdit = !!item?.id;
  const [form, setForm] = useState(isEdit
    ? { key_name: item.key_name, name_en: item.name_en || '', name_zh: item.name_zh || '',
        desc_en: item.desc_en || '', desc_zh: item.desc_zh || '',
        item_type: item.item_type || 'physical', unit_en: item.unit_en || '', unit_zh: item.unit_zh || '',
        price_cny: item.price_cny ?? '', price_usd: item.price_usd ?? '', price_credits: item.price_credits ?? '',
        stock_quantity: item.stock_quantity ?? '',
        tag: item.tag || '', sort_order: item.sort_order ?? 0,
        active: item.active !== false, image_url: item.image_url || '',
        store_item_id: item.store_item_id || null,
        show_in_store: item.show_in_store === true,
        sku_id: item.sku_id || '' }
    : item
      ? { key_name: item.key_name || '', name_en: item.name_en || '', name_zh: item.name_zh || '',
          desc_en: item.desc_en || '', desc_zh: item.desc_zh || '',
          item_type: item.item_type || 'physical', unit_en: item.unit_en || '', unit_zh: item.unit_zh || '',
          price_cny: item.price_cny ?? '', price_usd: item.price_usd ?? '', price_credits: item.price_credits ?? '',
          stock_quantity: '',
          tag: item.tag || '', sort_order: item.sort_order ?? 0,
          active: true, image_url: item.image_url || '',
          store_item_id: item.store_item_id || null, show_in_store: false,
          sku_id: item.sku_id || '' }
      : { ...EMPTY_INV_ITEM });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true); setUploadProgress(0); setError('');
    try {
      const presignRes = await axios.get('/api/oss/presign', {
        params: { type: 'image', filename: file.name, category: 'inventory' },
      });
      if (!presignRes.data.success) throw new Error(presignRes.data.error || ti.uploadFailed);
      const { url, get_url } = presignRes.data;
      await uploadToOSS(url, file, setUploadProgress);
      set('image_url', get_url);
    } catch (err) {
      setError(err.response?.data?.error || err.message || ti.uploadFailed);
    } finally { setUploading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.key_name.trim()) { setError(ti.keyRequired); return; }
    if (!form.name_en.trim()) { setError(ti.nameRequired); return; }
    if (!form.sku_id) { setError(ti.skuRequired); return; }
    setBusy(true); setError('');
    const payload = {
      ...form,
      channel_id: channelId,
      price_cny: form.price_cny !== '' ? form.price_cny : null,
      price_usd: form.price_usd !== '' ? form.price_usd : null,
      price_credits: form.price_credits !== '' ? form.price_credits : null,
      stock_quantity: form.stock_quantity !== '' ? parseInt(form.stock_quantity, 10) : null,
      sku_id: form.sku_id,
    };
    if (isEdit) delete payload.store_item_id;
    try {
      if (isEdit) await axios.put(`/api/channel-inventory/${item.id}`, payload);
      else await axios.post('/api/channel-inventory', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || ti.saveFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEdit ? ti.editItem : ti.addItem}
            {form.store_item_id && (
              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontWeight: 500 }}>
                {ti.linkedToStore}
              </span>
            )}
          </span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-grid">
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ti.skuBinding} <span style={{ color: '#ef4444' }}>*</span></span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.sku_id || ''} onChange={e => {
                  const skuId = e.target.value;
                  if (!isEdit && skuId) {
                    const sku = skus.find(s => String(s.id) === String(skuId));
                    if (sku) {
                      const autoKey = sku.sku_code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                      setForm(f => ({
                        ...f,
                        sku_id: skuId,
                        key_name: autoKey,
                        name_en: sku.name_en || f.name_en,
                        name_zh: sku.name_zh || f.name_zh,
                        desc_en: sku.desc_en || f.desc_en,
                        desc_zh: sku.desc_zh || f.desc_zh,
                        item_type: sku.item_type || f.item_type,
                        unit_en: sku.unit_en || f.unit_en,
                        unit_zh: sku.unit_zh || f.unit_zh,
                      }));
                      return;
                    }
                  }
                  set('sku_id', skuId);
                }} className="inline-select" style={{ width: '100%', borderColor: !form.sku_id ? '#ef4444' : undefined }}>
                  <option value="">{ti.selectSku}</option>
                  {skus.map(s => (
                    <option key={s.id} value={s.id}>{s.sku_code} - {s.name_zh || s.name_en}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ti.keyName}</span>
              <input value={form.key_name} onChange={e => set('key_name', e.target.value)} disabled={isEdit} placeholder="e.g. health-checkup-basic" />
            </label>
            <label className="form-field">
              <span>{ti.itemType}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.item_type} onChange={e => set('item_type', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="physical">{ti.physical}</option>
                  <option value="virtual">{ti.virtual}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ti.nameEn}</span>
              <input value={form.name_en} onChange={e => set('name_en', e.target.value)} placeholder="e.g. Basic Health Checkup" />
            </label>
            <label className="form-field">
              <span>{ti.nameZh}</span>
              <input value={form.name_zh} onChange={e => set('name_zh', e.target.value)} placeholder="例如 基础体检套餐" />
            </label>
            <HtmlDescField label={ti.descEn} value={form.desc_en} onChange={v => set('desc_en', v)} placeholder="Description in English (HTML supported)" category="inventory" />
            <HtmlDescField label={ti.descZh} value={form.desc_zh} onChange={v => set('desc_zh', v)} placeholder="中文描述（支持 HTML）" category="inventory" />
            <label className="form-field">
              <span>{ti.unitEn}</span>
              <input value={form.unit_en} onChange={e => set('unit_en', e.target.value)} placeholder="e.g. 1 session" />
            </label>
            <label className="form-field">
              <span>{ti.unitZh}</span>
              <input value={form.unit_zh} onChange={e => set('unit_zh', e.target.value)} placeholder="例如 1 次" />
            </label>
            <label className="form-field">
              <span>{ti.priceCny}</span>
              <input type="number" step="0.01" min="0" value={form.price_cny} onChange={e => set('price_cny', e.target.value)} placeholder="0.00" />
            </label>
            <label className="form-field">
              <span>{ti.priceUsd}</span>
              <input type="number" step="0.01" min="0" value={form.price_usd} onChange={e => set('price_usd', e.target.value)} placeholder="0.00" />
            </label>
            <label className="form-field">
              <span>{ti.priceCredits}</span>
              <input type="number" step="0.01" min="0" value={form.price_credits} onChange={e => set('price_credits', e.target.value)} placeholder="100" />
            </label>
            <label className="form-field">
              <span>{ti.stockQty}</span>
              <input type="number" min="0" step="1" value={form.stock_quantity} onChange={e => set('stock_quantity', e.target.value)} placeholder={ti.stockHint} />
            </label>
            <label className="form-field">
              <span>{ti.tag}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.tag} onChange={e => set('tag', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">—</option>
                  <option value="bestseller">{ti.tagBestseller}</option>
                  <option value="value">{ti.tagValue}</option>
                  <option value="new">{ti.tagNew}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ti.sortOrder}</span>
              <input type="number" min="0" value={form.sort_order} onChange={e => set('sort_order', e.target.value)} />
            </label>
            <label className="form-field">
              <span>{ti.active}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.active ? 'true' : 'false'} onChange={e => set('active', e.target.value === 'true')} className="inline-select" style={{ width: '100%' }}>
                  <option value="true">{ti.yes}</option>
                  <option value="false">{ti.no}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{ti.showInStore}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.show_in_store ? 'true' : 'false'} onChange={e => set('show_in_store', e.target.value === 'true')} className="inline-select" style={{ width: '100%' }}>
                  <option value="false">{ti.inStoreHidden}</option>
                  <option value="true">{ti.showInStoreLive}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span className="form-label-text">{ti.image}</span>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 6 }}>
                {form.image_url ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={form.image_url} alt="" style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid rgba(99,117,236,0.3)' }} />
                    <button type="button" className="icon-btn" onClick={() => set('image_url', '')}
                      style={{ position: 'absolute', top: -6, right: -6, background: '#0F2540', border: '1px solid rgba(99,117,236,0.4)', borderRadius: '50%', width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <X size={12} />
                    </button>
                  </div>
                ) : null}
                <label className="upload-zone" style={{ flex: 1, minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'wait' : 'pointer', flexDirection: 'column', gap: 6 }}>
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" style={{ display: 'none' }} onChange={handleImagePick} disabled={uploading} />
                  {uploading ? (
                    <>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{ti.uploading}</span>
                      <div className="upload-progress" style={{ width: '80%' }}>
                        <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </>
                  ) : (
                    <span className="upload-zone-hint" style={{ textAlign: 'center' }}>
                      {form.image_url ? '↺ ' : ''}{ti.uploadImage}
                    </span>
                  )}
                </label>
              </div>
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={uploading}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy || uploading}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteInventoryItemConfirm({ item, onClose, onConfirm }) {
  const { t } = useLang();
  const ti = t.inventory;
  const [busy, setBusy] = useState(false);
  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/channel-inventory/${item.id}`); onConfirm(); }
    catch { /* silent */ } finally { setBusy(false); }
  };
  const warningParts = ti.deleteWarning(item.name_en || item.key_name);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ti.deleteItem}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 20, color: '#475569' }}>
            {warningParts[0]}<strong>{warningParts[1]}</strong>{warningParts[2]}
          </p>
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

function WarehouseModal({ modal, onClose, onSave }) {
  const { t } = useLang();
  const ti = t.inventory;
  const isEdit = modal.type === 'edit';
  const isDelete = modal.type === 'delete';
  const w = modal.warehouse || {};
  const [form, setForm] = useState({ name: w.name || '', address: w.address || '', active: w.active !== false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.name.trim()) { setError(ti.warehouseNameLabel + ' is required'); return; }
    setBusy(true); setError('');
    try {
      if (isEdit) await axios.put(`/api/warehouses/${w.id}`, form);
      else await axios.post('/api/warehouses', form);
      onSave();
    } catch (e) { setError(e.response?.data?.error || t.inventory.saveFailed); }
    finally { setBusy(false); }
  };

  const handleDelete = async () => {
    setBusy(true);
    try { await axios.delete(`/api/warehouses/${w.id}`); onSave(); }
    catch (e) { setError(e.response?.data?.error || t.inventory.saveFailed); setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="modal-header">
          <h3>{isDelete ? (isEdit ? ti.editWarehouse : ti.addWarehouse) : isEdit ? ti.editWarehouse : ti.addWarehouse}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {isDelete ? (
          <>
            <p style={{ color: '#94a3b8', marginBottom: 20 }}>{ti.warehouseDeleteWarning}</p>
            <strong style={{ color: '#e2e8f0' }}>{w.name}</strong>
            {error && <p style={{ color: '#ef4444', marginTop: 12, fontSize: 13 }}>{error}</p>}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>{t.cancel || 'Cancel'}</button>
              <button className="btn-danger" onClick={handleDelete} disabled={busy}>
                {busy ? '…' : t.delete || 'Delete'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-field">
              <label className="form-label">{ti.warehouseNameLabel} *</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. shanghai-central" />
            </div>
            <div className="form-field">
              <label className="form-label">{ti.warehouseAddressLabel}</label>
              <input className="form-input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="e.g. 上海市浦东新区XX路XX号" />
            </div>
            {isEdit && (
              <div className="form-field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label className="form-label" style={{ margin: 0 }}>{ti.warehouseStatus}</label>
                <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
                <span style={{ color: '#94a3b8', fontSize: 13 }}>{form.active ? ti.warehouseActive : ti.warehouseInactive}</span>
              </div>
            )}
            {error && <p style={{ color: '#ef4444', marginTop: 4, fontSize: 13 }}>{error}</p>}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>{t.cancel || 'Cancel'}</button>
              <button className="btn-primary" onClick={handleSave} disabled={busy}>
                {busy ? '…' : t.save || 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ImportFromStoreModal({ existingItems, onClose, onSelect }) {
  const { t } = useLang();
  const ti = t.inventory;
  const [storeItems, setStoreItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/store-items?all=true')
      .then(r => setStoreItems(r.data.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const importedIds = new Set(existingItems.map(i => i.store_item_id).filter(Boolean));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{ti.importFromStore}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t.topbar.loading}</div>
          ) : storeItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{ti.noStoreItems}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {storeItems.map(si => {
                const alreadyAdded = importedIds.has(si.id);
                return (
                  <button
                    key={si.id}
                    type="button"
                    onClick={() => !alreadyAdded && onSelect(si)}
                    disabled={alreadyAdded}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(99,117,236,0.2)',
                      background: alreadyAdded ? 'rgba(30,41,59,0.3)' : 'rgba(30,41,59,0.6)',
                      cursor: alreadyAdded ? 'default' : 'pointer',
                      opacity: alreadyAdded ? 0.5 : 1,
                      textAlign: 'left', width: '100%',
                      transition: 'background 0.15s',
                    }}
                  >
                    {si.image_url
                      ? <img src={si.image_url} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 44, height: 44, borderRadius: 6, background: 'rgba(99,117,236,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <ShoppingBag size={18} style={{ color: '#6366f1', opacity: 0.6 }} />
                        </div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{si.name_en}</div>
                      {si.name_zh && <div style={{ fontSize: 11, color: '#94a3b8' }}>{si.name_zh}</div>}
                      <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{si.key_name}</div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      {si.price_cny != null && <div style={{ fontSize: 13, color: '#e2e8f0' }}>¥{Number(si.price_cny).toFixed(2)}</div>}
                      {alreadyAdded && (
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
                          {ti.alreadyAdded}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer" style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
        </div>
      </div>
    </div>
  );
}

// ── SkuModal (used by InventoryTab for channel SKU management) ────────────────

function SkuModal({ sku, onClose, onSave, channelId = null, allSkus = [], initialParentSkuId = '' }) {
  const { t } = useLang();
  const ts = t.store;
  const isEdit = !!sku?.id;

  const initMode = initialParentSkuId ? 'variant' : (sku?.is_parent ? 'parent' : sku?.parent_sku_id ? 'variant' : 'standalone');
  const initAttrs = sku?.attributes ? Object.entries(sku.attributes).map(([k, v]) => ({ key: k, value: v })) : [];

  const [skuMode, setSkuMode] = useState(initMode);
  const [parentSkuId, setParentSkuId] = useState(initialParentSkuId || sku?.parent_sku_id || '');
  const [attrs, setAttrs] = useState(initAttrs.length ? initAttrs : [{ key: '', value: '' }]);
  const [form, setForm] = useState(isEdit
    ? { sku_code: sku.sku_code, name_zh: sku.name_zh || '', name_en: sku.name_en || '',
        desc_zh: sku.desc_zh || '', desc_en: sku.desc_en || '',
        item_type: sku.item_type || 'physical', unit_zh: sku.unit_zh || '个', unit_en: sku.unit_en || 'pcs' }
    : { sku_code: '', name_zh: '', name_en: '', desc_zh: '', desc_en: '', item_type: 'physical', unit_zh: '个', unit_en: 'pcs' });
  const [busy, setBusy] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAiFill = async () => {
    setAiFilling(true); setError('');
    try {
      const res = await axios.post('/api/admin/ai-fill-sku', {
        sku_code: form.sku_code,
        name_en: form.name_en,
        name_zh: form.name_zh,
        desc_en: form.desc_en,
        desc_zh: form.desc_zh,
        item_type: form.item_type,
        unit_en: form.unit_en,
        unit_zh: form.unit_zh,
      });
      if (res.data.success && res.data.filled) {
        const f = res.data.filled;
        setForm(prev => ({
          ...prev,
          name_en: f.name_en || prev.name_en,
          name_zh: f.name_zh || prev.name_zh,
          desc_en: f.desc_en || prev.desc_en,
          desc_zh: f.desc_zh || prev.desc_zh,
          item_type: f.item_type || prev.item_type,
          unit_en: f.unit_en || prev.unit_en,
          unit_zh: f.unit_zh || prev.unit_zh,
        }));
      }
    } catch (err) { setError(err.response?.data?.error || ts.aiFillFailed); }
    finally { setAiFilling(false); }
  };

  const parentSkus = allSkus.filter(s => s.is_parent && s.id !== sku?.id);

  const suggestCode = () => {
    const parent = parentSkus.find(s => s.id === parentSkuId);
    if (!parent) return;
    const attrPart = attrs.filter(a => a.value).map(a => a.value.toUpperCase().replace(/\s+/g, '-')).join('-');
    set('sku_code', attrPart ? `${parent.sku_code}-${attrPart}` : parent.sku_code);
  };

  const setAttr = (i, field, val) => setAttrs(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: val } : a));
  const removeAttr = (i) => setAttrs(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.sku_code.trim()) { setError(ts.skuCodeRequired); return; }
    if (!form.name_en.trim() || !form.name_zh.trim()) { setError(ts.skuNamesRequired); return; }
    if (skuMode === 'variant' && !parentSkuId) { setError(ts.parentSkuRequired); return; }
    setBusy(true); setError('');
    try {
      const attrsObj = skuMode === 'variant'
        ? Object.fromEntries(attrs.filter(a => a.key && a.value).map(a => [a.key.trim(), a.value.trim()]))
        : {};
      const payload = {
        ...form,
        is_parent: skuMode === 'parent',
        parent_sku_id: skuMode === 'variant' ? parentSkuId : null,
        attributes: attrsObj,
        ...(channelId ? { channel_id: channelId } : {}),
      };
      if (isEdit) await axios.put(`/api/skus/${sku.id}`, payload);
      else        await axios.post('/api/skus', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || ts.saveFailed); }
    finally { setBusy(false); }
  };

  const modeStyle = (m) => ({
    flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${skuMode === m ? '#6366f1' : 'var(--border)'}`,
    background: skuMode === m ? 'rgba(99,102,241,0.12)' : 'var(--surface)', color: skuMode === m ? '#818cf8' : '#94a3b8',
    cursor: 'pointer', fontSize: 12, fontWeight: skuMode === m ? 600 : 400, textAlign: 'center',
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{isEdit ? ts.editSkuTitle : ts.createSkuTitle}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11, minHeight: 'auto', display: 'flex', alignItems: 'center', gap: 5 }} onClick={handleAiFill} disabled={aiFilling || busy}>
              <Sparkles size={12} style={{ color: '#818cf8' }} />{aiFilling ? ts.aiFilling : ts.aiFill}
            </button>
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-field" style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>{ts.skuModeLabel}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={modeStyle('standalone')} onClick={() => setSkuMode('standalone')}>{ts.skuModeStandalone}</button>
              <button type="button" style={modeStyle('parent')} onClick={() => setSkuMode('parent')}>{ts.skuModeParent}</button>
              <button type="button" style={modeStyle('variant')} onClick={() => setSkuMode('variant')}>{ts.skuModeVariant}</button>
            </div>
          </div>

          {skuMode === 'variant' && (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.25)' }}>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: '#a78bfa', display: 'block', marginBottom: 6 }}>{ts.parentSkuLabel}</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={parentSkuId} onChange={e => setParentSkuId(e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="">{ts.parentSkuPlaceholder}</option>
                    {parentSkus.map(p => <option key={p.id} value={p.id}>{p.sku_code} — {p.name_en}</option>)}
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#a78bfa' }}>{ts.variantAttrs}</span>
                  <button type="button" style={{ fontSize: 11, color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    onClick={() => setAttrs(prev => [...prev, { key: '', value: '' }])}>
                    {ts.addAttr}
                  </button>
                </div>
                {attrs.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <input value={a.key} onChange={e => setAttr(i, 'key', e.target.value)} placeholder={ts.attrKeyPlaceholder} style={{ flex: 1 }} />
                    <input value={a.value} onChange={e => setAttr(i, 'value', e.target.value)} placeholder={ts.attrValuePlaceholder} style={{ flex: 1 }} />
                    <button type="button" className="icon-btn danger" onClick={() => removeAttr(i)} style={{ flexShrink: 0 }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-grid">
            <label className="form-field">
              <span>{ts.skuCodeLabel}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={form.sku_code} onChange={e => set('sku_code', e.target.value)} disabled={isEdit} placeholder="e.g. KINO-CHIP-V2" style={{ flex: 1 }} />
                {skuMode === 'variant' && !isEdit && (
                  <button type="button" className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minHeight: 'auto', flexShrink: 0 }} onClick={suggestCode}>{ts.suggestCode}</button>
                )}
              </div>
            </label>
            <label className="form-field">
              <span>{ts.itemType}</span>
              <div className="select-wrap" style={{ width: '100%' }}>
                <select value={form.item_type} onChange={e => set('item_type', e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="physical">{ts.physical}</option>
                  <option value="virtual">{ts.virtual}</option>
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            </label>
            <label className="form-field">
              <span>{t.table.nameEn}</span>
              <input value={form.name_en} onChange={e => set('name_en', e.target.value)} placeholder="e.g. Smart Ring Size M Black" />
            </label>
            <label className="form-field">
              <span>{t.table.nameZh}</span>
              <input value={form.name_zh} onChange={e => set('name_zh', e.target.value)} placeholder="例如 智能戒指 M 码 黑色" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ts.descEn}</span>
              <input value={form.desc_en} onChange={e => set('desc_en', e.target.value)} placeholder="Description" />
            </label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{ts.descZh}</span>
              <input value={form.desc_zh} onChange={e => set('desc_zh', e.target.value)} placeholder="中文描述" />
            </label>
            <label className="form-field">
              <span>{ts.unitEn}</span>
              <input value={form.unit_en} onChange={e => set('unit_en', e.target.value)} placeholder="e.g. pcs, chip, box" />
            </label>
            <label className="form-field">
              <span>{ts.unitZh}</span>
              <input value={form.unit_zh} onChange={e => set('unit_zh', e.target.value)} placeholder="例如 个, 片, 盒" />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.modal.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DeleteSkuConfirm({ sku, onClose, onConfirm }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setBusy(true); setError('');
    try {
      await axios.delete(`/api/skus/${sku.id}`);
      onConfirm();
    } catch (err) {
      setError(err.response?.data?.error || t.store.deleteSkuFailed);
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.store.deleteSkuTitle}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p style={{ color: '#ef4444', fontWeight: 600 }}>{t.store.deleteSkuWarning(sku.sku_code)}</p>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t.store.deleteSkuNote}</p>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>{t.modal.cancel}</button>
          <button className="btn-primary danger" onClick={handleDelete} disabled={busy}>
            {busy ? t.store.deleting : t.store.confirmDelete}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockAdjustModal({ sku: skuProp = null, skus = [], defaultLocationType = 'warehouse', defaultWarehouseName = '', channels = [], onClose, onSave, channelMode = null }) {
  const { t } = useLang();
  const [selectedSkuId, setSelectedSkuId] = useState(skuProp?.id ? String(skuProp.id) : '');
  const sku = skuProp || skus.find(s => String(s.id) === selectedSkuId) || null;
  const [locationType, setLocationType] = useState(channelMode ? 'channel' : defaultLocationType);
  const [channelId, setChannelId] = useState(channelMode ? String(channelMode) : '');
  const [warehouseName, setWarehouseName] = useState(defaultWarehouseName || 'shanghai-central');
  const [quantity, setQuantity] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!sku) { setError(t.store.pleaseSelectSku); return; }
    if (locationType === 'channel' && !channelId) { setError(t.store.pleaseSelectChannel); return; }
    if (locationType === 'warehouse' && !warehouseName.trim()) { setError(t.store.pleaseEnterWarehouse); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        sku_id: sku.id,
        location_type: locationType,
        channel_id: locationType === 'channel' ? parseInt(channelId, 10) : null,
        warehouse_name: locationType === 'warehouse' ? warehouseName : null,
        quantity: quantity !== '' ? parseInt(quantity, 10) : null,
        low_stock_threshold: parseInt(lowStockThreshold, 10) || 0,
      };
      await axios.post('/api/inventory-stock', payload);
      onSave();
    } catch (err) { setError(err.response?.data?.error || t.store.stockFailed); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t.store.adjustStockTitle}</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>{t.store.targetSku}</span>
            {skuProp ? (
              <div className="bold" style={{ fontSize: 16, color: 'var(--primary)', marginTop: 4 }}>{skuProp.sku_code} - {skuProp.name_zh || skuProp.name_en}</div>
            ) : (
              <div className="select-wrap" style={{ width: '100%', marginTop: 6 }}>
                <select value={selectedSkuId} onChange={e => setSelectedSkuId(e.target.value)} className="inline-select" style={{ width: '100%' }}>
                  <option value="">{t.store.selectSkuLabel}</option>
                  {skus.map(s => (
                    <option key={s.id} value={String(s.id)}>{s.sku_code} — {s.name_zh || s.name_en}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="select-chevron" />
              </div>
            )}
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            {!channelMode && (
              <label className="form-field">
                <span>{t.store.locationType}</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={locationType} onChange={e => setLocationType(e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="warehouse">{t.store.centralWarehouse}</option>
                    <option value="channel">{t.store.clinicChannel}</option>
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </label>
            )}

            {locationType === 'channel' && !channelMode ? (
              <label className="form-field">
                <span>{t.store.selectChannel}</span>
                <div className="select-wrap" style={{ width: '100%' }}>
                  <select value={channelId} onChange={e => setChannelId(e.target.value)} className="inline-select" style={{ width: '100%' }}>
                    <option value="">{t.store.chooseChannel}</option>
                    {channels.map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.key_name}</option>
                    ))}
                  </select>
                  <ChevronDown size={11} className="select-chevron" />
                </div>
              </label>
            ) : locationType !== 'channel' ? (
              <label className="form-field">
                <span>{t.store.warehouseName}</span>
                <input value={warehouseName} onChange={e => setWarehouseName(e.target.value)} placeholder="shanghai-central" />
              </label>
            ) : null}

            <label className="form-field">
              <span>{t.store.quantityLabel}</span>
              <input type="number" min="0" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder={t.store.unlimitedStock} />
            </label>

            <label className="form-field">
              <span>{t.store.lowStockThreshold}</span>
              <input type="number" min="0" value={lowStockThreshold} onChange={e => setLowStockThreshold(e.target.value)} />
            </label>
          </div>
          {error && <div className="form-error" style={{ marginTop: 12 }}>{error}</div>}
          <div className="modal-footer" style={{ marginTop: 20 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>{t.modal.cancel}</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              <Check size={14} />{busy ? t.modal.saving : t.store.saveAdjustments}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── OrderStatusSelect (used inline in inventory orders sub-tab) ───────────────

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

function OrderStatusSelect({ orderId, status, onSave }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [showFulfillModal, setShowFulfillModal] = useState(false);
  const [carrier, setCarrier] = useState('SF Express (顺丰速运)');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');
  const [assets, setAssets] = useState('');

  const handleChange = async (e) => {
    const val = e.target.value;
    if (val === 'shipped') {
      setShowFulfillModal(true);
      return;
    }
    setBusy(true);
    try {
      await axios.put(`/api/orders/${orderId}`, { status: val });
      onSave();
    }
    catch { /* silent */ } finally { setBusy(false); }
  };

  const handleShipSubmit = async (e) => {
    e.preventDefault();
    if (!tracking.trim()) {
      alert('Tracking number is required');
      return;
    }
    setBusy(true);
    try {
      await axios.put(`/api/orders/${orderId}`, {
        status: 'shipped',
        shipping_carrier: carrier,
        tracking_number: tracking.trim(),
        fulfillment_notes: notes.trim() || null,
        fulfilled_assets: assets.trim() ? assets.split(',').map(s => s.trim()) : null
      });
      setShowFulfillModal(false);
      onSave();
    } catch {
      alert('Failed to update shipment details');
    } finally {
      setBusy(false);
    }
  };

  const color = { pending: '#f59e0b', confirmed: '#3b82f6', shipped: '#8b5cf6', delivered: '#10b981', cancelled: '#94a3b8' }[status] || '#94a3b8';

  return (
    <div className="select-wrap">
      <select value={status} onChange={handleChange} disabled={busy} className="inline-select" style={{ color }}>
        {ORDER_STATUSES.map(s => <option key={s} value={s}>{t.store[s]}</option>)}
      </select>
      <ChevronDown size={11} className="select-chevron" />

      {showFulfillModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, color: '#1e293b'
        }}>
          <div style={{
            background: '#ffffff', width: '420px', borderRadius: '16px',
            padding: '24px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            border: '1px solid rgba(226, 232, 240, 0.8)'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a', marginBottom: '16px' }}>Fulfill & Ship Order</h3>
            <form onSubmit={handleShipSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Shipping Carrier *</label>
                <input
                  type="text"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="e.g. SF Express (顺丰速运)"
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Tracking Number *</label>
                <input
                  type="text"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  placeholder="Enter courier barcode/tracking number"
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                  required
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Physical Asset Codes (Optional)</label>
                <input
                  type="text"
                  value={assets}
                  onChange={(e) => setAssets(e.target.value)}
                  placeholder="e.g., KNC12345678-0001 (comma separated)"
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Fulfillment Notes (Optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any internal shipping notes..."
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none', minHeight: '60px', resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowFulfillModal(false)}
                  disabled={busy}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', background: '#6375EC', color: '#ffffff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(99, 117, 236, 0.2)' }}
                >
                  {busy ? 'Processing...' : 'Confirm Shipment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── InventoryTab ──────────────────────────────────────────────────────────────

export default function InventoryTab({ channels, session, isSuperadmin }) {
  const { t } = useLang();
  const ti = t.inventory;
  const [selectedChannelId, setSelectedChannelId] = useState(
    isSuperadmin ? '' : (session?.channelId || '')
  );
  const [subTab, setSubTab] = useState('items');
  const [items, setItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [localSkus, setLocalSkus] = useState([]);
  const [localStock, setLocalStock] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [warehouseModal, setWarehouseModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  const selectedChannel = channels.find(c => String(c.id) === String(selectedChannelId));
  // Channels with a GCN sector manage their own SKU/inventory/shipping entirely in
  // GCN — nano's native inventory UI is inert for them (see CLAUDE.md §19). Applies
  // to whoever is viewing that channel here, superadmin or the channel's own admin.
  const isGcnLinked = GCN_LINKED_CHANNEL_KEYS.has(selectedChannel?.key_name);

  useEffect(() => {
    if (isSuperadmin && !selectedChannelId && channels.length) {
      setSelectedChannelId(String(channels[0].id));
    }
  }, [isSuperadmin, channels, selectedChannelId]);

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await axios.get('/api/warehouses');
      setWarehouses(res.data.warehouses || []);
    } catch { setWarehouses([]); }
  }, []);

  const fetchItems = useCallback(async (cid) => {
    if (!cid) return;
    setLoading(true);
    try {
      const [itemsRes, ordersRes, skusRes, stockRes] = await Promise.allSettled([
        axios.get(`/api/channel-inventory?channel_id=${cid}`),
        axios.get(`/api/orders?channel_id=${cid}`),
        axios.get('/api/skus'),
        axios.get('/api/inventory-stock'),
      ]);
      setItems(itemsRes.status === 'fulfilled' ? (itemsRes.value.data.items || []) : []);
      setOrders(ordersRes.status === 'fulfilled' ? (ordersRes.value.data.orders || []) : []);
      setLocalSkus(skusRes.status === 'fulfilled' ? (skusRes.value.data.skus || []) : []);
      setLocalStock(stockRes.status === 'fulfilled' ? (stockRes.value.data.inventory || []) : []);
    } catch { setItems([]); setOrders([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWarehouses(); }, [fetchWarehouses]);

  useEffect(() => {
    if (isGcnLinked) return;
    fetchItems(selectedChannelId);
  }, [selectedChannelId, fetchItems, isGcnLinked]);

  const closeAndRefresh = () => { setModal(null); fetchItems(selectedChannelId); };

  const ownSkus = localSkus.filter(s => String(s.channel_id) === String(selectedChannelId));

  const warehouseStock = localStock.filter(s => s.location_type === 'warehouse');
  const warehouseNames = [...new Set(warehouseStock.map(s => s.warehouse_name).filter(Boolean))].sort();
  const [expandedWarehouse, setExpandedWarehouse] = useState(null);
  const [expandedSkuId, setExpandedSkuId] = useState(null);

  const activeCount   = items.filter(i => i.active).length;
  const physicalCount = items.filter(i => i.item_type === 'physical').length;
  const virtualCount  = items.filter(i => i.item_type === 'virtual').length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  const revenue       = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.price_cny) * o.quantity, 0);

  return (
    <>
      {isSuperadmin && (
        <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Archive size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
          <div className="select-wrap">
            <select
              value={selectedChannelId}
              onChange={e => { setSelectedChannelId(e.target.value); setItems([]); setOrders([]); }}
              className="inline-select"
              style={{ minWidth: 200 }}
            >
              <option value="">{ti.selectChannelOption}</option>
              {channels.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.key_name}</option>
              ))}
            </select>
            <ChevronDown size={11} className="select-chevron" />
          </div>
          {selectedChannel && (
            <span style={{ color: '#94a3b8', fontSize: 13 }}>
              {selectedChannel.name || selectedChannel.key_name}
            </span>
          )}
        </div>
      )}

      {!selectedChannelId ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
          <Archive size={40} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
          <p>{ti.selectChannel}</p>
        </div>
      ) : isGcnLinked ? (
        <GcnInventoryEmbed channelId={selectedChannelId} />
      ) : (
        <>
          <div className="stat-row">
            <StatCard icon={Box}        label={ti.totalItems}    value={items.length}   color="#6366f1" />
            <StatCard icon={Box}        label={ti.activeItems}   value={activeCount}    color="#10b981" />
            <StatCard icon={Package}    label={ti.totalOrders}   value={orders.length}  color="#3b82f6" />
            <StatCard icon={ShoppingBag} label={ti.pendingOrders} value={pendingOrders} color="#f59e0b" />
          </div>

          <div className="subtab-row">
            <button className={`subtab-btn${subTab === 'items' ? ' active' : ''}`} onClick={() => setSubTab('items')}>
              <Box size={13} />{ti.itemsTab}
            </button>
            <button className={`subtab-btn${subTab === 'skus' ? ' active' : ''}`} onClick={() => setSubTab('skus')}>
              <Layers size={13} />{ti.skusTab}
            </button>
            <button className={`subtab-btn${subTab === 'orders' ? ' active' : ''}`} onClick={() => setSubTab('orders')}>
              <Package size={13} />{ti.ordersTab} {pendingOrders > 0 && <span style={{ background: '#f59e0b', color: '#000', borderRadius: 10, padding: '1px 6px', fontSize: 11, marginLeft: 4 }}>{pendingOrders}</span>}
            </button>
            {(isSuperadmin || session?.canManageWarehouses) && (
              <button className={`subtab-btn${subTab === 'warehouses' ? ' active' : ''}`} onClick={() => setSubTab('warehouses')}>
                <Building2 size={13} />{t.store.warehousesTab}
              </button>
            )}
          </div>

          {subTab === 'items' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
                <button className="btn-secondary" onClick={() => setModal({ type: 'import-from-store' })}>
                  <ShoppingBag size={13} />{ti.importFromStore}
                </button>
                {(isSuperadmin || session?.canCustomizeStore) && (
                  <button className="btn-primary" onClick={() => setModal({ type: 'add' })}>
                    <Plus size={13} />{ti.addItem}
                  </button>
                )}
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t.topbar.loading}</div>
              ) : items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                  <Box size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
                  <p>{ti.noItems}</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}></th>
                        <th>{ti.itemName}</th>
                        <th>{ti.itemType}</th>
                        <th>{ti.source}</th>
                        <th>{ti.priceCny}</th>
                        <th>{ti.priceCredits}</th>
                        <th>{ti.stock}</th>
                        <th>{ti.active}</th>
                        <th>{ti.inStore}</th>
                        <th style={{ width: 80 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id}>
                          <td>
                            {item.image_url
                              ? <img src={item.image_url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />
                              : <div style={{ width: 40, height: 40, borderRadius: 6, background: 'rgba(99,117,236,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Box size={16} style={{ color: '#6366f1', opacity: 0.5 }} /></div>
                            }
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{item.name_zh || item.name_en || item.key_name}</div>
                            {item.name_zh && item.name_en && <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.name_en}</div>}
                            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{item.key_name}</div>
                          </td>
                          <td>
                            <Badge color={item.item_type === 'virtual' ? '#8b5cf6' : '#3b82f6'}>
                              {item.item_type === 'virtual' ? ti.virtual : ti.physical}
                            </Badge>
                          </td>
                          <td>
                            <Badge color={item.store_item_id ? '#6366f1' : '#475569'}>
                              {item.store_item_id ? ti.sourceStore : ti.sourceCustom}
                            </Badge>
                          </td>
                          <td>
                            {item.price_cny != null ? `¥${Number(item.price_cny).toFixed(2)}` : '—'}
                          </td>
                          <td style={{ color: '#10b981', fontWeight: 600 }}>
                            {item.price_credits != null ? `${item.price_credits} pts` : '—'}
                          </td>
                          <td>
                            {item.stock_quantity != null ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                {item.stock_quantity}
                                {item.stock_quantity > 0 && item.stock_quantity < 10 && (
                                  <Badge color="#f59e0b">{ti.stockLow}</Badge>
                                )}
                                {item.stock_quantity === 0 && (
                                  <Badge color="#ef4444">{ti.stockOut}</Badge>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: '#64748b' }}>{ti.stockUnlimited}</span>
                            )}
                          </td>
                          <td>
                            <Badge color={item.active ? '#10b981' : '#64748b'}>
                              {item.active ? ti.yes : ti.no}
                            </Badge>
                          </td>
                          <td>
                            <Badge color={item.show_in_store ? '#10b981' : '#475569'}>
                              {item.show_in_store ? ti.inStoreLive : ti.inStoreHidden}
                            </Badge>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="icon-btn" title={ti.editItem} onClick={() => setModal({ type: 'edit', item })}>
                                <Pencil size={14} />
                              </button>
                              <button className="icon-btn" title={ti.deleteItem} style={{ color: '#f87171' }} onClick={() => setModal({ type: 'delete', item })}>
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
            </>
          )}

          {subTab === 'skus' && (
            <div className="card">
              <div className="table-toolbar">
                <span className="table-count">{ownSkus.length} {t.store.skusRegistered}</span>
                <button className="btn-primary" onClick={() => setModal({ type: 'add-sku' })}>
                  <Plus size={14} />{t.store.addSku}
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t.store.skuCode}</th>
                    <th>{t.table.nameEn}</th>
                    <th>{t.table.nameZh}</th>
                    <th>{t.table.type}</th>
                    <th>{t.store.unit}</th>
                    <th>{t.store.locationStocks}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ownSkus.length === 0 && <tr><td colSpan={7} className="empty-row">{t.store.noSkus}</td></tr>}
                  {(() => {
                    const parentSkus = ownSkus.filter(s => s.is_parent);
                    const childSkus = ownSkus.filter(s => s.parent_sku_id);
                    const standaloneSkus = ownSkus.filter(s => !s.is_parent && !s.parent_sku_id);
                    const rows = [];
                    const renderStocks = (stocks) => (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {stocks.length === 0
                          ? <span className="muted" style={{ fontSize: 11 }}>— {t.store.noStocksConfigured}</span>
                          : stocks.map(st => (
                            <div key={st.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                              <span style={{ padding: '1px 5px', borderRadius: 4, background: st.location_type === 'warehouse' ? '#334155' : 'rgba(99,102,241,0.15)', color: st.location_type === 'warehouse' ? '#e2e8f0' : '#818cf8', fontWeight: 500 }}>
                                {st.location_type === 'warehouse' ? `${t.store.warehouse}: ${st.warehouse_name}` : channels.find(c => String(c.id) === String(st.channel_id))?.name || st.channel_id}
                              </span>
                              <span className="bold" style={{ color: (st.quantity ?? 0) <= (st.low_stock_threshold ?? 0) ? '#ef4444' : '#10b981' }}>
                                {st.quantity === null ? '∞' : `${st.quantity} ${t.store.left}`}
                              </span>
                            </div>
                          ))
                        }
                      </div>
                    );
                    standaloneSkus.forEach(sku => {
                      const stocks = localStock.filter(st => st.sku_id === sku.id);
                      rows.push(
                        <tr key={sku.id}>
                          <td><code className="code-tag">{sku.sku_code}</code></td>
                          <td className="bold">{sku.name_en}</td>
                          <td className="muted">{sku.name_zh}</td>
                          <td><Badge color={sku.item_type === 'physical' ? '#6366f1' : '#10b981'}>{sku.item_type === 'physical' ? t.store.physical : t.store.virtual}</Badge></td>
                          <td>{sku.unit_zh} / {sku.unit_en}</td>
                          <td>{renderStocks(stocks)}</td>
                          <td>
                            <div className="row-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                              <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minHeight: 'auto', height: 24 }} onClick={() => setModal({ type: 'adjust-stock', sku })}>{t.store.adjustStock}</button>
                              <button className="icon-btn" title={t.store.editSku} onClick={() => setModal({ type: 'edit-sku', sku })}><Pencil size={14} /></button>
                              <button className="icon-btn danger" title={t.store.deleteSku} onClick={() => setModal({ type: 'delete-sku', sku })}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                    parentSkus.forEach(parent => {
                      const children = childSkus.filter(c => c.parent_sku_id === parent.id);
                      const isExp = expandedSkuId === parent.id;
                      rows.push(
                        <tr key={parent.id} onClick={() => setExpandedSkuId(isExp ? null : parent.id)} style={{ cursor: 'pointer', background: 'rgba(99,102,241,0.05)' }}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {isExp ? <ChevronUp size={12} style={{ color: '#6366f1', flexShrink: 0 }} /> : <ChevronDown size={12} style={{ color: '#6366f1', flexShrink: 0 }} />}
                              <code className="code-tag">{parent.sku_code}</code>
                              <Badge color="#7c3aed">{t.store.parentBadge}</Badge>
                            </div>
                          </td>
                          <td className="bold">{parent.name_en}</td>
                          <td className="muted">{parent.name_zh}</td>
                          <td><Badge color={parent.item_type === 'physical' ? '#6366f1' : '#10b981'}>{parent.item_type === 'physical' ? t.store.physical : t.store.virtual}</Badge></td>
                          <td>{parent.unit_zh} / {parent.unit_en}</td>
                          <td><span style={{ color: '#94a3b8', fontSize: 12 }}>{children.length} {t.store.variantsCount}</span></td>
                          <td>
                            <div className="row-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                              <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minHeight: 'auto', height: 24 }} onClick={e => { e.stopPropagation(); setModal({ type: 'add-variant-sku', parentSku: parent }); }}>
                                <Plus size={11} />{t.store.addVariant}
                              </button>
                              <button className="icon-btn" title={t.store.editSku} onClick={e => { e.stopPropagation(); setModal({ type: 'edit-sku', sku: parent }); }}><Pencil size={14} /></button>
                              <button className="icon-btn danger" title={t.store.deleteSku} onClick={e => { e.stopPropagation(); setModal({ type: 'delete-sku', sku: parent }); }}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                      if (isExp) {
                        children.forEach(child => {
                          const stocks = localStock.filter(st => st.sku_id === child.id);
                          const attrPairs = child.attributes ? Object.entries(child.attributes) : [];
                          rows.push(
                            <tr key={child.id} style={{ background: 'rgba(99,102,241,0.03)' }}>
                              <td style={{ paddingLeft: 36 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ color: '#475569', fontSize: 12 }}>↳</span>
                                  <code className="code-tag" style={{ fontSize: 11 }}>{child.sku_code}</code>
                                  {attrPairs.map(([k, v]) => (
                                    <span key={k} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(124,58,237,0.15)', color: '#a78bfa' }}>{v}</span>
                                  ))}
                                </div>
                              </td>
                              <td className="bold" style={{ fontSize: 12 }}>{child.name_en}</td>
                              <td className="muted" style={{ fontSize: 12 }}>{child.name_zh}</td>
                              <td><Badge color={child.item_type === 'physical' ? '#6366f1' : '#10b981'}>{child.item_type === 'physical' ? t.store.physical : t.store.virtual}</Badge></td>
                              <td style={{ fontSize: 12 }}>{child.unit_zh} / {child.unit_en}</td>
                              <td>{renderStocks(stocks)}</td>
                              <td>
                                <div className="row-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                                  <button className="btn-secondary" style={{ padding: '4px 8px', fontSize: 11, minHeight: 'auto', height: 24 }} onClick={() => setModal({ type: 'adjust-stock', sku: child })}>{t.store.adjustStock}</button>
                                  <button className="icon-btn" title={t.store.editSku} onClick={() => setModal({ type: 'edit-sku', sku: child })}><Pencil size={14} /></button>
                                  <button className="icon-btn danger" title={t.store.deleteSku} onClick={() => setModal({ type: 'delete-sku', sku: child })}><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      }
                    });
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          )}

          {subTab === 'orders' && (
            <div className="card">
              <div className="table-toolbar">
                <span className="table-count">{t.countOrder(orders.length)}</span>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  {ti.revenueLabel(revenue.toFixed(2))}
                </span>
              </div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>{t.topbar.loading}</div>
              ) : orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
                  <Package size={32} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.4 }} />
                  <p>{t.empty.orders}</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t.table.id}</th>
                      <th>{ti.user}</th>
                      <th>{ti.itemName}</th>
                      <th>{t.store.qty}</th>
                      <th>{ti.priceCny}</th>
                      <th>{t.store.status}</th>
                      <th>{ti.date}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => {
                      const isExpanded = expandedOrderId === o.id;
                      return (
                        <React.Fragment key={o.id}>
                          <tr onClick={() => setExpandedOrderId(isExpanded ? null : o.id)} style={{ cursor: 'pointer' }}>
                            <td><span className="mono muted">{o.id.slice(0, 8)}…</span></td>
                            <td>{fmt(o.nickname || o.user_id)}</td>
                            <td className="bold">{fmt(o.name_zh || o.name_en)}</td>
                            <td>{o.quantity}</td>
                            <td>¥{o.price_cny}</td>
                            <td onClick={(e) => e.stopPropagation()}><OrderStatusSelect orderId={o.id} status={o.status} onSave={() => fetchItems(selectedChannelId)} /></td>
                            <td className="muted">{fmtDate(o.created_at)}</td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} style={{ background: 'rgba(99, 117, 236, 0.03)', padding: '16px 24px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '13px', color: '#64748b' }}>
                                  <div>
                                    <h4 style={{ color: '#0f172a', marginBottom: '8px', fontWeight: 600 }}>{ti.shippingAddress}</h4>
                                    {o.shipping_name ? (
                                      <div>
                                        <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.recipientName}:</strong> {o.shipping_name}</p>
                                        <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.recipientPhone}:</strong> {o.shipping_phone}</p>
                                        <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.recipientAddress}:</strong> {o.shipping_address}</p>
                                      </div>
                                    ) : (
                                      <p style={{ fontStyle: 'italic', margin: '4px 0' }}>{ti.noShippingAddress}</p>
                                    )}
                                  </div>
                                  <div>
                                    <h4 style={{ color: '#0f172a', marginBottom: '8px', fontWeight: 600 }}>{ti.paymentFulfillment}</h4>
                                    <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.paymentMethod}:</strong> {o.payment_method || 'WeChat Pay'}</p>
                                    <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.paymentStatus}:</strong> <span style={{ color: o.payment_status === 'paid' ? '#10b981' : '#f59e0b', fontWeight: 600 }}>{o.payment_status || 'paid'}</span></p>
                                    {o.tracking_number && (
                                      <div style={{ marginTop: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                                        <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.carrier}:</strong> {o.shipping_carrier}</p>
                                        <p style={{ margin: '4px 0' }}><strong style={{ color: '#334155' }}>{ti.trackingNo}:</strong> <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: '#6375EC' }}>{o.tracking_number}</code></p>
                                        {o.shipped_at && <p style={{ margin: '4px 0', fontSize: '11px', color: '#94a3b8' }}>{ti.shippedAt}: {fmtDate(o.shipped_at)}</p>}
                                      </div>
                                    )}
                                    {o.fulfillment_notes && (
                                      <p style={{ margin: '8px 0 4px', fontStyle: 'italic', fontSize: '12px' }}><strong style={{ color: '#334155', fontStyle: 'normal' }}>{ti.orderNotes}:</strong> {o.fulfillment_notes}</p>
                                    )}
                                    {o.fulfilled_assets && (
                                      <p style={{ margin: '4px 0', fontSize: '12px' }}><strong style={{ color: '#334155' }}>{ti.assets}:</strong> {o.fulfilled_assets.join(', ')}</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {subTab === 'warehouses' && (isSuperadmin || session?.canManageWarehouses) && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">
              {warehouses.length} {warehouses.length === 1 ? t.store.warehousesLabel : t.store.warehousesLabelPlural}
            </span>
            {(isSuperadmin || session?.canManageWarehouses) && (
              <button className="btn-primary" onClick={() => setWarehouseModal({ type: 'add' })}>
                <Plus size={14} />{t.inventory.addWarehouse}
              </button>
            )}
          </div>
          {warehouses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
              <Building2 size={36} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>{t.store.noWarehouses}</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t.store.warehouseName}</th>
                  <th>{t.inventory.warehouseAddress}</th>
                  <th>{t.inventory.warehouseStatus}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map(w => (
                  <tr key={w.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Building2 size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
                        <strong style={{ color: '#e2e8f0' }}>{w.name}</strong>
                      </div>
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>{w.address || '—'}</td>
                    <td>
                      <Badge color={w.active ? '#10b981' : '#64748b'}>
                        {w.active ? t.inventory.warehouseActive : t.inventory.warehouseInactive}
                      </Badge>
                    </td>
                    <td>
                      {(isSuperadmin || session?.canManageWarehouses) && (
                        <div className="row-actions" style={{ justifyContent: 'flex-end', gap: 8 }}>
                          <button className="icon-btn" title={t.store.editSku} onClick={() => setWarehouseModal({ type: 'edit', warehouse: w })}><Pencil size={14} /></button>
                          <button className="icon-btn danger" title={t.store.deleteSku} onClick={() => setWarehouseModal({ type: 'delete', warehouse: w })}><Trash2 size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {warehouseModal && (
        <WarehouseModal
          modal={warehouseModal}
          onClose={() => setWarehouseModal(null)}
          onSave={() => { setWarehouseModal(null); fetchWarehouses(); }}
        />
      )}

      {modal?.type === 'add-warehouse-stock' && (
        <StockAdjustModal
          sku={null}
          skus={ownSkus}
          defaultLocationType="warehouse"
          defaultWarehouseName={modal.warehouseName || ''}
          channels={[]}
          onClose={() => setModal(null)}
          onSave={closeAndRefresh}
        />
      )}

      {modal?.type === 'add' && (
        <ChannelInventoryItemModal
          item={modal.prefill || null}
          channelId={selectedChannelId}
          skus={ownSkus}
          onClose={() => setModal(null)}
          onSave={closeAndRefresh}
        />
      )}
      {modal?.type === 'edit' && (
        <ChannelInventoryItemModal
          item={modal.item}
          channelId={selectedChannelId}
          skus={ownSkus}
          onClose={() => setModal(null)}
          onSave={closeAndRefresh}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteInventoryItemConfirm
          item={modal.item}
          onClose={() => setModal(null)}
          onConfirm={closeAndRefresh}
        />
      )}
      {modal?.type === 'add-sku' && (
        <SkuModal sku={null} channelId={selectedChannelId} allSkus={localSkus} onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'edit-sku' && (
        <SkuModal sku={modal.sku} channelId={selectedChannelId} allSkus={localSkus} onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'add-variant-sku' && (
        <SkuModal sku={null} channelId={selectedChannelId} allSkus={localSkus} initialParentSkuId={modal.parentSku?.id || ''} onClose={() => setModal(null)} onSave={closeAndRefresh} />
      )}
      {modal?.type === 'delete-sku' && (
        <DeleteSkuConfirm sku={modal.sku} onClose={() => setModal(null)} onConfirm={closeAndRefresh} />
      )}
      {modal?.type === 'adjust-stock' && (
        <StockAdjustModal
          sku={modal.sku}
          skus={ownSkus}
          channels={channels.filter(c => String(c.id) === String(selectedChannelId))}
          defaultLocationType="channel"
          channelMode={selectedChannelId}
          onClose={() => setModal(null)}
          onSave={closeAndRefresh}
        />
      )}
      {modal?.type === 'import-from-store' && (
        <ImportFromStoreModal
          existingItems={items}
          onClose={() => setModal(null)}
          onSelect={si => setModal({
            type: 'add',
            prefill: {
              key_name: si.key_name,
              name_en: si.name_en,
              name_zh: si.name_zh,
              desc_en: si.desc_en,
              desc_zh: si.desc_zh,
              item_type: 'physical',
              unit_en: si.unit_en,
              unit_zh: si.unit_zh,
              price_cny: si.price_cny ?? '',
              price_usd: si.price_usd ?? '',
              image_url: si.image_url || '',
              tag: si.tag || '',
              sort_order: si.sort_order ?? 0,
              store_item_id: si.id,
              sku_id: si.sku_id || '',
            },
          })}
        />
      )}
    </>
  );
}
