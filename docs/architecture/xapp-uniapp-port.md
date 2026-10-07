# xapp — uni-app x native port of the WeChat miniapp

`src/xapp/` is an exploratory **native port** of `src/mini/nano-miniapp/` to **uni-app x**
(UTS + `.uvue`, compiled to Kotlin for Android; iOS possible from the same tree). Started
2026-10-01 with the costs known and accepted: full rewrite, no code reuse, HBuilderX-bound
toolchain. **The miniapp remains the production frontend untouched** — nothing in this tree is
deployed; it lives beside the miniapp for evaluation.

Per-file status, port decisions and the fix log live in **`src/xapp/README.md`** — this document
covers discovery, the run/verify runbook, and the porting rules that the compiler cannot teach.

## Tree layout (mirrors the miniapp)

```
src/xapp/
├── manifest.json        # appid __UNI__316095D; packagename net.gcn.nano
├── pages.json           # pages + pull-refresh, same routes as app.json
├── pages/               # main (5 tabs), coach, login, verify-phone, …
├── components/          # user-health, health-documents, strip-record,
│                        # toolbox, avatar-picker
├── packages/viva-ag/    # shared AG panel; asynchronous component subpackage on xapp-mini
├── utils/               # config/state/request/session/markdown/tool-actions/main-t (i18n dict),
│                        # wearable/ (halo, v8, sync, transport interface + mp/android adapters)
├── uni_modules/waven-ble/ # Android BLE UTS plugin (BluetoothLeScanner/BluetoothGatt + op queue)
└── static/              # icons + images copied from the miniapp assets/
```

Backend selection is a `BUILD_ENV` constant in `utils/config.uts` (dev → `nano-dev.gcn.net`),
and `VERSION` there follows the same MMDD-N marker rule as the miniapp — bump on every change
under `src/xapp/`, it is the only way to prove a device build is current.

Auth differs by design: **no `wx.login`** on native (the mp-weixin build, xapp-mini, keeps the
miniapp's `wx.login` and guest mode — `tools/xapp-mini/README.md`) — phone/email OTP only (server already supports it,
§33). See README for the two server-side gaps
this exposed (plain-text QR for `/qr-login`, `ref` param for signup referrals).

## Running on a device (runbook)

To package a local debug APK, run `tools/xapp-android/build.sh`; it copies the result
to `dist/xapp/android/`. See [the packaging prerequisites](../../tools/xapp-android/README.md).

```bash
# 1. HBuilderX 5.26 must be installed; project already imported. Where it lives differs per Mac:
#    the original arm64 Mac: /Applications/HBuilderX.app, project /Users/pin/waven/nano/src/xapp;
#    i9 (Intel): ~/Applications/HBuilderX.app (user-level install), project ~/waven/xapp-android
#    (an rsync of src/xapp). Watch-mode launch — compiles, installs the debug base, hot-pushes on every save:
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project /Users/pin/waven/nano/src/xapp
~/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project ~/waven/xapp-android --deviceId <ip:port>   # i9
# add `--compile true` for a compile-only pass (reports errors, ~80s/round, caps ~4/round)

# 2. Wireless ADB (ports rotate per session — never trust an old ip:port):
adb mdns services            # find _adb-tls-pairing._tcp and _adb-tls-connect._tcp
adb pair <ip>:<pairport> <code>
adb connect <ip>:<connectport>
```

- **macOS Local Network privacy:** an adb server started from an SSH session cannot reach the phone
  (`adb pair` fails with "protocol fault", the server log says "No route to host", although `nc` from the
  same shell connects). Start the adb server from the Mac's own Terminal (`adb pair …` there); later adb
  commands over SSH reuse that server.
- **The connect port** is the one on the phone's main Wireless debugging screen, not the pairing port;
  `dns-sd -B _adb-tls-connect._tcp` / `dns-sd -L "<name> (2)" _adb-tls-connect._tcp` finds it when mDNS
  lists a stale entry first.
