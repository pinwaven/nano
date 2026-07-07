// Server-side academy certificate compositing — draws name/dates/cert number onto
// a certification's template image so every consumer (admin panel, miniapp, public
// verification page) loads the exact same pre-rendered PNG from OSS instead of each
// re-rendering the text on-device. Mirrors the layout/field semantics of
// src/web/admin-panel/src/utils/certRender.js (browser canvas) — keep the two in
// sync if the layout schema changes.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { pinyin } = require('pinyin-pro');
const ossLib = require('./oss');

const COMPOUND_SURNAMES = [
    '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '长孙', '慕容',
    '令狐', '宇文', '钟离', '独孤', '南宫', '闻人', '夏侯', '轩辕', '司徒', '司空',
    '太史', '端木', '百里', '东郭', '公羊', '澹台', '拓跋', '夹谷', '宰父',
];

function isChineseText(str) {
    return /[一-鿿]/.test(str || '');
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function toPinyinName(name) {
    if (!name || !isChineseText(name)) return name || '';
    const trimmed = name.trim();
    const surnameLen = COMPOUND_SURNAMES.some((s) => trimmed.startsWith(s)) ? 2 : 1;
    const surname = trimmed.slice(0, surnameLen);
    const given = trimmed.slice(surnameLen);
    const surnamePinyin = capitalize(pinyin(surname, { toneType: 'none', type: 'string', separator: '' }));
    if (!given) return surnamePinyin;
    const givenPinyin = capitalize(pinyin(given, { toneType: 'none', type: 'string', separator: '' }));
    return `${surnamePinyin} ${givenPinyin}`;
}

// mode: 'en' (pinyin if Chinese) | 'zh' (original) | 'both' (Chinese + pinyin)
function resolveDisplayName(rawName, mode = 'en') {
    if (!rawName) return '';
    const chinese = isChineseText(rawName);
    const english = chinese ? toPinyinName(rawName) : rawName;
    if (mode === 'zh') return rawName;
    if (mode === 'both') return chinese ? `${rawName}  ${english}` : english;
    return english;
}

const ORDINAL_SUFFIX = (day) => {
    if (day % 10 === 1 && day !== 11) return 'st';
    if (day % 10 === 2 && day !== 12) return 'nd';
    if (day % 10 === 3 && day !== 13) return 'rd';
    return 'th';
};

// "2027-12-31" -> "31st December 2027". Accepts either an ISO date string or a
// native Date. `pg` parses DATE columns using the process's local TZ (every FC
// function here sets TZ=Asia/Shanghai) — e.g. DATE '2026-07-06' becomes a Date
// object whose ISO/UTC form is "2026-07-05T16:00:00.000Z". `certification` arrives
// here over HTTP as JSON (worker -> media), which always serializes via
// toISOString(), so by the time this runs the value is a string one calendar day
// "behind" in UTC terms. A Date object and its JSON string represent the exact
// same instant either way, so shifting by the fixed +8h Shanghai offset (no DST in
// China) before reading fields recovers the correct calendar day regardless of
// which form this receives or what timezone the function itself runs in.
function formatOrdinal(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    const shanghai = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    const day = shanghai.getUTCDate();
    const month = shanghai.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    return `${day}${ORDINAL_SUFFIX(day)} ${month} ${shanghai.getUTCFullYear()}`;
}

// Mirrors DEFAULT_TEMPLATE_LAYOUT in the admin panel's certRender.js.
const DEFAULT_TEMPLATE_LAYOUT = {
    name:               { enabled: true,  xPct: 50, yPct: 44, fontSizePct: 4.2, color: '#1a1a1a', fontWeight: 'bold',   align: 'center' },
    certificate_number: { enabled: true,  xPct: 12, yPct: 88, fontSizePct: 1.8, color: '#8a7440', fontWeight: 'normal', align: 'left' },
    validity_date:      { enabled: true,  xPct: 12, yPct: 92, fontSizePct: 1.8, color: '#1a1a1a', fontWeight: 'normal', align: 'left' },
    issue_date:         { enabled: false, xPct: 50, yPct: 62, fontSizePct: 2.0, color: '#1a1a1a', fontWeight: 'normal', align: 'center' },
};

// Georgia/Times New Roman are almost certainly absent on Aliyun FC's Linux base
// image (no fonts bundled with the function code yet), so @napi-rs/canvas's Skia
// font matcher will fall through to whatever generic "serif" resolves to there —
// possibly a CJK font with no matching Latin glyphs. If deployed renders show
// missing/wrong-looking glyphs, bundle an actual .ttf under this directory and
// register it here with GlobalFonts.registerFromPath.
async function renderCertificateBuffer({ templateImageBuffer, layout, values }) {
    const image = await loadImage(templateImageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    Object.entries(layout || {}).forEach(([field, cfg]) => {
        if (!cfg || !cfg.enabled) return;
        const text = values?.[field];
        if (!text) return;
        const fontSize = (cfg.fontSizePct / 100) * canvas.height;
        const defaultFontFamily = field === 'name' ? 'Georgia, serif' : '"Times New Roman", Georgia, serif';
        ctx.font = `${cfg.fontWeight || 'normal'} ${fontSize}px ${cfg.fontFamily || defaultFontFamily}`;
        ctx.fillStyle = cfg.color || '#1a1a1a';
        ctx.textAlign = cfg.align || 'center';
        ctx.textBaseline = 'middle';
        const x = (cfg.xPct / 100) * canvas.width;
        const y = (cfg.yPct / 100) * canvas.height;
        ctx.fillText(text, x, y);
    });

    return canvas.toBuffer('image/png');
}

// Fetches the certification's template image + a user's nickname, composites the
// issued cert's fields onto it, uploads the result to OSS, and returns the new key.
// Returns null (never throws) if there's no template image to render onto — callers
// should treat that as "leave cert_oss_key unset, fall back to raw template display".
async function generateAndUploadCertificateImage({ certification, issuedCert, nickname }) {
    if (!certification?.template_image_oss_key) return null;
    try {
        const templateImageBuffer = await ossLib.getObjectBuffer(certification.template_image_oss_key);
        const layout = { ...DEFAULT_TEMPLATE_LAYOUT, ...(certification.template_layout || {}) };
        const values = {
            name: resolveDisplayName(nickname || '', 'en'),
            certificate_number: issuedCert.certificate_number ? `NO.${issuedCert.certificate_number}` : '',
            validity_date: issuedCert.expiry_date ? `Validity Date: ${formatOrdinal(issuedCert.expiry_date)}` : '',
            issue_date: issuedCert.issue_date ? `Awarded on ${formatOrdinal(issuedCert.issue_date)}` : '',
        };
        const buffer = await renderCertificateBuffer({ templateImageBuffer, layout, values });
        const key = ossLib.generateKey('cert-rendered', `${issuedCert.certificate_number || issuedCert.id}.png`);
        await ossLib.putObjectBuffer(key, buffer, 'image/png');
        return key;
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'certificate render failed', data: { certification_id: certification?.id, issued_id: issuedCert?.id, error: err.message } }));
        return null;
    }
}

module.exports = {
    isChineseText,
    toPinyinName,
    resolveDisplayName,
    formatOrdinal,
    DEFAULT_TEMPLATE_LAYOUT,
    renderCertificateBuffer,
    generateAndUploadCertificateImage,
};
