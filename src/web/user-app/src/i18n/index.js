import { createContext, useContext } from 'react';
import { T as LEGACY } from './legacy.js';
import MAIN from './main.js';
import HEALTH, { TWIN_LAYER_LABELS } from './health.js';
import DOCS from './documents.js';
import AG from './ag.js';
import PHONES from './phones.js';
import EMAILS from './emails.js';
import REFERRAL from './referral.js';
import { SUB_AGE_KEYS } from '../config.js';

export { TWIN_LAYER_LABELS };

// Web-only additions the miniapp has no string for (its hardware buttons do the real thing).
const WEB_EXTRA = {
  zh: {
    wearableWebNotice: '请在微信小程序中绑定或同步手环，数据会自动显示在这里。',
    scanManualHint: '请输入二维码中的编码',
    scanCameraHint: '将二维码对准摄像头',
    scanUseCamera: '使用摄像头扫描',
    scanConfirm: '确认',
    scanCancel: '取消',
    loginFooter: '哈佛大学创新实验室 · 成员企业',
    continueAs: (masked) => `继续使用 ${masked}`,
    useOtherPhone: '使用其他手机号登录',
    useEmailLogin: '使用邮箱登录',
    welcomeBack: '欢迎回来',
    adminLinkNote: '在浏览器中打开网页后台',
    inviteLinkCopied: '邀请链接已复制',
    loadEarlier: '加载更早消息',
    chatStart: '— 对话开始 —',
    copyLink: '复制链接',
    openLink: '打开链接',
  },
  en: {
    wearableWebNotice: 'Bind or sync your ring in the WeChat Mini Program — its data shows up here automatically.',
    scanManualHint: 'Enter the code from the QR',
    scanCameraHint: 'Point the QR code at the camera',
    scanUseCamera: 'Scan with camera',
    scanConfirm: 'Confirm',
    scanCancel: 'Cancel',
    loginFooter: 'Harvard Innovation Labs · Member Company',
    continueAs: (masked) => `Continue as ${masked}`,
    useOtherPhone: 'Use another phone number',
    useEmailLogin: 'Sign in with email',
    welcomeBack: 'Welcome back',
    adminLinkNote: 'Opens the web admin panel',
    inviteLinkCopied: 'Invite link copied',
    loadEarlier: 'Load earlier messages',
    chatStart: '— Start of conversation —',
    copyLink: 'Copy link',
    openLink: 'Open link',
  },
};

function build(lang) {
  return {
    ...LEGACY[lang],
    ...MAIN[lang],
    ...WEB_EXTRA[lang],
    health: HEALTH[lang],
    docs: DOCS[lang],
    ag: AG[lang],
    phones: PHONES[lang],
    emails: EMAILS[lang],
    referral: REFERRAL[lang],
  };
}

export const T = { zh: build('zh'), en: build('en') };

// Channel-level sub-age display-name overrides (main.js:buildSubAgeLabels). Applied to both
// the main table and the health table, which each carry their own subAgeLabels.
export function buildSubAgeLabels(base, overrides, lang) {
  if (!overrides) return base;
  const result = { ...base };
  for (const key of SUB_AGE_KEYS) {
    const override = overrides[key]?.[lang];
    if (override && override.trim()) result[key] = override.trim();
  }
  return result;
}

export function tableFor(lang, channel) {
  const l = lang === 'en' ? 'en' : 'zh';
  const base = T[l];
  const overrides = channel?.sub_age_display_names || null;
  if (!overrides) return base;
  return {
    ...base,
    subAgeLabels: buildSubAgeLabels(base.subAgeLabels, overrides, l),
    health: { ...base.health, subAgeLabels: buildSubAgeLabels(base.health.subAgeLabels, overrides, l) },
  };
}

// `{{key}}` interpolation, as pages/phones/phones.js:fmt.
export function fmt(str, vars = {}) {
  return String(str ?? '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

export const LangContext = createContext({ lang: 'zh', t: T.zh });
export const useLang = () => useContext(LangContext);
