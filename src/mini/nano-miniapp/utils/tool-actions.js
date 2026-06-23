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

async function runFormulaDs(openid, t, ctx) {
  const { addMsg, addActionMsg, req, setTyping } = ctx
  addMsg('user', t.toolFormulaDotMsg, true)
  addMsg('ai', t.formulaGenerating, true)
  setTyping(true)
  try {
    await req(`${BASE}/api/formula-dots`, 'POST', { openid })
    addMsg('ai', t.formulaComplete, true)
    if (addActionMsg) addActionMsg('view_dots', t.formulaViewDots, true)
  } catch (e) {
    addMsg('ai', t.formulaError)
  } finally {
    setTyping(false)
  }
}

async function runHealthAdvice(openid, t, ctx) {
  const { addMsg, req, setTyping } = ctx
  addMsg('user', t.toolHealthAdviceMsg)
  setTyping(true)
  try {
    const res = await req(`${BASE}/api/health-advice`, 'POST', { openid })
    if (res.statusCode !== 200 && res.statusCode !== 201) throw new Error('server error')
    const reply = res.data?.message
    if (!reply) throw new Error('empty response')
    addMsg('ai', reply, true)
  } catch (e) {
    addMsg('ai', t.healthAdviceError)
  } finally {
    setTyping(false)
  }
}

// Called directly with a tempFilePath already obtained by the toolbox component's onTap.
function runUploadImage(openid, t, ctx, tempFilePath) {
  _doUpload(tempFilePath, openid, t, ctx)
}

function _doUpload(tempPath, openid, t, ctx) {
  const { addMsg, addImageMsg, updateImageMsg, req, setTyping } = ctx
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