- HBuilderX's bundled adb (`plugins/launcher-tools/tools/adbs/adb`) is protocol 1.0.41, so it reuses that server.
- First run of a fresh HBuilderX install downloads the uni-app x launcher, the vue3 compiler and the UTS Android
  extension; the CLI stops ("正在安装 uts Android 运行扩展", "运行状态错误，请重试") until they are in — rerun it.

**Which app on the phone is which** (this confused a whole session):

| Package | What it is |
|---|---|
| `io.dcloud.uniappx` ("uni-app x") | **the xapp** — HBuilderX debug base; src/xapp code hot-pushes into it |
| `com.waven.nano` | June-2026 **Donut APK of the miniapp** (`cli build-apk`; Donut framework: [wechat-multiterminal.md](wechat-multiterminal.md)) — NOT src/xapp |
| `net.gcn.nano` | locally packaged xapp APK (`npm run build:xapp:android`) |

`am start -n io.dcloud.uniappx/io.dcloud.uniapp.UniAppActivity` brings the xapp up; it keeps its
login session across restarts (uni storage), the Donut APK has a separate storage and looks
nearly identical at the login screen — check the header VERSION badge (xapp = `utils/config.uts`).

App-side `console.log` does NOT surface in a plain `logcat` grep; the launch command's own stdout
is the live dev-server stream (page-enter timings appear there). For runtime errors:
`adb logcat --pid=$(adb shell pidof io.dcloud.uniappx)`.

## Parity sweep harness (xapp vs miniapp, side by side)

Used 2026-10-01 to diff every tab against the DevTools simulator, same user on dev:

- **Miniapp side**: drive via `tools/wechat-automator` (`connect.js`, automation ws port 22090 —
  see its README for the gotchas). Screenshots: `screencapture -x -o -l <CGWindowID>` of the
  DevTools window; window id from `temp/winlist` (`temp/winlist.swift`, ~15-line
  `CGWindowListCopyWindowInfo` printer, `swiftc -O winlist.swift -o winlist`). Simulator crop
  rect for the current window layout: `(1820,175)-(2480,1615)` of the 2500×1846 capture —
  wrapped as `temp/mcap.sh <name>`. Re-derive the rect if the IDE window is resized.
- **Phone side**: `adb exec-out screencap -p`. Tab bar tap coords on the 1080×2376 screen:
  y≈2173, x = 108/324/540/756/972 (对话/健康/方案/学习/补给). `uiautomator dump` sees almost
  nothing (custom rendering) — work from screenshots.
- **Simulator traps confirmed the hard way**: `page.setData({tab})` skips `switchTab`'s fetches
  (learn tab looked empty until really tapped); a stale page can render the previous theme
  (`callWxMethod('reLaunch', …)` first); the textarea placeholder can keep a stale color —
  trust the WXSS, not the screenshot, for that one element.

## Porting rules the compiler cannot teach

Classes learned across the compile pass and two device passes (full log in README):

**UTS/Kotlin**
- `uni.request`'s awaitable overload silently picks the RequestTask shape in most call sites →
  **all requests are `new Promise` + `success/fail` callbacks** (`_envelopeRun` pattern).
- `lifetimes: { attached() }` is a miniapp concept — **it never runs in uvue**. Use
  `mounted()`/`unmounted()`. (This silently killed the whole wearable server-hydration path.)
- `'#RRGGBBAA'` (hex + alpha suffix) is NOT parseable on Android (`#AARRGGBB` only) — the whole
  declaration is dropped at runtime, borders render invisible. Compose `rgba()` (`tcA()` in
  user-health). Same for inline styles: give `border-width` rules an explicit
  `border-style: solid`.
- `UTSJSONObject.getArray<UTSJSONObject>(k)` on an array stored inside a UTSJSONObject fails the
  generic check at runtime → store such collections as `Map<string, UTSJSONObject[]>`.
- `$refs` to a child component: cast to the generated `CompComponentPublicInstance` export
  (hand-written interfaces CCE at runtime; `InstanceType<typeof C['$component']>` is a parse error).
