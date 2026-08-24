// Viva AG panel — the second subtab of the health tab, shown only to a user holding an active
// Viva AG add-on. Manages the PDFs of their health records and issues long-running analysis
// jobs to the external agent; results arrive in the chat tab, and are also archived here.
//
// Self-contained on purpose (own i18n table, own _req): keeping it out of user-health.js is
// what stops that already-1000-line component from growing another feature's worth of state.
const { BASE } = require('../../utils/config.js')
const { mdToHtml, MD_TAG_STYLE } = require('../../utils/markdown.js')
const app = getApp()

const T = {
  zh: {
    heroDesc: '深度分析您的完整数字孪生，包括上传的体检与就医记录。分析需要较长时间，完成后会在对话中通知您。',
    validUntil: '有效期至',
    documents: '健康档案',
    uploadBtn: '＋ 上传档案',
    sourcePdf: '从聊天记录选择文件',
    unsupportedTitle: '暂不支持这种文件',
    unsupportedBody: '目前支持 PDF、Word、Excel、PPT 和图片。请选择其中一种格式的健康档案。',
    errOpen: '无法打开该文件，请重试',
    sourcePhoto: '拍照 / 从相册选择',
    photoName: '健康档案照片',
    pdfUnavailableTitle: '文件上传暂未开放',
    pdfUnavailableBody: '微信要求先在小程序后台的「用户隐私保护指引」中声明「选中的文件」权限，才能从聊天记录选择文件。在此之前，可以先用「拍照 / 从相册选择」上传档案照片。',
    gotIt: '知道了',
    errPickFile: '选择文件失败，请重试',
    uploading: '上传中…',
    registering: '保存中…',
    loading: '加载中…',
    noDocsTitle: '还没有上传任何档案',
    noDocsHint: '支持 PDF、Word、Excel、PPT 和图片。可以直接拍照上传纸质报告；文件请先发送到「文件传输助手」或任意聊天，再回来选择。',
    delete: '删除',
    deleteConfirm: '删除后不可恢复，确定删除吗？',
    newAnalysis: '发起分析',
    commandPlaceholder: '想让 Viva AG 重点看什么？（可选）',
    submit: '开始深度分析',
    submitting: '提交中…',
    oneAtATime: '已有一个分析在进行中，完成后可再次发起。',
    pickSomething: '请选择一个分析类型，或输入您的问题。',
    history: '分析记录',
    noJobs: '还没有分析记录。',
    inProgress: '正在分析中，完成后会在对话中通知您。',
    failed: '这次分析没能完成，您可以重新发起。',
    openReport: '查看完整报告',
    opening: '打开中…',
    reports: '分析报告',
    reportTruncated: '（报告较长，此处仅显示前一部分，可下载完整文件查看）',
    errReportEmpty: '报告内容为空',
    cancel: '取消这次分析',
    presetFull: '全面分析',
    presetDocs: '解读档案',
    presetRisk: '风险筛查',
    stQueued: '排队中', stClaimed: '已受理', stProcessing: '分析中',
    stCompleted: '已完成', stFailed: '未完成', stCancelled: '已取消',
    typeHospital: '就医记录', typeLab: '化验报告', typeImaging: '影像报告',
    typeDischarge: '出院小结', typePrescription: '处方', typeOther: '其他',
    errTooLarge: '文件超过 20MB，无法上传',
    errUpload: '上传失败，请重试',
    errGeneric: '操作失败，请重试',
    errNetwork: '网络异常，请稍后重试',
    errDailyLimit: '今天的深度分析次数已用完（每天最多 {n} 次），明天再来吧。',
    errNoAccess: 'Viva AG 权限已过期，请联系客服',
    quotaLeft: '今日还可发起 {n} 次',
    quotaUsedUp: '今日次数已用完，明天恢复',
    okDeleted: '已删除',
    okSubmitted: '已提交，完成后会通知您',
  },
  en: {
    heroDesc: 'A deep analysis of your full digital twin, including uploaded medical records. It takes a while — you will be notified in chat when it is ready.',
    validUntil: 'Valid until',
    documents: 'Health Records',
    uploadBtn: '＋ Upload record',
    sourcePdf: 'Choose a file from a chat',
    unsupportedTitle: 'That file type is not supported',
    unsupportedBody: 'PDF, Word, Excel, PowerPoint and images are supported. Please pick a health record in one of those formats.',
    errOpen: "Couldn't open that file, please try again",
    sourcePhoto: 'Take a photo / choose from album',
    photoName: 'health-record-photo',
    pdfUnavailableTitle: 'File upload not enabled yet',
    pdfUnavailableBody: 'WeChat requires the "selected files" scope to be declared in the Mini Program console\'s privacy guidelines before files can be picked from a chat. Until then, use "Take a photo / choose from album" to upload a picture of the record.',
    gotIt: 'Got it',
    errPickFile: "Couldn't pick that file, please try again",
    uploading: 'Uploading…',
    registering: 'Saving…',
    loading: 'Loading…',
    noDocsTitle: 'No records uploaded yet',
    noDocsHint: 'PDF, Word, Excel, PowerPoint and images are supported. Photograph a paper report directly, or send the file to File Transfer (文件传输助手) or any conversation first, then come back and pick it.',
    delete: 'Delete',
    deleteConfirm: 'This cannot be undone. Delete this record?',
    newAnalysis: 'New Analysis',
    commandPlaceholder: 'Anything specific you want Viva AG to focus on? (optional)',
    submit: 'Start deep analysis',
    submitting: 'Submitting…',
    oneAtATime: 'An analysis is already running. You can start another once it finishes.',
    pickSomething: 'Pick an analysis type, or type your question.',
    history: 'Past Analyses',
    noJobs: 'No analyses yet.',
    inProgress: 'Analysis in progress — you will be notified in chat when it is ready.',
    failed: "This analysis didn't finish. You can start a new one.",
    openReport: 'Open full report',
    opening: 'Opening…',
    reports: 'Reports',
    reportTruncated: '(This report is long — only the first part is shown here. Download the file for the full text.)',
    errReportEmpty: 'This report is empty',
    cancel: 'Cancel this analysis',
    presetFull: 'Full analysis',
    presetDocs: 'Review records',
    presetRisk: 'Risk screen',
    stQueued: 'Queued', stClaimed: 'Accepted', stProcessing: 'Analyzing',
    stCompleted: 'Done', stFailed: 'Failed', stCancelled: 'Cancelled',
    typeHospital: 'Hospital record', typeLab: 'Lab report', typeImaging: 'Imaging',
    typeDischarge: 'Discharge summary', typePrescription: 'Prescription', typeOther: 'Other',
    errTooLarge: 'File exceeds the 20MB limit',
    errUpload: 'Upload failed, please try again',
    errGeneric: 'Something went wrong, please try again',
    errNetwork: 'Network problem, please try again shortly',
    errDailyLimit: "You've used today's deep analyses ({n} per day). Try again tomorrow.",
    errNoAccess: 'Your Viva AG access has expired',
    quotaLeft: '{n} left today',
    quotaUsedUp: 'None left today — resets tomorrow',
    okDeleted: 'Deleted',
    okSubmitted: 'Submitted — we will notify you when it is ready',
  },
}

