// Imperative UI service standing in for wx.showToast / wx.showModal / wx.showActionSheet /
// wx.scanCode, so ported handlers read like the miniapp's. <UiHost/> (ui-host.jsx) renders
// whatever is queued here; every function returns a promise the caller can await.
let host = null;
export function _bindHost(h) { host = h; }

export const ui = {
  toast(title, { icon = 'none', duration = 1500 } = {}) {
    host?.toast({ title: String(title ?? ''), icon, duration });
  },
  // Resolves { confirm: boolean } like wx.showModal's success payload.
  confirm({ title = '', content = '', confirmText, cancelText, showCancel = true, editable = false, placeholderText = '' } = {}) {
    return new Promise(resolve => host?.confirm({ title, content, confirmText, cancelText, showCancel, editable, placeholderText, resolve }));
  },
  // Resolves { tapIndex } or rejects on cancel, like wx.showActionSheet.
  actionSheet({ itemList = [], title = '' } = {}) {
    return new Promise((resolve, reject) => host?.actionSheet({ itemList, title, resolve, reject }));
  },
  // Resolves the decoded string; rejects on cancel. Camera when BarcodeDetector exists,
  // otherwise a manual code field — both hand back the same string wx.scanCode would.
  scan({ title = '' } = {}) {
    return new Promise((resolve, reject) => host?.scan({ title, resolve, reject }));
  },
  loading(title = '', on = true) { host?.loading(on ? String(title) : null); },
};
