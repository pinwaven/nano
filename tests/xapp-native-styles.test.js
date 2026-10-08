const test = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../tools/xapp-android/generate-native-styles.mjs');

test('native colors resolve nested palette tokens without losing alpha', async () => {
  const { nativeDeclaration } = await modulePromise;
  assert.equal(nativeDeclaration('border-color', 'rgba(var(--blue-rgb),0.22)', { '--blue-rgb': '152,95,51' }),
    'border-color:rgba(152,95,51,0.22)');
  assert.equal(nativeDeclaration('color', 'var(--text)', { '--text': '#2C2C2C' }), 'color:#2C2C2C');
  assert.equal(nativeDeclaration('color', 'var(--missing)', {}), null);
});

test('native shadows use four pixel lengths and preserve the intended color', async () => {
  const { nativeDeclaration } = await modulePromise;
  assert.equal(nativeDeclaration('box-shadow', '0 12rpx 40rpx rgba(152,95,51,0.18), inset 0 1rpx 0 white', {}),
    'box-shadow:0px 6px 20px 0px rgba(152,95,51,0.18)');
  assert.equal(nativeDeclaration('box-shadow', '0px 0px 14px 0px rgba(99,117,236,0.22)', {}),
    'box-shadow:0px 0px 14px 0px rgba(99,117,236,0.22)');
});

test('native CSS keeps supported gradients and excludes unsupported viewport caps', async () => {
  const { nativeDeclaration } = await modulePromise;
  assert.equal(nativeDeclaration('background', 'linear-gradient(135deg,#1a2f4a,#1e3a5f)', {}),
    'background-image:linear-gradient(to bottom right,#1a2f4a,#1e3a5f)');
  assert.equal(nativeDeclaration('max-width', '100%', {}), null);
  assert.equal(nativeDeclaration('height', '82vh', {}), null);
  assert.equal(nativeDeclaration('filter', 'brightness(0)', {}), null);
});

test('native gradients retain endpoint colors using a supported direction', async () => {
  const { nativeDeclaration } = await modulePromise;
  assert.equal(nativeDeclaration('background-image', 'linear-gradient(150deg,rgb(26,31,98) 0%,rgb(29,53,101) 50%,rgb(22,46,74) 100%)', {}),
    'background-image:linear-gradient(to bottom right,rgb(26,31,98),rgb(22,46,74))');
});

test('mini extraction excludes native-only imports while retaining shared visual fixes', async () => {
  const { miniCss } = await modulePromise;
  const css = miniCss('<style>\n.base{color:red}\n/* #ifdef MP-WEIXIN */\n.mini{color:blue}\n/* #endif */\n/* #ifdef APP */\n@import "native.css";\n/* #endif */\n</style>');
  assert.match(css, /\.base/);
  assert.match(css, /\.mini/);
  assert.doesNotMatch(css, /native\.css/);
});

test('large native text grows its line box instead of clipping glyphs', async () => {
  const { nativeFontDeclarations } = await modulePromise;
  assert.deepEqual(nativeFontDeclarations(['font-size', 'var(--fs-80)'], 1, { '--fs-80': '93rpx' }),
    ['font-size:93rpx', 'line-height:93rpx']);
  assert.deepEqual(nativeFontDeclarations(['font-size', 'var(--fs-22)'], 1.2, { '--fs-22': '33rpx' }),
    ['font-size:33rpx', 'line-height:39.6rpx']);
});

test('theme and scale selectors update the target view without remounting panels', async () => {
  const { nativeSelector } = await modulePromise;
  assert.equal(nativeSelector('.theme-light .message-ai'), '.message-ai-native-light');
  assert.equal(nativeSelector('.theme-light .mcard-good .mcard-pill'), '.mcard-good .mcard-pill-native-light');
  assert.equal(nativeSelector('.pkg-name', 0), '.pkg-name-native-fs-0');
  assert.equal(nativeSelector('.theme-light .pkg-name', 3), '.pkg-name-native-light.pkg-name-native-fs-3');
});

test('mini compilation restores original class bindings and removes native hooks', async () => {
  const { restoreClassBindings } = await import('../tools/xapp-mini/prepare-source.mjs');
  const template = '<view :class="nativeClass(\'message-bubble\', (role == \'user\' ? \'message-user\' : \'message-ai\'))"><text :class="nativeClass(\'msg-text\', (null))">Hi</text></view>';
  assert.equal(restoreClassBindings(template), '<view class="message-bubble" :class="role == \'user\' ? \'message-user\' : \'message-ai\'"><text class="msg-text">Hi</text></view>');
  const script = "import { nativeClass as nativeVisualClass } from '../../utils/native-visual.uts'\nmethods: {\n nativeClass(names : string, dynamic : any | null) : string {\n return nativeVisualClass(names, dynamic, this.theme, null)\n },\n noop() {}\n}";
  assert.doesNotMatch(restoreClassBindings(script), /nativeVisualClass|nativeClass/);
});
