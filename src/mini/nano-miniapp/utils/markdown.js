'use strict'

// Markdown -> renderable SEGMENTS for the chat tab's AI bubbles (pages/main/).
//
// Why segments instead of one HTML blob: <mp-html> is registered as a WeChat Component with no
// options.styleIsolation, so it defaults to `isolated` — main.wxss class selectors CANNOT reach
// inside it. Only inherited properties (color/font-size/line-height/font-family) cross the
// boundary. That makes designed cards (status-coloured metric tiles, accent-barred takeaways)
// impossible to build in there: no descendant selectors, no pseudo-elements, no .theme-light
// cascade. So prose goes through mp-html and everything else renders as native page-scope views.
//
// Segment shapes (kept flat — WXML can't destructure):
//   { t:'html',     h }                                   coalesced prose run
//   { t:'rule' }                                          --- divider
//   { t:'metric',   items:[{ label, value, unit, s, sl }] }
//   { t:'takeaway', title, h }
//   { t:'dots',     items:[{ id, name, note }] }
//
// `s` is normalised to a closed set; `sl` is the model's own label, shown verbatim, so zh and en
// both work with no translation table. The client never invents a status the model didn't write.

// Theme-INVARIANT chrome. MD_TAG_STYLE is bound to <mp-html tag-style> and mp-html's `properties`
// declares an observer on `content` ONLY — tagStyle has none, so rebinding it on a theme toggle
// would not re-parse already-rendered messages. Hence: no theme-dependent colour here. Prose
// colour rides on inheritance (.message-ai / .theme-light .message-ai already flip it), and
// non-inherited chrome uses neutral translucent greys that read as a lighter panel on the dark
// navy bubble and a darker one on the light cream bubble.
var B = 'rgba(127,127,127,0.30)' // borders / rules
var F = 'rgba(127,127,127,0.13)' // subtle fills

// Sizes here are RELATIVE (em), not absolute rpx, so they track .msg-html's own font-size
// and therefore the accessibility text-size setting. Absolute values would not: tagStyle is
// applied as an INLINE style on each parsed node (parser.js parseStyle), which beats any
// stylesheet rule, and the map is bound once and never re-parsed (see the note above). With
// 28rpx body text scaling to 40rpx at the largest level, a hardcoded 34rpx h1 would end up
// SMALLER than the paragraphs under it. The em values reproduce the previous rpx sizes
// exactly at the default level (34/28 = 1.21, 32/28 = 1.14, 29/28 = 1.04, 25/28 = 0.89,
// 24/28 = 0.86). mp-html's own built-in tagStyle uses em the same way (big/small).
var MD_TAG_STYLE = {
  p: 'margin:0 0 20rpx',
  h1: 'font-size:1.21em;font-weight:700;margin:30rpx 0 12rpx;line-height:1.35',
  h2: 'font-size:1.14em;font-weight:700;margin:28rpx 0 10rpx;line-height:1.35',
  h3: 'font-size:1.04em;font-weight:600;margin:24rpx 0 8rpx;line-height:1.4',
  h4: 'font-size:1em;font-weight:600;margin:20rpx 0 6rpx',
  h5: 'font-size:1em;font-weight:600;margin:20rpx 0 6rpx',
  h6: 'font-size:1em;font-weight:600;margin:20rpx 0 6rpx',
  ul: 'margin:10rpx 0 18rpx;padding-left:38rpx',
  ol: 'margin:10rpx 0 18rpx;padding-left:44rpx',
  li: 'margin:0 0 8rpx;line-height:1.6',
  strong: 'font-weight:600',
  em: 'font-style:italic',
  blockquote: 'margin:18rpx 0;padding:2rpx 0 2rpx 22rpx;border-left:6rpx solid ' + B,
  code: 'font-family:monospace;font-size:0.89em;background:' + F + ';padding:2rpx 8rpx;border-radius:6rpx',
  // Overriding the built-in `pre` entry DROPS its default "font-family:monospace;white-space:pre"
  // (parser.js does Object.assign over the whole map, not a per-property merge) — both restated.
  pre: 'font-family:monospace;white-space:pre;display:block;font-size:0.86em;background:' + F +
       ';border:1rpx solid ' + B + ';border-radius:12rpx;padding:16rpx 18rpx;margin:18rpx 0;overflow-x:auto',
  table: 'width:100%;table-layout:fixed;border-collapse:collapse;font-size:0.89em;margin:18rpx 0',
  th: 'border:1rpx solid ' + B + ';padding:10rpx 12rpx;text-align:left;font-weight:600',
  td: 'border:1rpx solid ' + B + ';padding:10rpx 12rpx;text-align:left;word-break:break-word',
  // node.wxss hardcodes ._a{color:#366092}, a blue matching neither theme. An element's own inline
  // style is concatenated AFTER tagStyle in parser.js, so this wins — and inheriting the bubble's
  // colour is theme-safe by construction.
  a: 'color:inherit;text-decoration:underline'
}

