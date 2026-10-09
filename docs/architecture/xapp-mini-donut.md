# xapp-mini as a Donut (WeChat multi-terminal) app

**Status (2026-10-09): exploratory.** xapp-mini (`dist/xapp/mini`, the `mp-weixin` build of
`src/xapp`) runs as a Donut Android APK once one line of uni-app x's runtime is patched. Hot update
(resource packs) was uploaded and published but **never reached a device on the free plan**. The
console labels 资源包管理 Professional-only (`专业版`). Nothing here is scripted or deployed: the
working copies live in the git-ignored `dist/xapp/donut*`.

Why this was tried: the native xapp-android build compiles to Kotlin and cannot hot-update. DCloud's
upgrade center says so: *"uni-app x的app-Android由于编译为纯原生，没有wgt包，无法热更新"*. Donut
updates a mini-program package without a store release. If xapp-mini runs under Donut, one
`src/xapp` tree gives a mini-program, a web build, a native build and a hot-updatable app. Donut
background: [wechat-multiterminal.md](wechat-multiterminal.md).

## 1. The runtime patch (required)

uni-app x's mini-program runtime (`common/vendor.js`, minified) contains:

```js
En = On && "SAAASDK" === On.env ? Tn.miniapp.shareVideoMessage : Tn.shareVideoMessage
```

Under Donut, `getAppBaseInfo().host.env` is `SAAASDK`, but `wx.miniapp` is **undefined** (Android
SDK 1.6.24). The read throws `TypeError: Cannot read properties of undefined (reading
'shareVideoMessage')` while `app.js` loads. No page ever renders: the screen stays at the window
background, and vConsole still draws but no page loads. The fix guards the read; it was applied
to the build output with a regex:

```js
s.replace(/(\w+)\.miniapp\.shareVideoMessage/g, '($1.miniapp&&$1.miniapp.shareVideoMessage)')
```

It is a DCloud defect (HBuilderX 5.26). The production miniapp is plain WXML/JS and never hits it.
With the patch, xapp-mini renders. It reaches the expected `wx.login:fail … 多端App无法使用wx.login`
screen (Donut has no WeChat login), and phone + OTP sign-in works against the production backend.
A Donut APK embeds the package as `release`, so `utils/config.uts` picks `nano.gcn.net`.

**How it was found:** the APK is not debuggable (no WebView inspector over adb), and vConsole would
not open. A bisect stubbed the page markup, then the stylesheets, then `app.json`, then the
JavaScript. Finally `app.js` was wrapped in a try/catch that writes the error to storage, and a stub
login page displays it. Reuse that trick for any future blank Donut screen.

## 2. Building the Donut project

Start from a normal xapp-mini build (`tools/xapp-mini/build.sh`, with `APPID=` set to the miniapp
the multi-terminal app is bound to), then:

1. Copy from `src/mini/nano-miniapp/`: `project.miniapp.json`, `miniapp/` and **`i18n/`**. Then create
   an empty `miniapp/android/nativeResources` (git drops empty directories). Without `i18n/` the
   build fails with `Cannot read property 'android' of undefined`; without `nativeResources` it
   fails with `ENOENT … nativeResources`. `app.miniapp.json` names the miniapp's `gh_` user. Copy it
   only when the bound miniapp is the TWINN one (`wx84bd7d00a6fd626e`).
2. Set `projectArchitecture: "multiPlatform"` in `project.config.json`.
3. Apply the §1 patch to `common/vendor.js`.
4. Sync to M3 and open the project in DevTools (`cli open --project …`). `build-apk` answers
   `project not found` for a project that is not open.

Build headlessly on M3:

```bash
cli build-apk --project <dir> --port 22038 \
  --ks ~/.android/debug.keystore --sp android --kp android --ka androiddebugkey \
  --desc <text> -o <outdir>
```

