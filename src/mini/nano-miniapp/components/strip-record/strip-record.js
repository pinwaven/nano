// 心电节律 / 脉搏波 记录 — one overlay that records a raw strip from a bound wearable, uploads it
// for analysis and shows the result, and that reads a stored strip back. `kind` picks which:
//   kind="ecg"  single-lead ECG from the V8 band (CLAUDE.md §18/§45; V8 only), 30 s, ≈255 Hz,
//               needs a finger from the other hand on the electrode — POST /api/ecg;
//   kind="ppg"  the raw optical pulse wave from the V8 band or the Halo ring, 60 s, 50 Hz, no
//               finger, hand still — POST /api/ppg.
// Both are twin layer 2 data (§34). Self view only for recording; the host (user-health)
// renders it only when the bound wearable supports the kind. Everything about the devices'
// behaviour here was established live (2026-09-19 ECG, 2026-09-20 PPG) — see tools/halo/README.md
// "ECG" / "PPG", docs/architecture/v8-smart-band.md §6, halo-smart-ring.md §3.12:
//   - ECG: contact owns the measurement (wrist + finger, or the band aborts within ~3 s and this
//     unit family may emit nothing at all); the band ends it at the requested duration; a start
//     that produces no packets is explained as "lift the finger and place it again";
//   - PPG: the pulse is a few percent of the light level and the device re-ranges its gain on
//     motion, so a loose strap or a moving hand is refused by the server as poor_contact and
//     explained as "snug and still", never as a device error.
// Nothing here is a diagnosis: the devices give dimensionless counts, the server derives rhythm.
const { BASE } = require('../../utils/config.js')
const app = getApp()

const NO_SIGNAL_AFTER_MS = 5000
const CONNECT_TIMEOUT_MS = 15000
const LIVE_WINDOW_SEC = 4
const STRIP_ROW_SEC = 5   // a printed strip: 5 s per row
const STRIP_ROW_PX = 64

// Per-kind facts: capture length, the adapter method, the endpoint, the nominal sample rate the
// live drawing assumes, and the live beat detector's threshold (sd multiples) / refractory (s).
const KINDS = {
  ecg: { durationSec: 30, method: 'recordEcg', path: 'ecg', brands: ['v8'], rateHz: 256, liveSd: 3, liveRefractoryS: 0.3, liveHighPassS: 0.5 },
  ppg: { durationSec: 60, method: 'recordPpg', path: 'ppg', brands: ['v8', 'halo'], rateHz: 50, liveSd: 0.5, liveRefractoryS: 0.4, liveHighPassS: 0.5 },
}

// Shared copy first, then each kind's own. Every t.* the WXML uses must exist in both languages
// for both kinds — the tests check.
const COMMON = {
  zh: {
    connecting: '正在连接设备…',
    saving: '正在分析…',
    stopEarly: '提前结束',
    packets: '数据包',
    beatsLive: '心搏',
    beats: '有效心搏',
    rrMedian: '间期中位 ms',
    rrSd: '间期波动 ms',
    duration: '时长',
    done: '完成',
    retry: '重新记录',
    close: '关闭',
    loading: '正在读取记录…',
    delete: '删除这条记录',
    deleteConfirm: '删除后无法恢复，确定删除这条记录？',
    deleteFailed: '删除失败，请稍后重试。',
    failLoadTitle: '无法读取记录',
    failLoadBody: '网络异常或记录已被删除。',
    failBleTitle: '无法连接设备',
    failBleBody: '请确认设备在附近且蓝牙已开启，然后重试。',
    failUploadTitle: '保存失败',
    failUploadBody: '网络异常，记录未能保存。请稍后重试。',
    failUnsupported: '当前绑定的设备不支持这项记录。',
  },
  en: {
    connecting: 'Connecting to the device…',
    saving: 'Analysing…',
    stopEarly: 'Stop early',
    packets: 'packets',
    beatsLive: 'beats',
    beats: 'clean beats',
    rrMedian: 'interval median ms',
    rrSd: 'interval spread ms',
    duration: 'length',
    done: 'Done',
    retry: 'Record again',
    close: 'Close',
    loading: 'Loading the strip…',
    delete: 'Delete this strip',
    deleteConfirm: 'This cannot be undone. Delete this strip?',
    deleteFailed: 'Could not delete. Try again later.',
    failLoadTitle: "Couldn't load the strip",
    failLoadBody: 'Network problem, or the strip was deleted.',
    failBleTitle: "Couldn't connect to the device",
    failBleBody: 'Make sure the device is nearby and Bluetooth is on, then retry.',
    failUploadTitle: 'Could not save',
    failUploadBody: 'Network problem — the strip was not saved. Try again later.',
    failUnsupported: 'The bound device does not support this recording.',
  },
}

