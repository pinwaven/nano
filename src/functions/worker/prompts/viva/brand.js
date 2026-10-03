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

module.exports = { vivaBrand, DEFAULT_BRAND };
