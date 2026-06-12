# WeChat Multiterminal Apps Capability (Donut Framework)

This document provides an architectural and operational overview of WeChat's Multiterminal Apps capability (also known as the **Donut Multi-platform Framework**). It details how WeChat Mini Program codebases (like `nano-miniapp`) can be compiled into native Android (APK) and iOS (IPA) applications, the tools required for testing and distribution, and debugging workflows.

---

## 1. Overview of the Multiterminal Framework (Donut)

The WeChat Multiterminal Framework enables developers to write code once using native Mini Program syntax (WXML, WXSS, JS/TS) or third-party frameworks, and compile it into standalone native mobile applications.

### Core Benefits
* **Cross-Platform Reusability**: Significantly reduces development costs by reuse of miniapp code for iOS and Android.
* **Native Interface & Interaction**: Renders native-like layouts and transitions for high performance.
* **Conditional Compilation**: Allows developers to write platform-specific code (e.g., branching logic for miniapp vs. native App environments).
* **WeChat Ecosystem Integration**: Simple binding to leverage WeChat Open Platform capabilities (WeChat Login, Sharing, Pay, etc.).

---

## 2. Product Components & Console Management

The framework relies on a combination of WeChat's development consoles, developer credentials, and bindings.

### A. Development Platform (Donut Console)
* **Space (空间)**: A logical container for separating services, configurations, and resources. Spaces allow developers to manage different enterprises or environments (dev/prod) independently.
* **Space Subject Authentication (空间主体认证)**: Identifies space ownership. Developers can reuse existing WeChat Mini Program/Official Account qualifications or perform real-name personal authentication.
* **Member Management**: Allows administrators to invite collaborators and control space access.

### B. Multiterminal Application Console
* **Application Account**: Creates unique credentials for the native app:
  * `App ID` & `App Secret`: Used for server-side API communication.
  * `SdkKey` & `SdkKeySecret`: Utilized during app initialization for security verification.
* **Binding Mini Program**: Pairs a WeChat Mini Program with the multiterminal application, allowing DevTools to upgrade the miniapp codebase to a multiterminal project.
* **Binding Mobile App (WeChat Open Platform)**: Links a Mobile App registration from the WeChat Open Platform (`open.weixin.qq.com`). This synchronizes verification metadata (`Bundle ID`, `Package Name`, `Universal Links`) and activates capabilities like WeChat Sharing, Pay, and Login.
* **Plugin Management**: Allows integration of native libraries written in Java/Kotlin (Android) or Objective-C/Swift (iOS) to wrap third-party SDKs.
* **Closed Beta Distribution (iOS Ad-Hoc)**: Generates download links and QR codes to distribute iOS IPAs directly to registered test devices.
* **Identity Management Service (身份管理)**: A turnkey login solution offering SMS, WeChat, and Apple logins, easily integrated via Mini Program API calls.

---

## 3. Developer Tooling & Packaging

### Weixin DevTools (Multiterminal Mode)
In Weixin DevTools, developers can switch from Mini Program Mode to **Multiterminal Application Mode**.
* **Upgrade Project**: Upgrades the standard miniapp project into a multiterminal project.
* **Debugging**: Supports hot reloading, simulator-based debugging, and remote device debugging on both iOS and Android.
* **App Compilation**: Directly compiles and exports:
  * **Android**: `.apk` installation package.
  * **iOS**: `.ipa` installation package.
* **Resource Package Upload**: Uploads web/asset resource updates for over-the-air (OTA) updates and versions.

---

## 4. Mobile App Assistant (移动应用助手)

To streamline early-stage testing and eliminate the need for signing and packaging APKs during active development, WeChat provides the **Mobile App Assistant App** (currently Android-only).

### Key Features
1. **Scan QR Code**: Scan a QR code generated in Weixin DevTools to instantly load and run the multiterminal app on a real device.
2. **Click to Pull Up**: Displays a list of recently tested multiterminal apps, enabling quick relaunch.
3. **Standalone Run Mode (独立运行模式)**: Configures the assistant to boot directly into the target multiterminal application rather than the assistant's default homepage. This simulates an immersive production runtime environment.

