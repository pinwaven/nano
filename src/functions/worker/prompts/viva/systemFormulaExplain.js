'use strict';

/**
 * Explains an ALREADY-DECIDED dot plan (formulated by handlePostFormulaDots' deterministic
 * allocation step) to the user, warmly and accurately — this is NOT a recommendation prompt.
 * The plan is a closed fact by the time this runs (the schedule is already committed to the
 * DB), so the model's job is narrowly to explain the real allocation, not to re-derive one.
 *
 * Pure Chinese per the existing Viva convention (no isZh branching) — see factConstraint.js.
 */
const { getFactConstraintBlock } = require('./factConstraint');
const { getFactMemoryBlock } = require('./factMemoryBlock');
const { getVivaLabels } = require('./subAgeLabels');

module.exports = (ctx) => {
    const { user_profile, biomarkers, bioage, formulated_plan, sub_age_display_names } = ctx;
    const labels = getVivaLabels(sub_age_display_names);
    const hasBiomarkers = biomarkers && Object.keys(biomarkers).length > 0;
    const hasBioAge = bioage && bioage.BioAge;

    const bioAgeSection = hasBioAge
        ? `生理年龄：${bioage.BioAge} vs 实际年龄 ${bioage.ChronoAge}\n子年龄 — ${labels.CellularAge}：${bioage.SubAges?.CellularAge ?? '—'} | ${labels.MetabolicAge}：${bioage.SubAges?.MetabolicAge ?? '—'} | ${labels.MicroVascularAge}：${bioage.SubAges?.MicroVascularAge ?? '—'} | ${labels.ResilienceAge}：${bioage.SubAges?.ResilienceAge ?? '—'}`
        : '暂无生理年龄评估。';

    const planSection = (formulated_plan || []).length > 0
        ? formulated_plan.map(p => `• ${p.dot_id}号原粒 ${p.name_zh || p.name}（${p.key_name}）${p.target_dimension ? `（针对${p.target_dimension}）` : ''} — 每日 ${p.count} 粒，${p.timing === 'Morning' ? '早服' : p.timing === 'Evening' ? '晚服' : '时段未定'}`).join('\n')
        : '（本次未分配任何原粒）';

    return `${getFactConstraintBlock(ctx.essential_knowledge)}

${getFactMemoryBlock(ctx.user_facts)}

你是 Viva，Aeviva 的精准长寿顾问。系统刚刚根据用户的生物标志物数据，为其配置了一套为期7天的原粒方案（见下方"已配置的原粒方案"）。你的任务不是重新推荐或列出其他选项，而是**用温暖、清晰的语言，向用户解释这套已经生成的方案**——为什么选择这些原粒、它们分别针对哪个维度、如何呼应用户当前的生物标志物状态。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}${user_profile.bmi ? '，BMI ' + user_profile.bmi : ''}

${bioAgeSection}

生物标志物：${hasBiomarkers ? JSON.stringify(biomarkers) : '暂无数据'}

已配置的原粒方案（这是唯一真实的方案，编号、名称、剂量必须逐字复制下方原文，不得改写、增减或编造）：
${planSection}

回复规则：
- 直接解释这套已配置的方案，不要重新做推荐、不要列出配方库中未被选中的其他原粒。
- 引用用户真实的生物标志物/生理年龄数值，说明驱动因素。
- 最多 2–3 段简短段落。绝不使用 Markdown 标题（#、##、###）或分段编号，保持自然对话语气。
- 全程使用简体中文回复。
- 结尾干净收尾，不要提问或引导用户继续追问。`;
};
