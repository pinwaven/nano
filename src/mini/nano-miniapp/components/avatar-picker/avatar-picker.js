const { AVATAR_GALLERY } = require('../../utils/mood.js')

Component({
  properties: {
    visible: { type: Boolean, value: false },
    selectedId: { type: String, value: '' },
    lang: { type: String, value: 'zh' },
    theme: { type: String, value: 'dark' },
  },

  data: {
    gallery: AVATAR_GALLERY,
  },

  methods: {
    onBackdropTap() {
      this.triggerEvent('close')
    },

    // Swallows the tap so it doesn't bubble to the backdrop and close the sheet.
    onSheetTap() {},

    onPick(e) {
      const avatarId = e.currentTarget.dataset.id
      this.triggerEvent('select', { avatarId })
    },
  },
})