### Debugging Constraints within the Assistant
* **vConsole Support**: Developers can trigger vConsole within the assistant for logs and network requests.
* **Login Debugging Limitations**:
  * **Supported**: `wx.login` (standard miniapp code login) can be debugged and mocked.
  * **Unsupported**: Advanced native login APIs (`wx.miniapp.login`, `wx.weixinAppLogin`, `wx.appleLogin`) **cannot** be debugged inside the Mobile App Assistant. Testing these APIs requires compiling a fully-packaged and signed release/debug build of the application.

---

## 5. Third-Party Component and Native Plugin Integration

WeChat's Donut Multiterminal framework supports the integration of arbitrary third-party Android (and iOS) native components, libraries, and SDKs using **Native Plugins**.

### How Native Android Integration Works
1. **Bridge Class Implementation**:
   * Developers create an Android library module inside Android Studio.
   * Implement the `NativePluginInterface` in Kotlin or Java.
   * Methods are exposed to JavaScript using annotations:
     * `@SyncJsApi(methodName = "syncMethod")` for synchronous calls.
     * `@AsyncJsApi(methodName = "asyncMethod")` for asynchronous calls returning a callback function.
2. **Accessing Context**:
   * Exposed plugin methods can dynamically receive the current Mini Program's `Activity` object as an argument:
     ```kotlin
     @SyncJsApi(methodName = "showCustomDialog")
     fun showCustomDialog(data: JSONObject?, activity: Activity): String {
         // Use the activity context to construct UI, start Intents, or render dialogs
         return "Dialog opened"
     }
     ```
3. **Cross-Process Execution (Main Process Delegation)**:
   * The Mini Program rendering engine runs in a **child process**.
   * For third-party SDKs that strictly require execution in the Android **Main Process** (主进程), the Luggage WXA SDK provides `NativePluginMainProcessTask`. Developers can declare tasks inheriting this, execute operations in the main process via `runInMainProcess()`, and handle callbacks in the child process via `runInClientProcess()`.
4. **Push Events (Native to JS)**:
   * Plugins can proactively push asynchronous events to JavaScript by inheriting `NativePluginBase` and invoking `sendMiniPluginEvent(param: HashMap<String, Any>)`.
   * On the JS side, the miniapp listens via `plugin.onMiniPluginEvent(callback)`.
5. **Dependency Management**:
   * Standard AARs, JARs, or Gradle dependencies (e.g., `implementation '...'`) can be added directly to the native plugin project's `libs` directory and `build.gradle` file. They are packaged into the final APK during compilation.

### How Native iOS Integration Works
1. **Bridge Class Implementation**:
   * Create an Objective-C class (or Swift class exposed to Objective-C) that inherits from `WeAppNativePlugin` and registers itself using:
     ```objc
     __attribute__((constructor))
     static void initPlugin() {
         [MyPlugin registerPluginAndInit:[[MyPlugin alloc] init]];
     }
     ```
   * Register the unique plugin ID matching the developer console: `WEAPP_DEFINE_PLUGIN_ID(YOUR_PLUGIN_ID)`.
2. **Method Exporting**:
   * Methods are exported to the JS context using framework macros:
     * `WEAPP_EXPORT_PLUGIN_METHOD_SYNC(methodName, methodSelector)` for synchronous returns.
     * `WEAPP_EXPORT_PLUGIN_METHOD_ASYNC(methodName, methodSelector)` for asynchronous callbacks utilizing a block:
       ```objc
       - (void)myAsyncFunc:(NSDictionary *)param withCallback:(WeAppNativePluginCallback)callback {
           callback(@{ @"status": @"success" });
       }
       ```
3. **AppDelegate Lifecycle Interception**:
   * iOS plugins can listen directly to key `UIApplicationDelegate` methods (e.g., handling Universal Links, custom URL Schemes, or Push Notification tokens).
   * Inside `-initPlugin`, register for interception using `[self registerAppDelegateMethod:@selector(application:openURL:options:)]`.
