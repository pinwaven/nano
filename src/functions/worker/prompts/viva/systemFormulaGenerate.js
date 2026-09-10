'use strict';

/**
 * Decides the actual weekly dot formulation (Viva only) — the agentic PLAN→GENERATE→JUDGE→
 * REVISE loop's system prompt for handleChatGenerateEvent's 'formula_dots_generate' kind.
 * Unlike the old two-hop design (a dumb single-shot decision, explained afterward by a second
 * agentic call against systemFormulaExplain.js), this prompt makes the real decision itself,
 * with full tool access and the user's complete digital twin — its own prose reply doubles as
 * the user-facing explanation, so no second LLM call is needed.
 *
 * Pure Chinese per the existing Viva convention (no isZh branching) — see factConstraint.js.
 */
const { classifyBiomarker, LABELS_ZH: STATUS_LABELS_ZH } = require('../../lib/biomarkerStatus');
const { getFactConstraintBlock } = require('../chat/factConstraint');
const { getFactMemoryBlock } = require('../chat/factMemoryBlock');
const { getCurrentDateBlock } = require('../chat/currentDateBlock');
const { getTwinVocabBlock } = require('../chat/twinVocabulary');
const { getVivaLabels } = require('./subAgeLabels');

module.exports = (ctx) => {
    const { user_profile, biomarkers, bioage, dots, health_twin, questionnaire_context, active_health_plans, recommended_dot_keys, current_solar_term, sub_age_display_names , formulation_package, formulation_tiers } = ctx;
    const labels = getVivaLabels(sub_age_display_names);

    const formularyLines = (dots || []).length > 0
        ? dots.map(d => {
            const shortKey = d.key_name.replace(/^DOT/, 'D');
            const ingrArr = d.ingredients_zh || d.ingredients;
            const ingrStr = Array.isArray(ingrArr) && ingrArr.length > 0
                ? ' [' + ingrArr.map(i => `${i.name}: ${i.mg}mg`).join(', ') + ']'
                : '';
            const isPulse = d.dosing_protocol === 'pulse';
            const rangeLabel = isPulse ? '单次剂量范围' : '每日总量范围';
            const range = (d.target_dots_min != null && d.target_dots_max != null)
                ? `${d.target_dots_min}-${d.target_dots_max}粒`
                : '1-10粒 (无专属范围，谨慎使用)';
            const timingZh = d.timing === 'Morning' ? '早（默认/主时段）' : d.timing === 'Evening' ? '晚（默认/主时段）' : '未指定';
            const flexZh = d.timing_flexible ? '早晚皆可，可自由拆分' : '固定时段，不可拆分';
            const keyZh = d.key_name_zh || shortKey;
            const isN7 = d.key_name === 'DOT-N7';
            // DOT-N7's dosing is no longer decided by GENERATE at all (2026-08-08) — the system
            // now schedules it on 2 fixed, system-chosen days each cycle (in week 2), as the sole
            // ingredient in BOTH capsules that day at its own max. Told explicitly here so GENERATE
            // never narrates a count for it and never treats it as a normal daily/weekly item.
            // Pulse dots in general (dosing_protocol='pulse') are NOT taken daily — the system
            // schedules them only on their real active pulse days, so the count decided here is a
            // single-dose amount, not a daily amount. Made explicit here (2026-08-08) because
            // GENERATE was previously never told this and would narrate/imply daily use for these
            // dots — a real, repeated JUDGE catch on live prod sampling.
            const pulseNote = isN7
                ? '（用法已由系统全权接管：本周期内系统会自动选定2天，当天早晚两颗胶囊均只含此原粒、且各自达到上限剂量，不再逐日混入其他原粒——你在下方JSON中始终填0即可，此数值会被系统忽略，分析中也不要提及具体用量或"每日/每次X粒"）'
                : isPulse
                ? `（脉冲式方案：每${d.pulse_cycle_days || 30}天中仅连续${d.pulse_days_per_cycle || 2}天使用一次，系统会自动只在这些天安排剂量——不要在分析中说"每日"或"每天"服用此原粒，也不要在其他普通原粒的语境中把它当作日常项混谈）`
                : '';
            return `${shortKey}（对话中称呼："${keyZh}"）: ${d.name_zh || d.name}${ingrStr} — ${rangeLabel} ${range}，默认时段：${timingZh}（${flexZh}）${d.sub_age_target ? `，对应维度：${d.sub_age_target}` : ''}${pulseNote}`;
        }).join('\n')
        : '配方库暂不可用。';

    const biomarkersStr = Object.entries(biomarkers || {})
        .map(([k, v]) => {
            const status = classifyBiomarker(k, v);
            return `  ${k}: ${v}${status ? `（${STATUS_LABELS_ZH[status]}）` : ''}`;
        })
        .join('\n') || '  （暂无生物标志物数据）';

    const bioAge = bioage?.BioAge ?? '未知';
    const chronoAge = bioage?.ChronoAge ?? '未知';

    const twinSection = health_twin
        ? `数字孪生 · 日常监测（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}\n30天趋势：${health_twin.trend_data ? JSON.stringify(health_twin.trend_data) : '暂无'}`
        : '暂无穿戴设备数据。';

    const healthPlanSection = active_health_plans && active_health_plans.length > 0
        ? `当前健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
        : '';

    // Soft, non-exclusionary weighting hint derived from the union of the user's active
    // health_plans' recommended dots — recommended dots should skew toward the higher end
    // of their own range, but every other dot is still decided normally by biomarker severity
    // (never forced to 0 just for being off the focus list). The weighting is purely additive on
    // the server side too: _fallbackCountForDot promotes a listed dot and leaves everything else
    // at the midpoint it would get with no focus at all.
    //
    // `recommended_dot_keys` is resolved once by the caller (handlers/dots.js) and carried on the
    // context. The inline derivation below is a FALLBACK ONLY, for a context built before that
    // field existed — an event published by an older worker can still be in flight. Do not make
    // it the primary path: the stored shape changed from dots.id to key_name
    // (migration_health_plan_recommended_dot_keys.sql) and a second copy of that logic is how one
    // of them gets missed next time.
    const recommendedDotShortKeys = (() => {
        const toShort = (keys) => keys.filter(Boolean).map(k => k.replace(/^DOT/, 'D'));
        if (Array.isArray(recommended_dot_keys)) return toShort(recommended_dot_keys);
        const entries = new Set();
        for (const p of active_health_plans || []) for (const e of (p.recommended_dot_ids || [])) entries.add(e);
        if (entries.size === 0) return [];
        const byId = new Map((dots || []).map(d => [d.id, d]));
        const byKey = new Set((dots || []).map(d => d.key_name));
        return toShort([...entries].map(e => (typeof e === 'string' ? (byKey.has(e) ? e : null) : byId.get(e)?.key_name)));
    })();
    const focusWeightingSection = recommendedDotShortKeys.length > 0
        ? `本轮聚焦方案重点推荐原粒：${recommendedDotShortKeys.join('、')}（配方决策时可适当偏向这些原粒范围的较高值；但其余原粒仍需按生物标志物正常判断决定数值，不得因未被推荐而强行归零——若某项生物标志物明显异常但对应原粒不在此列表中，仍应给出合理剂量）`
        : '';


    // The 28-day package this user has already paid for (GCN's migration_0085). The tiers differ
    // only in how many distinct dots the formula may contain, so this is a hard shape constraint
    // on the answer, not a preference — and it is far better to BUILD a 6-dot formula than to
    // build a 10-dot one and delete four. _capDistinctDots enforces the number afterwards
    // regardless; this section is what makes that trim a no-op instead of a demolition.
    const packageSection = formulation_package && formulation_package.max_distinct_dots
        ? `用户已购买的套餐：${formulation_package.name || '28天定制套餐'} — 该套餐限定的是**每周**可同时服用的原粒种类数：任意一周内最多 ${formulation_package.max_distinct_dots} 种（DOT-N7 为系统固定的重置原粒，不计入此数量）。
四周可以不同：你可以让某个原粒只出现在其中一两周，把名额让给另一个原粒，只要**每一周**都不超过 ${formulation_package.max_distinct_dots} 种。需要连续服用才有意义的原粒（如睡眠、情绪支持）应四周都保留；只有适合阶段性或轮换的原粒才安排在部分周。
请**主动挑选**每周最关键的 ${formulation_package.max_distinct_dots} 种并把剂量给足，不要先铺开再删减——超出的部分会被系统按重要性裁掉。`
        : '';

    // The purchasable ladder, for a user who has bought NOTHING yet — the mirror image of
    // packageSection above and never rendered with it. There the tier is settled and the job is to
    // hit it; here the tier is the thing being chosen, and the user has never been shown what it
    // costs them to choose the narrow one.
    //
    // The ask is one nested set of formulas, not three: the essential core, then +2, then +2. The
    // server takes prefixes of the model's own tier ordering (_buildTierLadder), so the widths
    // hold whatever the model tags — the tag decides only WHICH dot is the better next addition,
    // which is the clinical judgement it is here to make.
    //
    // Widths come from GCN's catalog, never hardcoded: a tier repriced, added or retired in the
    // admin panel has to reach this prompt with no deploy.
    const tierRungs = (formulation_tiers || [])
        .map(t => ({ label: t.tier_label || t.package_name || '', max: Number(t.max_distinct_dots) }))
        .filter(t => Number.isFinite(t.max) && t.max > 0)
        .sort((a, b) => a.max - b.max);
    // How many dots the model is asked to rank: the widest purchasable tier when the user has
    // bought nothing (so one ordered list yields all three nested variants by prefix), the
    // purchased width when they have, and a sensible default otherwise. Asking for more than the
    // widest tier would be asking for ranks that are discarded before anyone sees them.
    const rankTarget = formulation_package && formulation_package.max_distinct_dots
        ? Number(formulation_package.max_distinct_dots)
        : (tierRungs.length ? tierRungs[tierRungs.length - 1].max : 8);

    // Three PACKAGES, not one formula with two upgrade steps. The widths still differ only in how
    // many dots may run in one week, but each is dosed as a complete formula of its own
    // (_equalizeToTarget), and the card draws all three side by side — so the prose must describe
    // the user's direction rather than any single width. Before 2026-09-10 this section ended by
    // telling the model to write about the narrowest tier alone, which is what made every reply
    // read as "here is your formula, plus two add-ons".
    const tierLadderSection = (!packageSection && tierRungs.length > 1)
        ? `用户尚未购买套餐。可购买的28天套餐共 ${tierRungs.length} 款，每一款都是一份完整配方，区别在于**每周**可同时服用的原粒种类数（DOT-N7 为系统固定的重置原粒，任何一款都不计入）：
${tierRungs.map((t, i) => `· ${t.label || t.max + '种'}：任意一周最多 ${t.max} 种${i === 0 ? '' : `（比上一款多 ${t.max - tierRungs[i - 1].max} 种）`}`).join('\n')}

系统会按你给出的重要性排序，自动生成上面这 ${tierRungs.length} 款各自的完整配方——**你不需要、也不要自己挑出哪几种属于哪一款**。你要做的只有一件事：把排序排准。排在越前面的原粒，越会出现在每一款里，并拿到该原粒范围内偏高的剂量。
**排序里要放满 ${rankTarget} 个**：绝不要因为“反正最窄的一款只装得下 ${tierRungs[0].max} 种”就只排出 ${tierRungs[0].max} 个——排在后面的几个正是更宽那几款的内容，少排一个就少一款可选。

正文分析请围绕这位用户的整体调理方向与优先级来写，**不要指向其中某一款套餐**，也不要提"档位""升级""加配"：每一款的定位说明由系统在卡片上逐一给出。`
        : '';

    // One action tail in both modes. The ladder used to add "tier" tags and an "upgrades" array
    // here; both were removed 2026-09-07 after nine measured runs in which qwen-plus never once
    // produced the requested 6/2/2 partition (17/0/0, 7/6/4, 9/4/4 x3, 4/0/0 x2, 6/3/2), and one
    // revision of the instruction pushed it to zero 13 of 17 dots and emit no ladder at all. The
    // packages are now chosen by the server from the ranking, and their copy written by a second,
    // tightly-scoped call that is SHOWN the dots it is describing (lib/tierCopy.js), so the
    // sentence and the dots under it cannot disagree. A stale cached prompt still parses: the
    // extra fields are simply ignored.
    const formatLine = `{"action":"formulate_dots","ranking":[{"dot_key":"D-N9","why":"一句话说明为什么排这里"}, ...按重要性排序，共 ${rankTarget} 条]}`;

    const seasonSection = current_solar_term
        ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
        : '';

    return `${getFactConstraintBlock(ctx.essential_knowledge)}

${getCurrentDateBlock(ctx.now_iso)}

${getFactMemoryBlock(ctx.user_facts)}

${getTwinVocabBlock()}

你是 Viva，Aeviva 的精准长寿顾问，专为东方人群打造。你现在的任务是：为用户配置接下来28天（4周）的 Waven 原粒方案——这是一次真实的配方决策，不是解释一个已有方案。系统会将你给出的每日总量重复安排到这28天内（DOT-N7 除外，见下方配方库中的专项说明）。

生物标志物的状态（正常/偏高/高）已在下方直接标注，请严格使用该标注。

用户：${user_profile.nickname || '用户'}，${user_profile.age ? user_profile.age + ' 岁' : '年龄未知'}${user_profile.bmi ? '，BMI ' + user_profile.bmi : ''}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${focusWeightingSection ? focusWeightingSection + '\n' : ''}${packageSection ? packageSection + '\n' : (tierLadderSection ? tierLadderSection + '\n' : '')}
${twinSection}

${seasonSection}

生物标志物：
${biomarkersStr}
年龄：BioAge = ${bioAge}, ChronoAge = ${chronoAge}
偏高维度：${Object.entries(bioage?.SubAges || {}).filter(([, age]) => age > (bioage?.ChronoAge ?? Infinity)).map(([dim]) => labels[dim] || dim).join('、') || '无'}

配方库（短代码: 名称 [成分] — 每日总量范围，默认时段，对应维度）：
${formularyLines}

可用工具：你可以调用 get_biomarker_history 查看历史检测趋势、get_nutrition_schedule 查看以往的配方历史（避免与近期方案剧烈波动、了解用户的原粒使用习惯）。不确定时优先调用工具核实，而不是凭空假设。

任务：
1. 分析：这段文字是本次配方决策的说明，**不是**一份通用健康状态总结——绝不能只罗列生物标志物/生理年龄/穿戴设备数据而不提及任何具体原粒。必须明确点名你在下方"配方"中实际选择或加重的至少2-3个原粒，说明"为什么选它、对应哪个生物标志物或维度"，让用户看得出这段话和下面的配方是同一个决策的两个部分。提及原粒时对用户使用配方库中标注的"对话中称呼"（如"原粒1号"）或原粒名称，**不要**说出内部短代码（如"D-N1"）——那是给系统解析用的，不是给用户看的。可以简短提及驱动决策的关键数据，但核心内容是解释原粒选择，不是复述体检报告。2-3句话，对话语气，不使用列表或标题。
2. 配方：从配方库中挑出对这位用户最有价值的 ${rankTarget} 个短代码，按重要性从高到低排成一份列表。粒数由系统按每个原粒自己的范围和它在这份列表中的位置换算，脉冲式原粒也一样（系统只会在真正的脉冲日安排它）。早晚如何拆分同样由系统按默认时段/是否"早晚皆可"自动计算，你**不需要**、也**不应该**自己写粒数或拆分早晚——只需把这份排序排准。

配方规则（务必遵守）：
- **你不需要写任何粒数**。你唯一要做的判断是：从配方库中挑出对这位用户最有价值的 ${rankTarget} 个原粒，**按重要性从高到低排好序**。每个原粒该给多少粒、早晚怎么分、总量会不会超过一颗胶囊装得下的量，全部由系统计算——各原粒的范围差异极大（从1粒到上百粒），这部分交给系统才不会出错。
- 排序就是这次配方的全部决策：排在最前面的会拿到该原粒范围内偏高的剂量，靠后的接近下限，没有进入列表的这次完全不用。所以真正驱动用户当前异常的那几个必须排在最前面。
- **列表长度必须是 ${rankTarget} 个**，不多不少，且不得重复。
- DOT-N7 不要出现在列表里——它的用法已由系统全权接管。
- 排序依据是完整的数字孪生，而不只是生物标志物：偏高的子年龄维度是主线，但睡眠、活动量、问卷、用户自述的目标与饮食禁忌同样是排序理由。一个子年龄看着正常、却明显拖累用户日常状态的方向，照样可以排得很靠前。

输出格式（严格遵守，回复正文照常撰写，然后在最后另起一行附上下方 JSON，短代码必须与配方库完全一致）：
${formatLine}

回复规则：
- 先给出对话式分析（不使用标题、不使用列表，2-3句话），再附上 JSON 行。
- 引用用户真实的生物标志物/趋势数值，说明驱动因素。
- 全程使用简体中文回复，结尾干净收尾，不提问、不引导用户继续追问。`;
};
