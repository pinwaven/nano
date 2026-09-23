const { BASE, ENV_VERSION } = require('./utils/config.js')
const session = require('./utils/session.js')

App({
  globalData: {
    user: null,
    channel: null,
    coach: null,
    lang: 'zh',
    theme: 'dark',
    textScale: 0,   // accessibility text size, 0-3; see .fs-1/.fs-2/.fs-3 in app.wxss
    // This user's own API session (utils/session.js) — set on launch and by every login.
    // Empty for a guest or a signed-out install.
    apiToken: '',
    sandboxMode: false,
  },

  // Holds the resolve fn WeChat passes to onNeedPrivacyAuthorization.
  // The user-health component reads this and calls it after the user taps agree.
  _privacyResolve: null,
  _onPrivacyRequest: null,

  onLaunch() {
    try {
      // A stored session is only valid against the backend that issued it. wx.storage is
      // shared per appid across envVersions, so a phone that ran a 预览 build (trial → prod)
      // and then 真机调试 (develop → dev) would carry the prod user_id into dev, where the
      // server does not know it. Live incident 2026-09-19: dev minted a ghost account for the
      // prod id and two days of ring syncs + ECG strips landed there while the header kept
      // showing the cached prod profile. nano_base records the issuing BASE at login
      // (login.js); a mismatch clears the session and last-session snapshot so the user
      // re-logs in on this backend. Sessions from before the marker existed are grandfathered
      // on prod builds (nothing else they could have come from) and cleared in the IDE/
      // 真机调试, where a wrong guess is cheap and the leak actually happens.
      const storedBase = wx.getStorageSync('nano_base')
      if (storedBase !== BASE) {
        if (storedBase || ENV_VERSION === 'develop') {
          for (const k of ['nano_user', 'nano_channel', 'nano_coach', 'nano_last_session', 'nano_session', 'nano_session_at']) wx.removeStorageSync(k)
        }
        wx.setStorageSync('nano_base', BASE)
      }
      const user = wx.getStorageSync('nano_user')
      const channel = wx.getStorageSync('nano_channel')
      const coach = wx.getStorageSync('nano_coach')
      // Deliberately read OUTSIDE the `if (user)` block below, unlike theme: an
      // accessibility setting has to survive logout and apply on the guest/login
      // screens too, where globalData.user is still null.
      // `??` chain, not `||`: 0 is a valid level and `||` would treat it as unset and
      // fall through to the server value.
      const storedScale = parseInt(wx.getStorageSync('nano_text_scale'), 10)
      const serverScale = parseInt(user && user.text_scale, 10)
      const resolvedScale = Number.isNaN(storedScale)
        ? (Number.isNaN(serverScale) ? 0 : serverScale)
        : storedScale
      this.globalData.textScale = Math.max(0, Math.min(3, resolvedScale))
      // Restore any stored account regardless of phone completeness — phone is optional
      // (see guest sign-up password-skip). Missing-phone nudging is handled in-chat instead.
      if (user) {
        this.globalData.user = user
        this.globalData.channel = channel || null
        this.globalData.coach = coach || null
        this.globalData.lang = user.language === 'en' ? 'en' : ((channel?.locale === 'en') ? 'en' : 'zh')
        const savedTheme = wx.getStorageSync('nano_theme')
        this.globalData.theme = savedTheme || user.theme || 'dark'
        this.globalData.sandboxMode = !!wx.getStorageSync('nano_sandbox_active')
      }
      session.restoreSession(this)
    } catch (e) {}

    this._applyUpdates()

    // WeChat fires this whenever a privacy API (e.g. openBluetoothAdapter) is
    // called and the user hasn't consented yet. Without this listener WeChat
    // blocks the call with "fail appid privacy api banned" in release builds.
    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        this._privacyResolve = resolve
        if (this._onPrivacyRequest) this._onPrivacyRequest()
      })
    }
  },

  // Apply a new version as soon as WeChat has it, instead of on some later cold start: the
  // server stops accepting the old build's shared token once every install has moved to
  // per-user sessions, so a lingering old version would eventually just stop working.
  _applyUpdates() {
    if (!wx.getUpdateManager) return
    const mgr = wx.getUpdateManager()
    mgr.onUpdateReady(() => {
      wx.showModal({
        title: this.globalData.lang === 'en' ? 'Update ready' : '新版本已就绪',
        content: this.globalData.lang === 'en' ? 'Restart to use the new version.' : '重启小程序以使用新版本。',
        showCancel: false,
        success: () => mgr.applyUpdate(),
      })
    })
  },
})
