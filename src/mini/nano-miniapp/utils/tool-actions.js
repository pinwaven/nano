const { BASE } = require('./config.js')

// Returns the ordered tool list with translated labels.
// Add new tools here — all pages that register the toolbox component pick them up automatically.
function getToolList(t) {
  return [
    { action: 'upload_image', icon: '▣', label: t.toolUploadImage },
    { action: 'test_chip',    icon: '⬡', label: t.toolTestChip },
    { action: 'formula_dots', icon: '◉', label: t.toolFormulaDots },
    { action: 'health_advice',icon: '♥', label: t.toolHealthAdvice },
  ]
}

// ctx = { addMsg, addActionMsg (optional), req, setTyping }
// addMsg(role, content, persist?) — 'user' role is mapped to 'coach' by the caller if needed
// addActionMsg(action, label, persist?) — optional, omit in coach context

async function runTestChip(openid, t, ctx) {
  const { addMsg, req, setTyping } = ctx
  return new Promise((resolve) => {
    wx.scanCode({
      onlyFromCamera: false,
      success: async (res) => {
        const chip_id = res.result
        addMsg('user', chip_id, true)
        setTyping(true)
        try {
          const scanRes = await req(`${BASE}/api/kino-scan`, 'POST', { openid, chip_id })
          if (scanRes.statusCode !== 200) throw new Error('server error')
          const status = scanRes.data?.status
          if (status === 'invalid_chip')    addMsg('ai', t.kinoScanInvalidChip, true)
          else if (status === 'already_linked') addMsg('ai', t.kinoScanAlreadyLinked, true)
          else if (status === 'used')       addMsg('ai', t.kinoScanUsed, true)
          else if (status === 'claimed_by_other') addMsg('ai', t.kinoScanClaimedByOther, true)
          else {
            addMsg('ai', t.kinoScanSuccess, true)
            addMsg('ai', t.kinoScanInstruction, true)
          }
        } catch (e) {
          addMsg('ai', t.kinoScanError, true)
        } finally {
          setTyping(false)
          resolve()
        }
      },
      fail: () => resolve(),
    })
  })
}

// opts.skipUserMsg — the chat classifier launched this tool from the user's own message
// ("我要定制营养素") instead of the toolbox button, so that message already stands in the chat and
// was persisted server-side. Adding the canned trigger line on top of it would read as the user
// asking twice.
//
// opts.ignoreFocus — the user picked 不设方向 in the focus sheet (main.js's _startFormulaDots),
// so formulate from biomarkers alone even though they hold an active health-plan focus. The
// server zeroes the plans out entirely on this flag, which is why it is a deliberate answer and
// not a default: omitting it means "use whatever focus I have", the behaviour that has always
// applied.
async function runFormulaDs(openid, t, ctx, opts = {}) {
  const { addMsg, addActionMsg, req, setTyping } = ctx
  if (!opts.skipUserMsg) addMsg('user', t.toolFormulaDotMsg, true)
  addMsg('ai', t.formulaGenerating, true)
  setTyping(true)
  try {
    const body = { openid }
    if (opts.ignoreFocus) body.ignore_focus = true
    const res = await req(`${BASE}/api/formula-dots`, 'POST', body)
    if (res.data?.processing) {
      // The dot-count decision runs through the full agentic loop asynchronously (can
      // take up to ~180s) — nothing is written yet at this point, so showing
      // formulaComplete + a working "view plan" button here would be misleading (found via a
      // real device report, 2026-07-29: complete/view-plan showed within a second, but the
      // actual plan wasn't ready for minutes). main.js's ctx defines onAsyncStart (it has a
      // notification-polling loop that can deliver a follow-up message) — keep the
      // typing/status UI alive for it. Callers without one (coach.js) get an honest
      // "still working" message instead of a premature "done".
      if (ctx.onAsyncStart) {
        ctx.onAsyncStart()
        return
      }
      addMsg('ai', t.formulaProcessing, true)
      setTyping(false)
      return
    }
    // No "view plan" button: this tool writes a 'proposed' plan, which deliberately has no
    // schedules and stays out of the Dots subtab until the delivered box is scanned — so that
    // button would show whatever plan the user is currently ON, not the one they just asked for.
    // The reply carries the whole 28-day allocation as a :::formula card instead.
    addMsg('ai', t.formulaComplete, true)
    setTyping(false)
  } catch (e) {
    addMsg('ai', t.formulaError)
    setTyping(false)
  }
}

