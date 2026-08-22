const assert = require('node:assert');
const test = require('node:test');
const path = require('node:path');

const { mdToSegments, MD_TAG_STYLE } = require(
  path.join(__dirname, '..', 'src', 'mini', 'nano-miniapp', 'utils', 'markdown.js')
);

// Convenience: the concatenated HTML of every prose segment, in order.
const html = (md) => mdToSegments(md).filter(s => s.t === 'html').map(s => s.h).join('');
const types = (md) => mdToSegments(md).map(s => s.t);

// ── Paragraphs ──────────────────────────────────────────────────────────────

test('wrapped lines collapse into ONE <p> joined with <br>', () => {
  const h = html('line one\nline two\nline three');
  assert.strictEqual((h.match(/<p/g) || []).length, 1);
  assert.strictEqual((h.match(/<br>/g) || []).length, 2);
});

test('a blank line starts a new <p> and emits NO stray <br>', () => {
  const h = html('first para\n\nsecond para');
  assert.strictEqual((h.match(/<p/g) || []).length, 2);
  assert.doesNotMatch(h, /<br>/, 'the old implementation emitted a bare <br> for a blank line');
});

test('the last block of a prose run gets its bottom margin zeroed', () => {
  assert.match(html('only para'), /<p style="margin-bottom:0">/);
});

// ── Inline ──────────────────────────────────────────────────────────────────

test('** inside a backtick span stays literal', () => {
  const h = html('use `a ** b` here');
  assert.match(h, /<code>a \*\* b<\/code>/);
  assert.doesNotMatch(h, /<strong>/);
});

test('snake_case is not italicised', () => {
  const h = html('the user_id and DOT_N7 fields');
  assert.doesNotMatch(h, /<em>/);
  assert.match(h, /user_id/);
});

test('_word_ with real boundaries still italicises', () => {
  assert.match(html('an _emphasised_ word'), /<em>emphasised<\/em>/);
});

test('bold, bold-italic, strike and inline code', () => {
  const h = html('**b** and ***bi*** and ~~s~~ and `c`');
  assert.match(h, /<strong>b<\/strong>/);
  assert.match(h, /<strong><em>bi<\/em><\/strong>/);
  assert.match(h, /<del>s<\/del>/);
  assert.match(h, /<code>c<\/code>/);
});

test('html in the source is escaped, not executed', () => {
  assert.match(html('<script>alert(1)</script>'), /&lt;script&gt;/);
});

test('links become <a href>', () => {
  assert.match(html('see [docs](https://x.test/a)'), /<a href="https:\/\/x\.test\/a">docs<\/a>/);
});

// ── Blocks ──────────────────────────────────────────────────────────────────

test('headings render at their own level', () => {
  const h = html('# one\n\n## two\n\n###### six');
  assert.match(h, /<h1>one<\/h1>/);
  assert.match(h, /<h2>two<\/h2>/);
  assert.match(h, /<h6[^>]*>six<\/h6>/);
});

