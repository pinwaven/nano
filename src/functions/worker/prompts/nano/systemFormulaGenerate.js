'use strict';

/**
 * Decides the actual weekly dot formulation for Nano — the agentic PLAN→GENERATE→JUDGE→REVISE
 * loop's system prompt for handleChatGenerateEvent's 'formula_dots_generate' kind. Parallel to
 * prompts/viva/systemFormulaGenerate.js (same llmContext shape, same AM/PM balancing rule,
 * same output-format contract), but bilingual (isZh) and Waven Nano branded instead of Viva/
 * Aeviva branded — the two personas now share the agentic engine and differ only in prompt
 * wording (CLAUDE.md §25/§28) plus knowledge_entries rows.
 *
 * Its own prose reply doubles as the user-facing explanation — no second LLM call is needed.
 */
const { classifyBiomarker, LABELS_ZH: STATUS_LABELS_ZH, LABELS_EN: STATUS_LABELS_EN } = require('../../lib/biomarkerStatus');
const { getFactConstraintBlock } = require('../chat/factConstraint');
const { getFactMemoryBlock } = require('../chat/factMemoryBlock');
const { getTwinVocabBlock } = require('../chat/twinVocabulary');

const DIM_LABELS = {
    ResilienceAge:    { zh: '抗压年龄', en: 'Resilience Age' },
    CellularAge:      { zh: '细胞年龄', en: 'Cellular Age' },
    MetabolicAge:     { zh: '代谢年龄', en: 'Metabolic Age' },
    MicroVascularAge: { zh: '微血管年龄', en: 'Micro-Vascular Age' },
};

