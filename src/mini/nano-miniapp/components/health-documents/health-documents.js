// 健康文档 — the user's uploaded health records: clinic notes, 体检报告 PDFs, photographs of
// paper printouts. This is twin layer 3, Medical Records (CLAUDE.md §34), not a Viva AG feature,
// which is why it is a shared component: the 数字孪生 subtab hosts it for everyone, and the
// Viva AG subtab hosts the same one for add-on holders. Extracted from viva-ag-panel on
// 2026-09-08 — a second copy would be two upload paths drifting apart against one backend.
//
// A coach embeds it read-only (can-upload="{{false}}" + coach-id), which hides the upload button
// and the per-row delete. The server re-checks ownership from coach_id; see
// worker/handlers/health_documents.js's _resolveOwner.
const { BASE } = require('../../utils/config.js')
const app = getApp()

const T = {
  zh: {
    documents: '健康文档',
    uploadBtn: '＋ 上传文档',
    sourcePdf: '从聊天记录选择文件',
    sourcePhoto: '拍照 / 从相册选择',
    photoName: '健康文档照片',
    unsupportedTitle: '暂不支持这种文件',
    unsupportedBody: '目前支持 PDF、Word、Excel、PPT 和图片。请选择其中一种格式的健康文档。',
    pdfUnavailableTitle: '文件上传暂未开放',
    pdfUnavailableBody: '微信要求先在小程序后台的「用户隐私保护指引」中声明「选中的文件」权限，才能从聊天记录选择文件。在此之前，可以先用「拍照 / 从相册选择」上传文档照片。',
    gotIt: '知道了',
    errPickFile: '选择文件失败，请重试',
    errOpen: '无法打开该文件，请重试',
    errTooLarge: '文件超过 20MB，请压缩后再试',
    errUpload: '上传失败，请重试',
    errGeneric: '操作失败，请重试',
    okDeleted: '已删除',
    opening: '打开中…',
    preparing: '准备中…',
    uploading: '上传中…',
    registering: '保存中…',
    loading: '加载中…',
    noDocsTitle: '还没有上传任何文档',
    noDocsOther: '该用户还没有上传健康文档',
    noDocsHint: '支持 PDF、Word、Excel、PPT 和图片。可以直接拍照上传纸质报告；文件请先发送到「文件传输助手」或任意聊天，再回来选择。',
    footnote: '文档保存在你的数字孪生「医疗记录」层，健康分析时会作为参考。',
    delete: '删除',
    extPending: '正在解析…',
    extFailed: '解析未完成',
    extRejected: '已标记为解析有误',
    extNone: '',
    extRerun: '重新解析',
    extWrong: '解析有误',
    extRerunOk: '已重新排队',
    extRerunBusy: '正在解析中',
    extClearedTitle: '清除这次解析？',
    extClearedBody: '会删除本次从这份文档读取的指标和健康信息，文档本身保留。',
    extCleared: '已清除',
    summaryLabel: '摘要',
    deleteConfirm: '删除后不可恢复，确定删除吗？',
    typeHospital: '就医记录', typeLab: '检验报告', typeImaging: '影像报告',
    typeDischarge: '出院小结', typePrescription: '处方', typeOther: '文档',
  },
  en: {
    documents: 'Health Records',
    uploadBtn: '＋ Upload record',
    sourcePdf: 'Choose a file from a chat',
    sourcePhoto: 'Take a photo / choose from album',
    photoName: 'health-record-photo',
    unsupportedTitle: 'That file type is not supported',
    unsupportedBody: 'PDF, Word, Excel, PowerPoint and images are supported. Please pick a health record in one of those formats.',
    pdfUnavailableTitle: 'File upload not enabled yet',
    pdfUnavailableBody: 'WeChat requires the "selected files" scope to be declared in the Mini Program console\'s privacy guidelines before files can be picked from a chat. Until then, use "Take a photo / choose from album" to upload a picture of the record.',
    gotIt: 'Got it',
    errPickFile: "Couldn't pick that file, please try again",
    errOpen: "Couldn't open that file, please try again",
    errTooLarge: 'That file is over 20MB. Please compress it and try again',
    errUpload: 'Upload failed, please try again',
    errGeneric: "That didn't work, please try again",
    okDeleted: 'Deleted',
    opening: 'Opening…',
    preparing: 'Preparing…',
    uploading: 'Uploading…',
    registering: 'Saving…',
    loading: 'Loading…',
    noDocsTitle: 'No records uploaded yet',
    noDocsOther: 'This user has not uploaded any health records',
    noDocsHint: 'PDF, Word, Excel, PowerPoint and images are supported. Photograph a paper report directly, or send the file to File Transfer (文件传输助手) or any conversation first, then come back and pick it.',
    footnote: "Records are kept in your digital twin's Medical Records layer and drawn on for health analysis.",
    delete: 'Delete',
    extPending: 'Reading…',
    extFailed: "Couldn't read this one",
    extRejected: 'Marked as misread',
    extNone: '',
    extRerun: 'Read again',
    extWrong: 'Misread',
    extRerunOk: 'Queued again',
    extRerunBusy: 'Already reading',
    extClearedTitle: 'Clear this reading?',
    extClearedBody: 'Removes the markers and health details read from this document. The document itself is kept.',
    extCleared: 'Cleared',
    summaryLabel: 'Summary',
    deleteConfirm: 'This cannot be undone. Delete this record?',
    typeHospital: 'Hospital record', typeLab: 'Lab report', typeImaging: 'Imaging',
    typeDischarge: 'Discharge summary', typePrescription: 'Prescription', typeOther: 'Record',
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

const extOf = (name) => String(name || '').includes('.')
  ? String(name).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
  : ''

Component({
  properties: {
    userId: { type: String, value: '' },
    lang:   { type: String, value: 'zh' },
    theme:  { type: String, value: 'dark' },
    // False hides the upload button AND the per-row delete — a coach reads a client's records,
    // it never adds to or removes from them.
    canUpload: { type: Boolean, value: true },
    // Set only by the coach app. Travels as &coach_id= so the server can verify the target is
    // actually one of this coach's clients (worker/handlers/health_documents.js _resolveOwner).
    coachId: { type: String, value: '' },
  },

  data: {
    t: {},
    documents: [],
    docsLoading: true,
    uploading: false,
    uploadStatus: '',
  },

  lifetimes: {
    attached() {
      this.setData({ t: T[this.properties.lang] || T.zh })
      this._loadDocuments()
    },
  },

  observers: {
    // Both hosts sit behind a wx:if, so an AG holder toggling subtabs gets a fresh mount and
    // a fresh fetch. A user with no AG subtab, though, mounts this once per app launch (the
    // health tab is display:none, never unmounted) — so a language switch after that has to
    // re-translate here rather than relying on attached(). viva-ag-panel does not do this, which
    // is the bug this avoids inheriting.
    lang(newLang) {
      this.setData({ t: T[newLang] || T.zh })
      if (this.data.documents.length) this._relabel()
    },
    userId(id) {
      if (id) this._loadDocuments()
    },
  },

  methods: {
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

    _scope() {
      const { coachId } = this.properties
      return coachId ? `&coach_id=${encodeURIComponent(coachId)}` : ''
    },

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

    // typeLabel is baked into each row at fetch time, so a language switch has to redo it
    // without a round trip.
    _relabel() {
      this.setData({
        documents: this.data.documents.map(d => ({
          ...d,
          typeLabel: this._typeLabel(d.doc_type),
          extLabel: this._extLabel(d.extraction),
        })),
      })
    },

    // What the extraction found, in one line. Counts only — the values themselves are the
    // document's own metadata and the Medical Records layer, and a second copy here would be one
    // more thing to keep in step.
    _extLabel(ext) {
      if (!ext) return ''
      const t = this.data.t
      if (['queued', 'claimed', 'processing'].includes(ext.status)) return t.extPending
      if (ext.status === 'failed') return t.extFailed
      if (ext.status === 'rejected') return t.extRejected
      if (ext.status !== 'completed') return ''
      const isZh = this.properties.lang !== 'en'
      const bits = []
      if (ext.accepted > 0) bits.push(isZh ? `${ext.accepted} 项指标` : `${ext.accepted} marker${ext.accepted === 1 ? '' : 's'}`)
      if (ext.findings > 0) bits.push(isZh ? `${ext.findings} 条健康信息` : `${ext.findings} health detail${ext.findings === 1 ? '' : 's'}`)
      if (bits.length === 0) return isZh ? '未读取到指标' : 'No markers found'
      return isZh ? `已记录 ${bits.join('、')}` : `Recorded ${bits.join(', ')}`
    },

    // Re-run. The server clears the previous extraction BEFORE queueing, which is mandatory
    // rather than tidy: health_events dedupes on (user_id, source, external_id), so a corrected
    // value for the same marker and date would otherwise be a silent no-op.
    async rerunExtraction(e) {
      if (!this.properties.canUpload) return
      const id = e.currentTarget.dataset.id
      const { userId } = this.properties
      const t = this.data.t
      try {
        const res = await this._req(`${BASE}/api/health-documents/${id}/extract`, 'POST', { openid: userId })
        if (!res.data?.success) throw new Error(res.data?.error || 'failed')
        this._toast(res.data.queued ? t.extRerunOk : t.extRerunBusy, 'success')
        this._loadDocuments()
      } catch (err) { this._toast(t.errGeneric) }
    },

    // 解析有误 — throw the reading away and keep the document. Deliberately a different action
    // from deleting the document: the user is saying the reading was wrong, not the file.
    rejectExtraction(e) {
      if (!this.properties.canUpload) return
      const id = e.currentTarget.dataset.id
      const { userId } = this.properties
      const t = this.data.t
      wx.showModal({
        title: t.extClearedTitle,
        content: t.extClearedBody,
        confirmColor: '#E05C5C',
        success: async (m) => {
          if (!m.confirm) return
          try {
            await this._req(`${BASE}/api/health-documents/${id}/extraction?openid=${encodeURIComponent(userId)}`, 'DELETE')
            this._toast(t.extCleared, 'success')
            this._loadDocuments()
          } catch (err) { this._toast(t.errGeneric) }
        },
      })
    },

    async _loadDocuments() {
      const { userId } = this.properties
      if (!userId) return
      try {
        const res = await this._req(
          `${BASE}/api/health-documents?openid=${encodeURIComponent(userId)}${this._scope()}`)
        const docs = (res.data?.documents || []).map(d => ({
          ...d,
          typeLabel: this._typeLabel(d.doc_type),
          sizeLabel: this._sizeLabel(d.size_bytes),
          extLabel: this._extLabel(d.extraction),
          extBusy: !!d.extraction && ['queued', 'claimed', 'processing'].includes(d.extraction.status),
          extDone: !!d.extraction && d.extraction.status === 'completed',
        }))
        this.setData({ documents: docs, docsLoading: false })
      } catch (e) {
        this.setData({ docsLoading: false })
      }
    },

    // Two sources, because they have different platform prerequisites and different real-world
    // uses: a PDF already sitting in a WeChat chat, or a photo of a paper record.
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
      // Three phases, because a single 'uploading' label covered ~95% of the wait and never
      // moved while it did — indistinguishable from a hang on a large scan over a slow uplink.
      // readFile alone is seconds on a 20MB PDF (it pulls the whole file into the JS heap) and
      // reports nothing, so it gets its own phase rather than hiding inside the transfer's.
      //
      // The accompanying bar is INDETERMINATE by necessity, not by preference: wx.request
      // exposes no upload progress events, and wx.uploadFile — the only API that does — sends
      // multipart/form-data, which would break the OSS presigned PUT's signature (it signs the
      // raw body plus Content-Type). A real percentage needs an OSS POST-policy upload and a
      // different presign shape server-side. Until then this says "still working" rather than
      // inventing a number nothing can measure.
      this.setData({ uploading: true, uploadStatus: t.preparing })
      try {
        const pre = await this._req(
          `${BASE}/api/health-documents/presign?openid=${encodeURIComponent(userId)}`
          + `&filename=${encodeURIComponent(file.name)}&size_bytes=${file.size}`)
        if (!pre.data?.success) throw new Error(pre.data?.error || 'presign failed')
        const { key, put_url, put_content_type } = pre.data

        const bytes = await new Promise((resolve, reject) => {
          wx.getFileSystemManager().readFile({ filePath: file.path, success: r => resolve(r.data), fail: reject })
        })

        this.setData({ uploadStatus: t.uploading })
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
        const res = await this._req(
          `${BASE}/api/health-documents/${id}/url?openid=${encodeURIComponent(userId)}${this._scope()}`)
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
      if (!this.properties.canUpload) return
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
  },
})
