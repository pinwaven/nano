import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { LayoutGrid, Sliders, BookOpen, Users2, MessageSquare, KeyRound } from 'lucide-react';
import { useLang, StatCard, Badge } from '../shared.jsx';
import { KnowledgeTab } from './KnowledgeTab.jsx';
import { PersonaSubscriptionsTab } from './PersonaSubscriptionsTab.jsx';

const PERSONAS = [
  { type: 'nano', label: 'Nano', color: '#6366f1', desc_en: 'Waven Nano — bilingual (zh/en), Kino biomarkers / BioAge / Dots nutrition.', desc_zh: 'Waven Nano — 中英双语，Kino 生物标志物 / 生理年龄 / 原粒营养。' },
  { type: 'viva', label: 'Viva', color: '#8b5cf6', desc_en: 'Aeviva — pure Chinese, developer-defined domain, agentic PLAN→GENERATE→JUDGE loop.', desc_zh: 'Aeviva — 纯中文，自定义领域，具备 PLAN→GENERATE→JUDGE 代理循环。' },
];

function AIPersonaTab({ channels }) {
  const { t, lang } = useLang();
  const isZh = lang === 'zh';
  const isSuperadmin = true; // this tab is superadmin-only (see App.jsx SUPERADMIN_ONLY gate)

  const [subTab, setSubTab] = useState('overview');

  return (
    <>
      <div className="subtab-row">
        <button className={`subtab-btn${subTab === 'overview' ? ' active' : ''}`} onClick={() => setSubTab('overview')}>
          <LayoutGrid size={13} /> {isZh ? '概览' : 'Overview'}
        </button>
        <button className={`subtab-btn${subTab === 'features' ? ' active' : ''}`} onClick={() => setSubTab('features')}>
          <Sliders size={13} /> {isZh ? '功能开关' : 'Features'}
        </button>
        <button className={`subtab-btn${subTab === 'knowledge' ? ' active' : ''}`} onClick={() => setSubTab('knowledge')}>
          <BookOpen size={13} /> {t.nav.knowledge || (isZh ? '知识库' : 'Knowledge')}
        </button>
        <button className={`subtab-btn${subTab === 'subscriptions' ? ' active' : ''}`} onClick={() => setSubTab('subscriptions')}>
          <KeyRound size={13} /> {t.nav.vivaSubscriptions || (isZh ? '订阅激活码' : 'Subscriptions')}
        </button>
      </div>

      {subTab === 'overview'       && <PersonaOverview channels={channels} isZh={isZh} />}
      {subTab === 'features'       && <PersonaFeatures isZh={isZh} />}
      {subTab === 'knowledge'      && <KnowledgeTab isSuperadmin={isSuperadmin} />}
      {subTab === 'subscriptions'  && <PersonaSubscriptionsTab />}
    </>
  );
}

