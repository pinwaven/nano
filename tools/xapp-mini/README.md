# xapp-mini — the uni-app x port, exported as a WeChat mini-program

`src/xapp` also compiles to a WeChat mini-program (uni-app x's `mp-weixin` target). Nothing here
is deployed: the production frontend remains `src/mini/nano-miniapp`. xapp-mini is the same UTS/uvue
source as the native app, running inside WeChat.

## Build

```bash
tools/xapp-mini/build.sh                             # → src/xapp-mini (git-ignored), appid touristappid
APPID=wxecbcf00ce480fcf2 tools/xapp-mini/build.sh    # the appid the DevTools project on i9 uses (WX_APPID)
```

- **`build.sh`** runs HBuilderX's compiler in build mode (minified), with the command and
  environment that `xcli launch mp-weixin` spawns (captured from `/proc` on HBuilderX 5.26).
  - It then writes `project.config.json`: `projectname: xapp-mini`, the appid, `urlCheck: false`.
  - `xcli launch mp-weixin --project src/xapp --compile true` also works on Linux, but it only
    produces an unminified dev compile in `src/xapp/unpackage/dist/dev/mp-weixin`.
  - `xcli publish mp-weixin` needs an appid and an upload key, and uploads.
- **Size:** about 1.6 MB, under WeChat's 2 MB main-package limit, with no subpackages.
- **Backend:** `utils/config.uts` `BUILD_ENV` (`develop` → nano-dev). The mini-program has no
  `envVersion` switch like the miniapp's.

## Open it

The build runs on the EC2 box, and WeChat DevTools runs on the Mac:

```bash
rsync -a --delete <ec2-host>:waven/nano/src/xapp-mini/ ~/waven/xapp-mini/   # on the Mac
# or push from the EC2 box through the reverse tunnel to i9 (see the i9 notes in ~/.claude/CLAUDE.md):
rsync -a --delete --exclude project.private.config.json -e "ssh -i ~/.ssh/us1_to_i9 -p 2222" \
  src/xapp-mini/ pin@localhost:waven/xapp-mini/
```

Then import `~/waven/xapp-mini` in WeChat DevTools.
- Later syncs: add `--exclude project.private.config.json`, or `--delete` removes DevTools' own
  per-machine settings.
- Build with the same `APPID=` the DevTools project uses; otherwise each sync resets it to
  `touristappid`.
- **`touristappid`:** the simulator works (domain checks are off), but there is no real-device
  preview and no `wx.login`.
- **The real appid** allows real-device preview: `nano-dev.gcn.net` is already on its request
  whitelist. Do **not** press Upload: that would replace the production miniapp's development
  version.

## What differs from the miniapp

It is the native port's behaviour (`#ifndef WEB` branches), not the miniapp's, except where noted:
- **Login and guest mode are the miniapp's** (`pages/login/login.uvue`, `#ifdef MP-WEIXIN`).
  - Launch runs `wx.login` → `/api/wx-login`. An unknown WeChat user with no invite, coach link,
    referral or channel QR gets `guest: true` and browses as a guest, which is what lets the
    mini-program reviewer use the app without an account.
  - Guests see the 游客 header, the 注册 button in place of the mic, locked 健康/方案 cards, and
    no 学习/商店 tabs; every gated action opens the invite-code sheet. That UI was already in the
    shared main page; the native app never reaches it, since only `/wx-login` returns `guest`.
  - A valid invite relaunches login with `?invite=`; the new account goes to verify-phone.
    `?coach_id=`, `?ref=`, channel QR (`scene=ch:<id>`), the account-choice step, the error step
    and `?loggedOut=1` behave as in the miniapp. Phone OTP sends `miniapp_code`, so it links the
    WeChat identity.
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
