// GCN storefront handoff — the web twin of pages/appview/appview.js + main.js:_openAevivaStore.
// The store lives on <slug>(-dev).gcn.net; a one-time 60s `wvt` (POST /webview-token, with
// the miniapp's `context` intents carried verbatim) signs the buyer in over there. Opens a
// NEW TAB: the tab is created synchronously in the click handler and navigated after the mint,
// because a window.open after an await is popup-blocked on Safari and Chrome.
import { api } from './api.js';
import { gcnStoreHost } from './config.js';
import { ui } from './components/ui/ui.js';

export async function openGcnStore(app, context = null, path = '/dashboard.html') {
  const { user, channel } = app;
  const base = `${gcnStoreHost(channel)}${path}`;
  const win = window.open('', '_blank');
  const go = url => { if (win) win.location.href = url; else window.location.href = url; };
  if (!user?.user_id) { go(base); return; }
  try {
    const res = await api.post('/webview-token', context ? { openid: user.user_id, context } : { openid: user.user_id });
    const wvt = res?.wvt;
    const sep = base.includes('?') ? '&' : '?';
    go(wvt ? `${base}${sep}wvt=${encodeURIComponent(wvt)}` : base);
  } catch {
    go(base); // appview.js does the same: the store still opens, just signed out
  }
}

// main.js:_openAevivaStoreGated — the store needs a verified phone (or, on the Waven tree, a
// verified email). Same copy as the miniapp modal; "去验证" opens the Phones page here.
export async function openGcnStoreGated(app, context = null) {
  const { phone, email } = await app.checkIdentityVerified();
  const verified = phone || (email && app.emailLoginAllowed);
  if (!verified) {
    const zh = app.lang === 'zh';
    const ea = app.emailLoginAllowed;
    const { confirm } = await ui.confirm({
      title: zh ? (ea ? '需要验证手机号或邮箱' : '需要验证手机号') : (ea ? 'Verification needed' : 'Phone verification needed'),
      content: zh
        ? (ea ? '进入商城前，请先验证您的手机号码或邮箱' : '进入商城前，请先验证您的手机号码')
        : (ea ? 'Please verify your phone number or email before entering the store.' : 'Please verify your phone number before entering the store.'),
      confirmText: zh ? '去验证' : 'Verify',
      cancelText: zh ? '取消' : 'Cancel',
    });
    if (confirm) app.setRoute('phones');
    return false;
  }
  await openGcnStore(app, context);
  return true;
}
