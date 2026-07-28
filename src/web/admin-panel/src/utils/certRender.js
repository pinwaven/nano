// Composes dynamic text (name / cert number / dates) onto an academy certificate
// template image using canvas, entirely client-side.

import { pinyin } from 'pinyin-pro';

// Common two-character compound surnames (百家姓 compound surnames) — used so
// e.g. "欧阳娜娜" romanizes as "Ouyang Nana" instead of "Ou Yangnana".
const COMPOUND_SURNAMES = [
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '长孙', '慕容',
  '令狐', '宇文', '钟离', '独孤', '南宫', '闻人', '夏侯', '轩辕', '司徒', '司空',
  '太史', '端木', '百里', '东郭', '公羊', '澹台', '拓跋', '夹谷', '宰父',
];

export function isChineseText(str) {
  return /[一-鿿]/.test(str || '');
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// "陈红梅" -> "Chen Hongmei" (surname romanized separately from the given name)
export function toPinyinName(name) {
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
export function resolveDisplayName(rawName, mode) {
  if (!rawName) return '';
  const chinese = isChineseText(rawName);
  const english = chinese ? toPinyinName(rawName) : rawName;
  if (mode === 'zh') return rawName;
  if (mode === 'both') return chinese ? `${rawName}  ${english}` : english;
  return english; // 'en' (default)
}

export const NAME_DISPLAY_MODES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'both', label: 'English + Chinese' },
];

const ORDINAL_SUFFIX = (day) => {
  if (day % 10 === 1 && day !== 11) return 'st';
  if (day % 10 === 2 && day !== 12) return 'nd';
  if (day % 10 === 3 && day !== 13) return 'rd';
  return 'th';
};

// "2027-12-31" -> "31st December 2027"
export function formatOrdinal(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'long' });
  return `${day}${ORDINAL_SUFFIX(day)} ${month} ${d.getFullYear()}`;
}

// layout: { [fieldKey]: { enabled, xPct, yPct, fontSizePct, color, fontWeight, align } }
// values: { [fieldKey]: string }
export function renderCertificate({ imageObjectUrl, layout, values }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        Object.entries(layout || {}).forEach(([field, cfg]) => {
          if (!cfg || !cfg.enabled) return;
          const text = values?.[field];
          if (!text) return;
          const fontSize = (cfg.fontSizePct / 100) * canvas.height;
          // Georgia's default numerals are old-style (0/1/2 sit at x-height, 6/8 reach
          // cap-height) so digit-bearing fields look uneven. Times New Roman uses
          // uniform lining figures, so it's the fallback for anything but the name field.
          const defaultFontFamily = field === 'name' ? 'Georgia, serif' : '"Times New Roman", Georgia, serif';
          ctx.font = `${cfg.fontWeight || 'normal'} ${fontSize}px ${cfg.fontFamily || defaultFontFamily}`;
          ctx.fillStyle = cfg.color || '#1a1a1a';
          ctx.textAlign = cfg.align || 'center';
          ctx.textBaseline = 'middle';
          const x = (cfg.xPct / 100) * canvas.width;
          const y = (cfg.yPct / 100) * canvas.height;
          ctx.fillText(text, x, y);
        });

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Failed to load template image'));
    img.src = imageObjectUrl;
  });
}

export const DEFAULT_TEMPLATE_LAYOUT = {
  name:               { enabled: true,  xPct: 50, yPct: 44, fontSizePct: 4.2, color: '#1a1a1a', fontWeight: 'bold',   align: 'center' },
  certificate_number: { enabled: true,  xPct: 12, yPct: 88, fontSizePct: 1.8, color: '#8a7440', fontWeight: 'normal', align: 'left' },
  validity_date:      { enabled: true,  xPct: 12, yPct: 92, fontSizePct: 1.8, color: '#1a1a1a', fontWeight: 'normal', align: 'left' },
  issue_date:         { enabled: false, xPct: 50, yPct: 62, fontSizePct: 2.0, color: '#1a1a1a', fontWeight: 'normal', align: 'center' },
};

export const LAYOUT_FIELDS = ['name', 'certificate_number', 'validity_date', 'issue_date'];