var STATUS_TOKENS = {
  '正常': 'normal', 'normal': 'normal',
  '偏高': 'high', '高': 'high', '升高': 'high', 'elevated': 'high', 'high': 'high',
  '偏低': 'low', '低': 'low', 'low': 'low',
  '良好': 'good', '优秀': 'good', 'good': 'good', 'optimal': 'good',
  '关注': 'watch', '注意': 'watch', 'watch': 'watch', 'borderline': 'watch'
}

function _normStatus (s) {
  if (!s) return 'none'
  var k = String(s).trim().toLowerCase()
  return STATUS_TOKENS[k] || 'none'
}

function _esc (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// escape -> stash code spans -> transform -> restore. Stashing is what stops `**x**` INSIDE a
// backtick span from being processed as bold (a real bug in the previous implementation).
function _inline (s) {
  var codes = []
  var out = _esc(s)
  out = out.replace(/`([^`\n]+)`/g, function (_m, c) {
    codes.push(c)
    return '\u0000' + (codes.length - 1) + '\u0000'
  })
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, function (_m, txt, href) {
    return '<a href="' + href.replace(/"/g, '&quot;') + '">' + txt + '</a>'
  })
  out = out.replace(/~~(.+?)~~/g, function (_m, c) { return '<del>' + c + '</del>' })
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, function (_m, c) { return '<strong><em>' + c + '</em></strong>' })
  out = out.replace(/\*\*(.+?)\*\*/g, function (_m, c) { return '<strong>' + c + '</strong>' })
  out = out.replace(/\*([^*\n]+)\*/g, function (_m, c) { return '<em>' + c + '</em>' })
  // _italic_ REQUIRES word boundaries — the previous unanchored rule mangled user_id, DOT_N7 and
  // any other snake_case that showed up in a reply.
  out = out.replace(
    /(^|[\s(（【「])_([^_\s][^_]*?)_(?=[\s.,!?)）】」。，！？；;:：]|$)/g,
    function (_m, pre, c) { return pre + '<em>' + c + '</em>' }
  )
  out = out.replace(/\u0000(\d+)\u0000/g, function (_m, i) { return '<code>' + codes[Number(i)] + '</code>' })
  return out
}

function _isHr (t) { return /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(t) }
function _isHeading (t) { return /^#{1,6}\s+/.test(t) }
function _isListItem (l) { return /^(\s*)([-*+]|\d+[.)])\s+/.test(l) }
function _isQuote (l) { return /^\s*>/.test(l) }
function _isFence (t) { return /^```/.test(t) }

function _isTableStart (lines, i) {
  if (i + 1 >= lines.length) return false
  if (lines[i].indexOf('|') === -1) return false
  return /^\s*\|?[\s:\-|]*\|[\s:\-|]*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])
}

function _tableCells (line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim() })
}