test('nested lists nest, and nested levels carry an inline margin reset', () => {
  const h = html('- a\n- b\n  - b1\n  - b2\n- c');
  assert.match(h, /<ul[^>]*><li>a<\/li><li>b<ul style="margin:0"><li>b1<\/li><li>b2<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
});

test('4-space indentation nests the same as 2-space', () => {
  assert.match(html('- a\n    - a1'), /<ul style="margin:0"><li>a1<\/li><\/ul>/);
});

test('ordered lists use <ol>', () => {
  assert.match(html('1. first\n2. second'), /<ol[^>]*><li>first<\/li><li>second<\/li><\/ol>/);
});

test('task list items render a glyph, not an <input>', () => {
  const h = html('- [x] done\n- [ ] todo');
  assert.match(h, /✓ done/);
  assert.match(h, /○ todo/);
  assert.doesNotMatch(h, /<input/);
});

test('blockquote wraps recursively parsed blocks', () => {
  assert.match(html('> quoted **text**'), /<blockquote[^>]*><p[^>]*>quoted <strong>text<\/strong><\/p><\/blockquote>/);
});

test('table builds thead/tbody', () => {
  const h = html('| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(h, /<table[^>]*><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/);
  assert.match(h, /<tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/);
});

test('a table directly after a paragraph is not swallowed by it', () => {
  const h = html('intro line\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  assert.match(h, /<p[^>]*>intro line<\/p>/);
  assert.match(h, /<table[^>]*>/);
});

test('fenced code becomes <pre> with escaped content and no inner <code>', () => {
  const h = html('```js\nif (a < b) {}\n```');
  assert.match(h, /<pre[^>]*>if \(a &lt; b\) \{\}<\/pre>/);
});

test('--- becomes a rule SEGMENT, never an <hr> (not in rich-text\'s whitelist)', () => {
  assert.deepStrictEqual(types('a\n\n---\n\nb'), ['html', 'rule', 'html']);
  assert.doesNotMatch(html('a\n\n---\n\nb'), /<hr/);
});

test('a list item is not mistaken for a horizontal rule', () => {
  assert.deepStrictEqual(types('- item one'), ['html']);
});

// ── Directives ──────────────────────────────────────────────────────────────

test('metric fence parses label|value|unit|status', () => {
  const segs = mdToSegments('::: metric\nGDF-15 | 1240 | pg/mL | 偏高\nhsCRP | 0.8 | mg/L | normal\n:::');
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].t, 'metric');
  assert.deepStrictEqual(segs[0].items[0], { label: 'GDF-15', value: '1240', unit: 'pg/mL', sl: '偏高', s: 'high' });
  assert.deepStrictEqual(segs[0].items[1], { label: 'hsCRP', value: '0.8', unit: 'mg/L', sl: 'normal', s: 'normal' });
});

test('status normalises across both languages; unknown falls back to none but keeps the label', () => {
  const one = (label) => mdToSegments(`::: metric\nX | 1 | u | ${label}\n:::`)[0].items[0];
  assert.strictEqual(one('正常').s, 'normal');
  assert.strictEqual(one('elevated').s, 'high');
  assert.strictEqual(one('偏低').s, 'low');
  assert.strictEqual(one('good').s, 'good');
  assert.strictEqual(one('borderline').s, 'watch');
  const weird = one('完全未知的状态');
  assert.strictEqual(weird.s, 'none');
  assert.strictEqual(weird.sl, '完全未知的状态', 'the model\'s own label must survive verbatim');
});

test('malformed metric rows degrade instead of throwing', () => {
  const segs = mdToSegments('::: metric\nOnlyLabel\n | | | \nA|1|u|x|extra\n:::');
  assert.strictEqual(segs[0].t, 'metric');
  assert.strictEqual(segs[0].items.length, 2, 'the all-empty row is dropped, the other two kept');
  assert.deepStrictEqual(segs[0].items[0], { label: 'OnlyLabel', value: '', unit: '', sl: '', s: 'none' });
});

test('takeaway carries parsed prose and no hardcoded title (localised in WXML)', () => {
  const segs = mdToSegments('::: takeaway\nDo the **thing**.\n:::');
  assert.strictEqual(segs[0].t, 'takeaway');
  assert.match(segs[0].h, /<strong>thing<\/strong>/);
  assert.strictEqual(segs[0].title, undefined);
});

test('dots keeps id and name space-separated so factCheck can still read the name', () => {
  const segs = mdToSegments('::: dots\n12号原粒 夜安宁 | 2粒/晚\n:::');
  assert.deepStrictEqual(segs[0].items[0], { id: '12号原粒', name: '夜安宁', note: '2粒/晚' });
});

test('an unknown directive falls back to prose — content is never dropped', () => {
  const segs = mdToSegments('::: mystery\nimportant text\n:::');
  assert.deepStrictEqual(segs.map(s => s.t), ['html']);
  assert.match(segs[0].h, /important text/);
});

test('an unterminated fence closes implicitly at EOF (LLM output truncates)', () => {
  const segs = mdToSegments('::: metric\nGDF-15 | 1240 | pg/mL | 偏高');
  assert.strictEqual(segs[0].t, 'metric');
  assert.strictEqual(segs[0].items.length, 1);
});

test('a new fence implicitly closes an unterminated one', () => {
  assert.deepStrictEqual(types('::: metric\nA | 1 | u | high\n::: takeaway\ngo\n:::'), ['metric', 'takeaway']);
});

test(':::metric with no space is accepted', () => {
  assert.strictEqual(mdToSegments(':::metric\nA | 1 | u | high\n:::')[0].t, 'metric');
});

test('an empty directive body degrades to nothing rather than an empty card', () => {
  assert.deepStrictEqual(types('::: metric\n\n:::'), []);
});

test('::: inside a fenced code block is left alone', () => {
  const segs = mdToSegments('```\n::: metric\nA | 1 | u | high\n:::\n```');
  assert.deepStrictEqual(segs.map(s => s.t), ['html']);
  assert.match(segs[0].h, /<pre[^>]*>/);
});

test('--- inside a fenced code block does not become a rule', () => {
  assert.deepStrictEqual(types('```\n---\n```'), ['html']);
});

test('a user message echoing ::: back is handled without throwing', () => {
  assert.doesNotThrow(() => mdToSegments('you said ::: and then :::\n::: \n:::'));
});

test('a pipe inside a metric label does not break the row', () => {
  const it = mdToSegments('::: metric\na|b | 1 | u | high\n:::')[0].items[0];
  assert.strictEqual(it.label, 'a');
  assert.strictEqual(it.value, 'b');
});

// ── Input hygiene ───────────────────────────────────────────────────────────

test('CRLF input parses identically to LF', () => {
  assert.strictEqual(html('a\r\n\r\nb'), html('a\n\nb'));
});

test('null / empty input yields no segments', () => {
  assert.deepStrictEqual(mdToSegments(null), []);
  assert.deepStrictEqual(mdToSegments(''), []);
  assert.deepStrictEqual(mdToSegments('   \n\n  '), []);
});

test('plain prose with no markdown yields exactly one html segment', () => {
  assert.deepStrictEqual(types('just a normal sentence.'), ['html']);
});

// ── Tag style contract ──────────────────────────────────────────────────────

test('MD_TAG_STYLE restates pre\'s defaults, which overriding the entry would otherwise drop', () => {
  assert.match(MD_TAG_STYLE.pre, /font-family:monospace/);
  assert.match(MD_TAG_STYLE.pre, /white-space:pre/);
});

test('MD_TAG_STYLE carries no theme-dependent colour (tagStyle has no observer, so it never re-parses)', () => {
  const themed = /#[0-9a-f]{3,8}\b/i;
  for (const [tag, css] of Object.entries(MD_TAG_STYLE)) {
    assert.doesNotMatch(css, themed, `${tag} must not hardcode a hex colour`);
  }
  assert.match(MD_TAG_STYLE.a, /color:inherit/, 'links must inherit the bubble colour to stay theme-safe');
});
