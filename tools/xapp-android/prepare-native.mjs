// Sync exported Kotlin, assets, permissions and selected SDK libraries into Gradle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const native = path.join(root, 'tools/xapp-android/native');
const source = path.join(root, 'src/xapp');
const exported = path.join(source, 'unpackage/resources/app-android');
const sdk = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
const android = manifest.app.distribute.android;
if (!/^__UNI__[A-Za-z0-9]+$/.test(manifest.appid)) throw new Error('Invalid DCloud app ID');
if (manifest['uni-app-x']?.vapor) throw new Error('This native project supports VDOM only');
const exportedManifest = JSON.parse(fs.readFileSync(path.join(exported, manifest.appid, 'www/manifest.json'), 'utf8'));
if (exportedManifest['uni-app-x'].compilerVersion !== '5.26') throw new Error('Export requires the matching 5.26 SDK');

const generated = path.join(native, 'app/src/generated');
const libs = path.join(native, 'app/libs');
for (const dir of [generated, libs]) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}
fs.cpSync(path.join(exported, 'uniappx/app-android/src'), path.join(generated, 'java'), { recursive: true });
fs.cpSync(path.join(exported, manifest.appid), path.join(generated, 'assets/apps', manifest.appid), { recursive: true });
const plugins = path.join(exported, 'uni_modules');
if (fs.existsSync(plugins)) {
  for (const name of fs.readdirSync(plugins)) {
    // Fail when a new plugin requires additional native integration.
    if (name !== 'waven-ble') throw new Error(`Add native integration for UTS plugin ${name}`);
    const plugin = path.join(plugins, name, 'utssdk/app-android');
    const config = JSON.parse(fs.readFileSync(path.join(plugin, 'config.json'), 'utf8'));
    if (config.dependencies?.length) throw new Error(`Configure dependencies for ${name}`);
    fs.cpSync(path.join(plugin, 'src'), path.join(generated, 'java/plugins', name), { recursive: true });
  }
}
fs.mkdirSync(path.join(generated, 'res/drawable'), { recursive: true });
fs.copyFileSync(path.join(source, 'static/waven-logo-icon.png'), path.join(generated, 'res/drawable/app_icon.png'));
fs.cpSync(path.join(sdk, 'plugins'), path.join(native, 'plugins'), { recursive: true });

const modules = Object.keys(exportedManifest['app-android'].distribute.modules);
const builtins = new Set(['uni-getElementById']);
const libraryNames = new Set([
  'uts-runtime-release.aar', 'android-gif-drawable-1.2.30.aar',
  'app-common-release.aar', 'app-runtime-release.aar', 'breakpad-build-release.aar',
  'dcloud-layout-release.aar', 'framework-release.aar',
  ...['uni-exit', 'uni-getAccessibilityInfo', 'uni-getAppAuthorizeSetting',
    'uni-getAppBaseInfo', 'uni-getDeviceInfo', 'uni-getSystemInfo', 'uni-getSystemSetting',
    'uni-openAppAuthorizeSetting', 'uni-prompt', 'uni-storage', 'uni-rpx2px', 'uni-theme',
    // Transitive dependencies of media, scanCode, rich-text and canvas.
    'uni-actionSheet', 'uni-modal', 'uni-loading', 'uni-fileSystemManager', 'uni-camera',
    // Callback types remain in native Kotlin even when no picker is in the module list.
    'uni-picker',
    'uni-barcode-scanning', 'uni-arrayBufferToBase64', 'uni-canvas-component'
  ].map(name => `${name}-release.aar`), 'nativeobj-preview-release.aar'
]);
for (const name of modules) {
  if (!builtins.has(name)) libraryNames.add(`${name}-release.aar`);
}
for (const name of libraryNames) {
  const file = path.join(sdk, 'SDK/libs', name);
  if (!fs.existsSync(file)) throw new Error(`SDK library missing: ${name}`);
  fs.copyFileSync(file, path.join(libs, name));
}
const xml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const permissions = android.permissions.join('\n    ');
fs.writeFileSync(path.join(generated, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
    ${permissions}
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
    <application android:name="io.dcloud.uniapp.UniApplication" android:label="${xml(manifest.name)}"
        android:icon="@drawable/app_icon" android:allowBackup="false" tools:replace="android:allowBackup"
        android:supportsRtl="true" android:theme="@style/UniAppX.Activity.DefaultTheme">
        <meta-data android:name="DCLOUD_UNI_APPID" android:value="${xml(manifest.appid)}" />
        <activity android:name="net.gcn.nano.LauncherActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        <activity android:name="io.dcloud.uniapp.UniAppActivity" android:exported="true"
            android:configChanges="orientation|keyboard|keyboardHidden|smallestScreenSize|screenLayout|screenSize|mcc|mnc|fontScale|navigation|uiMode"
            android:screenOrientation="portrait" android:windowSoftInputMode="adjustResize"
            android:theme="@style/UniAppX.Activity.DefaultTheme"
            tools:replace="android:exported,android:theme,android:configChanges,android:windowSoftInputMode,android:screenOrientation" />
    </application>
</manifest>
`);
console.log(`Prepared ${libraryNames.size} SDK libraries, xapp Kotlin and waven-ble for ${manifest.appid}`);
