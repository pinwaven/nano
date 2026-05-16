/**
 * Lightweight markdown → HTML converter for mp-html in the miniapp chat.
 * Handles the subset of markdown that Nano AI actually outputs.
 */

function mdToHtml(md) {
  if (!md || typeof md !== 'string') return ''

  let s = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Fenced code blocks (before inline code)
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    `<pre><code>${code.trim()}</code></pre>`)

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')

  // Headers
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Bold + italic combined
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Blockquotes
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')

  // Unordered lists — collect consecutive items then wrap
  s = s.replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^[-*] /, '')}</li>`).join('')
    return `<ul>${items}</ul>`
  })

  // Ordered lists
  s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('')
    return `<ol>${items}</ol>`
  })

  // Horizontal rule
  s = s.replace(/^---+$/gm, '<hr>')

  // Paragraphs: split on double newlines, wrap non-block lines
  const blockTags = /^<(h[1-6]|ul|ol|pre|blockquote|hr)/
  const parts = s.split(/\n{2,}/)
  s = parts.map(p => {
    p = p.trim()
    if (!p) return ''
    if (blockTags.test(p)) return p
    // Single newlines within a paragraph become <br>
    return `<p>${p.replace(/\n/g, '<br>')}</p>`
  }).filter(Boolean).join('')

  return s
}

module.exports = { mdToHtml }