- The output is an **official** (`正式版`) build: DevTools' build record
  (`WeappMiniApp/buildRecord/android/record.json`) says `打包类型：正式版`. The package name is the
  SDK default, `com.tencent.weauth`, about 36 MB.
- Expect intermittent `System error, error code:-202`; retry.
- A multi-terminal app's first build has no cached base APK (`No local base apk found, need remote
  build`). WeChat builds one remotely. The CLI can give up with `Timeout` (about 5 minutes) or
  `-606` while that runs; retry later and it picks up the finished base.
- `wxa_container`'s log shows `pkgVersion=` for the package that loaded, which is the quickest way
  to tell the embedded package from an updated one.

## 3. Hot update (resource packs): tested, not delivered

**Upload works without the UI.** The DevTools menu item (Build → Upload Resource Pack) needs a nightly
DevTools; the CLI does the same thing:

```bash
cli build-apk … --isUploadResourceBundle true --resourceBundleVersion 1.0.1 --resourceBundleDesc <note>
```

The build record then shows `上传资源包：是`. The pack appears under **开发版** in
`developers.weixin.qq.com` → 多端应用 → *app* → **资源包管理**. Publish it with ··· → **设为线上版本**. A
dialog offers optional 最低版本App / 最低版本Sdk; leave both empty so every build matches.

**Result.** Both multi-terminal apps on the account were tried:

| Multi-terminal app | App ID | Bound miniapp | Plan | Pack online | Reached device |
|---|---|---|---|---|---|
| Waven Nano | `wx2c845211952f50d6` | TWINN `wx84bd7d00a6fd626e` | free | 1.0.1, 05:13 | no |
| CURIA | `wx045c966b19f0e238` | CURIA `wxecbcf00ce480fcf2` | free | 1.0.1, 06:14 | no |

In each case an official baseline APK without the marker cold-started three or more times after the
pack went online. It kept loading the embedded package (`pkgVersion` unchanged, no download in the
log), and the visible `· OTA测试1` marker never appeared. The 资源包管理 page itself says
*"此功能当前仅面向专业版开发，升级为专业版即可使用"*, and WeChat's docs list the feature as
Professional-only. **Next step:** upgrade one app to 专业版 and repeat. CURIA's marker pack is
already online, and its baseline APK is the right test subject.

WeChat's other documented rules: updates go only to official (not development) APKs. The Beta
whitelist needs `wx.miniapp.setSaaAUserId`, which does not exist in this SDK (§1). Packages cover
mini-program code only, never native plugins or the SDK.

## 4. Driving the console from us1

Computer use is not available from the us1 CLI, and SSH sessions on M3 have no Accessibility
permission (no synthetic clicks). M3's Chrome can be scripted instead:

- Turn on Chrome → View → Developer → **Allow JavaScript from Apple Events**, then
  `osascript … tell application "Google Chrome" to execute (tab N of front window) javascript js`
  (read the JS from a file to avoid quoting).
- The console renders inside a **wujie** micro-frontend: query
  `document.querySelector('wujie-app').shadowRoot`, not the page or its iframe.
- Chakra menus ignore a bare `.click()`. Dispatch `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click`
  (`composed: true`) on the `[role=menuitem]` element.
- Screenshots: `screencapture -x -o -l <window id>` (`~/.local/bin/winid`) shows only the tab
  in front.

## 5. Phone pitfalls

- **DevTools' run-on-device/preview installs its own debug APK**, signed with a different key, over
  the test app. That one crashed at launch ("There was an error with 'Waven Nano'") and blocks
  `adb install` (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Avoid those buttons on a Donut project under
  test. To recover: `adb uninstall com.tencent.weauth`, then tap away the stacked system error dialogs.
- The OnePlus asks for confirmation on every `adb install`. Tap Install by coordinates.
- Typing into the WebView drops characters when sent fast. Send one character per `input text`.

The non-WeChat alternative (a native shell running xapp-web with our own hot update, for the US
launch): [xapp-hybrid-shell-plan.md](xapp-hybrid-shell-plan.md).
