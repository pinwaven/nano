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
    errOpen: '无法打开该文件，请重试',
    loading: '加载中…',
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
    // ── Formulation progress (dots_formulation → expert review → compounding → scan) ──
    fmTitle: '原粒配方进度',
    fmValid: '待专家审核', fmValidHint: '配方已通过配比校验，营养专家审核中',
    fmInvalid: '配比未通过', fmInvalidHint: '配方不符合胶囊规格，可重新生成一次',
    fmApproved: '已审核 · 定制加工中', fmApprovedHint: '收到包装后扫描盒身二维码即可开始 28 天周期',
    fmRejected: '专家未通过', fmRejectedHint: '营养专家暂未通过该配方，客服将与您联系',
    fmCommitted: '已激活', fmCommittedHint: '方案已生效，可在「原粒」中查看每日配比',
    fmDots: '共 {n} 粒 / 28 天',
    presetDots: '原粒定制',
    stQueued: '排队中', stClaimed: '已受理', stProcessing: '分析中',
    stCompleted: '已完成', stFailed: '未完成', stCancelled: '已取消',
    stAwaitingInput: '待补充信息',
    // ── Clarifying questionnaire (the agent parked the job to ask something) ──
    askTitle: '需要补充信息',
    askBody: 'Viva AG 还需要向你确认几个问题，回答后会继续分析。',
    askCta: '去回答',
    askDeadline: '请在 {n} 前回答',
    errGeneric: '操作失败，请重试',
    errNetwork: '网络异常，请稍后重试',
    errDailyLimit: '今天的深度分析次数已用完（每天最多 {n} 次），明天再来吧。',
    errNoAccess: 'Viva AG 权限已过期，请联系客服',
    quotaLeft: '今日还可发起 {n} 次',
    quotaUsedUp: '今日次数已用完，明天恢复',
    okSubmitted: '已提交，完成后会通知您',
  },
  en: {
    heroDesc: 'A deep analysis of your full digital twin, including uploaded medical records. It takes a while — you will be notified in chat when it is ready.',
    validUntil: 'Valid until',
    errOpen: "Couldn't open that file, please try again",
    loading: 'Loading…',
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
    // ── Formulation progress (dots_formulation → expert review → compounding → scan) ──
    fmTitle: 'Formulation progress',
    fmValid: 'Awaiting expert review', fmValidHint: 'Passed the capsule-spec check; a nutrition expert is reviewing it',
    fmInvalid: 'Spec check failed', fmInvalidHint: "This formula doesn't meet the capsule spec — you can run it again",
    fmApproved: 'Approved · being compounded', fmApprovedHint: 'Scan the QR on your box when it arrives to start the 28-day cycle',
    fmRejected: 'Not approved', fmRejectedHint: "The nutrition expert didn't approve this formula; support will be in touch",
    fmCommitted: 'Active', fmCommittedHint: 'Your plan is live — see the daily mix under Dots',
    fmDots: '{n} dots / 28 days',
    presetDots: 'Dot formulation',
    stQueued: 'Queued', stClaimed: 'Accepted', stProcessing: 'Analyzing',
    stCompleted: 'Done', stFailed: 'Failed', stCancelled: 'Cancelled',
    stAwaitingInput: 'Needs your input',
    // ── Clarifying questionnaire (the agent parked the job to ask something) ──
    askTitle: 'A few more questions',
    askBody: 'Viva AG needs to check a few things with you before it can finish this analysis.',
    askCta: 'Answer now',
    askDeadline: 'Please answer before {n}',
    errGeneric: 'Something went wrong, please try again',
    errNetwork: 'Network problem, please try again shortly',
    errDailyLimit: "You've used today's deep analyses ({n} per day). Try again tomorrow.",
    errNoAccess: 'Your Viva AG access has expired',
    quotaLeft: '{n} left today',
    quotaUsedUp: 'None left today — resets tomorrow',
    okSubmitted: 'Submitted — we will notify you when it is ready',
  },
}

// The file types wx.openDocument can actually render — its fileType list, nothing more.
// Health-record upload moved to components/health-documents/, which carries its own, wider list
// mirroring CONTENT_TYPE_BY_EXT in worker/handlers/health_documents.js.
const DOC_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']