function PersonaOverview({ channels, isZh }) {
  const counts = PERSONAS.reduce((acc, p) => {
    acc[p.type] = (channels || []).filter(c => (c.config?.persona_type || 'nano') === p.type).length;
    return acc;
  }, {});

  return (
    <>
      <div className="stat-row">
        {PERSONAS.map(p => (
          <StatCard key={p.type} icon={Users2} label={`${p.label} — ${isZh ? '使用渠道数' : 'channels using it'}`} value={counts[p.type] || 0} color={p.color} />
        ))}
      </div>
      <div className="card">
        {PERSONAS.map(p => (
          <div key={p.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Badge color={p.color}>{p.label}</Badge>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{p.type}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', maxWidth: 560 }}>{isZh ? p.desc_zh : p.desc_en}</div>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
              {counts[p.type] || 0} {isZh ? '个渠道' : 'channels'}
            </div>
          </div>
        ))}
        <div style={{ padding: '12px 16px', fontSize: 12, color: '#64748b' }}>
          {isZh
            ? '渠道的 AI 人格分配在「渠道管理」标签页中编辑（渠道详情 → AI Persona 字段）。'
            : 'A channel\'s persona assignment is edited in the Channels tab (channel detail → AI Persona field).'}
        </div>
      </div>
    </>
  );
}

function PersonaFeatures({ isZh }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingType, setSavingType] = useState(null);
  const [error, setError] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/persona-settings');
      const map = {};
      (res.data?.settings || []).forEach(s => { map[s.persona_type] = s; });
      setSettings(map);
    } catch { /* silently fail, cards render defaults */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const save = async (personaType, patch) => {
    setError('');
    const current = settings[personaType] || { dynamic_questionnaires_enabled: true, dynamic_questionnaire_cooldown_hours: 24 };
    const next = { ...current, ...patch };
    setSettings(s => ({ ...s, [personaType]: next }));
    setSavingType(personaType);
    try {
      const res = await axios.put(`/api/persona-settings/${personaType}`, {
        dynamic_questionnaires_enabled: next.dynamic_questionnaires_enabled,
        dynamic_questionnaire_cooldown_hours: parseInt(next.dynamic_questionnaire_cooldown_hours, 10) || 24,
      });
      if (res.data?.success === false) { setError(res.data.error); fetchSettings(); }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      fetchSettings();
    } finally { setSavingType(null); }
  };

  return (
    <div className="card">
      <div className="table-toolbar">
        <span className="table-count">
          <MessageSquare size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          {isZh ? '动态问卷功能' : 'Dynamic Questionnaire'}
        </span>
      </div>
      <div style={{ padding: '4px 16px 16px', fontSize: 12, color: '#64748b' }}>
        {isZh
          ? 'AI 在对话中判断需要结构化信息时，会生成一个简短问卷交给用户填写。目前该指令仅写入 Viva 的提示词模板，Nano 尚未接入。'
          : 'When the AI decides mid-conversation it needs structured input, it generates a short native questionnaire for the user to fill out. Today the trigger instruction is only wired into Viva\'s prompt templates — Nano\'s prompts don\'t call it yet.'}
      </div>

      {loading && <div className="empty-row" style={{ padding: 16 }}>…</div>}

      {!loading && PERSONAS.map(p => {
        const s = settings[p.type] || { dynamic_questionnaires_enabled: true, dynamic_questionnaire_cooldown_hours: 24 };
        const wired = p.type === 'viva'; // only Viva's chat templates call getAskQuestionsBlock() today
        return (
          <div key={p.type} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', margin: '0 16px 12px', borderRadius: 10,
            background: s.dynamic_questionnaires_enabled && wired ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${s.dynamic_questionnaires_enabled && wired ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
            opacity: wired ? 1 : 0.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
              <Badge color={p.color}>{p.label}</Badge>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: s.dynamic_questionnaires_enabled ? '#c4b5fd' : '#94a3b8' }}>
                  {s.dynamic_questionnaires_enabled ? (isZh ? '已启用' : 'Enabled') : (isZh ? '已停用' : 'Disabled')}
                </div>
                {!wired && (
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {isZh ? 'Nano 的提示词模板尚未接入此功能，开启此开关暂无实际效果。' : 'Nano\'s prompt templates don\'t call this yet — enabling this alone won\'t activate anything.'}
                  </div>
                )}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8', marginLeft: 'auto', marginRight: 16 }}>
                {isZh ? '冷却时间（小时）' : 'Cooldown (hours)'}
                <input
                  type="number" min={1} max={168}
                  value={s.dynamic_questionnaire_cooldown_hours}
                  onChange={e => setSettings(cur => ({ ...cur, [p.type]: { ...s, dynamic_questionnaire_cooldown_hours: e.target.value } }))}
                  onBlur={e => save(p.type, { dynamic_questionnaire_cooldown_hours: e.target.value })}
                  style={{ width: 60 }}
                  disabled={savingType === p.type}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => save(p.type, { dynamic_questionnaires_enabled: !s.dynamic_questionnaires_enabled })}
              disabled={savingType === p.type}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: savingType === p.type ? 'wait' : 'pointer', flexShrink: 0,
                background: s.dynamic_questionnaires_enabled ? '#8b5cf6' : '#334155',
                transition: 'background 0.2s', position: 'relative',
              }}
              title={s.dynamic_questionnaires_enabled ? (isZh ? '点击停用' : 'Click to disable') : (isZh ? '点击启用' : 'Click to enable')}
            >
              <span style={{
                position: 'absolute', top: 3, width: 18, height: 18, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', left: s.dynamic_questionnaires_enabled ? 23 : 3,
              }} />
            </button>
          </div>
        );
      })}
      {error && <div className="form-error" style={{ margin: '0 16px 12px' }}>{error}</div>}
    </div>
  );
}

export { AIPersonaTab };