const T = {
  ecg: {
    zh: {
      ...COMMON.zh,
      title: '心电节律记录',
      guideGlyph: '☝︎',
      guide1: '戴好手环，用另一只手的指尖轻按手环上的金属电极。',
      guide2: '保持手臂放松不动，记录 30 秒。',
      guide3: '如果记录没有开始，抬起手指再重新按上去。',
      start: '开始记录',
      measuring: '记录中，请保持不动',
      noSignal: '没有收到信号：抬起手指，再重新按上电极',
      notDiagnosis: '这是手环单导联的节律记录，只用于观察心率与节律规律性，不是心电图诊断。如有不适请就医。',
      failPoorContactTitle: '没有记录到足够清晰的心搏',
      failPoorContactBody: '请确认指尖稳稳按在电极上、手臂放松不动，抬起手指后重新按上再试一次。',
      failTooShortTitle: '记录太短',
      failTooShortBody: '手环没有持续发送数据。抬起手指、重新按上电极后再试。',
    },
    en: {
      ...COMMON.en,
      title: 'ECG rhythm strip',
      guideGlyph: '☝︎',
      guide1: 'Wear the band, then rest a fingertip of your other hand on its metal electrode.',
      guide2: 'Keep your arm still for 30 seconds.',
      guide3: 'If nothing starts, lift the finger and place it again.',
      start: 'Start recording',
      measuring: 'Recording — hold still',
      noSignal: 'No signal yet: lift your finger and place it on the electrode again',
      notDiagnosis: 'A single-lead rhythm strip from the band, for heart rate and rhythm regularity only — not a diagnostic ECG. See a doctor if you feel unwell.',
      failPoorContactTitle: 'Not enough clear beats were recorded',
      failPoorContactBody: 'Keep the fingertip firmly on the electrode and the arm still. Lift the finger, place it again, and retry.',
      failTooShortTitle: 'The recording was too short',
      failTooShortBody: 'The band stopped sending data. Lift the finger, place it on the electrode again, and retry.',
    },
  },
  ppg: {
    zh: {
      ...COMMON.zh,
      title: '脉搏波记录',
      guideGlyph: '✋',
      guide1: '戴好设备，确保传感器贴紧皮肤（手环请系紧一格）。',
      guide2: '把手平放在桌面上，保持不动，记录 60 秒。',
      guide3: '不需要用手指触碰电极。',
      start: '开始记录',
      measuring: '记录中，请保持手不动',
      noSignal: '没有收到信号：请确认设备已戴好并贴紧皮肤',
      notDiagnosis: '这是光学传感器记录的脉搏波形，只用于观察心率与搏动规律性，不是血氧或血糖测量，也不是诊断。如有不适请就医。',
      failPoorContactTitle: '脉搏信号不够稳定',
      failPoorContactBody: '请把设备戴紧、贴住皮肤，手平放不动后再试一次。',
      failTooShortTitle: '记录太短',
      failTooShortBody: '设备没有持续发送数据。请确认设备已戴好后再试。',
    },
    en: {
      ...COMMON.en,
      title: 'Pulse wave strip',
      guideGlyph: '✋',
      guide1: 'Wear the device with the sensor snug against the skin (tighten a band one notch).',
      guide2: 'Rest your hand flat on a table and keep it still for 60 seconds.',
      guide3: 'No need to touch the electrode.',
      start: 'Start recording',
      measuring: 'Recording — keep the hand still',
      noSignal: 'No signal yet: check the device is on and against the skin',
      notDiagnosis: 'An optical pulse waveform, for heart rate and beat regularity only — not an oxygen or glucose reading, and not a diagnosis. See a doctor if you feel unwell.',
      failPoorContactTitle: 'The pulse signal was not steady enough',
      failPoorContactBody: 'Wear the device snug against the skin, rest the hand flat and still, and try again.',
      failTooShortTitle: 'The recording was too short',
      failTooShortBody: 'The device stopped sending data. Check it is worn properly and retry.',
    },
  },
}