// Result artifacts the agent can attach, mirroring RESULT_CONTENT_TYPES in
// worker/handlers/viva_ag.js. Two presentation paths, because wx.openDocument supports NEITHER
// .md nor .txt (its fileType list is doc/docx/xls/xlsx/ppt/pptx/pdf only) — handing it a
// markdown file just fails in the user's hands. So a PDF opens in the system viewer and text
// renders in-app.
const RESULT_TEXT_EXTENSIONS = ['md', 'txt']

// A report is prose, not a dataset: past this the in-app viewer is the wrong tool, and the user
// is told to download the file instead of being handed a page that janks.
const MAX_REPORT_CHARS = 120000

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
    jobs: [],
    jobsLoading: true,
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
    // The most recent dots_formulation and where it is on its way to becoming a real plan.
    formulation: null,
    // The parked job waiting on a questionnaire, if any — drives the "needs your input" card.
    awaitingJob: null,
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
          { key: 'dots_formulation', label: t.presetDots },
        ],
      })
      this._loadJobs()
      this._loadFormulation()
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

    _sizeLabel(bytes) {
      if (!bytes) return ''
      const mb = bytes / (1024 * 1024)
      return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
    },

    // ── Jobs ─────────────────────────────────────────────────────────────────

    _statusLabel(status) {
      const t = this.data.t
      return {
        queued: t.stQueued, claimed: t.stClaimed, processing: t.stProcessing,
        awaiting_input: t.stAwaitingInput,
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

    // A dots_formulation job's result is not the end of the story the way an analysis report is:
    // it goes to a nutrition expert, then to compounding, then ships, and only becomes the user's
    // actual plan when they scan the box. Without this the panel would show "completed" and go
    // quiet for days while all of that happened.
    async _loadFormulation() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/viva-ag/formulation?openid=${encodeURIComponent(userId)}`)
        const list = res.data?.formulations || []
        const f = list[0] || null
        this.setData({ formulation: f ? this._decorateFormulation(f) : null })
      } catch (e) {
        // A missing status line is not worth an error banner over the rest of the panel.
        this.setData({ formulation: null })
      }
    },

    _decorateFormulation(f) {
      const t = this.data.t
      const map = {
        valid: { label: t.fmValid, hint: t.fmValidHint },
        invalid: { label: t.fmInvalid, hint: t.fmInvalidHint },
        approved: { label: t.fmApproved, hint: t.fmApprovedHint },
        rejected: { label: t.fmRejected, hint: t.fmRejectedHint },
        committed: { label: t.fmCommitted, hint: t.fmCommittedHint },
      }
      const m = map[f.status] || { label: f.status, hint: '' }
      return {
        ...f,
        statusLabel: m.label,
        statusHint: m.hint,
        // Rendered as-is by the WXML, so format it here rather than leaving a bare number
        // that reads as an error code.
        total_dots: f.total_dots ? String(t.fmDots).replace('{n}', f.total_dots) : '',
      }
    },

    async _loadJobs() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(`${BASE}/api/viva-ag/jobs?openid=${encodeURIComponent(userId)}`)
        const jobs = (res.data?.jobs || []).map(j => this._decorate(j))
        this._loadFormulation()
        const hasActive = !!res.data?.has_active
        // At most one, because uniq_viva_ag_jobs_active counts 'awaiting_input' as active.
        const awaiting = jobs.find(j => j.status === 'awaiting_input') || null
        this.setData({
          jobs, jobsLoading: false, hasActive,
          awaitingJob: awaiting ? {
            ...awaiting,
            deadlineText: awaiting.awaiting_input_expires_at
              ? (this.data.t.askDeadline || '').replace('{n}', awaiting.awaiting_input_expires_at.slice(0, 10))
              : '',
          } : null,
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

    // The questionnaire itself renders in the CHAT tab — that renderer already exists, handles
    // all five widget types, and is what onboarding and coach-assigned forms already use.
    // Duplicating it here would be a second place to maintain every input type for no
    // user-visible gain, so the panel hands off instead: main.js switches tabs and calls
    // _checkForPendingQuestionnaire().
    goAnswer() {
      this.triggerEvent('gotochat', { reason: 'viva_ag_questionnaire' })
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
