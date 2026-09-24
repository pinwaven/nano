// Avatar picker: the 40-character gallery, plus (self view only) "use my photo" — upload a photo,
// the worker generates a personal 4-mood set in the gallery's style, the user previews and
// applies it. Record: docs/architecture/avatar-gallery.md §6.
//
// The component owns the custom flow end to end (pick → crop → upload → poll → preview → apply)
// and reports only outcomes: 'select' {avatarId} for a gallery pick, 'customapplied' {avatar_url,
// avatar_character:'custom', avatar_moods} once the server has applied a generated set.
const { AVATAR_GALLERY, DEFAULT_MOOD, CUSTOM_AVATAR_ID } = require('../../utils/mood.js')
const { BASE } = require('../../utils/config.js')

const app = getApp()
const POLL_MS = 5000
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024

const T = {
  zh: {
    title: '选择头像',
    myPhoto: '我的照片',
    myPhotoHint: '用你的照片生成专属头像',
    uploading: '正在上传照片…',
    generating: '正在生成你的专属头像，约 1–2 分钟。可以先关闭，稍后回来查看。',
    previewTitle: '你的专属头像',
    previewHint: '四种状态会随你的手环数据自动切换',
    use: '使用',
    ok: '好的',
    regenerate: '重新生成',
    tryAgain: '换一张照片',
    privacy: '原始照片仅用于生成，生成后立即删除。',
    moodRestored: '恢复', moodRelaxed: '放松', moodEngaged: '活力', moodStressed: '压力',
    err_no_face: '没有检测到清晰的人脸，请换一张正面照片。',
    err_multiple_faces: '照片里有多个人，请换一张只有你自己的照片。',
    err_not_a_photo: '请上传一张真实的本人照片。',
    err_not_frontal: '请换一张正面、面向镜头的照片。',
    err_gen_failed: '生成失败了，请稍后再试。',
    err_store_failed: '保存失败了，请稍后再试。',
    err_daily_limit: '今天的生成次数已用完，明天再来试试。',
    err_in_progress: '上一次生成还在进行中，请稍候。',
    err_too_large: '照片太大了，请换一张。',
    err_upload: '上传失败，请重试。',
    err_apply: '设置失败，请重试。',
  },
  en: {
    title: 'Choose an Avatar',
    myPhoto: 'My photo',
    myPhotoHint: 'Generate a personal avatar from your photo',
    uploading: 'Uploading photo…',
    generating: 'Generating your avatar — about 1–2 minutes. You can close this and come back.',
    previewTitle: 'Your avatar',
    previewHint: 'The four moods follow your wearable data',
    use: 'Use it',
    ok: 'OK',
    regenerate: 'Regenerate',
    tryAgain: 'Try another photo',
    privacy: 'Your photo is only used for generation and deleted right after.',
    moodRestored: 'Restored', moodRelaxed: 'Relaxed', moodEngaged: 'Engaged', moodStressed: 'Stressed',
    err_no_face: 'No clear face found — try a front-facing photo.',
    err_multiple_faces: 'More than one person in the photo — use one with only you.',
    err_not_a_photo: 'Please upload a real photo of yourself.',
    err_not_frontal: 'Please use a photo facing the camera.',
    err_gen_failed: 'Generation failed, please try again later.',
    err_store_failed: 'Saving failed, please try again later.',
    err_daily_limit: 'Daily limit reached — try again tomorrow.',
    err_in_progress: 'The previous generation is still running.',
    err_too_large: 'Photo is too large, please pick another.',
    err_upload: 'Upload failed, please retry.',
    err_apply: 'Could not apply, please retry.',
  },
}

const PREVIEW_ORDER = ['restored', 'relaxed', 'engaged', 'stressed']

