import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Users, Coins, Settings2, Plus, Pencil, Trash2, X, Check, ChevronDown, Store, Link2 } from 'lucide-react';

const GCN_LINKED_CHANNEL_KEYS = new Set(['aeviva', 'aeviva-china']);
import { useLang, fmtDate, StatCard, Badge } from '../shared.jsx';

function PartnersTab({ users = [], session }) {
  const { t } = useLang();
  const p = t.partners;
  const [subTab, setSubTab] = useState('partners');
  const [partners, setPartners] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tierCfg, setTierCfg] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [referrerSearch, setReferrerSearch] = useState('');
  const [commForm, setCommForm] = useState({});
  const [showCommForm, setShowCommForm] = useState(false);
  const [commBusy, setCommBusy] = useState(false);
  const [commError, setCommError] = useState('');

  const [partnerTypes, setPartnerTypes] = useState([]);
  const [config, setConfig] = useState(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState('');
  const [typeForm, setTypeForm] = useState({});
  const [editingType, setEditingType] = useState(null);
  const [showTypeForm, setShowTypeForm] = useState(false);
  const [typeBusy, setTypeBusy] = useState(false);
  const [typeError, setTypeError] = useState('');

  const TIER_KEYS = partnerTypes.map(t => t.key);
  const isGcnManagedEdit = !!editingType?.managed_by_gcn;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requests = [
        axios.get('/api/partners'),
        axios.get('/api/partner-commissions'),
        axios.get('/api/partner-commission-config'),
        axios.get('/api/partner-types'),
      ];
      if (session?.channelId) {
        requests.push(axios.get(`/api/channels/${session.channelId}/partner-tiers-config`));
      }
      const [pRes, cRes, cfgRes, ptRes, tcRes] = await Promise.all(requests);
      setPartners(pRes.data.partners || []);
      setCommissions(cRes.data.commissions || []);
      setConfig(cfgRes.data.config || null);
      setPartnerTypes(ptRes.data.types || []);
      if (tcRes) setTierCfg(tcRes.data.partner_tiers_config || null);
    } finally {
      setLoading(false);
    }
  }, [session?.channelId]);

  function setReferralRate(upline, newTier, val) {
    setConfig(c => ({
      ...c,
      referral_rates: {
        ...c.referral_rates,
        [upline]: { ...c.referral_rates[upline], [newTier]: val === '' ? '' : Number(val) / 100 },
      },
    }));
  }

  function setDiscountRate(field, tier, val) {
    setConfig(c => ({
      ...c,
      [field]: { ...c[field], [tier]: val === '' ? '' : Number(val) / 100 },
    }));
  }

  async function saveConfig() {
    setConfigBusy(true); setConfigMsg('');
    try {
      await axios.put('/api/partner-commission-config', config);
      setConfigMsg(p.rulesSaved);
      setTimeout(() => setConfigMsg(''), 3000);
    } catch {
      setConfigMsg(p.saveFailed);
    } finally {
      setConfigBusy(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  const tierLabel = (tier) => tierCfg?.[tier]?.label || partnerTypes.find(t => t.key === tier)?.label_zh || partnerTypes.find(t => t.key === tier)?.label || tier;
  const tierColor = (tier) => tierCfg?.[tier]?.color || partnerTypes.find(t => t.key === tier)?.color || '#64748b';
  const statusColor = (s) => ({ active: '#16a34a', pending: '#f59e0b', inactive: '#94a3b8', draft: '#64748b', approved: '#2563eb', transferred: '#16a34a' }[s] || '#64748b');
  const statusLabel = (s) => ({ active: p.statusActive, pending: p.statusPending, inactive: p.statusInactive, draft: p.draft, approved: p.approved, transferred: p.transferred }[s] || s);
  const sourceLabel = (s) => ({ referral: p.typeReferral, sales: p.typeSales, team_primary: p.typeTeamPrimary, team_secondary: p.typeTeamSecondary, wholesale_margin: p.typeWholesale }[s] || s);

  function openAddType() { setEditingType(null); setTypeForm({ color: '#64748b', sort_order: partnerTypes.length + 1, entry_fee: 0 }); setTypeError(''); setShowTypeForm(true); }
  function openEditType(t) { setEditingType(t); setTypeForm({ ...t }); setTypeError(''); setShowTypeForm(true); }

  async function savePartnerType() {
    if (!typeForm.key && !editingType) { setTypeError(p.keyRequired); return; }
    if (!typeForm.label) { setTypeError(p.labelRequired); return; }
    setTypeBusy(true); setTypeError('');
    try {
      if (editingType) await axios.put(`/api/partner-types/${editingType.key}`, typeForm);
      else await axios.post('/api/partner-types', typeForm);
      setShowTypeForm(false);
      await load();
    } catch (err) { setTypeError(err.response?.data?.error || 'Save failed'); }
    finally { setTypeBusy(false); }
  }

  async function deactivatePartnerType(key) {
    if (!confirm(p.confirmDeactivateType(key))) return;
    try {
      await axios.delete(`/api/partner-types/${key}`);
      await load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  }

  function openAdd() { setEditing(null); setForm({ status: 'active' }); setFormError(''); setUserSearch(''); setReferrerSearch(''); setShowForm(true); }
  function openEdit(partner) { setEditing(partner); setForm({ ...partner }); setFormError(''); setReferrerSearch(''); setShowForm(true); }

  async function savePartner() {
    if (!editing && !form.user_id) { setFormError('A linked user is required'); return; }
    if (!form.real_name) { setFormError(p.realNameRequired); return; }
    if (!form.phone)     { setFormError(p.phoneRequired);    return; }
    if (!form.tier)      { setFormError(p.tierRequired);     return; }
    if (!form.entry_fee_paid) { setFormError(p.entryFeeRequired); return; }
    setFormBusy(true); setFormError('');
    try {
      if (editing) {
        const res = await axios.put(`/api/partners/${editing.id}`, form);
        if (res.data?.gcnSyncError) alert(`Saved, but GCN re-sync failed: ${res.data.gcnSyncError}`);
      } else {
        await axios.post('/api/partners', form);
      }
      setShowForm(false);
      await load();
    } catch (err) { setFormError(err.response?.data?.error || p.saveFailed); }
    finally { setFormBusy(false); }
  }

  async function deactivatePartner(id) {
    if (!confirm(p.confirmDeactivate)) return;
    try {
      const res = await axios.delete(`/api/partners/${id}`);
      if (res.data?.gcnSyncError) alert(`Deactivated, but GCN re-sync failed: ${res.data.gcnSyncError}`);
      await load();
    } catch { alert(p.saveFailed); }
  }

  const [provisioningId, setProvisioningId] = useState(null);

  async function provisionGcnStore(id) {
    setProvisioningId(id);
    try {
      await axios.post(`/api/partners/${id}/gcn-provision`);
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || p.saveFailed);
    } finally {
      setProvisioningId(null);
    }
  }

  const [inviteLinkId, setInviteLinkId] = useState(null);

  // Same GCN-domain-detection pattern as GcnInventoryEmbed.jsx, but pointed at the
  // aeviva(-dev).gcn.net sector domain rather than edge(-dev).gcn.net, since this link is
  // meant to be shared externally (WeChat message, etc.) and opened in a normal browser.
  async function generateInviteLink(id) {
    setInviteLinkId(id);
    try {
      const res = await axios.post(`/api/partners/${id}/invite-code`);
      const host = window.location.hostname.includes('nano-dev') ? 'https://aeviva-dev.gcn.net' : 'https://aeviva.gcn.net';
      const url = `${host}/partner-apply.html?code=${res.data.invite_code}`;
      try { await navigator.clipboard.writeText(url); } catch {}
      alert(`${p.inviteLinkCopied}\n${url}`);
    } catch (err) {
      alert(err?.response?.data?.error || p.saveFailed);
    } finally {
      setInviteLinkId(null);
    }
  }

  async function saveCommission() {
    if (!commForm.partner_id || !commForm.source_type || !commForm.amount_cny) { setCommError(p.saveFailed); return; }
    setCommBusy(true); setCommError('');
    try {
      await axios.post('/api/partner-commissions', commForm);
      setShowCommForm(false);
      setCommForm({});
      await load();
    } catch (err) { setCommError(err.response?.data?.error || p.saveFailed); }
    finally { setCommBusy(false); }
  }

  const activeCount = partners.filter(pt => pt.status === 'active').length;
  const totalEarned = commissions.reduce((sum, c) => sum + Number(c.amount_cny || 0), 0);

  const TIERS = partnerTypes.filter(t => t.is_active).map(t => ({ value: t.key, label: t.label_zh || t.label }));
  const SOURCE_TYPES = [
    { value: 'referral', label: p.typeReferral },
    { value: 'sales', label: p.typeSales },
    { value: 'team_primary', label: p.typeTeamPrimary },
    { value: 'team_secondary', label: p.typeTeamSecondary },
    { value: 'wholesale_margin', label: p.typeWholesale },
  ];

  return (
    <>
      <div className="stat-row">
        <StatCard icon={Users}  label={p.totalPartners}  value={partners.length}               color="#6366f1" />
        <StatCard icon={Users}  label={p.activePartners} value={activeCount}                   color="#16a34a" />
        <StatCard icon={Coins}  label={p.totalEarned}    value={`¥${totalEarned.toFixed(0)}`} color="#10b981" />
      </div>

      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'partners' ? ' active' : ''}`} onClick={() => setSubTab('partners')}>
          <Users size={13} /> {p.partnersTab}
        </button>
        <button className={`subtab-btn${subTab === 'commissions' ? ' active' : ''}`} onClick={() => setSubTab('commissions')}>
          <Coins size={13} /> {p.commissionsTab}
        </button>
        <button className={`subtab-btn${subTab === 'rules' ? ' active' : ''}`} onClick={() => setSubTab('rules')}>
          <Settings2 size={13} /> {p.rulesTab}
        </button>
        <button className={`subtab-btn${subTab === 'types' ? ' active' : ''}`} onClick={() => setSubTab('types')}>
          <Users size={13} /> {p.typesTab}
        </button>
      </div>

      {loading && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}

      {!loading && subTab === 'partners' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{partners.length} partner{partners.length !== 1 ? 's' : ''}</span>
            <button className="btn-primary" onClick={openAdd}><Plus size={13} />{p.addPartner}</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th><th>{p.realName}</th><th>{p.tier}</th><th>{p.status}</th>
                <th>{p.channel}</th><th>{p.upline}</th><th>{p.totalCommissions}</th>
                <th>{p.entryFee}</th><th>{p.contractedAt}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 && <tr><td colSpan={10} className="empty-row">{p.noPartners}</td></tr>}
              {partners.map(pt => (
                <tr key={pt.id}>
                  <td className="muted">{pt.id}</td>
                  <td className="bold">{pt.real_name}</td>
                  <td><Badge color={tierColor(pt.tier)}>{tierLabel(pt.tier)}</Badge></td>
                  <td><Badge color={statusColor(pt.status)}>{statusLabel(pt.status)}</Badge></td>
                  <td>{pt.channel_name || <span className="muted">—</span>}</td>
                  <td>{pt.upline_name ? <span>{pt.upline_name} <Badge color={tierColor(pt.upline_tier)} style={{ fontSize: 10 }}>{tierLabel(pt.upline_tier)}</Badge></span> : <span className="muted">—</span>}</td>
                  <td className="bold">¥{Number(pt.total_commissions_cny || 0).toFixed(2)}</td>
                  <td>¥{Number(pt.entry_fee_paid).toFixed(0)}</td>
                  <td className="muted">{fmtDate(pt.contracted_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={p.editPartner} onClick={() => openEdit(pt)}><Pencil size={14} /></button>
                      {pt.status !== 'inactive' &&
                        <button className="icon-btn" title={p.deactivatePartner} onClick={() => deactivatePartner(pt.id)}><Trash2 size={14} /></button>}
                      {GCN_LINKED_CHANNEL_KEYS.has(pt.channel_key) && (
                        pt.gcn_partner_id
                          ? <Badge color="green" title={p.gcnProvisioned}>{p.gcnProvisioned}</Badge>
                          : <button
                              className="icon-btn"
                              title={p.provisionGcnStore}
                              disabled={pt.status !== 'active' || provisioningId === pt.id}
                              onClick={() => provisionGcnStore(pt.id)}
                            ><Store size={14} /></button>
                      )}
                      {pt.status === 'active' && (
                        <button
                          className="icon-btn"
                          title={p.inviteLink}
                          disabled={inviteLinkId === pt.id}
                          onClick={() => generateInviteLink(pt.id)}
                        ><Link2 size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'commissions' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{commissions.length} commission{commissions.length !== 1 ? 's' : ''}</span>
            <button className="btn-primary" onClick={() => setShowCommForm(true)}><Plus size={13} />{p.addCommission}</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>{p.partnerName}</th><th>{p.sourceType}</th><th>{p.amount}</th>
                <th>{p.rate}</th><th>{p.baseAmount}</th><th>{p.description}</th><th>{p.status}</th><th>{p.date}</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 && <tr><td colSpan={8} className="empty-row">{p.noCommissions}</td></tr>}
              {commissions.map(c => (
                <tr key={c.id}>
                  <td className="bold">{c.partner_name || c.partner_id}</td>
                  <td><Badge color="#6366f1">{sourceLabel(c.source_type)}</Badge></td>
                  <td className="bold">¥{Number(c.amount_cny).toFixed(2)}</td>
                  <td className="muted">{c.rate != null ? `${(c.rate * 100).toFixed(0)}%` : '—'}</td>
                  <td className="muted">{c.base_amount != null ? `¥${Number(c.base_amount).toFixed(0)}` : '—'}</td>
                  <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.description || '—'}</td>
                  <td><Badge color={statusColor(c.status)}>{statusLabel(c.status)}</Badge></td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'types' && (
        <div className="card">
          <div className="table-toolbar">
            <span className="table-count">{p.countTypes(partnerTypes.length)}</span>
            <button className="btn-primary" onClick={openAddType}><Plus size={13} />{p.addType}</button>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>{p.typeKey}</th><th>{p.typeLabel}</th><th>{p.typeLabelZh}</th><th>{p.typeColor}</th><th>{p.typeEntryFee}</th><th>{p.typeSort}</th><th>{p.status}</th><th></th></tr>
            </thead>
            <tbody>
              {partnerTypes.length === 0 && <tr><td colSpan={8} className="empty-row">{p.noTypes}</td></tr>}
              {partnerTypes.map(t => (
                <tr key={t.key}>
                  <td>
                    <code className="code-tag">{t.key}</code>
                    {t.managed_by_gcn && (
                      <span
                        className="badge"
                        title={p.typeManagedByGcnNote}
                        style={{ background: '#2563eb1a', color: '#2563eb', marginLeft: 6 }}
                      >
                        {p.typeManagedByGcn}
                      </span>
                    )}
                  </td>
                  <td className="bold"><Badge color={t.color || '#64748b'}>{t.label}</Badge></td>
                  <td>{t.label_zh || <span className="muted">—</span>}</td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: t.color, border: '1px solid rgba(255,255,255,0.2)', display: 'inline-block' }} />{t.color}</span></td>
                  <td>¥{Number(t.entry_fee || 0).toLocaleString()}</td>
                  <td className="muted">{t.sort_order}</td>
                  <td><Badge color={t.is_active ? '#16a34a' : '#94a3b8'}>{t.is_active ? p.typeActive : p.typeInactive}</Badge></td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={p.editType} onClick={() => openEditType(t)}><Pencil size={14} /></button>
                      {t.is_active && !t.managed_by_gcn && <button className="icon-btn" title={p.deactivatePartner} onClick={() => deactivatePartnerType(t.key)}><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && subTab === 'rules' && config && (
        <div className="card" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{p.rulesTitle}</h3>
          </div>
          {/* Phase 5 of gcn's partner-system-consolidation-roadmap.md, 2026-08-09: GCN now
              computes and pays aeviva commissions itself, using its own copy of this same rate
              data — nano's recordReferralCommission/recordSalesCommission (the only code that
              ever read this config) are disabled. Editing here would silently do nothing to real
              payouts, so this whole tab is now read-only-for-reference rather than a live editor. */}
          <div style={{ fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
            {p.rulesDeprecatedNote}
          </div>

          {/* Referral matrix */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.referralMatrix}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{p.referralHint}</div>
            <table className="data-table" style={{ width: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 130 }}>{p.uplineTier} / {p.newTier}</th>
                  {TIER_KEYS.map(tk => <th key={tk} style={{ minWidth: 120 }}>{tierLabel(tk)}</th>)}
                </tr>
              </thead>
              <tbody>
                {TIER_KEYS.map(upline => (
                  <tr key={upline}>
                    <td className="bold">{tierLabel(upline)}</td>
                    {TIER_KEYS.map(newTier => (
                      <td key={newTier}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input type="number" min="0" max="100" step="1" disabled
                            value={config.referral_rates?.[upline]?.[newTier] != null ? Math.round(Number(config.referral_rates[upline][newTier]) * 100) : ''}
                            onChange={e => setReferralRate(upline, newTier, e.target.value)}
                            style={{ width: 60, textAlign: 'right' }} />
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>%</span>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Product & training discount rates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28, marginBottom: 28 }}>
            {[
              { field: 'product_discount_rates', label: p.productDiscounts, hint: p.productHint },
              { field: 'training_discount_rates', label: p.trainingDiscounts, hint: p.trainingHint },
            ].map(({ field, label, hint }) => (
              <div key={field}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{hint}</div>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
                  {TIER_KEYS.map(tk => (
                    <label className="form-field" key={tk}>
                      <span>{tierLabel(tk)}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min="0" max="100" step="1" disabled
                          value={config[field]?.[tk] != null ? Math.round(Number(config[field][tk]) * 100) : ''}
                          onChange={e => setDiscountRate(field, tk, e.target.value)}
                          style={{ width: 80, textAlign: 'right' }} />
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>%</span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Team income rates */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.teamIncome}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{p.teamHint}</div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                { key: 'team_primary_rate', label: p.teamPrimary },
                { key: 'team_secondary_rate', label: p.teamSecondary },
              ].map(({ key, label }) => (
                <label className="form-field" key={key}>
                  <span>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="0" max="100" step="0.1" disabled
                      value={config[key] != null ? Number((Number(config[key]) * 100).toFixed(1)) : ''}
                      onChange={e => setConfig(c => ({ ...c, [key]: e.target.value === '' ? '' : Number(e.target.value) / 100 }))}
                      style={{ width: 80, textAlign: 'right' }} />
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>%</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {showTypeForm && (
        <div className="modal-overlay" onClick={() => setShowTypeForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editingType ? p.editType : p.addType}</span>
              <button className="icon-btn" onClick={() => setShowTypeForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); savePartnerType(); }}>
              <div className="modal-body">
                {isGcnManagedEdit && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>{p.typeManagedByGcnNote}</div>}
                <div className="form-grid">
                  {!editingType && (
                    <label className="form-field">
                      <span>{p.typeKeyLabel}</span>
                      <input value={typeForm.key || ''} onChange={e => setTypeForm(f => ({ ...f, key: e.target.value }))} placeholder="e.g. gold_partner" />
                    </label>
                  )}
                  {editingType && isGcnManagedEdit ? (
                    <label className="form-field">
                      <span>{p.typeKey}</span>
                      <code className="code-tag">{typeForm.key}</code>
                    </label>
                  ) : null}
                  <label className="form-field">
                    <span>{p.typeLabelEn}</span>
                    {isGcnManagedEdit
                      ? <span>{typeForm.label}</span>
                      : <input value={typeForm.label || ''} onChange={e => setTypeForm(f => ({ ...f, label: e.target.value }))} />}
                  </label>
                  <label className="form-field">
                    <span>{p.typeLabelZh}</span>
                    {isGcnManagedEdit
                      ? <span>{typeForm.label_zh || <span className="muted">—</span>}</span>
                      : <input value={typeForm.label_zh || ''} onChange={e => setTypeForm(f => ({ ...f, label_zh: e.target.value }))} />}
                  </label>
                  <label className="form-field">
                    <span>{p.typeColor}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={typeForm.color || '#64748b'} onChange={e => setTypeForm(f => ({ ...f, color: e.target.value }))} style={{ width: 36, height: 32, padding: 2, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer' }} />
                      <input value={typeForm.color || ''} onChange={e => setTypeForm(f => ({ ...f, color: e.target.value }))} placeholder="#64748b" style={{ flex: 1 }} />
                    </div>
                  </label>
                  <label className="form-field">
                    <span>{p.typeEntryFee}</span>
                    {isGcnManagedEdit
                      ? <span>{typeForm.entry_fee}</span>
                      : <input type="number" min="0" value={typeForm.entry_fee ?? ''} onChange={e => setTypeForm(f => ({ ...f, entry_fee: e.target.value === '' ? 0 : Number(e.target.value) }))} />}
                  </label>
                  <label className="form-field">
                    <span>{p.typeSort}</span>
                    <input type="number" value={typeForm.sort_order ?? ''} onChange={e => setTypeForm(f => ({ ...f, sort_order: Number(e.target.value) }))} />
                  </label>
                  <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                    <span>{p.typeDesc}</span>
                    <input value={typeForm.description || ''} onChange={e => setTypeForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%' }} />
                  </label>
                  {editingType && (
                    <label className="form-field" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <input type="checkbox" checked={!!typeForm.is_active} disabled={isGcnManagedEdit} onChange={e => setTypeForm(f => ({ ...f, is_active: e.target.checked }))} />
                      <span>{p.typeActive}</span>
                    </label>
                  )}
                </div>
                {typeError && <div className="form-error">{typeError}</div>}
              </div>
              <div className="modal-footer" style={{ padding: '12px 20px 16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowTypeForm(false)} disabled={typeBusy}>{t.modal.cancel}</button>
                <button type="submit" className="btn-primary" disabled={typeBusy}>
                  <Check size={14} />{typeBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{editing ? p.editPartner : p.addPartner}</span>
              <button className="icon-btn" onClick={() => setShowForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); savePartner(); }}>
              <div className="modal-body" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
                <div className="form-grid">
                  {!editing && (() => {
                    const selectedUser = users.find(u => u.user_id === form.user_id) || null;
                    const filteredUsers = userSearch.trim().length > 0
                      ? users.filter(u => {
                          const q = userSearch.toLowerCase();
                          return (u.nickname || '').toLowerCase().includes(q) || (u.user_id || '').toLowerCase().includes(q);
                        }).slice(0, 8)
                      : [];
                    return (
                      <div className="form-field" style={{ gridColumn: '1 / -1', position: 'relative' }}>
                        <span>Linked User *</span>
                        {selectedUser ? (
                          <div className="coach-user-selected">
                            <div className="avatar" style={{ background: '#6366f120', color: '#6366f1', width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>{(selectedUser.nickname || 'U')[0].toUpperCase()}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600 }}>{selectedUser.nickname || '—'}</div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{selectedUser.user_id}</div>
                            </div>
                            <button type="button" className="icon-btn" onClick={() => { setForm(f => ({ ...f, user_id: null, real_name: '', phone: '' })); setUserSearch(''); }}><X size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <input
                              value={userSearch}
                              onChange={e => setUserSearch(e.target.value)}
                              placeholder="Search by nickname or user ID…"
                              autoComplete="off"
                            />
                            {filteredUsers.length > 0 && (
                              <div className="coach-user-dropdown">
                                {filteredUsers.map(u => (
                                  <div key={u.user_id} className="coach-user-option" onClick={() => {
                                    setForm(f => ({ ...f, user_id: u.user_id, real_name: f.real_name || u.nickname || '', phone: f.phone || u.phone || '' }));
                                    setUserSearch('');
                                  }}>
                                    <div className="avatar" style={{ background: '#6366f120', color: '#6366f1', width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>{(u.nickname || 'U')[0].toUpperCase()}</div>
                                    <div>
                                      <div style={{ fontWeight: 500 }}>{u.nickname || '—'}</div>
                                      <div style={{ fontSize: 11, color: '#64748b' }}>{u.user_id}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <label className="form-field">
                    <span>{p.realName}</span>
                    <input value={form.real_name || ''} onChange={e => setForm(f => ({ ...f, real_name: e.target.value }))} />
                  </label>
                  <label className="form-field">
                    <span>{p.phone}</span>
                    <input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                  </label>
                  <label className="form-field">
                    <span>{p.tier}</span>
                    {form.tier_managed_by_gcn ? (
                      <div>
                        <code className="code-tag">{form.tier}</code>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{p.tierManagedByGcnNote}</div>
                      </div>
                    ) : (
                      <div className="select-wrap" style={{ width: '100%' }}>
                        <select value={form.tier || ''} onChange={e => setForm(f => ({ ...f, tier: e.target.value }))} className="inline-select" style={{ width: '100%' }}>
                          <option value="">—</option>
                          {TIERS.map(tier => <option key={tier.value} value={tier.value}>{tier.label}</option>)}
                        </select>
                        <ChevronDown size={11} className="select-chevron" />
                      </div>
                    )}
                  </label>
                  <label className="form-field">
                    <span>{p.entryFee}</span>
                    <input type="number" value={form.entry_fee_paid || ''} onChange={e => setForm(f => ({ ...f, entry_fee_paid: e.target.value }))} />
                  </label>
                  {(() => {
                    const selectedReferrer = partners.find(pt => pt.id === Number(form.referred_by_partner_id)) || null;
                    const filteredReferrers = referrerSearch.trim().length > 0
                      ? partners.filter(pt => {
                          if (editing && pt.id === editing.id) return false;
                          const q = referrerSearch.toLowerCase();
                          return (pt.real_name || '').toLowerCase().includes(q) || (pt.phone || '').toLowerCase().includes(q) || String(pt.id).includes(q);
                        }).slice(0, 8)
                      : [];
                    return (
                      <div className="form-field" style={{ gridColumn: '1 / -1', position: 'relative' }}>
                        <span>{p.referredBy}</span>
                        {selectedReferrer ? (
                          <div className="coach-user-selected">
                            <div className="avatar" style={{ background: '#6366f120', color: '#6366f1', width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>{(selectedReferrer.real_name || 'U')[0].toUpperCase()}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600 }}>{selectedReferrer.real_name} <Badge color={tierColor(selectedReferrer.tier)} style={{ fontSize: 10 }}>{tierLabel(selectedReferrer.tier)}</Badge></div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>#{selectedReferrer.id} · {selectedReferrer.phone || '—'}</div>
                            </div>
                            <button type="button" className="icon-btn" onClick={() => { setForm(f => ({ ...f, referred_by_partner_id: null })); setReferrerSearch(''); }}><X size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <input
                              value={referrerSearch}
                              onChange={e => setReferrerSearch(e.target.value)}
                              placeholder="Search by name, phone or ID…"
                              autoComplete="off"
                            />
                            {filteredReferrers.length > 0 && (
                              <div className="coach-user-dropdown">
                                {filteredReferrers.map(pt => (
                                  <div key={pt.id} className="coach-user-option" onClick={() => {
                                    setForm(f => ({ ...f, referred_by_partner_id: pt.id }));
                                    setReferrerSearch('');
                                  }}>
                                    <div className="avatar" style={{ background: '#6366f120', color: '#6366f1', width: 24, height: 24, fontSize: 11, flexShrink: 0 }}>{(pt.real_name || 'U')[0].toUpperCase()}</div>
                                    <div>
                                      <div style={{ fontWeight: 500 }}>{pt.real_name} <Badge color={tierColor(pt.tier)} style={{ fontSize: 10 }}>{tierLabel(pt.tier)}</Badge></div>
                                      <div style={{ fontSize: 11, color: '#64748b' }}>#{pt.id} · {pt.phone || '—'}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <label className="form-field">
                    <span>{p.status}</span>
                    <div className="select-wrap" style={{ width: '100%' }}>
                      <select value={form.status || 'active'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="inline-select" style={{ width: '100%' }}>
                        <option value="active">{p.statusActive}</option>
                        <option value="pending">{p.statusPending}</option>
                        <option value="inactive">{p.statusInactive}</option>
                      </select>
                      <ChevronDown size={11} className="select-chevron" />
                    </div>
                  </label>
                  <label className="form-field">
                    <span>{p.contractedAt}</span>
                    <input type="date" value={form.contracted_at ? form.contracted_at.slice(0, 10) : ''} onChange={e => setForm(f => ({ ...f, contracted_at: e.target.value || null }))} />
                  </label>
                  <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                    <span>{p.notes}</span>
                    <textarea rows={3} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ width: '100%', resize: 'vertical' }} />
                  </label>
                </div>
                {formError && <div className="form-error">{formError}</div>}
              </div>
              <div className="modal-footer" style={{ padding: '12px 20px 16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)} disabled={formBusy}>{t.modal.cancel}</button>
                <button type="submit" className="btn-primary" disabled={formBusy}>
                  <Check size={14} />{formBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCommForm && (
        <div className="modal-overlay" onClick={() => setShowCommForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span>{p.addCommission}</span>
              <button className="icon-btn" onClick={() => setShowCommForm(false)}><X size={16} /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); saveCommission(); }}>
              <div className="modal-body">
                <div className="form-grid">
                  <label className="form-field">
                    <span>{p.partnerId}</span>
                    <input type="number" value={commForm.partner_id || ''} onChange={e => setCommForm(f => ({ ...f, partner_id: e.target.value }))} />
                  </label>
                  <label className="form-field">
                    <span>{p.sourceType}</span>
                    <div className="select-wrap" style={{ width: '100%' }}>
                      <select value={commForm.source_type || ''} onChange={e => setCommForm(f => ({ ...f, source_type: e.target.value }))} className="inline-select" style={{ width: '100%' }}>
                        <option value="">—</option>
                        {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <ChevronDown size={11} className="select-chevron" />
                    </div>
                  </label>
                  <label className="form-field">
                    <span>{p.amount}</span>
                    <input type="number" step="0.01" value={commForm.amount_cny || ''} onChange={e => setCommForm(f => ({ ...f, amount_cny: e.target.value }))} />
                  </label>
                  <label className="form-field">
                    <span>{p.sourcePartnerId}</span>
                    <input type="number" value={commForm.source_partner_id || ''} onChange={e => setCommForm(f => ({ ...f, source_partner_id: e.target.value || null }))} />
                  </label>
                  <label className="form-field">
                    <span>{p.baseAmount}</span>
                    <input type="number" step="0.01" value={commForm.base_amount || ''} onChange={e => setCommForm(f => ({ ...f, base_amount: e.target.value }))} />
                  </label>
                  <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                    <span>{p.description}</span>
                    <input value={commForm.description || ''} onChange={e => setCommForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%' }} />
                  </label>
                </div>
                {commError && <div className="form-error">{commError}</div>}
              </div>
              <div className="modal-footer" style={{ padding: '12px 20px 16px' }}>
                <button type="button" className="btn-secondary" onClick={() => setShowCommForm(false)} disabled={commBusy}>{t.modal.cancel}</button>
                <button type="submit" className="btn-primary" disabled={commBusy}>
                  <Check size={14} />{commBusy ? t.modal.saving : t.modal.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export { PartnersTab };