module.exports = (ctx) => {
    const { user_profile, biomarkers, bioage, dots, health_twin, questionnaire_context, active_health_plans, recommended_dot_keys, current_solar_term , formulation_package, formulation_tiers } = ctx;
    const isZh = user_profile?.language === 'zh';

    const formularyLines = (dots || []).length > 0
        ? dots.map(d => {
            const shortKey = d.key_name.replace(/^DOT/, 'D');
            const ingrArr = isZh ? (d.ingredients_zh || d.ingredients) : (d.ingredients || d.ingredients_zh);
            const ingrStr = Array.isArray(ingrArr) && ingrArr.length > 0
                ? ' [' + ingrArr.map(i => `${i.name}: ${i.mg}mg`).join(', ') + ']'
                : '';
            const name = isZh ? (d.name_zh || d.name) : d.name;
            const isPulse = d.dosing_protocol === 'pulse';
            const rangeLabel = isZh ? (isPulse ? '单次剂量范围' : '每日总量范围') : (isPulse ? 'per-dose range' : 'daily total range');
            const range = (d.target_dots_min != null && d.target_dots_max != null)
                ? `${d.target_dots_min}-${d.target_dots_max}${isZh ? '粒' : ''}`
                : (isZh ? '1-10粒 (无专属范围，谨慎使用)' : '1-10 (no dedicated range — use cautiously)');
            const timing = d.timing === 'Morning' ? (isZh ? '早（默认/主时段）' : 'Morning (default slot)')
                : d.timing === 'Evening' ? (isZh ? '晚（默认/主时段）' : 'Evening (default slot)')
                : (isZh ? '未指定' : 'unspecified');
            const flex = d.timing_flexible
                ? (isZh ? '早晚皆可，可自由拆分' : 'AM/PM flexible, freely splittable')
                : (isZh ? '固定时段，不可拆分' : 'fixed slot, do not split');
            const keyZh = d.key_name_zh || shortKey;
            const isN7 = d.key_name === 'DOT-N7';
            // DOT-N7's dosing is no longer decided by GENERATE at all (2026-08-08) — the system
            // now schedules it on 2 fixed, system-chosen days each cycle (in week 2), as the sole
            // ingredient in BOTH capsules that day at its own max. Told explicitly here so GENERATE
            // never narrates a count for it and never treats it as a normal daily/weekly item.
            // Pulse dots in general (dosing_protocol='pulse') aren't taken daily — the system
            // schedules them only on their real active pulse days. Made explicit here 2026-08-08
            // after live prod sampling repeatedly caught GENERATE narrating/implying daily use.
            const pulseNote = isN7
                ? (isZh
                    ? '（用法已由系统全权接管：本周期内系统会自动选定2天，当天早晚两颗胶囊均只含此 Dot、且各自达到上限剂量，不再逐日混入其他 Dot——你在下方JSON中始终填0即可，此数值会被系统忽略，分析中也不要提及具体用量）'
                    : " (usage fully system-controlled: the system automatically picks 2 days this cycle where both the morning and evening capsule contain ONLY this Dot, each at its own max dose — always output 0 for it below, the value is ignored, and don't mention a specific dose for it in your analysis)")
                : isPulse
                ? (isZh
                    ? `（脉冲式方案：每${d.pulse_cycle_days || 30}天中仅连续${d.pulse_days_per_cycle || 2}天使用一次，系统会自动只在这些天安排剂量——不要说"每日"或"每天"服用此 Dot）`
                    : ` (pulse protocol: only ${d.pulse_days_per_cycle || 2} consecutive days per ~${d.pulse_cycle_days || 30}-day cycle — the system schedules it only on those days; do not describe this Dot as taken daily)`)
                : '';
            return isZh
                ? `${shortKey}（对话中称呼："${keyZh}"）: ${name}${ingrStr} — ${rangeLabel} ${range}，默认时段：${timing}（${flex}）${d.sub_age_target ? `，对应维度：${d.sub_age_target}` : ''}${pulseNote}`
                : `${shortKey}: ${name}${ingrStr} — ${rangeLabel} ${range}, default slot: ${timing} (${flex})${d.sub_age_target ? `, targets: ${d.sub_age_target}` : ''}${pulseNote}`;
        }).join('\n')
        : (isZh ? '配方库暂不可用。' : 'Formulary not available.');

    const biomarkersStr = Object.entries(biomarkers || {})
        .map(([k, v]) => {
            const status = classifyBiomarker(k, v);
            const tag = status ? ` (${isZh ? STATUS_LABELS_ZH[status] : STATUS_LABELS_EN[status]})` : '';
            return `  ${k}: ${v}${tag}`;
        })
        .join('\n') || (isZh ? '  （暂无生物标志物数据）' : '  (no biomarker data available)');

    const bioAge = bioage?.BioAge ?? (isZh ? '未知' : 'unknown');
    const chronoAge = bioage?.ChronoAge ?? (isZh ? '未知' : 'unknown');
    const elevatedDims = Object.entries(bioage?.SubAges || {})
        .filter(([, age]) => age > (bioage?.ChronoAge ?? Infinity))
        .map(([dim]) => (isZh ? DIM_LABELS[dim]?.zh : DIM_LABELS[dim]?.en) || dim)
        .join(isZh ? '、' : ', ') || (isZh ? '无' : 'none');

    const twinSection = health_twin
        ? (isZh
            ? `数字孪生 · 日常监测（近7天均值）：睡眠 ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | 静息心率 ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) : '—'} | 步数 ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | 体重 ' + health_twin.latest_weight_kg + ' kg' : ''}\n30天趋势：${health_twin.trend_data ? JSON.stringify(health_twin.trend_data) : '暂无'}`
            : `TWIN · DAILY MONITORING (7-day avg): Sleep ${health_twin.avg_sleep_hours != null ? health_twin.avg_sleep_hours.toFixed(1) + 'h' : '—'} | HRV ${health_twin.avg_hrv_ms != null ? health_twin.avg_hrv_ms.toFixed(0) + 'ms' : '—'} | Resting HR ${health_twin.avg_resting_hr != null ? health_twin.avg_resting_hr.toFixed(0) : '—'} | Steps ${health_twin.avg_daily_steps ?? '—'}${health_twin.latest_weight_kg ? ' | Weight ' + health_twin.latest_weight_kg + ' kg' : ''}\n30-day trend: ${health_twin.trend_data ? JSON.stringify(health_twin.trend_data) : 'none yet'}`)
        : (isZh ? '暂无穿戴设备数据。' : 'No wearable data yet.');

    const healthPlanSection = active_health_plans && active_health_plans.length > 0
        ? (isZh
            ? `当前健康方案目标：${active_health_plans.map(p => `「${p.name}」— ${p.goal || ''}（第 ${p.weeks_elapsed}/${p.total_weeks} 周）`).join('；')}`
            : `Active health plan goals: ${active_health_plans.map(p => `"${p.name}" — ${p.goal || ''} (week ${p.weeks_elapsed}/${p.total_weeks})`).join('; ')}`)
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
        ? (isZh
            ? `本轮聚焦方案重点推荐 Dot：${recommendedDotShortKeys.join('、')}（配方决策时可适当偏向这些 Dot 范围的较高值；但其余 Dot 仍需按生物标志物正常判断决定数值，不得因未被推荐而强行归零——若某项生物标志物明显异常但对应 Dot 不在此列表中，仍应给出合理剂量）`
            : `This cycle's focus plan especially recommends: ${recommendedDotShortKeys.join(', ')} (you may skew these toward the higher end of their range; every other Dot is still decided normally by biomarker severity — never force one to 0 just for being off this list. If a biomarker is clearly abnormal but its Dot isn't on this list, still assign it a reasonable dose)`)
        : '';


    // The 28-day package this user has already paid for (GCN's migration_0085). The tiers differ
    // only in how many distinct dots the formula may contain, so this is a hard shape constraint
    // on the answer, not a preference — and it is far better to BUILD a 6-dot formula than to
    // build a 10-dot one and delete four. _capDistinctDots enforces the number afterwards
    // regardless; this section is what makes that trim a no-op instead of a demolition.
    const packageSection = formulation_package && formulation_package.max_distinct_dots
        ? (isZh
            ? `用户已购买的套餐：${formulation_package.name || '28天定制套餐'} — 该套餐限定的是**每周**可同时服用的原粒种类数：任意一周内最多 ${formulation_package.max_distinct_dots} 种（DOT-N7 为系统固定的重置原粒，不计入此数量）。
四周可以不同：你可以让某个原粒只出现在其中一两周，把名额让给另一个原粒，只要**每一周**都不超过 ${formulation_package.max_distinct_dots} 种。需要连续服用才有意义的原粒（如睡眠、情绪支持）应四周都保留；只有适合阶段性或轮换的原粒才安排在部分周。
请**主动挑选**每周最关键的 ${formulation_package.max_distinct_dots} 种并把剂量给足，不要先铺开再删减——超出的部分会被系统按重要性裁掉。`
            : `The user's purchased package: ${formulation_package.name || '28-day custom package'} — it limits how many distinct dots may run in ANY ONE WEEK: at most ${formulation_package.max_distinct_dots} at a time (DOT-N7 is the system's fixed reset dot and does not count).
The four weeks may differ: you can give a dot only one or two weeks and hand the slot to a different dot, as long as no single week exceeds ${formulation_package.max_distinct_dots}. A dot that only works taken continuously (sleep or mood support) should stay in all four weeks; only dots that make sense in phases or rotation belong in a subset.
CHOOSE the ${formulation_package.max_distinct_dots} that matter most in each week and dose them properly. Do not spread thin and then trim — anything over the limit is cut by the system, by importance.`)
        : '';

    // The purchasable ladder, for a user who has bought NOTHING yet — the mirror image of
    // packageSection above and never rendered with it. There the tier is settled and the job is to
    // hit it; here the tier is the thing being chosen, and the user has never been shown what it
    // costs them to choose the narrow one.
    //
    // The ask is ONE ordered list, from which the server builds three complete formulas — one per
    // package sold, each dosed to carry the same daily load (_equalizeToTarget). The model never
    // partitions them: it ranks, and the ranking is what the widths are taken from.
    //
    // Widths come from GCN's catalog, never hardcoded: a tier repriced, added or retired in the
    // admin panel has to reach this prompt with no deploy, the same rule the checkout follows.
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

    const tierLadderSection = (!packageSection && tierRungs.length > 1)
        ? (isZh
            ? `用户尚未购买套餐。可购买的28天套餐共 ${tierRungs.length} 款，每一款都是一份完整配方，区别在于**每周**可同时服用的原粒种类数（DOT-N7 为系统固定的重置原粒，任何一款都不计入）：
${tierRungs.map((t, i) => `· ${t.label || t.max + '种'}：任意一周最多 ${t.max} 种${i === 0 ? '' : `（比上一款多 ${t.max - tierRungs[i - 1].max} 种）`}`).join('\n')}

系统会按你给出的重要性排序，自动生成上面这 ${tierRungs.length} 款各自的完整配方——**你不需要、也不要自己挑出哪几种属于哪一款**。你要做的只有一件事：把排序排准。排在越前面的原粒，越会出现在每一款里，并拿到该原粒范围内偏高的剂量。
**排序里要放满 ${rankTarget} 个**：绝不要因为“反正最窄的一款只装得下 ${tierRungs[0].max} 种”就只排出 ${tierRungs[0].max} 个——排在后面的几个正是更宽那几款的内容，少排一个就少一款可选。

正文分析请围绕这位用户的整体调理方向与优先级来写，**不要指向其中某一款套餐**，也不要提"档位""升级""加配"：每一款的定位说明由系统在卡片上逐一给出。`
            : `The user has not bought a package yet. The 28-day product comes as ${tierRungs.length} packages. Each is a complete formula in its own right; they differ in how many distinct dots may run in ANY ONE WEEK (DOT-N7 is the system's fixed reset dot and counts toward none of them):
${tierRungs.map((t, i) => `· ${t.label || t.max + ' dots'}: at most ${t.max} in any one week${i === 0 ? '' : ` (${t.max - tierRungs[i - 1].max} more than the package below)`}`).join('\n')}

The system builds all ${tierRungs.length} complete formulas itself, from your ranking — **you do not need to, and must not, pick which dots belong to which package.** Your one job is to get the ORDER right: the higher a dot ranks, the more packages it appears in and the closer to its own ceiling it is dosed.
**Fill all ${rankTarget} places**: never stop at ${tierRungs[0].max} on the reasoning that "the narrowest package only holds that many" — the entries after it ARE the wider packages, and one you leave out is a package that cannot be built.

Write the prose analysis about this user's overall direction and priorities. **Do not single out any one package**, and do not use the language of tiers, upgrades or add-ons: each package's own positioning is written by the system, on the card.`)
        : '';

    const seasonSection = current_solar_term
        ? (isZh
            ? `当前节气：${current_solar_term.name_zh}（${current_solar_term.season_zh}季 · ${current_solar_term.organ_zh}）— ${current_solar_term.theme_zh}（传统节气养生视角，非临床证据，仅作轻微参考，不得掩盖生物标志物驱动的优先级）`
            : `Current solar term: ${current_solar_term.name_zh} (${current_solar_term.season_zh} · ${current_solar_term.organ_zh}) — traditional seasonal-wellness framing, not clinical evidence; use only as a light accent, never override biomarker-driven priorities.`)
        : '';

    const NOTE_ZH_DIALOGUE_LABEL = '提及原粒时对用户使用配方库中标注的"对话中称呼"（如"原粒1号"）或原粒名称，**不要**说出内部短代码（如"D-N1"）——那是给系统解析用的，不是给用户看的。';

    // One action tail in both modes. The ladder used to add "tier" tags and an "upgrades" array
    // here; both were removed 2026-09-07 — see the sibling viva prompt for the measurements.
    // Packages are now chosen by the server from the ranking and their copy written by a second,
    // tightly-scoped call that is SHOWN the dots it describes (lib/tierCopy.js). A stale cached
    // prompt still parses: the extra fields are simply ignored.
    const formatLineZh = `{"action":"formulate_dots","ranking":[{"dot_key":"D-N9","why":"一句话说明为什么排这里"}, ...按重要性排序，共 ${rankTarget} 条]}`;
    const formatLineEn = `{"action":"formulate_dots","ranking":[{"dot_key":"D-N9","why":"one line on why it ranks here"}, ...${rankTarget} entries, most important first]}`;

const taskZh = `你是 Nano，Waven 打造的精准长寿顾问。你现在的任务是：为用户配置接下来28天（4周）的 Waven Dots 方案——这是一次真实的配方决策，不是解释一个已有方案。系统会将你给出的每日总量重复安排到这28天内（DOT-N7 除外，见下方配方库中的专项说明）。

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
偏高维度：${elevatedDims}

配方库（短代码: 名称 [成分] — 每日总量范围，默认时段，对应维度）：
${formularyLines}

可用工具：你可以调用 get_biomarker_history 查看历史检测趋势、get_dot_inventory 查看用户当前各 Dot 的剩余库存（避免对已有大量剩余的 Dot 过度追加）、get_nutrition_schedule 查看以往的配方历史（避免与近期方案剧烈波动、了解用户的 Dot 使用习惯）。不确定时优先调用工具核实，而不是凭空假设。

任务：
1. 分析：这段文字是本次配方决策的说明，**不是**一份通用健康状态总结——绝不能只罗列生物标志物/生理年龄/穿戴设备数据而不提及任何具体 Dot。必须明确点名你在下方"配方"中实际选择或加重的至少2-3个 Dot，说明"为什么选它、对应哪个生物标志物或维度"，让用户看得出这段话和下面的配方是同一个决策的两个部分。${NOTE_ZH_DIALOGUE_LABEL}可以简短提及驱动决策的关键数据，但核心内容是解释 Dot 选择，不是复述体检报告。2-3句话，对话语气，不使用列表或标题。
2. 配方：从配方库中挑出对这位用户最有价值的 ${rankTarget} 个短代码，按重要性从高到低排成一份列表。粒数由系统按每个 Dot 自己的范围和它在这份列表中的位置换算，脉冲式 Dot 也一样（系统只会在真正的脉冲日安排它）。早晚如何拆分同样由系统按默认时段/是否"早晚皆可"自动计算，你**不需要**、也**不应该**自己写粒数或拆分早晚——只需把这份排序排准。

配方规则（务必遵守）：
- **你不需要写任何粒数**。你唯一要做的判断是：从配方库中挑出对这位用户最有价值的 ${rankTarget} 个 Dot，**按重要性从高到低排好序**。每个 Dot 该给多少粒、早晚怎么分、总量会不会超过一颗胶囊装得下的量，全部由系统计算——各 Dot 的范围差异极大（从1粒到上百粒），这部分交给系统才不会出错。
- 排序就是这次配方的全部决策：排在最前面的会拿到该 Dot 范围内偏高的剂量，靠后的接近下限，没有进入列表的这次完全不用。所以真正驱动用户当前异常的那几个必须排在最前面。
- **列表长度必须是 ${rankTarget} 个**，不多不少，且不得重复。
- DOT-N7 不要出现在列表里——它的用法已由系统全权接管。
- 排序依据是完整的数字孪生，而不只是生物标志物：偏高的子年龄维度是主线，但睡眠、活动量、问卷、用户自述的目标与饮食禁忌同样是排序理由。一个子年龄看着正常、却明显拖累用户日常状态的方向，照样可以排得很靠前。

输出格式（严格遵守，回复正文照常撰写，然后在最后另起一行附上下方 JSON，短代码必须与配方库完全一致）：
${formatLineZh}

回复规则：
- 先给出对话式分析（不使用标题、不使用列表，2-3句话），再附上 JSON 行。
- 引用用户真实的生物标志物/趋势数值，说明驱动因素。
- 全程使用简体中文回复，结尾干净收尾，不提问、不引导用户继续追问。`;

    const taskEn = `You are Nano, a warm precision-longevity AI built by Waven. Your task right now: formulate the next 28 days' (4-week) Waven Dots plan for this user — this is a real formulation decision, not an explanation of an existing plan. The system repeats your assigned daily totals across all 28 days (except DOT-N7 — see its dedicated note in the formulary below).

Biomarker status (normal/elevated/high) is already labeled directly below — use that label as-is.

User: ${user_profile.nickname || 'the user'}${user_profile.age ? ', ' + user_profile.age + ' years old' : ' (age unknown)'}${user_profile.bmi ? ', BMI ' + user_profile.bmi : ''}
${questionnaire_context ? '\n' + questionnaire_context + '\n' : ''}
${healthPlanSection ? healthPlanSection + '\n' : ''}
${focusWeightingSection ? focusWeightingSection + '\n' : ''}${packageSection ? packageSection + '\n' : (tierLadderSection ? tierLadderSection + '\n' : '')}
${twinSection}

${seasonSection}

Biomarkers:
${biomarkersStr}
Age: BioAge = ${bioAge}, ChronoAge = ${chronoAge}
Elevated dimensions: ${elevatedDims}

Formulary (short key: name [ingredients] — daily total range, default slot, target dimension):
${formularyLines}

Available tools: call get_biomarker_history for historical test trends, get_dot_inventory for the user's current remaining stock of each Dot (avoid over-adding to a Dot they already have plenty of), get_nutrition_schedule for prior formulation history (avoid wild swings from recent plans, and learn the user's Dot usage habits). When unsure, verify with a tool rather than assuming.

Task:
1. Analysis: this text explains the actual formulation decision — it is **not** a generic health-status summary. Never just list biomarkers/BioAge/wearable data without naming any specific Dot. You must explicitly name at least 2-3 Dot short-keys/names you actually chose or emphasized in the "formulation" below, and explain why each was chosen and which biomarker or dimension it addresses — the reader should see this text and the formulation below as two parts of the same decision. You may briefly mention the key data driving the decision, but the core content is explaining the Dot choices, not restating the lab report. 2-3 sentences, conversational tone, no lists or headers.
2. Formulation: pick the ${rankTarget} short-keys worth most to this user and put them in one list, most important first. The system converts each position into a real count using that Dot's own range, pulse Dots included (it schedules those only on the real pulse days). The AM/PM split is computed automatically from each Dot's default slot and flexibility flag — you do **not** need to, and should **not**, write pill counts or decide the morning/evening split yourself; just get the order right.

Formulation rules (must follow):
- **You do not write any pill counts.** Your only judgement is which ${rankTarget} Dots from the formulary matter most to this user, **ordered from most important to least**. How many pills each one gets, how they split between morning and evening, and whether the total fits in a capsule are all computed by the system — the ranges differ enormously (1 pill to over a hundred), and that part is where they get crossed.
- The ordering IS the formulation decision: what you put first gets a dose near the top of its own range, later entries sit closer to their floor, and anything not on the list is not used this cycle. So whatever is actually driving this user's abnormal markers has to come first.
- **The list must contain exactly ${rankTarget} entries**, no more, no fewer, with no repeats.
- Do not include DOT-N7 — its dosing is entirely system-controlled.
- Rank from the whole digital twin, not the biomarkers alone: the elevated sub-age dimensions are the through-line, but sleep, activity, the questionnaire, and the user's own stated goals and dietary limits are equally valid reasons to rank something highly. A dimension that reads as normal can still hold back the user's day-to-day state, and belongs near the top when it does.

Output format (follow strictly — write your reply normally, then append the JSON below on a new final line, short-keys must exactly match the formulary):
${formatLineEn}

Reply rules:
- Give the conversational analysis first (no headers, no lists, 2-3 sentences), then append the JSON line.
- Reference the user's real biomarker/trend values as the driving rationale.
- Write entirely in English, end cleanly — no follow-up question, no prompting the user to continue.`;

    return `${getFactConstraintBlock(ctx.essential_knowledge, isZh)}

${getFactMemoryBlock(ctx.user_facts, isZh)}

${getTwinVocabBlock(isZh)}

${isZh ? taskZh : taskEn}`;
};