// Distinct indent widths are mapped to levels in ascending order rather than dividing by a fixed
// step, so 2-space and 4-space indentation both nest correctly.
function _renderList (items) {
  var seen = []
  var k
  for (k = 0; k < items.length; k++) if (seen.indexOf(items[k].indent) === -1) seen.push(items[k].indent)
  seen.sort(function (a, b) { return a - b })
  for (k = 0; k < items.length; k++) items[k].level = Math.min(3, seen.indexOf(items[k].indent))

  var html = ''
  var stack = []
  function close () { var f = stack.pop(); html += '</li></' + (f.ordered ? 'ol' : 'ul') + '>' }

  for (k = 0; k < items.length; k++) {
    var it = items[k]
    while (stack.length > it.level + 1) close()
    if (stack.length === it.level + 1) {
      html += '</li>'
    } else {
      var tag = it.ordered ? 'ol' : 'ul'
      // Inline style on a nested list beats our own tagStyle margin (parser.js concatenates the
      // element's style AFTER tagStyle), restoring node.wxss's intent that nested lists don't
      // re-add the outer list's vertical margin.
      html += '<' + tag + (stack.length > 0 ? ' style="margin:0"' : '') + '>'
      stack.push({ ordered: it.ordered })
    }
    var tm = it.text.match(/^\[([ xX])\]\s+([\s\S]*)$/)
    if (tm) {
      // <input type=checkbox> is in mp-html's ignoreTags, so the box is drawn as a glyph.
      html += '<li style="list-style:none;margin-left:-24rpx">' + (tm[1] === ' ' ? '○ ' : '✓ ') + _inline(tm[2])
    } else {
      html += '<li>' + _inline(it.text)
    }
  }
  while (stack.length) close()
  return html
}

