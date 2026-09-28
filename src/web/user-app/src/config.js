// App-level constants mirrored from the Mini Program (pages/main/main.js §Constants and
// utils/config.js). The web build has no envVersion; the backend split is decided by the
// dev proxy target (`__API_IS_DEV__`, vite.config.js) or, on a deployed build, by the host.

export const IS_DEV_BACKEND = (typeof __API_IS_DEV__ !== 'undefined' && __API_IS_DEV__)
  || (typeof location !== 'undefined' && /-dev\./.test(location.hostname));

// Shown in the header next to the nickname, like the miniapp's `v{version}`. Bump on release.
export const VERSION = '0925-1';

export const API = '/api';

// Which channel trees have a GCN storefront, keyed on the ROOT of the channel tree
// (channel.root_key_name — aeviva-china → aeviva, waven-china-zj → waven) and mapped to the
// GCN site host slug (`<slug>(-dev).gcn.net`). Mirrors main.js:GCN_STORE_HOST_FOR_CHANNEL.
export const GCN_STORE_HOST_FOR_CHANNEL = { aeviva: 'aeviva', waven: 'waven' };

export function channelRootKey(channel) {
  if (!channel) return null;
  if (channel.root_key_name) return channel.root_key_name;
  const key = String(channel.key_name || '');
  return key ? key.split('-')[0] : null;
}
export function gcnStoreSlug(channel) {
  return GCN_STORE_HOST_FOR_CHANNEL[channelRootKey(channel)] || null;
}
// `isAeviva` is the historical name for "this channel has a GCN storefront" — the Store tab,
// packages, redeem codes and formulation CTAs all key on it. True for the waven tree too.
export function isAevivaChannel(channel) {
  return !!gcnStoreSlug(channel);
}
export function emailLoginAllowedFor(channel) {
  return true;
}
export function gcnStoreHost(channel) {
  const slug = gcnStoreSlug(channel) || 'aeviva';
  return IS_DEV_BACKEND ? `https://${slug}-dev.gcn.net` : `https://${slug}.gcn.net`;
}

// ── Chat delivery contract (main.js:852–882) ────────────────────────────────

// Notification types whose text is ALSO written to chat_messages by the backend, so the
// chat_messages catch-up poll can legitimately re-deliver the same text. Only these take part
// in the cross-channel de-duplication. Deliberately excludes coach_reminder and
// questionnaire_ready, which have no chat_messages row.
export const AI_ECHO_TYPES = new Set([
  'chat_reply', 'nutrition_plan', 'formulation_proposal', 'formulation_reorder_ready',
  'formulation_order_paid', 'biological_report',
  'coach_message', 'morning_checkin', 'midday_checkin', 'evening_checkin',
  'viva_ag_result', 'viva_ag_failed', 'viva_ag_questionnaire',
  'doc_extraction_result',
  'program_day', 'program_day_summary', 'program_day_comment',
]);

// Async ({processing:true}): the server's whole worst case. Sync ({success:true}): the reply was
// already written when the ack arrived, so it is one poll tick away on either channel.
export const CHAT_WAIT_ASYNC_MS = 285000;
export const CHAT_WAIT_SYNC_MS = 30000;

// Delivered by the external Viva AG agent — drives the "Viva AG" bubble label.
export const AG_NOTIFICATION_TYPES = new Set(['viva_ag_result', 'viva_ag_failed', 'viva_ag_questionnaire']);

export const MSG_SEPARATOR_GAP_MS = 30 * 60 * 1000;

export const SUB_AGE_KEYS = ['ResilienceAge', 'CellularAge', 'MetabolicAge', 'MicroVascularAge'];
export const SUB_AGE_COLORS = {
  ResilienceAge: '#c084d4', CellularAge: '#10b981',
  MetabolicAge: '#6375EC', MicroVascularAge: '#0ea5e9',
};

export const STORAGE_KEYS = {
  user: 'nano_user', channel: 'nano_channel', coach: 'nano_coach', theme: 'nano_theme',
  textScale: 'nano_text_scale', sandboxActive: 'nano_sandbox_active', sandboxOrigin: 'nano_sandbox_origin',
  lastSession: 'nano_last_session', ref: 'nano_ref', cart: 'nano_cart',
};
