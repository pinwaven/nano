Component({
  properties: {
    tools: { type: Array, value: [] },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onTap(e) {
      const action = e.currentTarget.dataset.action
      const disabled = this.properties.disabled
      console.log('[toolbox] onTap', JSON.stringify({ action, disabled }))
      if (disabled) {
        console.log('[toolbox] blocked — disabled=true')
        return
      }
      if (action === 'upload_image') {
        console.log('[toolbox] calling wx.chooseMedia')
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['original'],
          success: (res) => {
            console.log('[toolbox] chooseMedia success', JSON.stringify(res.tempFiles))
            const tempFilePath = res.tempFiles[0]?.tempFilePath
            if (tempFilePath) {
              this.triggerEvent('toolaction', { action, tempFilePath })
            }
          },
          fail: (err) => {
            console.log('[toolbox] chooseMedia fail', JSON.stringify(err))
          },
        })
      } else {
        this.triggerEvent('toolaction', { action })
      }
    },
  },
})