// Returns an array of complete top-level block HTML strings. Recurses for blockquote content.
function _parseBlocks (lines) {
  var out = []
  var i = 0
  while (i < lines.length) {
    var raw = lines[i]
    var line = raw.trim()

    if (_isFence(line)) {
      i++
      var code = []
      while (i < lines.length && !_isFence(lines[i].trim())) { code.push(lines[i]); i++ }
      if (i < lines.length) i++
      // No inner <code>: `pre` already carries the panel chrome and `code` carries a chip
      // background — nesting them double-paints.
      out.push('<pre>' + _esc(code.join('\n')) + '</pre>')
      continue
    }

    if (line === '') { i++; continue }

    // Only reachable via blockquote recursion — the top-level scanner turns --- into a {t:'rule'}
    // segment instead, because <hr> is NOT in rich-text's tag whitelist and renders nothing.
    if (_isHr(line)) {
      out.push('<div style="height:1rpx;background:' + B + ';margin:18rpx 0"></div>')
      i++
      continue
    }

    var hm = line.match(/^(#{1,6})\s+(.+)$/)
    if (hm) {
      var n = hm[1].length
      out.push('<h' + n + '>' + _inline(hm[2].trim()) + '</h' + n + '>')
      i++
      continue
    }

    if (_isQuote(raw)) {
      var inner = []
      while (i < lines.length && (_isQuote(lines[i]) || (lines[i].trim() !== '' && inner.length && !_isListItem(lines[i]) && !_isHeading(lines[i].trim())))) {
        if (!_isQuote(lines[i]) && lines[i].trim() === '') break
        inner.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push('<blockquote>' + _parseBlocks(inner).join('') + '</blockquote>')
      continue
    }

    if (_isTableStart(lines, i)) {
      var head = _tableCells(lines[i])
      i += 2
      var th = ''
      for (var c = 0; c < head.length; c++) th += '<th>' + _inline(head[c]) + '</th>'
      var tbl = '<table><thead><tr>' + th + '</tr></thead><tbody>'
      while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
        var cells = _tableCells(lines[i])
        i++
        var td = ''
        for (var d = 0; d < cells.length; d++) td += '<td>' + _inline(cells[d]) + '</td>'
        tbl += '<tr>' + td + '</tr>'
      }
      out.push(tbl + '</tbody></table>')
      continue
    }

    if (_isListItem(raw)) {
      var items = []
      while (i < lines.length) {
        var lm = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+([\s\S]*)$/)
        if (!lm) {
          // A blank line only ends the list if a list item doesn't resume right after it.
          if (lines[i].trim() === '' && i + 1 < lines.length && _isListItem(lines[i + 1])) { i++; continue }
          break
        }
        items.push({
          indent: lm[1].replace(/\t/g, '  ').length,
          ordered: /\d/.test(lm[2]),
          text: lm[3]
        })
        i++
      }
      out.push(_renderList(items))
      continue
    }

    // Paragraph: consecutive non-blank lines become ONE <p> joined with <br>. This is
    // pixel-identical to the previous one-<p>-per-source-line behaviour (node.wxss's ._p has zero
    // margin, so N paragraphs rendered exactly like N <br>s) while letting a BLANK line become
    // real vertical rhythm instead of the stray bare <br> it used to emit. Joining with a space
    // instead would silently reflow intentional single-newline layout and open a visible gap at
    // CJK line boundaries.
    var para = []
    while (i < lines.length) {
      var pl = lines[i]
      var pt = pl.trim()
      if (pt === '' || _isFence(pt) || _isHr(pt) || _isHeading(pt) || _isQuote(pl) || _isListItem(pl) || _isTableStart(lines, i)) break
      para.push(pt)
      i++
    }
    if (para.length) {
      var joined = []
      for (var p = 0; p < para.length; p++) joined.push(_inline(para[p]))
      out.push('<p>' + joined.join('<br>') + '</p>')
    } else {
      i++ // safety: never spin
    }
  }
  return out
}

// Zero the trailing margin of a prose run's last block so it never leaves dangling space above a
// card or the next segment. Inline style beats tagStyle.
function _zeroLastMargin (block) {
  return block.replace(/^<([a-z][a-z0-9]*)([^>]*)>/i, function (_m, tag, attrs) {
    if (/\sstyle="/.test(attrs)) return '<' + tag + attrs.replace(/\sstyle="/, ' style="margin-bottom:0;') + '>'
    return '<' + tag + attrs + ' style="margin-bottom:0">'
  })
}

var DIRECTIVE_NAMES = { metric: 1, takeaway: 1, dots: 1, formula: 1, product: 1 }

// "1-9,12-28" -> "1\u20139 \u00b7 12\u201328". Digits, '-' and ',' only: this string is rendered next
// to the page's own localised day word, and anything else in it came from somewhere it shouldn't.
function _prettyDayRanges (raw) {
  var parts = String(raw || '').split(',')
  var out = []
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim()
    if (!/^[0-9]+(-[0-9]+)?$/.test(p)) continue
    out.push(p.replace('-', '\u2013'))
  }
  return out.join(' \u00b7 ')
}

