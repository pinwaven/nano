'use strict';

// Severity tags computed from a user's digital twin — the small, human-readable summary layer
// over health_twin + the latest Kino biomarker snapshot + self-declared conditions.
//
// Extracted verbatim from handlers/chat.js's own _buildHealthTagsBackend (where it backed
// GET /health-twin) so it can also be used by handlers/dots.js's GCN-facing formulation-review
// snapshot without dots.js requiring chat.js — chat.js already requires dots.js, so the reverse
// edge would be a cycle. Pure function, no pool access, which is what makes it safely shareable.
function buildHealthTags(twin, bm, conditionKeys) {
    const tags = [];
    const order = { alert: 0, warn: 1, good: 2 };

    if (bm) {
        if (bm.hsCRP > 3)            tags.push({ labelEn: 'High Inflammation',  labelZh: '炎症偏高',      severity: 'alert', color: '#ef4444' });
        else if (bm.hsCRP > 1)       tags.push({ labelEn: 'Mild Inflammation',   labelZh: '轻微炎症',      severity: 'warn',  color: '#f97316' });
        if (bm.IL6 > 6)              tags.push({ labelEn: 'Elevated IL-6',       labelZh: 'IL-6 升高',    severity: 'alert', color: '#ef4444' });
        if (bm.GDF15 > 1500)         tags.push({ labelEn: 'Accelerated Aging',   labelZh: '衰老加速',      severity: 'alert', color: '#ef4444' });
        else if (bm.GDF15 > 750)     tags.push({ labelEn: 'Elevated GDF-15',     labelZh: 'GDF-15 升高',  severity: 'warn',  color: '#f97316' });
        if (bm.GA > 20)              tags.push({ labelEn: 'Metabolic Risk',       labelZh: '代谢功能异常',  severity: 'alert', color: '#ef4444' });
        else if (bm.GA > 15)         tags.push({ labelEn: 'Elevated GA',          labelZh: '糖化白蛋白偏高', severity: 'warn',  color: '#f97316' });
        if (bm.CystatinC > 1.2)      tags.push({ labelEn: 'Vascular Stress',     labelZh: '血管压力',      severity: 'alert', color: '#ef4444' });
        else if (bm.CystatinC > 0.9) tags.push({ labelEn: 'Elevated Cystatin C', labelZh: '胱抑素C偏高',  severity: 'warn',  color: '#f97316' });
        if (bm.CD38 > 2)             tags.push({ labelEn: 'High CD38',            labelZh: 'CD38 升高',    severity: 'warn',  color: '#f97316' });
    }

    if (twin) {
        if (twin.avg_sleep_hours != null) {
            if (twin.avg_sleep_hours < 6)        tags.push({ labelEn: 'Sleep Deficit',    labelZh: '睡眠严重不足', severity: 'alert', color: '#ef4444' });
            else if (twin.avg_sleep_hours < 7)   tags.push({ labelEn: 'Low Sleep',         labelZh: '睡眠不足',    severity: 'warn',  color: '#f97316' });
            else if (twin.avg_sleep_hours <= 9)  tags.push({ labelEn: 'Good Sleep',        labelZh: '睡眠良好',    severity: 'good',  color: '#10b981' });
        }
        if (twin.avg_hrv_ms != null) {
            if (twin.avg_hrv_ms < 30)            tags.push({ labelEn: 'Low HRV',           labelZh: 'HRV 偏低',   severity: 'alert', color: '#ef4444' });
            else if (twin.avg_hrv_ms >= 80)      tags.push({ labelEn: 'Strong Recovery',   labelZh: '恢复力强',    severity: 'good',  color: '#10b981' });
        }
        if (twin.avg_resting_hr != null) {
            if (twin.avg_resting_hr > 90)        tags.push({ labelEn: 'Elevated HR',       labelZh: '心率过快',    severity: 'alert', color: '#ef4444' });
            else if (twin.avg_resting_hr > 75)   tags.push({ labelEn: 'High Resting HR',   labelZh: '静息心率偏高', severity: 'warn',  color: '#f97316' });
        }
        if (twin.avg_daily_steps != null) {
            if (twin.avg_daily_steps < 5000)     tags.push({ labelEn: 'Low Activity',      labelZh: '活动量不足',   severity: 'warn',  color: '#f97316' });
            else if (twin.avg_daily_steps >= 10000) tags.push({ labelEn: 'Active',          labelZh: '活动达标',    severity: 'good',  color: '#10b981' });
        }
    }

    const condTagMap = {
        blood_sugar_high:    { en: 'High Blood Sugar',    zh: '血糖高' },
        blood_pressure_high: { en: 'High Blood Pressure', zh: '血压高' },
        blood_lipids_high:   { en: 'High Blood Lipids',   zh: '血脂高' },
        cholesterol_high:    { en: 'High Cholesterol',    zh: '胆固醇高' },
        heart_issues:        { en: 'Heart Issues',        zh: '心脏问题' },
        kidney_disease:      { en: 'Kidney Disease',      zh: '肾病' },
    };
    for (const key of (conditionKeys || [])) {
        const m = condTagMap[key];
        if (m) tags.push({ labelEn: m.en, labelZh: m.zh, severity: 'warn', color: '#f97316' });
    }

    tags.sort((a, b) => order[a.severity] - order[b.severity]);
    return tags.slice(0, 7);
}

module.exports = { buildHealthTags };