// opts.async — only main.js's ctx sets this (it has onAsyncStart + a polling loop that can
// deliver the reply later). coach.js and the web ChatTab.jsx callers omit it, so they keep
// getting a synchronous reply exactly as before, unaffected by this.
async function runHealthAdvice(openid, t, ctx, opts = {}) {
  const { addMsg, req, setTyping } = ctx
  const wantAsync = !!opts.async
  addMsg('user', t.toolHealthAdviceMsg)
  setTyping(true)
  try {
    // 290s: the full agentic plan/generate/judge/revise loop is bounded at 200s server-side
    // (agenticChat's TURN_DEADLINE_MS) and the grounding check that follows it can add one more
    // ~60s LLM call, so a legitimate turn reaches ~260s — measured 266s end-to-end 2026-08-22.
    // Only matters for callers without `opts.async` (coach.js, the web app), which have no
    // polling fallback: tripping the client timeout makes FC cancel the invocation, destroying
    // the in-progress work rather than just delaying it. The old 180s sat below the server's own
    // worst case and so cancelled turns that were about to succeed.
    const res = await req(`${BASE}/api/health-advice`, 'POST', { openid, async: wantAsync }, 290000)
    if (res.statusCode !== 200 && res.statusCode !== 201) throw new Error('server error')
    if (wantAsync && res.data?.processing) {
      // Real reply arrives later via the caller's own notification-polling loop — leave the
      // typing/waiting state up to it (see main.js's onAsyncStart) rather than clearing it here.
      ctx.onAsyncStart?.()
      return
    }
    const reply = res.data?.message
    if (!reply) throw new Error('empty response')
    addMsg('ai', reply, true)
    setTyping(false)
  } catch (e) {
    addMsg('ai', t.healthAdviceError)
    setTyping(false)
  }
}

// Called directly with a tempFilePath already obtained by the toolbox component's onTap.
function runUploadImage(openid, t, ctx, tempFilePath) {
  _doUpload(tempFilePath, openid, t, ctx)
}

function _doUpload(tempPath, openid, t, ctx) {
  const { addMsg, addImageMsg, updateImageMsg, req, setTyping, onHealthReportPending } = ctx
  const filename = `img_${Date.now()}.jpg`
  addMsg('ai', t.imageUploading)
  setTyping(true)
  req(`${BASE}/api/oss/presign?type=image&filename=${encodeURIComponent(filename)}&category=user-images`, 'GET')
    .then(presignRes => {
      const { put_url, get_url, key } = presignRes.data || {}
      if (!put_url) throw new Error('presign failed')
      const msgId = addImageMsg ? addImageMsg(tempPath) : null
      wx.getFileSystemManager().readFile({
        filePath: tempPath,
        success: (fileRes) => {
          // File is now in memory — release the temp file immediately so WeChat
          // can create a new temp file on the next wx.chooseMedia call.
          wx.getFileSystemManager().unlink({ filePath: tempPath, fail: () => {} })
          wx.request({
            url: put_url,
            method: 'PUT',
            data: fileRes.data,
            header: { 'Content-Type': 'application/octet-stream' },
            responseType: 'text',
            success: () => {
              // Swap the local temp path to the permanent OSS URL in the chat.
              if (msgId && updateImageMsg) updateImageMsg(msgId, get_url)
              addMsg('ai', t.imageAnalyzing)
              req(`${BASE}/api/analyze-image`, 'POST', { openid, oss_key: key, filename, get_url })
                .then(res => {
                  const reply = res.data?.message
                  if (!reply) throw new Error('empty response')
                  addMsg('ai', reply, true)
                  // Lab report detected → ask the user (in the page) whether to save it.
                  if (res.data?.pending_health_report && onHealthReportPending) {
                    onHealthReportPending(res.data.payload)
                  }
                })
                .catch(() => addMsg('ai', t.imageError))
                .finally(() => setTyping(false))
            },
            fail: () => {
              if (msgId && updateImageMsg) updateImageMsg(msgId, null)
              addMsg('ai', t.imageError)
              setTyping(false)
            },
          })
        },
        fail: () => { addMsg('ai', t.imageError); setTyping(false) },
      })
    })
    .catch(() => { addMsg('ai', t.imageError); setTyping(false) })
}

module.exports = { getToolList, runTestChip, runFormulaDs, runHealthAdvice, runUploadImage, doUpload: _doUpload }
