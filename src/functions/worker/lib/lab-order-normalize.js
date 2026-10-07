'use strict';
const { validateExtraction } = require('./docExtraction');

// Explicit QCS labels only: D2/D3 fractions must never be mapped to total VitaminD.
const LABEL_KEYS = {
    '25-OH维生素D': 'VitaminD', '25羟维生素D': 'VitaminD',
    '同型半胱氨酸': 'Hcy', '糖化血红蛋白': 'HbA1c', '尿酸': 'UricAcid',
    '抗缪勒氏管激素': 'AMH', 'AMH': 'AMH', 'NAD+': 'NAD',
};
function labDate(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(n * 1000 + 8 * 3600000); // lab timestamps → Shanghai calendar day
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
function numeric(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^-?\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function normalizeOrder(order, catalog) {
    const goods = order.lab_final_result?.goods;
    if (!Array.isArray(goods)) return [];
    const ids = new Set();
    return goods.filter(g => g.progress === 'completed').map(g => {
        if (g.id == null || ids.has(String(g.id))) throw new Error('Missing or duplicate QCS goods id');
        ids.add(String(g.id));
        const date = labDate(g.reported_at);
        const rows = [];
        for (const [panelIndex,panel] of (g.bodyindex_panels || []).entries()) {
            for (const [itemIndex,item] of (panel.bodyindexes || []).entries()) {
                const label = String(item.name || '').trim();
                if (!label) continue;
                const dataDate = labDate(panel.test_time) || date;
                const key = LABEL_KEYS[label];
                // Validate each row independently so rejected/raw values survive in the record.
                // Missing units are not inferred, even though extraction allows that fallback.
                const validation = key && item.unit && numeric(item.value) != null && dataDate
                    ? validateExtraction({ document: { doc_type: 'lab_report', doc_date: dataDate }, observations: [
                        { key_name: key, label, value: item.value, unit: item.unit, data_date: dataDate },
                    ] }, catalog) : null;
                const observation = validation?.observations[0] || null;
                rows.push({ label, value_num: numeric(item.value), value_text: numeric(item.value) == null ? String(item.value ?? '') : null,
                    unit: item.unit || null, date: dataDate, section: panel.name || g.name,
                    observation, rejected: validation?.rejected || [], external_id: `${panel.id || panelIndex}:${item.id || itemIndex}` });
            }
        }
        return { id: String(g.id), name: String(g.name || '量康检验报告'), date: date || rows.find(r => r.date)?.date || null, rows };
    });
}
module.exports = { normalizeOrder, labDate, numeric, LABEL_KEYS };