- Data fields initialized from functions/imported consts infer to `Any` → annotate (`VERSION as string`).
- Async work in callbacks/hooks: `(async () : Promise<void> => {…})()` wrappers (callbacks must return Unit).
- **`new Array<number>(n)` is the one-element array `[n]` on Android**, not `n` empty slots as in JS — `.fill(0)` then gives
  `[0]` and every index past 0 throws. Build zero buffers with a push loop. It compiled cleanly and only failed on the
  phone; xapp-mini and web (JS) were unaffected (found 2026-10-02 in the Halo/V8 packet builders).

**uvue CSS (app-uvue-css)**
- `min-width`/`width` are CONTENT-box (WXSS default is border-box) — sizes that "match" the
  miniapp wrap or overflow; subtract padding+border when porting.
- No `radial-gradient` (background-image: linear-gradient|none only), no `%`/`vh` in
  max-width/max-height, no `align-items: baseline`, no `text-decoration`.
- `color`/`font-size` only apply on `<text>`/`<button>`/`<input>`/`<textarea>` — a `<view>`
  carrying them warns at runtime and renders unstyled.
- Stacking: an `absolute` overlay declared early in the template paints (and hit-tests) UNDER
  later siblings unless it has `z-index` — the menu mask needed `z-index: 100` to behave like
  the miniapp's `position: fixed` one.
- `<rich-text>` has no intrinsic width (give it explicit px) and **no `tag-style` prop** —
  mp-html's tag styles were merged into inline styles via `inlineTagStyles()` (markdown.uts).

## Web (H5) build

`tools/xapp-web/build.sh` + `serve.js` build and serve `src/xapp` for the browser, styled
by the web user-app's own CSS so it looks like the user-app. Architecture, styling model,
web-only behaviour and verification: [xapp-web.md](xapp-web.md); commands:
[tools/xapp-web/README.md](../../tools/xapp-web/README.md). The Android compile also runs on the
Linux box (`~/HBuilderX/cli launch app-android --project … --compile true`), but only alone: run
together with headless browsers it exhausts the 4 GB of memory.

## WeChat mini-program export (xapp-mini)

`tools/xapp-mini/build.sh` compiles the same tree for `mp-weixin` into `dist/xapp/mini`
(git-ignored), for WeChat DevTools. It runs the native branches (`#ifndef WEB`). How to open it
and what differs from the miniapp: [tools/xapp-mini/README.md](../../tools/xapp-mini/README.md).

## Offline gates (run both after every change)

```bash
node temp/uts-smoke/triage.js            # parse every .uts + .uvue <script>  (43/43)
node temp/uts-smoke/build-and-compare.js # logic equivalence vs miniapp JS     (2715/2715)
```

The harness shims `UTSJSONObject`/`uni`/`wx` and validates LOGIC only — the HBuilderX compile is
still the type gate. Keep `utils/markdown.uts`'s existing exports byte-identical when adding
page-side helpers (the harness diffs against the miniapp original).

## Status (2026-10-02, VERSION 1002-9)

Full tree compiles to Kotlin; runs on a OnePlus PJZ110 over the hot-push debug base; login →
chat (§22 async round-trip verified) → health → plans → learn → toolbox/menu popups are
**visually at parity with the miniapp in the DARK theme** (Pin's server theme on dev, 2026-10-01).
**Halo/V8 Bluetooth works on Android** (2026-10-02): `uni_modules/waven-ble`, tested with the V8 —
bind, sync, ECG. Rendering mode is VDOM (`manifest.json` `"uni-app-x": {}`); HBuilderX 5.26 also
offers vapor mode (蒸汽模式), not tried — switching would need the CSS rules above re-verified. Vapor
does not apply to the mp-weixin build.

Also built from the same tree: the web build (`xapp-web.md`) and xapp-mini (WeChat login, guest
mode, Bluetooth over WeChat's API — `tools/xapp-mini/README.md`).

Open gaps, each `TODO(port)`-tagged in code: **light theme** (the miniapp's ~690 `.theme-light`
WXSS rules have no uvue equivalent — needs a dynamic-class or per-rule port pass; the 浅色模式
toggle flips state but barely restyles), iOS Bluetooth (no transport), native binary file I/O
(`utils/file-bytes.uts` returns null on Android/iOS — uploads fail there), WechatSI ASR mic
(button renders, toasts), NFC Kino emulation, custom avatar §20, background audio.