function _buildDirective (name, inner) {
  var rows = []
  for (var i = 0; i < inner.length; i++) {
    var r = inner[i].trim()
    if (r !== '') rows.push(r)
  }
  if (!rows.length) return null

  if (name === 'metric') {
    var mitems = []
    for (var m = 0; m < rows.length; m++) {
      var p = rows[m].split('|')
      for (var q = 0; q < p.length; q++) p[q] = p[q].trim()
      if (!p[0]) continue
      mitems.push({
        label: p[0],
        value: p[1] || '',
        unit: p[2] || '',
        sl: p[3] || '',
        s: _normStatus(p[3])
      })
    }
    return mitems.length ? { t: 'metric', items: mitems } : null
  }

  if (name === 'takeaway') {
    // title is left undefined so the WXML falls back to the localised t.mdTakeaway — the
    // segmenter has no language context and must not hardcode one.
    return { t: 'takeaway', h: _parseBlocks(inner).join('') }
  }

  // :::formula — the Formulate-Dots proposal chart. Rows are key|name|color|am|pm, written by
  // the SERVER from an already-validated allocation (handlers/dots.js's
  // _buildFormulaChartBlock), never by the model — so the bars can't disagree with the numbers.
  // Every total is derived here rather than sent, so there is one place the arithmetic lives.
  //
  // Meta lines are '#'-prefixed, which no dot key can start with. A card saved to chat history
  // BEFORE the 28-day rework has none of them and still renders correctly, as one unlabelled
  // group — do not make any of them required.
  //   #cycle|<days>|<capsules>   cycle length, for the footer
  //   #plan|<id>                 the proposed nutrition_plans row, which enables the order CTA
  //   #label|<url>               the formulation's QR/label page. Rendered as a link the page
  //                              opens in a webview — the miniapp never draws the QR itself, so
  //                              what the user sees is the same page that prints on the box.
  //   #order|<mode>              'buy' (order this formulation) | 'submit' (a paid fast-track
  //                              package is waiting — confirm THIS formula for compounding) |
  //                              'ag' (a paid premium package is waiting; Viva AG owns it, so no
  //                              CTA). Absent, unknown, or unrecognised all mean 'buy'.
  //   #day|<ranges>|<kind>       starts a group; rows after it belong to it. Ranges are bare
  //                              numbers ("1-9,12-28"); the day WORD is the page's, not ours.
  //   #tier|<label>|<width>|<rec> starts a PACKAGE: every #day group and row after it belongs to
  //                              it, until the next #tier. Only ever present on a 'buy'-mode
  //                              card — a user who already paid holds a fixed tier and is not
  //                              choosing between them. <rec> is 1 on exactly one package: the
  //                              narrowest that carries the whole formulation.
  //   #note|<text>               that package's own positioning line, verbatim from the store
  //   #pitch|<text>              that package's line for THIS user
  //   #rung|<label>|<width>|<pitch>
  //                              RETIRED 2026-09-10 and no longer written: the card now draws a
  //                              complete formula per package instead of a base plus upgrade
  //                              rungs. Still parsed, because chat history is permanent and
  //                              every card written before that date contains one.
  //
  // A card with no #tier — every card written before three packages existed, and every card for
  // a user who already holds one — becomes a single unnamed package, so the page has one code
  // path rather than two.
  if (name === 'formula') {
    var fgroups = []
    var fcur = null
    var fcycleDays = 0
    var fcycleCaps = 0
    var fplan = ''
    var fmode = 'buy'
    var flabel = ''
    var frungs = []
    var fcurRung = null
    var ftiers = []
    var fcurTier = null
    for (var f = 0; f < rows.length; f++) {
      var line = rows[f]
      var fp = line.split('|')
      for (var y = 0; y < fp.length; y++) fp[y] = fp[y].trim()
      if (fp[0] === '#cycle') {
        fcycleDays = parseInt(fp[1], 10) > 0 ? parseInt(fp[1], 10) : 0
        fcycleCaps = parseInt(fp[2], 10) > 0 ? parseInt(fp[2], 10) : 0
        continue
      }
      if (fp[0] === '#plan') {
        // Interpolated into a data- attribute and posted back as a plan id, so digits only.
        fplan = /^[0-9]{1,18}$/.test(fp[1] || '') ? fp[1] : ''
        continue
      }
      if (fp[0] === '#label') {
        // Rejoin: the URL was split on '|' along with everything else, and a query string may
        // legitimately contain one. Scheme-checked because this ends up in wx.navigateTo.
        var url = fp.slice(1).join('|')
        flabel = /^https:\/\/[^\s]+$/.test(url) ? url : ''
        continue
      }
      if (fp[0] === '#order') {
        fmode = (fp[1] === 'submit' || fp[1] === 'ag') ? fp[1] : 'buy'
        continue
      }
      if (fp[0] === '#tier') {
        fcurTier = {
          label: fp[1] || '',
          width: parseInt(fp[2], 10) > 0 ? parseInt(fp[2], 10) : 0,
          recommended: fp[3] === '1',
          note: '',
          pitch: '',
          groups: []
        }
        // A new package starts its own chart; nothing after this line may attach to the previous
        // package's last day group.
        fcur = null
        ftiers.push(fcurTier)
        continue
      }
      if (fp[0] === '#note' || fp[0] === '#pitch') {
        // Rejoin the tail: both are sentences and may legitimately contain a '|', which the
        // server replaces with '/' before writing — but a future writer might not, and a line
        // truncated at the first pipe reads as a broken promise rather than as a bug.
        if (fcurTier) fcurTier[fp[0] === '#note' ? 'note' : 'pitch'] = fp.slice(1).join('|')
        continue
      }
      if (fp[0] === '#rung') {
        // Rejoin the tail: the pitch is a sentence and may legitimately contain a '|', which the
        // server replaces with '/' before writing — but a future writer might not, and a pitch
        // truncated at the first pipe reads as a broken promise rather than a bug.
        fcurRung = {
          label: fp[1] || '',
          width: parseInt(fp[2], 10) > 0 ? parseInt(fp[2], 10) : 0,
          pitch: fp.slice(3).join('|'),
          items: []
        }
        // Once a rung starts, every following row belongs to a rung — the day groups are done.
        fcur = null
        frungs.push(fcurRung)
        continue
      }
      if (fp[0] === '#day') {
        fcur = {
          days: _prettyDayRanges(fp[1] || ''),
          kind: fp[2] === 'n7' ? 'n7' : 'regular',
          items: [], am: 0, pm: 0, total: 0
        }
        fgroups.push(fcur)
        if (fcurTier) fcurTier.groups.push(fcur)
        continue
      }
      if (fp[0].charAt(0) === '#') continue
      var am = parseInt(fp[3], 10)
      var pm = parseInt(fp[4], 10)
      if (!fp[0] || (!am && !pm)) continue
      am = am > 0 ? am : 0
      pm = pm > 0 ? pm : 0
      if (fcurRung) {
        fcurRung.items.push({
          key: fp[0],
          name: fp[1] || fp[0],
          color: /^#[0-9a-fA-F]{3,8}$/.test(fp[2] || '') ? fp[2] : '#6B7B8C',
          am: am,
          pm: pm,
          // Bare week numbers when this dot does not run all four weeks; the word around them is
          // the page's, since this file has no language context. Absent = every week.
          weeks: /^[0-9]+(,[0-9]+)*$/.test(fp[5] || '') ? fp[5] : ''
        })
        continue
      }
      if (!fcur) {
        // Legacy card, or rows before any #day line: one implicit unlabelled group.
        fcur = { days: '', kind: 'regular', items: [], am: 0, pm: 0, total: 0 }
        fgroups.push(fcur)
        if (fcurTier) fcurTier.groups.push(fcur)
      }
      fcur.am += am
      fcur.pm += pm
      fcur.items.push({
        key: fp[0],
        name: fp[1] || fp[0],
        // Hex is validated rather than trusted: it is interpolated into an inline style.
        color: /^#[0-9a-fA-F]{3,8}$/.test(fp[2] || '') ? fp[2] : '#6B7B8C',
        am: am,
        pm: pm,
        total: am + pm
      })
    }
    var fkept = []
    for (var h = 0; h < fgroups.length; h++) if (fgroups[h].items.length) fkept.push(fgroups[h])
    if (!fkept.length) return null

    // Bar widths are percentages of the LARGEST capsule across EVERY group, not per group, so a
    // reset day's smaller capsule reads as genuinely smaller instead of self-normalising to look
    // the same size as a full day.
    var fmax = 1
    for (var m2 = 0; m2 < fkept.length; m2++) {
      if (fkept[m2].am > fmax) fmax = fkept[m2].am
      if (fkept[m2].pm > fmax) fmax = fkept[m2].pm
    }
    for (var g2 = 0; g2 < fkept.length; g2++) {
      var grp = fkept[g2]
      grp.total = grp.am + grp.pm
      for (var i2 = 0; i2 < grp.items.length; i2++) {
        grp.items[i2].amPct = grp.items[i2].am / fmax * 100
        grp.items[i2].pmPct = grp.items[i2].pm / fmax * 100
      }
    }
    // Packages with nothing to draw are dropped, then the ones that remain are given their own
    // dot roster and their delta over the package below. A card with no #tier becomes one unnamed
    // package holding every group, so the page renders both shapes with one loop.
    var ftkept = []
    for (var t2 = 0; t2 < ftiers.length; t2++) {
      var tr = ftiers[t2]
      var tgroups = []
      for (var q = 0; q < tr.groups.length; q++) if (tr.groups[q].items.length) tgroups.push(tr.groups[q])
      if (!tgroups.length) continue
      tr.groups = tgroups
      ftkept.push(tr)
    }
    if (!ftkept.length) {
      ftkept = [{ label: '', width: 0, recommended: true, note: '', pitch: '', groups: fkept }]
    }
    for (var t3 = 0; t3 < ftkept.length; t3++) {
      var tier = ftkept[t3]
      var seen = {}
      var roster = []
      for (var g3 = 0; g3 < tier.groups.length; g3++) {
        // The everyday group only: an N7 reset day holds one dot in isolation and listing it as
        // part of the roster would say this package contains a single dot.
        if (tier.groups[g3].kind === 'n7') continue
        for (var r3 = 0; r3 < tier.groups[g3].items.length; r3++) {
          var it = tier.groups[g3].items[r3]
          if (seen[it.key]) continue
          seen[it.key] = 1
          roster.push({ key: it.key, name: it.name, color: it.color })
        }
      }
      // The roster IS the package: its actual dots, drawn as swatches when collapsed. Deliberately
      // no count and no "+N over the one below" — what separates the packages is a product
      // decision moving beyond "how many kinds of dot", so a number here would be the first thing
      // to go stale, and it is the one claim on this card a user cannot verify for themselves.
      tier.dots = roster
      // The recommended package is the one the card opens on. Exactly one, always: a card whose
      // server marked none (or, from a future writer, several) still opens on something.
      tier.open = !!tier.recommended
    }
    var anyOpen = false
    for (var t4 = 0; t4 < ftkept.length; t4++) {
      if (ftkept[t4].open && !anyOpen) { anyOpen = true; continue }
      ftkept[t4].open = false
    }
    if (!anyOpen) ftkept[0].open = true

    return {
      t: 'formula',
      groups: fkept,
      tiers: ftkept,
      cycleDays: fcycleDays,
      cycleCapsules: fcycleCaps,
      planId: fplan,
      orderMode: fmode,
      labelUrl: flabel,
      // Rungs with no dots are dropped: an upgrade that adds nothing reads as a broken promise.
      // Only ever non-empty for a card written before packages replaced the ladder.
      rungs: frungs.filter(function (r) { return r.items.length }),
      // Legacy top-level fields, kept so anything still reading seg.items/am/pm/total sees the
      // everyday dose rather than nothing.
      items: fkept[0].items, am: fkept[0].am, pm: fkept[0].pm, total: fkept[0].total
    }
  }

  if (name === 'dots') {
    var ditems = []
    for (var k = 0; k < rows.length; k++) {
      var dp = rows[k].split('|')
      for (var z = 0; z < dp.length; z++) dp[z] = dp[z].trim()
      var head = dp[0] || ''
      // "12号原粒 夜安宁" / "DOT-N12 Night Calm" — id then name, space-separated, so
      // factCheck.js's _extractDotReferences still captures the real name.
      var hm2 = head.match(/^(\S+)\s+([\s\S]+)$/)
      var item = { id: hm2 ? hm2[1] : head, name: hm2 ? hm2[2] : '', note: dp[1] || '' }
      if (item.id) ditems.push(item)
    }
    return ditems.length ? { t: 'dots', items: ditems } : null
  }

  // :::product — a store recommendation card. Rows are sku|name|price|reason, written by the
  // SERVER from the catalog snapshot the turn was built on (handlers/dots.js's
  // _buildProductCardBlock), never by the model — same rule as :::formula above, so the price
  // shown can never disagree with what the store will actually charge. The sku is carried
  // through only as a tap target; it is never displayed.
  if (name === 'product') {
    var pitems = []
    for (var pi = 0; pi < rows.length; pi++) {
      var pp = rows[pi].split('|')
      for (var pj = 0; pj < pp.length; pj++) pp[pj] = pp[pj].trim()
      if (!pp[0] || !pp[1]) continue
      pitems.push({ sku: pp[0], name: pp[1], price: pp[2] || '', reason: pp[3] || '' })
    }
    return pitems.length ? { t: 'product', items: pitems } : null
  }

  return null
}

