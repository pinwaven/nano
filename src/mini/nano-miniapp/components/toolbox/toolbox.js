Component({
  properties: {
    tools: { type: Array, value: [] },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onTap(e) {
      if (this.properties.disabled) return
      this.triggerEvent('toolaction', { action: e.currentTarget.dataset.action })
    },
  },
})
