// Text-size (accessibility) feature: token table, WXSS conversion, and pinch-gesture math.
//
// Older users reported the health tab was unreadable — its 169 font-size rules bottomed out at
// 14rpx (~7px). Rather than a visual zoom (which would blur the 9 canvases and re-parent the 3
// position:fixed overlays inside the component), text now reflows through inherited size tokens
// selected by .fs-1/.fs-2/.fs-3 on the host page's root view.
//
// This file reads the real stylesheets and the real handler source, in the style of
// chat-card-contrast.test.js, so a later tweak cannot silently regress the curve, drop a token,
// or break the one-step-per-gesture latch.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const MINI = path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp');
const read = (...p) => fs.readFileSync(path.join(MINI, ...p), 'utf8');

const appCss = read('app.wxss');
const uhCss = read('components', 'user-health', 'user-health.wxss');
const uhJs = read('components', 'user-health', 'user-health.js');
const mainCss = read('pages', 'main', 'main.wxss');
const mdJs = read('utils', 'markdown.js');

// Pull the --fs-* map out of a selector block in app.wxss.
function tokens(selector) {
  const start = appCss.indexOf(selector + ' {');
  assert.ok(start > -1, `block "${selector}" not found in app.wxss`);
  const body = appCss.slice(start, appCss.indexOf('}', start));
  const out = {};
  for (const [, k, v] of body.matchAll(/--fs-(\d+):\s*(\d+)rpx/g)) out[Number(k)] = Number(v);
  return out;
}

const LEVELS = [tokens('page'), tokens('.fs-1'), tokens('.fs-2'), tokens('.fs-3')];
const BASES = Object.keys(LEVELS[0]).map(Number).sort((a, b) => a - b);

// The documented curve: caption/body text scales fully, display numerals taper off, so an
// 88rpx hero numeral grows +15% instead of the +50% that would burst its chip.
const MULT = [[1, 1, 1], [1.15, 1.05, 1.0], [1.30, 1.10, 1.0], [1.50, 1.15, 1.0]];
const curve = (b, [mA, mB, mC]) => {
  const A = Math.min(b, 22);
  const B = Math.max(0, Math.min(b, 36) - 22);
  const C = Math.max(0, b - 36);
  // round-half-up on a value first snapped to 6dp, so 29.499999999999996 reads as 29.5
  return Math.floor(Number((mA * A + mB * B + mC * C).toFixed(6)) + 0.5);
};

test('every level defines the full token set', () => {
  for (const [i, lv] of LEVELS.entries()) {
    assert.strictEqual(Object.keys(lv).length, BASES.length,
      `.fs-${i} defines ${Object.keys(lv).length} tokens, expected ${BASES.length}`);
  }
});

test('level 0 is the identity — the default build renders exactly as before', () => {
  for (const b of BASES) assert.strictEqual(LEVELS[0][b], b, `--fs-${b} baseline drifted`);
});

test('token values match the documented curve', () => {
  for (const [i, m] of MULT.entries()) {
    for (const b of BASES) {
      assert.strictEqual(LEVELS[i][b], curve(b, m),
        `.fs-${i} --fs-${b} is ${LEVELS[i][b]}, curve says ${curve(b, m)}`);
    }
  }
});

test('each level is strictly monotonic, so the visual hierarchy never collapses', () => {
  // Two originally-distinct sizes converging would flatten heading vs body at that level.
  for (const [i, lv] of LEVELS.entries()) {
    for (let k = 1; k < BASES.length; k++) {
      assert.ok(lv[BASES[k]] > lv[BASES[k - 1]],
        `.fs-${i}: --fs-${BASES[k - 1]} (${lv[BASES[k - 1]]}) >= --fs-${BASES[k]} (${lv[BASES[k]]})`);
    }
  }
});

test('small text scales harder than display text', () => {
  const ratio = (b) => LEVELS[3][b] / b;
  assert.ok(ratio(14) >= 1.45, `14rpx only reaches ${ratio(14).toFixed(2)}x — the complaint is unaddressed`);
  assert.ok(ratio(20) >= 1.45, `20rpx (the most common size) only reaches ${ratio(20).toFixed(2)}x`);
  assert.ok(ratio(88) <= 1.20, `88rpx grows ${ratio(88).toFixed(2)}x — the BioAge chip will burst`);
});

