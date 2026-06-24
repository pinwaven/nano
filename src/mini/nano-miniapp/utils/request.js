/**
 * Unified HTTP request helper for the Waven Nano miniapp.
 *
 * Usage:
 *   const { req } = require('../../utils/request')
 *   const data = await req('/api/users/me', 'GET')
 *   const data = await req('/api/chat', 'POST', { openid, message })
 *
 * Resolves with the parsed response body on 2xx.
 * Rejects with a typed error on failure:
 *   err.type === 'auth'    → 401/403, caller should redirect to login
 *   err.type === 'server'  → 5xx
 *   err.type === 'network' → wx.request fail (no connection)
 *   err.type === 'client'  → 4xx other than auth
 */

const app = getApp()
const { BASE } = require('./config.js')

class RequestError extends Error {
  constructor(type, message, statusCode) {
    super(message)
    this.type = type
    this.statusCode = statusCode
  }
}

function req(path, method = 'GET', data = null) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  return new Promise((resolve, reject) => {
    const opts = {
      url,
      method,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${app.globalData.apiToken}`,
      },
      success(res) {
        const { statusCode, data: body } = res
        if (statusCode >= 200 && statusCode < 300) {
          resolve(body)
          return
        }
        const msg = body?.error || `HTTP ${statusCode}`
        if (statusCode === 401 || statusCode === 403) {
          reject(new RequestError('auth', msg, statusCode))
        } else if (statusCode >= 500) {
          reject(new RequestError('server', msg, statusCode))
        } else {
          reject(new RequestError('client', msg, statusCode))
        }
      },
      fail(err) {
        reject(new RequestError('network', err.errMsg || 'Network error', 0))
      },
    }
    if (data !== null) opts.data = data
    wx.request(opts)
  })
}

module.exports = { req, RequestError }
