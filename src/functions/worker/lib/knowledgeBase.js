'use strict';

/**
 * DB-backed replacement for Viva's two static knowledge layers (see CLAUDE.md):
 *   - getEssentialBlock(): always-injected guardrail/domain text (was factConstraint.js's
 *     hard-coded string) — every active 'essential' row for the persona, concatenated.
 *   - findRelevantEntries(): matched-on-request science/protocol claims (was the 3 static
 *     files under prompts/viva/knowledge/) — every active 'optional' row for the persona,
 *     substring/tag-matched in-process exactly as before. No RAG/embeddings, by design.
 *
 * No caching: the table is small (~15 rows) and each function runs at most a couple of
 * times per chat turn, negligible next to the LLM call latency it sits beside. Add a TTL
 * cache later only if this is ever shown to matter.
 */
const { pool } = require('./db');

// Last-resort fallback if the DB is unreachable — never ship a reply (Viva OR Nano, both
// personas share this fallback since the underlying facts — the 4 SubAge dimensions, the
// Dots-only rule — are persona-agnostic) with zero anti-hallucination guardrails just
// because of a transient DB error. Kept in sync with the 'fact-constraint-core' seed rows
// in migration_knowledge_entries.sql (one per persona_type); if those rows are edited via
// the admin panel, this constant intentionally stays as the original baseline.
const FALLBACK_ESSENTIAL_BLOCK = `【事实约束 — 最高优先级，不得违反】
严禁捏造以下内容：具体研究名称、期刊名称、发表年份、临床试验编号、受试者人数、统计百分比、具体起效时间窗口（如"72小时内""2周后"）、预期改善幅度或数值预测、作者姓名或机构名称、具体p值、基因位点编号（如rs开头的SNP编号）、等位基因频率、参考数据库名称。
错误示例（绝对禁止此类编造，即使内容听起来合理）：
• "上海瑞金医院队列研究显示，每周红肉摄入超过300g的人群，细胞年龄平均加速1.9岁（p=0.002）" —— 编造了机构、队列、具体数值与p值
• "东亚人FMO3 rs2266782基因型频率达89%" —— 编造了具体基因位点编号与等位基因频率
• "中华医学会血液学分会2023"、"中国多中心参考数据库" —— 编造了机构或数据库名称作为数据来源
引用循证等级时，只使用以下标准表述，不附加任何虚构细节：
• "有高质量人体临床证据"
• "有随机对照试验（RCT）支持"
• "有系统综述或荟萃分析支持"
• "证据尚不充分，建议保守参考"
如现有数据不足以支持某个判断，说明缺的是哪一项数据、补上它需要做什么，然后继续把现有数据已经能支持的部分讲清楚。"信息不足"只能作为回复中的一句限定说明，绝不能构成整条回复的全部内容；也不得先声明信息不足、随后又给出大段具体建议而自相矛盾。
严禁捏造或推断任何公司业务信息，包括：物流/配送时效、配送方式、会员计划、促销活动、价格、库存状态、退换货政策或任何未在本次对话中明确提供的服务细节。如用户询问此类信息，回复："这个问题需要联系客服或在 App 内查看最新信息，我无法代为确认。"
严禁引入任何未在本提示词中提供的具体机制、暴露因素、基因型、族群遗传学或分子生物学细节（如特定基因位点、酶变异型、环境暴露来源如"油烟""重金属"等）；东方人群相关洞见仅限于使用提示词中已提供的表述，不得在其基础上编造新的具体诱因。

本系统仅测量以下四个生理年龄维度，没有其他维度：CellularAge（细胞年龄）、MetabolicAge（代谢年龄）、MicroVascularAge（微血管年龄）、ResilienceAge（抗压年龄）。如用户提及本系统未提供的其他"年龄"概念（如"排毒年龄""肠道年龄""皮肤年龄""免疫年龄"等），必须明确告知"本系统目前未提供该项检测"，可礼貌说明其与现有四个维度中最相关的一个并简要解释，但绝不可编造该维度专属的检测方法、生物标志物组合或具体数值——不得假装它是本系统的真实输出。

只推荐已提供的产品：任何具体成分/补充剂/剂量建议都必须来自 Waven 原粒（Dots）配方库，或本提示词中明确列出的「可推荐商品」清单（若本次对话未提供该清单，则只有原粒可推荐）。绝不建议用户购买这两者之外的补充剂、草本、单体营养素或食材提取物（如“牛磺酸粉”“硫辛酸”“葡萄籽提取物”等），也不得凭训练记忆推荐任何品牌或产品。若两者都没有对应产品，直接说明“目前没有针对这一点的产品”，不得给出品牌、剂量或购买渠道建议。日常整体饮食/餐食建议不受此限制，但不得在饮食建议中夹带具体分离出的营养补充剂成分与剂量。
提及「可推荐商品」清单中的商品时：只说明它为什么与用户当前的情况相关，绝不可自行写出价格、库存、配送时效或优惠信息——这些由系统在你的回复之后自动附上，写出来只会与真实数据冲突。

提及具体 Dots 时，编号、名称、成分必须逐字复制提示词中 Dots 配方库里给出的原文，不得凭记忆改写、替换或编造——配方库内容可能随产品迭代更新，你训练数据中记忆的旧版名称/成分可能已不准确。如果不确定某个编号对应的准确名称，宁可只说编号，也不要猜测或凭记忆填写名称。

套餐文案例外（仅适用于配方卡上每一款原粒套餐的那一句定位说明）：为一款套餐撰写的那句话，可以使用向往式、有画面感的产品介绍语气，不必逐字挂靠某一项指标——它是产品介绍，不是疗效承诺。上述禁令在此处全部照常生效：不得写出起效时间、改善幅度、任何数值预测或效果保证；不得编造成分、作用机制或功效；原粒的编号、名称与成分仍必须逐字取自配方库；也不得写出价格、库存或购买渠道。`;

async function getEssentialBlock(personaType) {
    try {
        const { rows } = await pool.query(
            `SELECT content_zh FROM knowledge_entries
             WHERE persona_type = $1 AND tier = 'essential' AND status = 'active'
             ORDER BY sort_order, id`,
            [personaType]
        );
        const joined = rows.map(r => r.content_zh).join('\n\n');
        return joined || FALLBACK_ESSENTIAL_BLOCK;
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'essential_knowledge_fetch_failed_fallback', personaType, error: err.message }));
        return FALLBACK_ESSENTIAL_BLOCK;
    }
}

async function findRelevantEntries(personaType, text, limit = 8) {
    if (!text || typeof text !== 'string') return [];
    try {
        const { rows } = await pool.query(
            `SELECT id, topic, content_zh AS claim_zh, evidence_level FROM knowledge_entries
             WHERE persona_type = $1 AND tier = 'optional' AND status = 'active'`,
            [personaType]
        );
        const hits = rows.filter(entry => (entry.topic || []).some(tag => text.includes(tag)));
        return hits.slice(0, limit);
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'optional_knowledge_fetch_failed', personaType, error: err.message }));
        return [];
    }
}

module.exports = { getEssentialBlock, findRelevantEntries, FALLBACK_ESSENTIAL_BLOCK };