test('every token referenced by the health tab is defined', () => {
  const used = new Set([...uhCss.matchAll(/var\(--fs-(\d+)/g)].map((m) => Number(m[1])));
  assert.ok(used.size > 0, 'health tab references no size tokens at all');
  for (const u of used) {
    assert.ok(LEVELS[0][u] !== undefined, `--fs-${u} is used but never defined in app.wxss`);
  }
});

test('tokenised declarations keep a literal fallback', () => {
  // No build step and no CSS lint here: an unresolved token would otherwise drop the whole
  // declaration and fall back to inherited size rather than to today's rendering.
  const decls = [...uhCss.matchAll(/font-size:\s*var\(--fs-(\d+),\s*(\d+)rpx\)/g)];
  assert.ok(decls.length > 100, `only ${decls.length} tokenised declarations — conversion looks partial`);
  for (const m of decls) {
    assert.strictEqual(m[1], m[2], `fallback disagrees with token: ${m[0]}`);
  }
});

test('glyph rules keep literal sizes', () => {
  // These size a symbol inside a fixed box, not reading content; scaling them clips the box.
  const GLYPHS = ['health-avatar-letter', 'wchart-close', 'edit-cond-tick', 'guest-lock-icon',
    'rpt-arrow', 'rpt-close-x', 'rpt-advice-num', 'wd-ring-icon', 'wd-chevron', 'wd-gear-glyph',
    'ring-chart-hlabel'];
  for (const cls of GLYPHS) {
    const at = uhCss.indexOf('.' + cls + ' {');
    assert.ok(at > -1, `.${cls} not found`);
    const body = uhCss.slice(at, uhCss.indexOf('}', at));
    if (!/font-size/.test(body)) continue;
    assert.ok(!/font-size:\s*var\(/.test(body), `.${cls} was tokenised but sizes a glyph`);
  }
});

test('fixed widths that wrap scaling text were relaxed to min-width', () => {
  for (const cls of ['edit-label', 'avatar-side-pill']) {
    const at = uhCss.indexOf('.' + cls + ' {');
    const body = uhCss.slice(at, uhCss.indexOf('}', at));
    assert.ok(!/^\s*width:\s*\d+rpx/m.test(body), `.${cls} still has a hard width`);
    assert.ok(/min-width:\s*\d+rpx/.test(body), `.${cls} lost its min-width floor`);
  }
});

test('sleep-week axis padding tracks the label tokens it aligns to', () => {
  const at = uhCss.indexOf('.ring-sleepweek-axis {');
  const body = uhCss.slice(at, uhCss.indexOf('}', at));
  const m = body.match(/padding-bottom:\s*calc\(var\(--fs-15[^)]*\)\s*\+\s*var\(--fs-14[^)]*\)\s*\+\s*(\d+)rpx\)/);
  assert.ok(m, '.ring-sleepweek-axis padding-bottom is no longer derived from the label tokens');
  // Must still resolve to the original hand-tuned 34rpx at level 0, or the ticks shift today.
  assert.strictEqual(LEVELS[0][15] + LEVELS[0][14] + Number(m[1]), 34);
});

test('both hosts apply the level class and pass the prop through', () => {
  for (const [file, root] of [[read('pages', 'main', 'main.wxml'), 'main'],
                             [read('pages', 'coach', 'coach.wxml'), 'coach-page']]) {
    assert.ok(file.includes(`class="${root} fs-{{textScale}}`), `${root} root is missing fs-{{textScale}}`);
    assert.ok(/text-scale="\{\{textScale\}\}"/.test(file), `${root} does not pass text-scale`);
    assert.ok(/bind:textscalestep=/.test(file), `${root} leaves the pinch gesture unbound (silently dead)`);
  }
});

