# xapp-mini — the uni-app x port, exported as a WeChat mini-program

`src/xapp` also compiles to a WeChat mini-program (uni-app x's `mp-weixin` target). Nothing here
is deployed: the production frontend remains `src/mini/nano-miniapp`. xapp-mini is the same UTS/uvue
source as the native app, running inside WeChat.

## Build

```bash
tools/xapp-mini/build.sh                             # → dist/xapp/mini (git-ignored), appid touristappid
APPID=wxecbcf00ce480fcf2 tools/xapp-mini/build.sh    # the appid the DevTools project on M3 uses (WX_APPID)
# Equivalent npm entry point: npm run build:xapp:mini
```

- **`build.sh`** runs HBuilderX's compiler in build mode (minified), with the command and
  environment that `xcli launch mp-weixin` spawns (captured from `/proc` on HBuilderX 5.26).
  It finds `/Applications/HBuilderX.app` on macOS or `~/HBuilderX` on Linux; set `HBX=` to override.
  - It then writes `project.config.json`: `projectname: xapp-mini`, the appid, `urlCheck: false`.
  - `es6: true`, `swc: false`, `disableSWC: true` enable DevTools' legacy Babel conversion.
    SWC caused `ReferenceError: C is not defined` on startup on M3 (2026-10-07). Babel handles
    `??`/optional chaining for preview packaging too, so no extra JavaScript conversion step
    is needed. Reload the project after changing these compiler settings.
  - `optimize-css.cjs` consolidates generated WXSS rules with CSSO before packaging. It only
    replaces files when they become smaller; source styles and native/web builds are unchanged.
  - `mp-weixin.lazyCodeLoading: "requiredComponents"` injects page/component code on demand.
    This is a startup optimization; it does not remove code from the uploaded packages.
  - `configure-subpackages.cjs` adds a native `componentPlaceholder` to the generated
    UserHealth JSON. HBuilderX exposes placeholders on pages but this reference is inside a
    component, so use this build script for the mini output.
  - `xcli launch mp-weixin --project src/xapp --compile true` also works on Linux, but it only
    produces an unminified dev compile in `src/xapp/unpackage/dist/dev/mp-weixin`.
  - `xcli publish mp-weixin` needs an appid and an upload key, and uploads.
- **Size:** main package 1,498,007 bytes; Coach subpackage 204,280 bytes; Viva AG subpackage
  43,808 bytes; total 1,746,095 bytes
  in the verified M3 preview (2026-10-07). Babel ES6 conversion, compact avatar data and CSS
  consolidation stay enabled. Each package is below WeChat's 2 MB limit.
- **Coach subpackage:** `pages.json` registers `pages/coach` as the `coach` subpackage only
  on MP-WEIXIN, with `mp-weixin.optimization.subPackages` enabled in `manifest.json`.
  Navigation still uses `/pages/coach/coach`; WeChat loads the package on entry. Shared
  components/runtime stay in the main package. Native/web retain the normal page route.
- **Viva AG subpackage:** `packages/viva-ag` contains the panel as a component-only package.
  The existing Health subtab renders it asynchronously on tap, with loading/timeout/retry
  handling. No new page navigation is introduced. Native/web import the same component normally.
- **Backend:** chosen at runtime from `envVersion`, as the miniapp does (`utils/config.uts`): the
  DevTools build talks to nano-dev, an uploaded 体验版 or the released build to nano (prod). The
  header and login screen show the VERSION marker in DevTools and 体验版, and in release the
  published version number (`miniProgram.version`), as the miniapp does.

## Open it

**From us1, M3 is the default DevTools host.** Build here, then sync the compiled output:

```bash
APPID=wxecbcf00ce480fcf2 tools/xapp-mini/build.sh
rsync -a --delete --exclude project.private.config.json \
  dist/xapp/mini/ m3:waven/nano/dist/xapp/mini/
ssh m3 '/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project /Users/pin/waven/nano/dist/xapp/mini --auto-port 22091 --port 22038'
```

Open/import `~/waven/nano/dist/xapp/mini` on M3. Repeat build → sync → recompile for each
change; `git pull` alone does not refresh the git-ignored output. Preserve
`project.private.config.json` during every sync. See the [M3 DevTools runbook](../wechat-automator/m3.md)
for SSH access, running test scripts, console errors, screenshots and tunnel recovery.

- Build with the same `APPID=` the DevTools project uses; otherwise each sync resets it to
  `touristappid`.
- **`touristappid`:** the simulator works (domain checks are off), but there is no real-device
  preview and no `wx.login`.
- **The real appid** allows real-device preview: `nano-dev.gcn.net` is already on its request
  whitelist. Do **not** press Upload: that would replace the production miniapp's development
  version.

## What differs from the miniapp

- **Avatar gallery data:** shared URL parts keep the manifest compact. Regenerate
  `src/xapp/utils/avatar-gallery.uts` from the production miniapp's manifest with
  `node tools/xapp-mini/generate-avatar-gallery.cjs`; all signed URLs remain identical.

It is the native port's behaviour (`#ifndef WEB` branches), not the miniapp's, except where noted:
- **Login and guest mode are the miniapp's** (`pages/login/login.uvue`, `#ifdef MP-WEIXIN`).
  - Launch runs `wx.login` → `/api/wx-login`. An unknown WeChat user with no invite, coach link,
    referral or channel QR gets `guest: true` and browses as a guest, which is what lets the
    mini-program reviewer use the app without an account.
  - Guests see the 游客 header, the 注册 button in place of the mic, locked 健康/方案 cards, and
    no 学习/商店 tabs; every gated action opens the invite-code sheet. That UI was already in the
    shared main page; the native app never reaches it, since only `/wx-login` returns `guest`.
  - A valid invite relaunches login with `?invite=`; the new account goes to verify-phone.
    `?coach_id=`, `?ref=`, channel QR (`scene=ch:<id>`), the error step and `?loggedOut=1` behave as
    in the miniapp. Phone sign-in does not link the WeChat to the account: the 2026-09-30
    WeChat-identity work was withdrawn on 2026-10-04 (kept on branch `wechat-identity-wip`).
  - The guest is not stored; each launch asks `/wx-login` again, as in the miniapp.
  - `/wx-login` refuses an appid it has no secret for (`unknown_app_id`). `wxecbcf00ce480fcf2` is
    known (`WX_APPID`); a new appid for a reviewed release needs its credentials in the worker env.
  - Still missing: the `getPhoneNumber` button on verify-phone. `CHANNEL_SLUG` is null (the miniapp
    maps its appid to a channel).
- **Uploads work:** `utils/file-bytes.uts` has an `MP-WEIXIN` branch (`getFileSystemManager().readFile`).
- **Bluetooth works** for Halo and V8: `utils/wearable/transport-mp.uts` adapts WeChat's own Bluetooth API
  (the calls the miniapp's `ble-manager.js` makes) to the shared `BleTransport`, and `App.uvue`
  installs it at launch. There is no `app.json` permission entry for Bluetooth: WeChat's `permission` only accepts location-type scopes, and DevTools flags `scope.bluetooth` as invalid.
  - Only the connector is mini-program-specific: the protocols, parsing, sync and capture code is
    the same code the Android app runs over its own connector (`uni_modules/waven-ble`).
  - It calls `wx.*`, not `uni.*`: uni-app x does not declare the discovery calls.
  - It needs a real phone and the real appid. The DevTools simulator has no radio.
- **Missing from the port everywhere:**
  - the WechatSI voice plugin;
  - `chooseAddress` (manual address entry);
  - `requestSubscribeMessage`;
  - the privacy-authorization popup.
- **Styling:** the uvue `<style>` blocks, as on native. The web build's user-app stylesheet is
  web-only.
- **The privacy popup:** WeChat shows its default one; the miniapp's custom one is not ported.
- **Verified (2026-10-02):** booted in WeChat DevTools on i9 (driven over the reverse tunnel with
  `miniprogram-automator`); guest mode, the invite sheet and the health/plans locks checked there;
  on a phone, a V8 band bound and synced, and its rows on dev matched the miniapp's.

## Style generators (`style-gen/`)

xapp's own stylesheets carry dark-theme px literals, so on xapp-mini two things the miniapp gets
from CSS variables would never happen on their own: the light theme and the 字体大小 text size. Both
are restated from the miniapp's stylesheets into MP-WEIXIN blocks at the end of each file's
`<style>`. Re-run them when the miniapp's styles change and paste the output over the block:

```bash
M=src/mini/nano-miniapp; X=src/xapp
node tools/xapp-mini/style-gen/fsvars.js    $M/pages/main/main.wxss $X/pages/main/main.uvue          # text size
node tools/xapp-mini/style-gen/fsinherit.js $M/pages/main/main.wxss $M/pages/main/main.wxml $X/pages/main/main.uvue
node tools/xapp-mini/style-gen/lightvars.js $M/components/viva-ag-panel/viva-ag-panel.wxss          # light theme
node tools/xapp-mini/style-gen/lightvars.js $M/pages/main/main.wxss --derived-only                  # …own rules already ported
node tools/xapp-mini/style-gen/lightinherit.js $M/pages/main/main.wxss $X/pages/main/main.uvue      # after lightvars' rules are in
```

- **`fsvars.js`** emits every miniapp rule whose `font-size` reads `var(--fs-N)` (and the
  `line-height` it declares), also onto xapp's `<cls>-txt/-text/-label/-on/…` child classes.
- **`fsinherit.js`** adds the miniapp text that sets no size and inherits one: xapp's `<text>`
  inherits nothing.
- **`lightvars.js`** emits the miniapp's own `.theme-light` rules plus each colour declaration
  that reads a variable, restated under `.theme-light` — and the literal-coloured modifiers of
  those classes (`.wd-dot-on`), which the extra class of specificity would otherwise hide. Put the
  restated half before the own rules. `--derived-only` leaves the own rules out.
- **`lightinherit.js`** is the colour counterpart of `fsinherit.js`, over xapp's own template: a
  `<text>` class the miniapp never colours but xapp gives a dark literal (`.fcard-cta-label`)
  gets its nearest ancestor's light colour. Classes that would inherit two different colours are
  skipped. Without these three, light-theme values stayed near-white (the health tab's metric
  row, 2026-10-03).

The variables themselves come from the miniapp's `app.wxss`, which `App.uvue` carries under
MP-WEIXIN; they rescale under the page root's `.fs-1/2/3` and flip under `.theme-light`.
