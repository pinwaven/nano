// Per-user API session. Every request sends `Authorization: Bearer ${app.globalData.apiToken}`;
// that value is now this user's own signed session (`u.…`, 30 days), handed back by every login
// response as `session_token` — not the shared app bearer every build used to ship, which the
// server treated as superadmin (TODO.md "Security", phase 3). The server decides per request
// what the session may do (worker lib/userAccess.js): own data, or a coach's own clients.
//
// Storage: nano_session (token) + nano_session_at (ms it was saved), next to nano_user.

const { BASE } = require('./config.js')

// The shared bearer, kept ONLY for upgradeLegacySession(): an install that was signed in before
// this build exchanges it once for its own session instead of logging in again. Dies with
// LEGACY_APP_BEARER=reject on the server, after which that one call 401s and the user signs in.
const LEGACY_APP_BEARER = 'tokenData-gh9bc7917115bid72c68c8c4693g'

const TOKEN_KEY = 'nano_session'
const SAVED_AT_KEY = 'nano_session_at'
const REFRESH_AFTER_MS = 24 * 3600 * 1000

function saveSession(app, token) {
  if (!token) return
  app.globalData.apiToken = token
  try {
    wx.setStorageSync(TOKEN_KEY, token)
    wx.setStorageSync(SAVED_AT_KEY, Date.now())
  } catch (e) {}
}

function clearSession(app) {
  app.globalData.apiToken = ''
  try {
    wx.removeStorageSync(TOKEN_KEY)
    wx.removeStorageSync(SAVED_AT_KEY)
  } catch (e) {}
}

function _post(path, token, data) {
  return new Promise((resolve) => {
    wx.request({
      url: `${BASE}/api${path}`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      data: data || {},
      success: resolve,
      fail: () => resolve(null),
    })
  })
}

// Called from app.onLaunch after nano_user is restored. Never blocks launch: the stored token
// (or, for an install from before sessions, the legacy bearer as a stopgap) is set at once and
// any network exchange happens in the background.
function restoreSession(app) {
  let token = ''
  let savedAt = 0
  try {
    token = wx.getStorageSync(TOKEN_KEY) || ''
    savedAt = Number(wx.getStorageSync(SAVED_AT_KEY)) || 0
  } catch (e) {}
  const user = app.globalData.user
  const signedIn = !!(user && !user.guest && user.user_id)

  if (token) {
    app.globalData.apiToken = token
    if (signedIn && Date.now() - savedAt > REFRESH_AFTER_MS) refreshSession(app)
    return
  }
  if (signedIn) {
    app.globalData.apiToken = LEGACY_APP_BEARER
    upgradeLegacySession(app, user.user_id)
    return
  }
  app.globalData.apiToken = ''
}

async function refreshSession(app) {
  const res = await _post('/session/refresh', app.globalData.apiToken)
  if (!res) return
  if (res.statusCode === 200 && res.data && res.data.session_token) saveSession(app, res.data.session_token)
  else if (res.statusCode === 401) handleAuthFailure(app)
}

async function upgradeLegacySession(app, userId) {
  const res = await _post('/session/upgrade', LEGACY_APP_BEARER, { user_id: userId })
  if (res && res.statusCode === 200 && res.data && res.data.session_token) {
    saveSession(app, res.data.session_token)
  } else if (res && res.statusCode === 401) {
    handleAuthFailure(app)
  }
}

// A 401 means the session is gone (expired, account deleted, or the legacy bearer cut off).
// Drop it and send the user through login once; the login page re-authenticates silently via
// WeChat. 403 is NOT this — that is the server refusing one request, and the session is fine.
let _redirecting = false
function handleAuthFailure(app) {
  if (_redirecting) return
  _redirecting = true
  clearSession(app)
  try { wx.removeStorageSync('nano_user') } catch (e) {}
  app.globalData.user = null
  wx.reLaunch({ url: '/pages/login/login', complete: () => { _redirecting = false } })
}

// For the pages' own request helpers: call with each response's statusCode.
function checkAuthStatus(app, statusCode) {
  if (statusCode === 401 && app.globalData.apiToken) handleAuthFailure(app)
}

module.exports = { saveSession, clearSession, restoreSession, checkAuthStatus, handleAuthFailure }