// ── pinch gesture ───────────────────────────────────────────────────────────
// The detector is a shared module (utils/pinch.js) precisely so the health tab's component
// and the chat tab's page cannot drift into behaving differently under the same gesture.
const { createPinchStepper } = require(path.join(MINI, 'utils', 'pinch.js'));

function stepper() {
  const fired = [];
  const s = createPinchStepper((dir) => fired.push(dir));
  s.fired = fired;
  return s;
}
const touch = (x1, x2) => ({ touches: [{ clientX: x1, clientY: 300 }, { clientX: x2, clientY: 300 }] });

test('pinch out fires exactly one step, however far it keeps going', () => {
  const s = stepper();
  s.start(touch(100, 200));   // d0 = 100
  s.move(touch(80, 220));     // 1.40 -> fire
  s.move(touch(50, 250));     // 2.00 -> latched
  s.move(touch(0, 300));      // 3.00 -> latched
  assert.deepStrictEqual(s.fired, [1]);
});

test('pinch in fires one negative step', () => {
  const s = stepper();
  s.start(touch(0, 200));     // d0 = 200
  s.move(touch(70, 130));     // 0.30 -> fire
  assert.deepStrictEqual(s.fired, [-1]);
});

test('touchend re-arms for the next gesture', () => {
  const s = stepper();
  s.start(touch(100, 200)); s.move(touch(80, 220));
  s.end();
  s.start(touch(100, 200)); s.move(touch(80, 220));
  assert.strictEqual(s.fired.length, 2, 'second gesture did not fire — latch was not cleared');
});

test('movement inside the dead zone fires nothing', () => {
  const s = stepper();
  s.start(touch(100, 200));
  s.move(touch(95, 205));     // 1.10, below the 1.25 threshold
  s.move(touch(105, 195));    // 0.90, above the 0.80 threshold
  assert.deepStrictEqual(s.fired, [], 'ordinary two-finger drift changed the text size');
});

test('one-finger touches never pinch', () => {
  const s = stepper();
  s.start({ touches: [{ clientX: 100, clientY: 300 }] });
  s.move({ touches: [{ clientX: 300, clientY: 300 }] });
  assert.deepStrictEqual(s.fired, [], 'a single-finger scroll or mic hold changed the text size');
});

test('two fingers resting close together are ignored', () => {
  const s = stepper();
  s.start(touch(100, 130));   // d0 = 30, below minSpread
  s.move(touch(90, 200));
  assert.deepStrictEqual(s.fired, []);
});

test('both scalable tabs bind the gesture', () => {
  // The health tab's binding lives on the component root; the chat tab is plain page markup,
  // so it binds on .chat-tab. A converted tab with no binding is text that silently won't
  // respond to the gesture the whole feature is built around.
  const uhWxml = read('components', 'user-health', 'user-health.wxml');
  assert.ok(/bindtouchmove="_onUhTouchMove"/.test(uhWxml), 'health tab lost its pinch binding');
  const mainWxml = read('pages', 'main', 'main.wxml');
  assert.ok(/class="chat-tab[^"]*"[\s\S]{0,220}?bindtouchmove="onChatTouchMove"/.test(mainWxml),
    'chat tab does not bind the pinch gesture');
});

