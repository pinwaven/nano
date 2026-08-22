// WCAG contrast audit for the chat tab's AI message cards, in BOTH themes.
//
// This exists because of commit c8aa1d6 ("miniapp light theme visibility issue fixed"), whose
// postmortem in app.wxss documents text rendering at 1.05:1 on the light background. The cards
// added for the AI-formatting redesign sit on a blue/brown-tinted surface layered over the
// message bubble — a lighter ground than the page background the global --success/--warn/
// --danger/--info tokens were audited against. Reusing those global values there measured
// 2.86:1 to 4.26:1, so main.wxss defines re-solved --chat-* tokens instead. This test reads the
// real values out of the stylesheet so a future tweak cannot silently regress them.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');
const mainCss = fs.readFileSync(path.join(MINI, 'pages', 'main', 'main.wxss'), 'utf8');

// ── colour maths ────────────────────────────────────────────────────────────
const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
};
const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const luminance = (c) => {
  const s = c.map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};
const contrast = (fg, bg) => {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
};

// Pull a --chat-* token out of a given block of main.wxss.
function token(blockSelector, name) {
  const start = mainCss.indexOf(blockSelector + ' {');
  assert.ok(start > -1, `block "${blockSelector}" not found in main.wxss`);
  const block = mainCss.slice(start, mainCss.indexOf('}', start));
  const m = block.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})'));
  assert.ok(m, `--${name} not found in "${blockSelector}"`);
  return hex(m[1]);
}

// Surfaces, composited exactly as main.wxss layers them. The alpha values mirror .mcard-tile /
// .tcard / .dcard-chip / .mcard-pill and their .theme-light overrides.
const THEMES = {
  dark: {
    sel: 'page',
    bubble: hex('#162E4A'),   // .message-ai
    page: hex('#0B1C2E'),     // --navy
    accentRgb: [99, 117, 236],
    tileA: 0.08, tcardA: 0.10, chipA: 0.12,
    pill: (tile) => over([127, 127, 127], 0.14, tile),
  },
  light: {
    sel: '.theme-light',
    bubble: hex('#F5EDE3'),   // .theme-light .message-ai -> --navy-lift
    page: hex('#FAF7F2'),
    accentRgb: [152, 95, 51],
    tileA: 0.06, tcardA: 0.07, chipA: 0.08,
    pill: (tile) => over([0, 0, 0], 0.05, tile),
  },
};

const MIN = 4.5; // all of these are small text (20-25rpx); none qualifies for the 3:1 large-text bar

for (const [name, T] of Object.entries(THEMES)) {
  test(`chat card text clears ${MIN}:1 in the ${name} theme`, () => {
    const tile = over(T.accentRgb, T.tileA, T.bubble);
    const tcard = over(T.accentRgb, T.tcardA, T.bubble);
    const chip = over(T.accentRgb, T.chipA, T.bubble);
    const pill = T.pill(tile);
    const tok = (n) => token(T.sel, n);

    const pairs = [
      ['.mcard-pill (base)', tok('chat-pill-fg'), pill],
      ['.mcard-good .mcard-pill', tok('chat-good'), pill],
      ['.mcard-watch .mcard-pill', tok('chat-warn'), pill],
      ['.mcard-high .mcard-pill', tok('chat-high'), pill],
      ['.mcard-low .mcard-pill', tok('chat-low'), pill],
      ['.tcard-title', tok('chat-accent'), tcard],
      ['.dcard-id', tok('chat-accent'), chip],
      ['.msg-daysep-text', tok('chat-sep-fg'), T.page],
    ];

    for (const [label, fg, bg] of pairs) {
      const r = contrast(fg, bg);
      assert.ok(r >= MIN, `${label} is ${r.toFixed(2)}:1, needs >= ${MIN}:1`);
    }
  });
}

test('every --chat-* token is defined in BOTH themes', () => {
  const names = ['chat-accent', 'chat-good', 'chat-warn', 'chat-high', 'chat-low', 'chat-pill-fg', 'chat-sep-fg'];
  for (const n of names) {
    assert.doesNotThrow(() => token('page', n), `--${n} missing from the dark (page) block`);
    assert.doesNotThrow(() => token('.theme-light', n), `--${n} missing from the .theme-light block`);
  }
});

test('cards use the audited --chat-* tokens, not the page-audited global ones', () => {
  const cardBlock = mainCss.slice(mainCss.indexOf('.mcard {'), mainCss.indexOf('.tcard {'));
  assert.doesNotMatch(cardBlock, /\.mcard-pill \{[^}]*color: var\(--text-sub\)/,
    'pill text must use --chat-pill-fg; --text-sub measured 4.23:1 on the light pill background');
  assert.match(mainCss, /\.tcard-title \{[^}]*color: var\(--chat-accent\)/s);
  assert.match(mainCss, /\.dcard-id \{[^}]*color: var\(--chat-accent\)/s);
});