Component({
  properties: {
    visible: { type: Boolean, value: false },
    selectedId: { type: String, value: '' },
    lang: { type: String, value: 'zh' },
    theme: { type: String, value: 'dark' },
    // Self view only. A coach never generates for a client; the server does not know the
    // difference, this prop is what keeps the tile off a coach's screen.
    allowUpload: { type: Boolean, value: false },
    // The openid used for every request.
    userId: { type: String, value: '' },
    // users.avatar_moods of the current user — renders the applied custom tile.
    customMoods: { type: Object, value: null },
  },

  data: {
    gallery: AVATAR_GALLERY,
    t: T.zh,
    CUSTOM_ID: CUSTOM_AVATAR_ID,
    // phase: 'idle' | 'uploading' | 'generating' | 'preview' | 'error'
    phase: 'idle',
    gen: null,           // latest generation row from the server (public shape)
    preview: [],         // [{mood, label, url}] in PREVIEW_ORDER
    errorText: '',
    busy: false,
    customThumb: '',     // the tile image: applied set's relaxed, else the latest done generation's
  },

  observers: {
    lang(lang) { this.setData({ t: T[lang] || T.zh }) },
    visible(v) {
      if (v) this._onShow()
      else this._stopPolling()
    },
    customMoods() { this._refreshCustomThumb() },
  },

  lifetimes: {
    detached() { this._stopPolling() },
  },

  methods: {
    onBackdropTap() { this.triggerEvent('close') },
    onSheetTap() {},
    onPick(e) {
      const avatarId = e.currentTarget.dataset.id
      this.triggerEvent('select', { avatarId })
    },

    // ---- custom flow -------------------------------------------------------------------------

    _onShow() {
      if (!this.properties.allowUpload || !this.properties.userId) return
      this._refreshCustomThumb()
      this._fetchLatest()
    },

    _refreshCustomThumb() {
      const moods = this.properties.customMoods
      const applied = moods && (moods.thumb || moods[DEFAULT_MOOD])
      const gen = this.data.gen
      const latest = gen && gen.status === 'done' && gen.moods && (gen.moods.thumb || gen.moods[DEFAULT_MOOD])
      this.setData({ customThumb: applied || latest || '' })
    },

    // Tap on the custom tile: an existing result opens the preview, otherwise pick a photo.
    onCustomTap() {
      if (this.data.busy) return
      const gen = this.data.gen
      if (gen && (gen.status === 'pending' || gen.status === 'running')) {
        this.setData({ phase: 'generating' })
        return
      }
      if (gen && gen.status === 'done' && gen.moods) {
        this._showPreview(gen)
        return
      }
      this.onPickPhoto()
    },

    onPickPhoto() {
      if (this.data.busy) return
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0]
          if (!file || !file.tempFilePath) return
          this._cropThenUpload(file.tempFilePath)
        },
        fail: (err) => {
          // A cancel is not an error. A scope refusal is the MP console's 用户隐私保护指引 (§35).
          const msg = (err && err.errMsg) || ''
          if (/cancel/i.test(msg)) return
          console.log(JSON.stringify({ level: 'WARN', msg: 'avatar chooseMedia failed', data: { errMsg: msg } }))
          this._showError('err_upload')
        },
      })
    },

    // Square crop when the base library offers it (2.26+); otherwise upload as-is — the
    // generator centres on the face anyway.
    _cropThenUpload(tempPath) {
      if (typeof wx.cropImage === 'function') {
        wx.cropImage({
          src: tempPath,
          cropScale: '1:1',
          success: (r) => this._upload(r.tempFilePath || tempPath),
          fail: (err) => {
            if (/cancel/i.test((err && err.errMsg) || '')) return
            this._upload(tempPath)
          },
        })
      } else {
        this._upload(tempPath)
      }
    },

    async _upload(tempPath) {
      const openid = this.properties.userId
      this.setData({ phase: 'uploading', busy: true, errorText: '' })
      try {
        const pre = await this._req(`${BASE}/api/avatar-generation/presign`, 'POST', { openid })
        if (!pre.data || !pre.data.success) throw new Error('presign')
        const { key, put_url, put_content_type } = pre.data
        const bytes = await new Promise((resolve, reject) => {
          wx.getFileSystemManager().readFile({ filePath: tempPath, success: r => resolve(r.data), fail: reject })
        })
        // Release the temp file now that the bytes are in memory (same as utils/tool-actions.js).
        wx.getFileSystemManager().unlink({ filePath: tempPath, fail: () => {} })
        if (bytes.byteLength > MAX_UPLOAD_BYTES) { this._showError('err_too_large'); return }
        const put = await new Promise((resolve, reject) => {
          wx.request({
            url: put_url, method: 'PUT', data: bytes,
            header: { 'Content-Type': put_content_type },
            responseType: 'text',
            success: resolve, fail: reject,
          })
        })
        if (put.statusCode < 200 || put.statusCode >= 300) throw new Error('put ' + put.statusCode)

        const created = await this._req(`${BASE}/api/avatar-generation`, 'POST', { openid, oss_key: key })
        const body = created.data || {}
        if (!body.success && !body.processing) {
          this._showError(body.reason ? `err_${body.reason}` : 'err_gen_failed')
          return
        }
        this.setData({ gen: body.generation || null })
        if (body.generation && body.generation.status === 'done') {
          this._showPreview(body.generation)
        } else if (body.generation && (body.generation.status === 'rejected' || body.generation.status === 'failed')) {
          this._showError(`err_${body.generation.error_code || 'gen_failed'}`)
        } else {
          this.setData({ phase: 'generating', busy: false })
          this._startPolling()
        }
      } catch (e) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'avatar upload failed', data: { error: e && e.message } }))
        this._showError('err_upload')
      }
    },

    async _fetchLatest() {
      const openid = this.properties.userId
      try {
        const res = await this._req(`${BASE}/api/avatar-generation?openid=${encodeURIComponent(openid)}`)
        const gen = res.data && res.data.generation
        this.setData({ gen: gen || null })
        this._refreshCustomThumb()
        if (gen && (gen.status === 'pending' || gen.status === 'running')) {
          if (this.data.phase === 'idle') this.setData({ phase: 'generating' })
          this._startPolling()
        } else if (gen && this.data.phase === 'generating') {
          // A poll just saw the job finish.
          this._stopPolling()
          if (gen.status === 'done' && gen.moods) this._showPreview(gen)
          else this._showError(`err_${gen.error_code || 'gen_failed'}`)
        } else {
          this._stopPolling()
        }
      } catch (e) {
        // Transient — the next tick retries.
      }
    },

    _startPolling() {
      if (this._pollTimer) return
      this._pollTimer = setInterval(() => this._fetchLatest(), POLL_MS)
    },

    _stopPolling() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
    },

    _showPreview(gen) {
      const t = this.data.t
      const labels = { restored: t.moodRestored, relaxed: t.moodRelaxed, engaged: t.moodEngaged, stressed: t.moodStressed }
      const preview = PREVIEW_ORDER.filter(m => gen.moods[m]).map(m => ({ mood: m, label: labels[m], url: gen.moods[m] }))
      this.setData({ phase: 'preview', preview, gen, busy: false, errorText: '' })
      this._refreshCustomThumb()
    },

    _showError(code) {
      const t = this.data.t
      this.setData({ phase: 'error', errorText: t[code] || t.err_gen_failed, busy: false })
    },

    onClosePanel() {
      this.setData({ phase: 'idle', errorText: '' })
    },

    onRegenerate() {
      this.setData({ phase: 'idle' })
      this.onPickPhoto()
    },

    async onApply() {
      const gen = this.data.gen
      if (!gen || gen.status !== 'done' || this.data.busy) return
      this.setData({ busy: true })
      try {
        const res = await this._req(`${BASE}/api/avatar-generation/apply`, 'POST', { openid: this.properties.userId, gen_id: gen.gen_id })
        const body = res.data || {}
        if (!body.success) throw new Error(body.error || 'apply')
        this.setData({ phase: 'idle', busy: false })
        this.triggerEvent('customapplied', {
          avatar_url: body.avatar_url,
          avatar_character: CUSTOM_AVATAR_ID,
          avatar_moods: body.avatar_moods,
        })
      } catch (e) {
        this._showError('err_apply')
      }
    },

    _req(url, method = 'GET', data = null) {
      return new Promise((resolve, reject) => {
        const opts = {
          url, method,
          header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
          success: resolve,
          fail: reject,
        }
        if (data) opts.data = data
        wx.request(opts)
      })
    },
  },
})
