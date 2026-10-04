'use strict';

// The company name in Viva's identity line. `brand_name` is the channel's override as
// lib/channels.js resolveChannelBrand returns it ({zh, en}); unset → Aeviva. Viva keeps her own
// name on every channel — only the company changes (SuperiorMed, 2026-10-03).
const DEFAULT_BRAND = 'Aeviva';

function vivaBrand(brand_name, language = 'zh') {
    if (typeof brand_name === 'string') return brand_name.trim() || DEFAULT_BRAND;
    const v = brand_name && (language === 'en' ? brand_name.en || brand_name.zh : brand_name.zh || brand_name.en);
    return (typeof v === 'string' && v.trim()) || DEFAULT_BRAND;
}

// Viva is brand-neutral (2026-10-04): her identity lines name no company, and she names the
// channel's brand only when the user asks who is behind her. withResponseLanguage appends this
// to every live Viva template. "Even if earlier replies named one" is there because history
// outweighs the prompt (see handlers/chat.js _alignHistoryBrand).
function vivaBrandRule(brand_name, language = 'zh') {
    const brand = vivaBrand(brand_name, language);
    return language === 'en'
        ? `COMPANY: By default never say which company or brand you belong to or work for — introduce yourself only as Viva, a precision longevity advisor, with no company name, even if your earlier replies named one. Only when the user explicitly asks which company is behind Viva (e.g. "Which company made you?", "Who do you work for?"), answer: ${brand}.`
        : `关于公司：默认不要提及你属于或服务于哪家公司、哪个品牌——自我介绍时只说你是 Viva、一位精准长寿顾问，不带任何公司名，即使你之前的回复里提到过也不要沿用。只有当用户明确问到 Viva 背后是哪家公司（例如"你是哪家公司的""谁开发了你"）时，才回答：${brand}。`;
}

module.exports = { vivaBrand, vivaBrandRule, DEFAULT_BRAND };