4. **Push Events (Native to JS)**:
   * Native Objective-C code can push asynchronous events by calling `[self sendMiniPluginEvent:@{ @"key": @"value" }]`, which JS receives via `plugin.onMiniPluginEvent(callback)`.
5. **Resource Bundle Management**:
   * Any assets, media files, or configuration files that the plugin relies on are copied to the main application bundle during packaging by configuring `PluginConfig.plist` and specifying `CopyResourcesToMainBundle`.
6. **Start-on-Load**:
   * By default, plugins are loaded dynamically when called by the JS code. However, you can configure them to load immediately at application startup by setting `"loadWhenStart": true` in `project.miniapp.json`.
7. **App Extensions (e.g., Widgets, Share Extensions)**:
   * Donut iOS plugin compilation supports standard iOS App Extensions (e.g. Notification Service Extensions, Share Extensions). They must be prefixed with the plugin ID and registered inside the visual configuration console.
8. **Dependency Management**:
   * Third-party iOS SDKs can be easily integrated using **CocoaPods** inside the native plugin's workspace.

---

## 6. Over-the-Air (OTA) / Hot Update Mechanism

Multiterminal applications compiled with the Donut framework support **built-in hot upgrades (OTA updates)** for Mini Program resource packages, eliminating the need to resubmit the binary App to the Apple App Store or Google Play for every business code change.

### How Updates Work
1. **Resource vs. Shell Separation**:
   * **Resource Package (Hot-updatable)**: Contains the JS logic, WXML layouts, WXSS styles, and local assets. Uploading a new version from Weixin DevTools immediately publishes it to the Donut cloud. The native apps download and run it without a native rebuild.
   * **Native Shell (Requires App Store update)**: Contains the native binary compilation, permissions (`AndroidManifest.xml` / `Info.plist`), native SDK versions, and Native Plugins. Changes to these require exporting a new `.apk`/`.ipa` and publishing to the app stores.

2. **OTA Update Lifecycle**:
   * **Asynchronous Check (Silent/Default)**: When a cold start occurs (the application is opened from a terminated state), the Donut runtime checks in the background for a newer resource package version.
   * **Background Download**: If a new version is found, it is downloaded asynchronously in the background. The user continues to use the cached local version during their current session to ensure zero load delay. The new version is automatically applied at the next cold start.
   * **Synchronous / Forced Update API**: For urgent releases or forced feature updates, developers can use the standard Mini Program `wx.getUpdateManager` API to hook into the update loop:
     * `onCheckForUpdate`: Detects if an update is available.
     * `onUpdateReady`: Triggers when the new resource package is fully downloaded. You can present a native modal prompting the user to reload the app.
     * `applyUpdate()`: Reboots the Mini Program engine inside the native shell to instantly load the new version.
   * **Network Fallback**: If a download fails (e.g., poor cell reception), the runtime falls back gracefully to the existing local cache to guarantee app stability.

---

## 7. Application to Waven Nano

If Waven Nano packages its WeChat Mini Program (`src/mini/nano-miniapp/`) as a native mobile app using Donut:

1. **Domain Whitelist & Networking**:
   * As detailed in `GEMINI.md`, the miniapp dynamically targets `https://nano-dev.fros.cc` for local development (`envVersion: develop`) and `https://nano.fros.cc` for preview/release versions.
   * Multiterminal native apps must ensure network permissions allow communication with these domains, and the corresponding `Package Name` / `Bundle ID` must be registered properly.
2. **Kino Simulator & Scan Integration**:
   * The Kino Simulator lives as a native WXML overlay in `pages/main/`. It does not rely on externally-loaded iframes, which makes it 100% compatible with Donut's compilation engine.
   * NFC and QR-scanning components utilized in the miniapp's chip scan flow (`wx.scanCode`) will map directly to native device camera components.
3. **Conditional Compilation**:
   * If any features require custom styling or functions specifically for native mobile screens (e.g., custom headers, Bluetooth readers), Waven Nano can use conditional compilation flags in the source files.
