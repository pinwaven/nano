'use strict';

const { classifyBiomarkers, THRESHOLDS, LABELS_ZH, LABELS_EN } = require('../../lib/biomarkerStatus');

/**
 * The status of each Kino marker, stated for the model instead of left for it to judge. The
 * chat templates passed raw values only, so the model compared them to thresholds itself, and
 * not consistently. Live on dev 2026-09-23 (「Kino检查的6项指标分别代表什么？」): one reply listed
 * hsCRP 1.16 among the normal markers in prose, marked it 偏高 in its own :::metric card, and
 * called it 升高 two paragraphs later. One stated status anchors the prose and the card alike. Same failure class as the
 * 2026-07-25 GDF-15 incident that created biomarkerStatus.js; systemHealthAdvice already uses it.
 *
 * The cut-off rides along because a status alone invites the model to supply one: the same day a
 * reply wrote 「GA 13.5%，在正常范围（<15.5%）」 — the system's line is 15.
 */
function getBiomarkerStatusLine(biomarkers, isZh = true) {
    const status = classifyBiomarkers(biomarkers || {});
    const keys = Object.keys(status).filter(k => status[k]);
    if (keys.length === 0) return '';
    const labels = isZh ? LABELS_ZH : LABELS_EN;
    const unit = (k) => (THRESHOLDS[k].unit === 'x baseline' ? (isZh ? '倍基线' : '× baseline') : THRESHOLDS[k].unit);
    const list = keys.map(k => `${k} ${labels[status[k]]}（${isZh ? '正常' : 'normal'} <${THRESHOLDS[k].elevated} ${unit(k)}）`).join(isZh ? '、' : ', ');
    return isZh
        ? `\n指标状态（系统已按参考范围判定——正文和指标卡都直接使用这里的状态，不要自行与阈值比较，也不要改写为其他状态；需要说参考范围时只用括号里的数值）：${list}`
        : `\nMarker status (already classified against the reference ranges — use it as given in prose and in any metric card; never re-compare values to thresholds yourself or restate a different status; if you cite a reference range, use only the figure in brackets): ${list}`;
}

module.exports = { getBiomarkerStatusLine };