// Mirrors MAX_DOCUMENT_BYTES in handlers/health_documents.js. Enforced here too because
// wx.getFileSystemManager().readFile pulls the whole file into the JS heap: an oversized PDF
// crashes the page rather than failing cleanly, so it must never reach readFile at all.
const MAX_BYTES = 20 * 1024 * 1024

// Mirrors CONTENT_TYPE_BY_EXT in worker/handlers/health_documents.js — a health record is
// whatever the clinic handed the user, so PDFs, Word/Excel/PowerPoint and photos of paper
// printouts are all accepted. The server re-validates; this list only drives the picker filter
// and the pre-upload message.
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'bmp', 'gif']
const ALLOWED_EXTENSIONS = DOC_EXTENSIONS.concat(IMAGE_EXTENSIONS)

// Result artifacts the agent can attach, mirroring RESULT_CONTENT_TYPES in
// worker/handlers/viva_ag.js. Two presentation paths, because wx.openDocument supports NEITHER
// .md nor .txt (its fileType list is doc/docx/xls/xlsx/ppt/pptx/pdf only) — handing it a
// markdown file just fails in the user's hands. So a PDF opens in the system viewer and text
// renders in-app.
const RESULT_TEXT_EXTENSIONS = ['md', 'txt']

// A report is prose, not a dataset: past this the in-app viewer is the wrong tool, and the user
// is told to download the file instead of being handed a page that janks.
const MAX_REPORT_CHARS = 120000