Component({
  properties: {
    kind: { type: String, value: 'ecg' },
    open: { type: Boolean, value: false },
    userId: { type: String, value: '' },
    brand: { type: String, value: '' },
    deviceId: { type: String, value: '' },
    deviceName: { type: String, value: '' },
    lang: { type: String, value: 'zh' },
    theme: { type: String, value: 'dark' },
    // Viewing a stored strip: the host passes the health_events id and, in coach view, its
    // coach id (the server re-checks users.coach_id). readOnly hides delete.
    viewId: { type: Number, value: 0 },
    coachId: { type: String, value: '' },
    readOnly: { type: Boolean, value: false },
  },

  data: {
    t: T.ecg.zh,
    stage: 'idle',        // idle | connecting | measuring | saving | result | failed | loading | view
    stripHeightPx: 160,   // the stacked full-strip canvas grows with the recording length
    viewWhen: '',
    remaining: 30,
    packetCount: 0,
    liveBeats: 0,
    noSignal: false,
    result: null,
    failTitle: '',
    failBody: '',
  },

  observers: {
    'kind, lang'(kind, lang) {
      const k = T[kind] ? kind : 'ecg'
      this.setData({ t: T[k][lang === 'en' ? 'en' : 'zh'], remaining: KINDS[k].durationSec })
    },
    'open, viewId'(open, viewId) {
      if (!open) return
      this.setData({ stage: 'idle', result: null, noSignal: false, packetCount: 0, liveBeats: 0, remaining: this._kind().durationSec })
      if (viewId) this._loadView(viewId)
    },
  },

  lifetimes: {
    detached() { this._teardown() },
  },

  methods: {
    noop() {},

    _kind() { return KINDS[this.data.kind] || KINDS.ecg },

    handleClose() {
      if (this.data.stage === 'measuring' && this._stopEarly) this._stopEarly()
      this._teardown()
      this.triggerEvent('close')
    },

    handleStop() {
      if (this._stopEarly) this._stopEarly()
    },

    handleRetry() {
      if (this.data.viewId) this._loadView(this.data.viewId)
      else this.handleStart()
    },

    async handleStart() {
      const t = this.data.t
      const K = this._kind()
      const brand = _normalizeBrand(this.data.brand)
      if (!K.brands.includes(brand) || !this.data.deviceId) {
        this.setData({ stage: 'failed', failTitle: t.failUnsupported, failBody: '' })
        return
      }
      this._samples = []
      this._packets = []
      this._lastPacketAt = 0
      this.setData({ stage: 'connecting', packetCount: 0, liveBeats: 0, noSignal: false, remaining: K.durationSec, result: null })

      const { createWearable } = require('../../utils/wearable/index.js')
      const ring = createWearable(brand)
      this._ring = ring
      try {
        // The BLE stack can sit in "connecting" indefinitely with the adapter off or the device
        // out of range (seen in the simulator: no adapter, no rejection). Cap it.
        await Promise.race([
          ring.connect(this.data.deviceId),
          new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS)),
        ])
      } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: `${this.data.kind} connect failed`, error: err && err.message }))
        this._teardown()
        this.setData({ stage: 'failed', failTitle: t.failBleTitle, failBody: t.failBleBody })
        return
      }

      const startedAt = Date.now()
      this.setData({ stage: 'measuring' })
      this._countdown = setInterval(() => {
        const left = Math.max(0, K.durationSec - Math.round((Date.now() - startedAt) / 1000))
        const noSignal = this._packets.length === 0 && Date.now() - startedAt > NO_SIGNAL_AFTER_MS
        this.setData({ remaining: left, noSignal })
      }, 500)

      let capture
      try {
        capture = await ring[K.method]({
          durationSec: K.durationSec,
          onStopSignal: (fn) => { this._stopEarly = fn },
          onPacket: (p) => this._onPacket(p),
        })
      } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: `${this.data.kind} record failed`, error: err && err.message }))
        capture = { packets: this._packets, startedAt }
      }
      clearInterval(this._countdown); this._countdown = null
      this._stopEarly = null
      ring.disconnect().catch(() => {})
      this._ring = null

      if (!capture.packets.length) {
        this.setData({ stage: 'failed', failTitle: t.failTooShortTitle, failBody: t.failTooShortBody })
        return
      }
      this.setData({ stage: 'saving' })
      await this._upload(capture, startedAt, brand)
    },

    _onPacket(p) {
      const rate = this._kind().rateHz
      this._packets.push(p)
      for (const v of p.samples) this._samples.push(v)
      const keep = rate * (LIVE_WINDOW_SEC + 2)
      if (this._samples.length > keep) this._samples.splice(0, this._samples.length - keep)
      const now = Date.now()
      if (now - this._lastPacketAt > 300) {
        this._lastPacketAt = now
        this.setData({ packetCount: this._packets.length, liveBeats: this._countLiveBeats(), noSignal: false })
        this._drawLive()
      }
    },

    // A cheap running beat count for the live meta line only: local maxima of the
    // baseline-removed signal above K.liveSd sd, K.liveRefractoryS apart. The server's detector
    // is the real one.
    _countLiveBeats() {
      const K = this._kind()
      const x = this._samples
      if (x.length < K.rateHz * 2) return 0
      const hp = _highPass(x, Math.round(K.rateHz * K.liveHighPassS))
      let mean = 0; for (const v of hp) mean += v; mean /= hp.length
      let sd = 0; for (const v of hp) sd += (v - mean) * (v - mean); sd = Math.sqrt(sd / hp.length) || 1
      const refractory = Math.round(K.rateHz * K.liveRefractoryS)
      let n = 0, last = -refractory
      for (let i = 1; i < hp.length - 1; i++) {
        if (hp[i] > mean + K.liveSd * sd && hp[i] >= hp[i - 1] && hp[i] > hp[i + 1] && i - last > refractory) { n++; last = i }
      }
      return n
    },

    _drawLive() {
      const K = this._kind()
      const x = this._samples
      if (!x.length) return
      const ctx = wx.createCanvasContext('strip-live', this)
      const W = _sheetInnerWidth(), H = 160
      // Paper grid: 0.2 s squares over a 4 s window.
      ctx.setFillStyle('#fbf5f4'); ctx.fillRect(0, 0, W, H)
      ctx.setStrokeStyle('#f0cfcc'); ctx.setLineWidth(1)
      for (let gx = 0; gx <= W; gx += W / 20) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
      for (let gy = 0; gy <= H; gy += H / 8) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }
      const win = x.slice(-K.rateHz * LIVE_WINDOW_SEC)
      const hp = _highPass(win, Math.round(K.rateHz * K.liveHighPassS))
      const sorted = hp.slice().sort((a, b) => a - b)
      const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)]
      const rng = (hi - lo) || 1
      ctx.setStrokeStyle('#1a1d21'); ctx.setLineWidth(1.5); ctx.beginPath()
      for (let i = 0; i < hp.length; i++) {
        const px = i / (K.rateHz * LIVE_WINDOW_SEC) * W
        const py = H - 8 - (Math.min(hi, Math.max(lo, hp[i])) - lo) / rng * (H - 16)
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.draw()
    },

    // A stored strip: summary from the row, waveform + peaks from OSS via the worker.
    async _loadView(id) {
      const t = this.data.t
      const K = this._kind()
      this.setData({ stage: 'loading' })
      try {
        const coach = this.data.coachId ? `&coach_id=${encodeURIComponent(this.data.coachId)}` : ''
        const res = await this._req(`${BASE}/api/${K.path}/${id}/waveform?openid=${encodeURIComponent(this.data.userId)}${coach}`)
        const row = res && res.success && (res[K.path] || res.ecg)
        if (!row || !Array.isArray(res.samples)) throw new Error((res && res.error) || 'load failed')
        if (this.data.viewId !== id || !this.data.open) return
        const samples = res.samples, peaks = res.peaks || []
        const rate = row.sample_rate_hz || K.rateHz
        this.setData({
          stage: 'view', result: row, viewWhen: _whenLabel(row.recorded_at),
          stripHeightPx: _stripHeight(samples.length, rate),
        }, () => this._drawStrip(samples, peaks, rate))
      } catch (_) {
        this.setData({ stage: 'failed', failTitle: t.failLoadTitle, failBody: t.failLoadBody })
      }
    },

    handleDelete() {
      const t = this.data.t
      const K = this._kind()
      const id = this.data.viewId
      if (!id || this.data.readOnly) return
      wx.showModal({
        title: '', content: t.deleteConfirm, confirmColor: '#e0565b',
        success: async (r) => {
          if (!r.confirm) return
          try {
            const res = await this._req(`${BASE}/api/${K.path}/${id}?openid=${encodeURIComponent(this.data.userId)}`, 'DELETE')
            if (!res || !res.success) throw new Error('delete failed')
            this.triggerEvent('deleted', { id, kind: this.data.kind })
            this.handleClose()
          } catch (_) {
            wx.showToast({ title: t.deleteFailed, icon: 'none' })
          }
        },
      })
    },

    // The whole strip on paper, printed-ECG style: rows of STRIP_ROW_SEC each, one scale for
    // every row, server-detected peaks ticked along the top of each row. Width is measured
    // from the layout because the legacy canvas draws in CSS px and phones differ.
    _drawStrip(samples, peaks, rateHz) {
      if (!samples || !samples.length) return
      const rate = rateHz || this._kind().rateHz
      const perRow = Math.round(rate * STRIP_ROW_SEC)
      const nRows = Math.max(1, Math.ceil(samples.length / perRow))
      const H = nRows * STRIP_ROW_PX
      wx.createSelectorQuery().in(this).select('.strip-strip-canvas').boundingClientRect((rect) => {
        const W = (rect && rect.width) || _sheetInnerWidth()
        const ctx = wx.createCanvasContext('strip-strip', this)
        ctx.setFillStyle('#fbf5f4'); ctx.fillRect(0, 0, W, H)
        ctx.setLineWidth(1)
        ctx.setStrokeStyle('#f0cfcc')
        const gx = W / (STRIP_ROW_SEC * 5) // 0.2 s squares
        for (let x = 0; x <= W; x += gx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
        for (let y = 0; y <= H; y += STRIP_ROW_PX / 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
        ctx.setStrokeStyle('#e3b3af')
        for (let r = 1; r < nRows; r++) { ctx.beginPath(); ctx.moveTo(0, r * STRIP_ROW_PX); ctx.lineTo(W, r * STRIP_ROW_PX); ctx.stroke() }
        const hp = _highPass(samples, Math.round(rate / 2))
        const sorted = hp.slice().sort((a, b) => a - b)
        const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)]
        const rng = (hi - lo) || 1
        const pos = (i) => {
          const row = Math.floor(i / perRow)
          const px = (i % perRow) / perRow * W
          const py = row * STRIP_ROW_PX + STRIP_ROW_PX - 6 - (Math.min(hi, Math.max(lo, hp[i])) - lo) / rng * (STRIP_ROW_PX - 14)
          return [px, py, row]
        }
        ctx.setStrokeStyle('#1a1d21'); ctx.setLineWidth(1.2); ctx.beginPath()
        let lastRow = -1
        for (let i = 0; i < hp.length; i++) {
          const [px, py, row] = pos(i)
          if (row !== lastRow) { ctx.moveTo(px, py); lastRow = row } else ctx.lineTo(px, py)
        }
        ctx.stroke()
        if (peaks && peaks.length) {
          ctx.setFillStyle('#1fb7a6')
          for (const p of peaks) {
            if (!(p >= 0 && p < hp.length)) continue
            const row = Math.floor(p / perRow), px = (p % perRow) / perRow * W
            ctx.fillRect(px - 1, row * STRIP_ROW_PX + 2, 2, 6)
          }
        }
        ctx.draw()
      }).exec()
    },

    async _upload(capture, startedAt, brand) {
      const t = this.data.t
      const K = this._kind()
      const body = {
        openid: this.data.userId,
        brand,
        device_name: this.data.deviceName || null,
        duration_seconds: K.durationSec,
        started_at: startedAt,
        packets: capture.packets.map((p) => ({ packetId: p.packetId, samples: p.samples, receivedAt: p.receivedAt })),
      }
      let res
      try {
        res = await this._req(`${BASE}/api/${K.path}`, 'POST', body)
      } catch (err) {
        this.setData({ stage: 'failed', failTitle: t.failUploadTitle, failBody: t.failUploadBody })
        return
      }
      const row = res && res.success && res[K.path]
      if (row) {
        // The result block mounts its own <canvas>; draw once it has rendered,
        // not synchronously — the node does not exist yet at this line.
        const all = []
        for (const p of capture.packets) for (const v of p.samples) all.push(v)
        const rate = row.sample_rate_hz || K.rateHz
        this.setData({ stage: 'result', result: row, stripHeightPx: _stripHeight(all.length, rate) },
          () => this._drawStrip(all, null, rate))
        this.triggerEvent('saved', { kind: this.data.kind, [K.path]: row })
        return
      }
      const reason = res && res.reason
      if (reason === 'poor_contact') this.setData({ stage: 'failed', failTitle: t.failPoorContactTitle, failBody: t.failPoorContactBody })
      else if (reason === 'too_short') this.setData({ stage: 'failed', failTitle: t.failTooShortTitle, failBody: t.failTooShortBody })
      else if (reason === 'unsupported_brand') this.setData({ stage: 'failed', failTitle: t.failUnsupported, failBody: '' })
      else this.setData({ stage: 'failed', failTitle: t.failUploadTitle, failBody: (res && res.error) || t.failUploadBody })
    },

    _teardown() {
      if (this._countdown) { clearInterval(this._countdown); this._countdown = null }
      if (this._ring) { this._ring.disconnect().catch(() => {}); this._ring = null }
      this._stopEarly = null
    },

    _req(url, method = 'GET', data = null) {
      return new Promise((resolve, reject) => {
        const opts = {
          url, method,
          header: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${app.globalData.apiToken}` },
          timeout: 20000,
          success: (r) => resolve(r.data),
          fail: (e) => reject(new Error((e && e.errMsg) || 'request failed')),
        }
        if (data) opts.data = data
        wx.request(opts)
      })
    },
  },
})

// 'x3' is the pre-rename Halo brand value still in old bindings (CLAUDE.md §18).
function _normalizeBrand(b) {
  const v = String(b || '').toLowerCase()
  return v === 'x3' ? 'halo' : v
}

// The sheet is full-width with 32rpx side padding, so the canvas is windowWidth − 64rpx in px.
// Used when the layout query returns nothing (the legacy canvas draws in CSS px, phones differ).
function _sheetInnerWidth() {
  try { const w = wx.getSystemInfoSync().windowWidth; return Math.round(w - 64 * w / 750) } catch (_) { return 340 }
}

function _stripHeight(nSamples, rateHz) {
  return Math.max(1, Math.ceil(nSamples / Math.round((rateHz || 256) * STRIP_ROW_SEC))) * STRIP_ROW_PX
}

function _whenLabel(iso) {
  const d = new Date(iso); if (isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// Moving-average high-pass: v - mean(last w). The same baseline removal the strip page uses.
function _highPass(a, w) {
  const out = new Array(a.length)
  let sum = 0; const q = []
  for (let i = 0; i < a.length; i++) {
    q.push(a[i]); sum += a[i]
    if (q.length > w) sum -= q.shift()
    out[i] = a[i] - sum / q.length
  }
  return out
}