function mdToSegments (md) {
  var segs = []
  if (md == null) return segs
  var lines = String(md).replace(/\r\n?/g, '\n').split('\n')
  var prose = []

  function flush () {
    if (!prose.length) return
    var blocks = _parseBlocks(prose)
    prose = []
    if (!blocks.length) return
    blocks[blocks.length - 1] = _zeroLastMargin(blocks[blocks.length - 1])
    segs.push({ t: 'html', h: blocks.join('') })
  }

  var i = 0
  var inCode = false
  while (i < lines.length) {
    var line = lines[i]
    var t = line.trim()

    // Track fenced code at the top level too, so a ``` block containing ::: or --- is left alone.
    if (_isFence(t)) { inCode = !inCode; prose.push(line); i++; continue }
    if (inCode) { prose.push(line); i++; continue }

    var dm = t.match(/^:::\s*([a-z][a-z0-9_-]*)\s*$/i)
    if (dm) {
      var name = dm[1].toLowerCase()
      var inner = []
      i++
      while (i < lines.length) {
        var it = lines[i].trim()
        if (/^:::\s*$/.test(it)) { i++; break }        // explicit close
        if (/^:::\s*[a-z]/i.test(it)) break            // a new fence implicitly closes this one
        inner.push(lines[i])
        i++
      }
      // Unterminated fences are normal — LLM output truncates — so EOF closes implicitly above.
      if (DIRECTIVE_NAMES[name]) {
        var seg = _buildDirective(name, inner)
        if (seg) { flush(); segs.push(seg); continue }
      }
      // Unknown or unbuildable directive: fall back to prose. Never drop content.
      for (var f = 0; f < inner.length; f++) prose.push(inner[f])
      continue
    }

    if (_isHr(t)) { flush(); segs.push({ t: 'rule' }); i++; continue }

    prose.push(line)
    i++
  }
  flush()
  return segs
}

// Plain markdown -> ONE html string, for rendering a whole document in a single <mp-html>.
//
// Unlike mdToSegments this deliberately does NOT interpret ::: directives: its caller is the
// Viva AG report viewer, whose input is a file written by an EXTERNAL system, and letting that
// system render designed status cards inside the app is the same injection surface
// handlers/viva_ag.js strips ::: out of result summaries to avoid. Directive lines fall through
// as ordinary text. Raw HTML in the source is escaped by _esc/_inline, so it cannot inject either.
function mdToHtml (md) {
  if (md == null) return ''
  var lines = String(md).replace(/\r\n?/g, '\n').split('\n')
  var blocks = _parseBlocks(lines)
  if (!blocks.length) return ''
  blocks[blocks.length - 1] = _zeroLastMargin(blocks[blocks.length - 1])
  return blocks.join('')
}

module.exports = { mdToSegments, mdToHtml, MD_TAG_STYLE }