const extOf = (name) => String(name || '').includes('.')
  ? String(name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
  : ''
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const POLL_MS = 15000

Component({
  properties: {
    userId: { type: String, value: '' },
    lang:   { type: String, value: 'zh' },
    theme:  { type: String, value: 'dark' },
  },

  data: {
    t: {},
    presets: [],
    documents: [],
    jobs: [],
    docsLoading: true,
    jobsLoading: true,
    uploading: false,
    uploadStatus: '',
    submitting: false,
    commandKey: '',
    commandText: '',
    canSubmit: false,
    hasActive: false,
    dailyLimit: 3,
    dailyUsed: 0,
    dailyLimitReached: false,
    quotaLeftText: '',
    expiryDisplay: '',
    detailJob: null,
    downloadingResult: false,
    // In-app viewer for .md/.txt artifacts (see RESULT_TEXT_EXTENSIONS).
    reportTitle: '',
    reportHtml: '',
    reportTruncated: false,
    mdTagStyle: MD_TAG_STYLE,
  },

  lifetimes: {
    attached() {
      const t = T[this.properties.lang] || T.zh
      this.setData({
        t,
        presets: [
          { key: 'full_analysis',   label: t.presetFull },
          { key: 'document_review', label: t.presetDocs },
          { key: 'risk_screen',     label: t.presetRisk },
        ],
      })
      this._loadDocuments()
      this._loadJobs()
    },
    detached() { this._stopPoll() },
  },

  pageLifetimes: {
    // The panel stays mounted while the tab is hidden, so stop polling on background rather
    // than leaving a 15s timer running behind the chat tab.
    hide() { this._stopPoll() },
    show() { if (this.data.hasActive) this._startPoll() },
  },

  methods: {
    noop() {},

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

    _toast(title, icon = 'none') { wx.showToast({ title, icon }) },

    // ── Documents ────────────────────────────────────────────────────────────

    _typeLabel(docType) {
      const t = this.data.t
      return {
        hospital_record: t.typeHospital, lab_report: t.typeLab, imaging: t.typeImaging,
        discharge_summary: t.typeDischarge, prescription: t.typePrescription,
      }[docType] || t.typeOther
    },

    _sizeLabel(bytes) {
      if (!bytes) return ''
      const mb = bytes / (1024 * 1024)
      return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
    },

    async _loadDocuments() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/health-documents?openid=${encodeURIComponent(userId)}`)
        const docs = (res.data?.documents || []).map(d => ({
          ...d,
          typeLabel: this._typeLabel(d.doc_type),
          sizeLabel: this._sizeLabel(d.size_bytes),
        }))
        this.setData({ documents: docs, docsLoading: false })
      } catch (e) {
        this.setData({ docsLoading: false })
      }
    },

    // Two sources, because they have different platform prerequisites and different real-world
    // uses: a PDF already sitting in a WeChat chat, or a photo of a paper record. The backend
    // accepts both (ALLOWED_EXTENSIONS in handlers/health_documents.js).
    chooseDocument() {
      if (this.data.uploading) return
      const t = this.data.t
      wx.showActionSheet({
        itemList: [t.sourcePdf, t.sourcePhoto],
        success: (r) => {
          if (r.tapIndex === 0) this._choosePdf()
          else this._choosePhoto()
        },
        fail: () => {},
      })
    },

    // wx.chooseMessageFile is the ONLY way to obtain a PDF in a Mini Program, and it reads from
    // a WeChat *conversation*, not the device filesystem — hence the instruction in the empty
    // state.
    //
    // It also requires the 「选中的文件」 scope to be declared in the miniapp's 用户隐私保护指引
    // in the MP console. Without that declaration WeChat rejects the call outright with
    // `chooseMessageFile:fail api scope is not declared in the privacy agreement` (errno 112) —
    // there is no runtime consent flow that can rescue it, and app.js's
    // onNeedPrivacyAuthorization handler never even fires. Surface that plainly and point the
    // user at the photo path, which works today, instead of dying silently.
    _choosePdf() {
      const t = this.data.t
      wx.chooseMessageFile({
        // 'all' rather than 'file': a lab report someone forwarded as an IMAGE is a message of
        // type 'image' and would be invisible under type:'file'. The `extension` filter only
        // applies to type:'file' anyway, so validation happens below — which also lets us say
        // what went wrong instead of silently hiding the file the user is looking at.
        type: 'all',
        count: 1,
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0]
          if (!f) return
          // Images picked from a chat have no `name`; fall back to the temp path's extension.
          const name = f.name || `record.${extOf(f.path) || 'jpg'}`
          const ext = extOf(name)
          if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return wx.showModal({ title: t.unsupportedTitle, content: t.unsupportedBody, showCancel: false, confirmText: t.gotIt })
          }
          if (f.size > MAX_BYTES) return this._toast(t.errTooLarge)
          this._uploadDocument({ path: f.path, name, size: f.size })
        },
        fail: (err) => {
          const errMsg = (err && err.errMsg) || ''
          console.log(JSON.stringify({ level: 'WARN', msg: 'wx.chooseMessageFile failed', data: { errMsg, errno: err && err.errno } }))
          // User backed out of the picker — say nothing.
          if (/cancel|deny/i.test(errMsg)) return
          if (/privacy|scope/i.test(errMsg)) {
            return wx.showModal({ title: t.pdfUnavailableTitle, content: t.pdfUnavailableBody, showCancel: false, confirmText: t.gotIt })
          }
          this._toast(t.errPickFile)
        },
      })
    },

    // Photograph a paper record, or pick an existing photo. Same album/camera scope the chat
    // tab's image upload already uses, so this path needs no additional declaration.
    _choosePhoto() {
      const t = this.data.t
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['original'],
        success: (res) => {
          const f = res.tempFiles && res.tempFiles[0]
          if (!f) return
          if (f.size > MAX_BYTES) return this._toast(t.errTooLarge)
          // chooseMedia gives no filename — derive one from the temp path's extension so the
          // server can resolve a content type and the list has something readable to show.
          const ext = (String(f.tempFilePath || '').split('.').pop() || 'jpg').toLowerCase()
          const stamp = new Date().toISOString().slice(0, 10)
          this._uploadDocument({ path: f.tempFilePath, name: `${t.photoName}-${stamp}.${ext}`, size: f.size })
        },
        fail: (err) => {
          const errMsg = (err && err.errMsg) || ''
          if (/cancel|deny/i.test(errMsg)) return
          console.log(JSON.stringify({ level: 'WARN', msg: 'wx.chooseMedia failed', data: { errMsg } }))
          this._toast(t.errPickFile)
        },
      })
    },

    // presign → readFile → PUT → register. Mirrors utils/tool-actions.js's _doUpload; the PUT's
    // Content-Type must be exactly what presign returned, since it is part of the signature.
    async _uploadDocument(file) {
      const { userId } = this.properties
      const t = this.data.t
      this.setData({ uploading: true, uploadStatus: t.uploading })
      try {
        const pre = await this._req(
          `${BASE}/api/health-documents/presign?openid=${encodeURIComponent(userId)}`
          + `&filename=${encodeURIComponent(file.name)}&size_bytes=${file.size}`)
        if (!pre.data?.success) throw new Error(pre.data?.error || 'presign failed')
        const { key, put_url, put_content_type } = pre.data

        const bytes = await new Promise((resolve, reject) => {
          wx.getFileSystemManager().readFile({ filePath: file.path, success: r => resolve(r.data), fail: reject })
        })

        const putStatus = await new Promise((resolve, reject) => {
          wx.request({
            url: put_url, method: 'PUT', data: bytes,
            header: { 'Content-Type': put_content_type },
            responseType: 'text',
            success: r => resolve(r.statusCode), fail: reject,
          })
        })
        if (putStatus !== 200) throw new Error('PUT ' + putStatus)

        this.setData({ uploadStatus: t.registering })
        const reg = await this._req(`${BASE}/api/health-documents`, 'POST', {
          openid: userId, oss_key: key, filename: file.name,
          size_bytes: file.size, doc_type: 'other',
        })
        if (!reg.data?.success) throw new Error(reg.data?.error || 'register failed')

        this.setData({ uploading: false, uploadStatus: '' })
        this._loadDocuments()
      } catch (e) {
        this.setData({ uploading: false, uploadStatus: '' })
        this._toast(t.errUpload)
      }
    },

    // Two viewers, because wx.openDocument does NOT handle images and wx.previewImage does not
    // handle documents. Passing an image to openDocument fails outright, and hardcoding
    // fileType:'pdf' would break every Word/Excel file — the extension has to drive the choice.
    //
    // Documents can't render inline in WXML either way, so it's downloadFile → openDocument,
    // the same path pages/main/main.js uses for certificates.
    async openDocument(e) {
      const id = e.currentTarget.dataset.id
      const { userId } = this.properties
      const t = this.data.t
      wx.showLoading({ title: t.opening, mask: true })
      try {
        const res = await this._req(`${BASE}/api/health-documents/${id}/url?openid=${encodeURIComponent(userId)}`)
        if (!res.data?.success) throw new Error('no url')
        const url = res.data.url
        const ext = extOf(res.data.filename) || extOf(url)

        if (IMAGE_EXTENSIONS.includes(ext)) {
          wx.hideLoading()
          // previewImage takes the URL directly — no download step, and it gives pinch-zoom,
          // which is what someone reading a photographed lab printout actually needs.
          return wx.previewImage({ urls: [url], current: url, fail: () => this._toast(t.errOpen) })
        }

        const dl = await new Promise((resolve, reject) => {
          wx.downloadFile({ url, success: resolve, fail: reject })
        })
        wx.hideLoading()
        wx.openDocument({
          filePath: dl.tempFilePath,
          fileType: DOC_EXTENSIONS.includes(ext) ? ext : 'pdf',
          showMenu: true,
          fail: () => this._toast(t.errOpen),
        })
      } catch (err) {
        wx.hideLoading()
        this._toast(t.errOpen)
      }
    },

    deleteDocument(e) {
      const { id } = e.currentTarget.dataset
      const { userId } = this.properties
      const t = this.data.t
      wx.showModal({
        title: e.currentTarget.dataset.name || '',
        content: t.deleteConfirm,
        confirmColor: '#E05C5C',
        success: async (m) => {
          if (!m.confirm) return
          try {
            await this._req(`${BASE}/api/health-documents/${id}?openid=${encodeURIComponent(userId)}`, 'DELETE')
            this._toast(t.okDeleted, 'success')
            this._loadDocuments()
          } catch (err) { this._toast(t.errGeneric) }
        },
      })
    },

    // ── Jobs ─────────────────────────────────────────────────────────────────

    _statusLabel(status) {
      const t = this.data.t
      return {
        queued: t.stQueued, claimed: t.stClaimed, processing: t.stProcessing,
        completed: t.stCompleted, failed: t.stFailed, cancelled: t.stCancelled,
      }[status] || status
    },

    _decorate(job) {
      return {
        ...job,
        files: (job.result_files || []).map(f => ({
          ...f,
          extLabel: String(f.ext || '').toUpperCase(),
          sizeLabel: this._sizeLabel(f.size_bytes),
        })),
        statusLabel: this._statusLabel(job.status),
        summaryPreview: job.result_summary
          ? (job.result_summary.length > 60 ? job.result_summary.slice(0, 60) + '…' : job.result_summary)
          : '',
      }
    },

    async _loadJobs() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/viva-ag/jobs?openid=${encodeURIComponent(userId)}`)
        const jobs = (res.data?.jobs || []).map(j => this._decorate(j))
        const hasActive = !!res.data?.has_active
        this.setData({
          jobs, jobsLoading: false, hasActive,
          dailyLimit: res.data?.daily_limit ?? this.data.dailyLimit,
          dailyUsed: res.data?.daily_used ?? 0,
          dailyLimitReached: !!res.data?.daily_limit_reached,
          // WXML cannot interpolate, so build the label here.
          quotaLeftText: (this.data.t.quotaLeft || '').replace('{n}',
            Math.max(0, (res.data?.daily_limit ?? 0) - (res.data?.daily_used ?? 0))),
          expiryDisplay: (res.data?.viva_ag_expires_at || '').slice(0, 10),
        })
        this._recomputeSubmit()
        if (hasActive) this._startPoll(); else this._stopPoll()
      } catch (e) {
        this.setData({ jobsLoading: false })
      }
    },

    // Deliberately NOT hooked into main.js's 3s notification poll: that loop is tuned around
    // chat delivery, and putting an AG query on every user's 3s tick for a feature almost
    // nobody has would be wasteful. Runs only while a job is actually in flight.
    _startPoll() {
      if (this._pollTimer) return
      this._pollTimer = setInterval(() => this._loadJobs(), POLL_MS)
    },

    _stopPoll() {
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null }
    },

    selectPreset(e) {
      const key = e.currentTarget.dataset.key
      this.setData({ commandKey: this.data.commandKey === key ? '' : key })
      this._recomputeSubmit()
    },

    onCommandInput(e) {
      this.setData({ commandText: e.detail.value })
      this._recomputeSubmit()
    },

    _recomputeSubmit() {
      const { commandKey, commandText, hasActive, submitting, dailyLimitReached } = this.data
      this.setData({
        canSubmit: !hasActive && !submitting && !dailyLimitReached
          && !!(commandKey || (commandText || '').trim()),
      })
    },

    async submitJob() {
      if (!this.data.canSubmit) return
      const { userId } = this.properties
      const t = this.data.t
      this.setData({ submitting: true, canSubmit: false })
      try {
        const res = await this._req(`${BASE}/api/viva-ag/jobs`, 'POST', {
          openid: userId,
          command_key: this.data.commandKey || undefined,
          command: (this.data.commandText || '').trim() || undefined,
        })
        if (!res.data?.success) {
          // The server distinguishes expected, actionable refusals from real faults. Showing
          // "operation failed, please retry" for all of them is actively misleading — retrying a
          // daily-limit refusal never works, and the user is given no idea why. Map the known
          // reasons; only a genuine fault falls through to the generic message.
          this.setData({ submitting: false })
          this._recomputeSubmit()
          const reason = res.data?.reason
          if (reason === 'daily_limit_reached') {
            const limit = res.data.limit || this.data.dailyLimit
            return this._toast(t.errDailyLimit.replace('{n}', limit))
          }
          if (reason === 'job_already_active') return this._toast(t.oneAtATime)
          if (reason === 'viva_ag_inactive' || reason === 'viva_inactive') return this._toast(t.errNoAccess)
          return this._toast(t.errGeneric)
        }
        this.setData({ submitting: false, commandText: '', commandKey: '' })
        this._toast(t.okSubmitted, 'success')
        this._loadJobs()
      } catch (e) {
        // Network/transport failure only — a refused request is handled above.
        this.setData({ submitting: false })
        this._recomputeSubmit()
        this._toast(t.errNetwork)
      }
    },

    openJob(e) {
      const uid = e.currentTarget.dataset.uid
      const job = this.data.jobs.find(j => j.job_uid === uid)
      if (job) this.setData({ detailJob: job })
    },

    closeJob() { this.setData({ detailJob: null }) },

    // One handler for both surfaces (the chips on a job card and the rows in its detail sheet),
    // and for both artifact shapes. Files are addressed by INDEX — the server never hands the
    // client an oss_key — and the URL is minted fresh per tap because it lives for 300s.
    async openResultFile(e) {
      if (this.data.downloadingResult) return
      const ds = e.currentTarget.dataset
      const job = this.data.jobs.find(j => j.job_uid === ds.uid) || this.data.detailJob
      if (!job) return
      const index = Number(ds.index) || 0
      const t = this.data.t
      this.setData({ downloadingResult: true })
      try {
        const res = await this._req(
          `${BASE}/api/viva-ag/jobs/result-url?openid=${encodeURIComponent(this.properties.userId)}` +
          `&job_uid=${encodeURIComponent(job.job_uid)}&index=${index}`)
        if (!res.data?.success) throw new Error(res.data?.reason || 'no url')
        const { url, file_type: ft, filename } = res.data
        const dl = await new Promise((resolve, reject) => {
          wx.downloadFile({
            url,
            // downloadFile resolves for any HTTP status; a 403 from an expired signature would
            // otherwise be handed to openDocument as a "file".
            success: (r) => (r.statusCode === 200 ? resolve(r) : reject(new Error('http ' + r.statusCode))),
            fail: reject,
          })
        })
        this.setData({ downloadingResult: false })
        if (RESULT_TEXT_EXTENSIONS.includes(ft)) return this._showTextReport(dl.tempFilePath, ft, filename)
        wx.openDocument({
          filePath: dl.tempFilePath,
          fileType: DOC_EXTENSIONS.includes(ft) ? ft : 'pdf',
          showMenu: true,
          fail: () => this._toast(t.errOpen),
        })
      } catch (err) {
        this.setData({ downloadingResult: false })
        this._toast(t.errGeneric)
      }
    },

    // .md / .txt render in-app: wx.openDocument cannot open either (its fileType list is
    // doc/docx/xls/xlsx/ppt/pptx/pdf), so handing it a markdown file just fails.
    _showTextReport(filePath, ext, filename) {
      const t = this.data.t
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'utf8',
        success: (r) => {
          let text = String(r.data || '')
          if (!text.trim()) return this._toast(t.errReportEmpty)
          const truncated = text.length > MAX_REPORT_CHARS
          if (truncated) text = text.slice(0, MAX_REPORT_CHARS)
          this.setData({
            reportTitle: filename || '',
            reportHtml: ext === 'md' ? mdToHtml(this._neutralizeLinks(text)) : this._plainToHtml(text),
            reportTruncated: truncated,
          })
        },
        fail: () => this._toast(t.errOpen),
      })
    },

    // This file was written by an EXTERNAL system. mp-html's link handler navigates in-app for
    // any href without a scheme (node.js: wx.navigateTo, falling back to switchTab), so a
    // markdown link in a report could send the user to an arbitrary page of this miniapp. The
    // target is kept visible as plain text — nothing is hidden, it just isn't tappable.
    _neutralizeLinks(md) {
      return String(md).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, text, href) => `${text} (${href})`)
    },

    _plainToHtml(text) {
      return '<pre>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>'
    },

    closeReport() { this.setData({ reportHtml: '', reportTitle: '', reportTruncated: false }) },

    async cancelJob() {
      const job = this.data.detailJob
      if (!job) return
      try {
        await this._req(`${BASE}/api/viva-ag/jobs/cancel`, 'POST', { openid: this.properties.userId, job_uid: job.job_uid })
        this.setData({ detailJob: null })
        this._loadJobs()
      } catch (e) { this._toast(this.data.t.errGeneric) }
    },
  },
})
