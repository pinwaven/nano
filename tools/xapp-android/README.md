# xapp Android APK

`npm run build:xapp:android` exports `src/xapp` with HBuilderX, then builds the
APK locally with Gradle. It uses no DCloud cloud packaging job. The compiler
and runtime remain DCloud's uni-app x SDK.

```bash
npm run build:xapp:android
# Output: dist/xapp/android/nano-xapp-debug.apk
adb install -r dist/xapp/android/nano-xapp-debug.apk
```

## Prerequisites

- HBuilderX **5.26.2026091802**, with xapp imported and the uni-app x compiler installed.
- JDK 17 (auto-detected on macOS when `JAVA_HOME` is unset).
- Android SDK platform **35** and build tools **35.0.0**. Set `ANDROID_HOME` or
  `ANDROID_SDK_ROOT`; macOS defaults to `~/Library/Android/sdk`.
- Node.js, curl, unzip, shasum; network access for the initial SDK and Gradle dependencies.

`HBX=/path/to/HBuilderX.app npm run build:xapp:android` selects another installation.
The pinned VDOM SDK is downloaded and checksum-verified by `setup-sdk.sh`, cached
in `temp/xapp-android-sdk/`. HBuilderX and the SDK must be upgraded together.
The Gradle wrapper pins Gradle 8.14.3 with a distribution checksum; the native
project uses Android Gradle Plugin 8.12.0 and Kotlin 2.2.0.

## How it works

1. HBuilderX `publish app-android --type appResource` exports fresh resources to
   `src/xapp/unpackage/resources/app-android/`.
2. `prepare-native.mjs` syncs the Kotlin sources, assets, manifest permissions,
   app icon, selected SDK modules and `waven-ble` into `native/`.
3. Gradle builds `native/app`, and the script copies its APK to `dist/xapp/android/`.

The DCloud app ID is `__UNI__316095D`; Android's package name is `net.gcn.nano`.
Both the package settings and app version come from `src/xapp/manifest.json`.
The native module registrations and dependencies in `native/app/build.gradle`
follow [DCloud's VDOM integration guide](https://doc.dcloud.net.cn/uni-app-x/native/use/android.html)
and [module configuration](https://doc.dcloud.net.cn/uni-app-x/native/modules/android/others.html).
When adding a new native feature or UTS plugin, update that integration as needed.
SDK libraries and generated Kotlin/assets are ignored; only build configuration,
launcher code and the Gradle wrapper are tracked.

## Release signing

The default APK is signed with Android's local debug key and is for testing.
For a release APK, configure your own signing key, then run:

```bash
# Set XAPP_KEYSTORE (absolute path), XAPP_STORE_PASSWORD,
# XAPP_KEY_ALIAS and XAPP_KEY_PASSWORD in your shell.
npm run build:xapp:android -- release
# Output: dist/xapp/android/nano-xapp-release.apk
```

Passwords are read from the environment, not stored in this repository. Release
builds require all four signing variables and do not fall back to debug signing.
The script builds locally without uploading the APK to a store or deploying it.

The native `BUILD_ENV` in `src/xapp/utils/config.uts` currently points to the
dev backend. Switch and test it before making a production release build.

## Verification (2026-10-04)

Built through `npm run build:xapp:android`, verified the APK signature and
installed on OnePlus PJZ110 (Android 16). Tested as Pin on dev: chat history,
health data, plans, learning and the GCN store web view loaded without an app
crash. Login-screen phone/email navigation also worked. BLE synchronization
and media capture were not exercised by this build smoke test.

Visual issues observed: black shadow regions around health/learning cards and
the BioAge value wrapping in its narrow card. Fixed and verified on the same phone in `1004-4`: lengths-first shadow syntax
restores soft colored shadows, and native age-chip spacing and typography keep
BioAge `44.8` and both age labels on one line. Health and learning screenshots
were checked after reinstalling the APK.

For a compile check without APK packaging:

```bash
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project src/xapp --compile true
```
