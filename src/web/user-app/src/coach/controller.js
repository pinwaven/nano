// A page-local adapter: never installs wx/getApp on window or impersonates the client.
import { createCoachPage } from './generated/controller.js';
import { createTools } from './generated/tools.js';
import { req, clipboard } from '../api.js';
import { VERSION } from '../config.js';
import { ui } from '../components/ui/ui.js';

export function createController(appRef, publish, { storage, request = req, uiService = ui } = {}) {
  let alive = true;
  const app = { globalData: {} };
  const current = appRef.current;
  Object.assign(app.globalData, {
    user: current.user, channel: current.channel, coach: current.coach,
    lang: current.lang, theme: current.theme, textScale: current.textScale, sandboxMode: current.sandboxMode,
  });
  const finish = async (promise, opts, map = v => v) => {
    try { const result = map(await promise); if (alive) await opts.success?.(result); return result; }
    catch (e) { if (alive) opts.fail?.(e); }
    finally { if (alive) opts.complete?.(); }
  };
  const wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 0, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ left: 398 }),
    setNavigationBarColor() {},
    getStorageSync: storage.get,
    setStorageSync: storage.set,
    removeStorageSync: storage.remove,
    navigateBack: () => appRef.current.setRoute(null),
    reLaunch: () => appRef.current.setRoute(null),
    showToast: ({ title, ...opts }) => alive && uiService.toast(title, opts),
    showLoading: ({ title }) => alive && uiService.loading(title),
    hideLoading: () => uiService.loading('', false),
    showModal: opts => finish(uiService.confirm(opts), opts),
    showActionSheet: opts => finish(uiService.actionSheet(opts), opts),
    scanCode: opts => finish(uiService.scan(), opts, result => ({ result })),
    setClipboardData: opts => finish(clipboard.write(opts.data).then(ok => { if (!ok) throw new Error('Clipboard unavailable'); }), opts),
    // Only the image PUT uses this method; API traffic below uses the authenticated client.
    request: opts => finish((async () => {
      const response = await fetch(opts.url, { method: opts.method, body: opts.data, headers: opts.header });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      return { statusCode: response.status, data: await response.text() };
    })(), opts),
    getFileSystemManager: () => ({
      readFile: opts => finish(opts.filePath.arrayBuffer(), opts, data => ({ data })),
      unlink() {},
    }),
  };
  const page = createCoachPage({ app, wx, session: {}, toolActions: createTools({ wx, BASE: '' }), maskPhone: () => '', BASE: '', VERSION });
  page.setData = (patch, callback) => {
    if (!alive) return;
    const next = { ...page.data };
    for (const [path, value] of Object.entries(patch)) {
      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = next;
      for (let i = 0; i < parts.length - 1; i++) { const k = parts[i]; target[k] = Array.isArray(target[k]) ? [...target[k]] : { ...target[k] }; target = target[k]; }
      target[parts.at(-1)] = value;
    }
    page.data = next;
    publish(next);
    callback?.();
  };
  page._req = async (url, method = 'GET', data = null, timeoutMs = 60000) => {
    try {
      if (!alive) throw new Error('Coach panel closed');
      const result = await request(url.replace(/^\/api/, ''), method, data, { timeoutMs: timeoutMs || 60000, raw: true });
      if (!alive) throw new Error('Coach panel closed');
      // These endpoints return localized reason codes handled by the page. Other mutations
      // must reject HTTP failures, or legacy miniapp handlers would display a false success.
      if (result.statusCode >= 400 && method !== 'GET' && !/^\/api\/(managed-customers|formulation-redeem|box-claim|chat)(?:[/?]|$)/.test(url)) {
        throw new Error(result.data?.error || `HTTP ${result.statusCode}`);
      }
      return result;
    }
    catch (e) { throw e; }
  };
  // Session/theme/language state belongs to AppProvider, not a second copy of the login.
  page.handleLogout = () => appRef.current.logout();
  page.exitSandbox = () => appRef.current.exitSandbox();
  page.toggleTheme = () => appRef.current.toggleTheme();
  page.toggleLang = () => appRef.current.toggleLang();
  page._applyTextScale = n => appRef.current.setTextScale(n);
  page.data.today = new Date().toLocaleDateString('en-CA');
  const startPoll = page._startVivaPoll;
  page._startVivaPoll = function (...args) { if (alive) return startPoll.apply(this, args); };
  const initialize = page.onLoad;
  page.onLoad = function () { initialize.call(this); this.setData({ capsuleRightPad: 0, theme: appRef.current.theme }); };
  return { page, dispose() { alive = false; page.onUnload(); } };
}