test('both pages drive the shared stepper rather than reimplementing it', () => {
  for (const [name, js] of [['main', read('pages', 'main', 'main.js')],
                            ['coach', read('pages', 'coach', 'coach.js')],
                            ['user-health', uhJs]]) {
    if (name === 'main') {
      assert.ok(/require\('\.\.\/\.\.\/utils\/pinch\.js'\)/.test(js), `${name} does not use utils/pinch.js`);
    }
    // Nobody should be re-deriving the pinch maths locally.
    assert.ok(!/Math\.sqrt\(dx \* dx/.test(js), `${name} reimplements the pinch distance`);
  }
});

test('both hosts guard their edge-swipe against multi-touch', () => {
  // Without this a pinch starting in the edge zone can navigate away mid-gesture.
  for (const [name, js] of [['main', read('pages', 'main', 'main.js')],
                            ['coach', read('pages', 'coach', 'coach.js')]]) {
    const at = js.indexOf('onTouchStart(e) {');
    const body = js.slice(at, js.indexOf('onTouchEnd(e) {', at));
    assert.ok(/e\.touches\.length > 1/.test(body), `${name}: onTouchStart has no multi-touch guard`);
    const end = js.slice(js.indexOf('onTouchEnd(e) {', at));
    assert.ok(/_multiTouch/.test(end.slice(0, 200)), `${name}: onTouchEnd does not honour the latch`);
  }
});

test('step handlers clamp to the 0-3 range', () => {
  for (const [name, js] of [['main', read('pages', 'main', 'main.js')],
                            ['coach', read('pages', 'coach', 'coach.js')]]) {
    const at = js.indexOf('_stepTextScale(dir) {');
    assert.ok(at > -1, `${name}: _stepTextScale missing`);
    const body = js.slice(at, at + 400);
    assert.ok(/next < 0 \|\| next > 3/.test(body), `${name}: step handler does not clamp`);
  }
});

// ── chat tab ────────────────────────────────────────────────────────────────
// main.wxss is one file for the whole main page, so the chat conversion is line-range
// scoped (the "Chat messages" .. "Loading states" sections). These assert that the prose
// actually scales and that the other tabs were left alone.

test('chat prose containers are tokenised', () => {
  for (const cls of ['msg-text', 'msg-html']) {
    const at = mainCss.indexOf('.' + cls + ' {');
    assert.ok(at > -1, `.${cls} not found`);
    const body = mainCss.slice(at, mainCss.indexOf('}', at));
    assert.ok(/font-size:\s*var\(--fs-28,\s*28rpx\)/.test(body),
      `.${cls} still has a literal font-size — AI replies would not scale`);
  }
});

test('chat tokens all resolve, and other tabs were left untouched', () => {
  const defined = new Set(Object.keys(LEVELS[0]).map(Number));
  for (const m of mainCss.matchAll(/var\(--fs-(\d+)/g)) {
    assert.ok(defined.has(Number(m[1])), `--fs-${m[1]} used in main.wxss but never defined`);
  }
  // The conversion was deliberately scoped to chat; the rest of the page still has literals.
  const literals = [...mainCss.matchAll(/font-size:\s*\d+rpx/g)].length;
  assert.ok(literals > 200, `only ${literals} literal sizes left — the conversion escaped its range`);
});

test('markdown tag styles are relative, so headings track the bubble', () => {
  // tagStyle is applied as an INLINE style (parser.js parseStyle) and bound once, so an
  // absolute size here beats the stylesheet and never re-parses. With body text at 40rpx
  // (level 3), a hardcoded 34rpx h1 would render SMALLER than its own paragraphs.
  const at = mdJs.indexOf('var MD_TAG_STYLE = {');
  const body = mdJs.slice(at, mdJs.indexOf('\n}', at));
  const abs = [...body.matchAll(/font-size:\s*(\d+)rpx/g)];
  assert.deepStrictEqual(abs.map((m) => m[0]), [], 'MD_TAG_STYLE still has absolute font sizes');
  assert.ok(/h1: 'font-size:1\.21em/.test(body), 'h1 lost its relative size');
});

test('markdown em ratios reproduce the original sizes at the default level', () => {
  // .msg-html is 28rpx, and these were 34/32/29/28/25/24rpx before the change.
  const at = mdJs.indexOf('var MD_TAG_STYLE = {');
  const body = mdJs.slice(at, mdJs.indexOf('\n}', at));
  const em = (tag) => Number(body.match(new RegExp(tag + ": '[^']*font-size:([0-9.]+)em"))[1]);
  for (const [tag, was] of [['h1', 34], ['h2', 32], ['h3', 29], ['h4', 28], ['code', 25], ['pre', 24], ['table', 25]]) {
    const got = em(tag) * 28;
    assert.ok(Math.abs(got - was) < 0.6, `${tag}: ${em(tag)}em = ${got.toFixed(1)}rpx, was ${was}rpx`);
  }
});
