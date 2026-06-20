# WeChat Mini Program Bluetooth (BLE) Release & Auditing Guide

This guide details the step-by-step process required to successfully enable, declare, and pass WeChat's official review process for Bluetooth (BLE) permissions in the published (production) version of the Waven Nano Mini Program.

---

## 1. Local Configuration (`app.json`)

To use Bluetooth capabilities, the permission must be declared in the Mini Program's local configuration file (`app.json`).

### Permission Declaration
Under the `permission` block, declare `scope.bluetooth` with a clear, user-facing description of why the app requires Bluetooth.

```json
{
  "permission": {
    "scope.bluetooth": {
      "desc": "用于连接您的健康戒指，读取健康数据"
    }
  }
}
```

> [!WARNING]
> **Avoid `requiredPrivateInfos` for Bluetooth:** 
> Do **NOT** declare Bluetooth APIs (e.g., `openBluetoothAdapter`, `getBluetoothDevices`) inside `requiredPrivateInfos` in `app.json`. The `requiredPrivateInfos` configuration block is strictly reserved for **geographic location APIs** (such as `getLocation` or `chooseAddress`). Adding Bluetooth APIs there will cause compilation errors or project setup warnings.

---

## 2. WeChat Developer Platform Configuration (Crucial for Auditing)

WeChat review systems scan all submitted code for calls to Bluetooth APIs (such as `wx.openBluetoothAdapter`). If found, you **must** declare this usage in your online console settings, or your application audit will be rejected.

### Step-by-Step Configuration:
1. Log in to the **[WeChat Mini Program Console](https://mp.weixin.qq.com)**.
2. Navigate to **设置 (Settings) -> 服务内容声明 (Service Declarations) -> 用户隐私保护指引 (User Privacy Protection Guidelines)**.
3. Edit the privacy guide and locate the **"访问你的蓝牙" (Access your Bluetooth)** permission checkbox.
4. **Define a highly specific, business-oriented reason.** 
   * **Wrong (Will be rejected):** *"为了提升用户体验"* (To improve user experience) or *"用于连接设备"* (To connect devices).
   * **Right (Approved):** *"用于搜索并连接您的健康智能戒指（如 Colmi 智能戒指），以同步读取心率、血氧、睡眠等健康数据，供生成个性化健康报告。"* (Used to search and connect your healthy smart ring to sync heart rate, SpO2, and sleep data to generate personalized health reports).

> [!IMPORTANT]
> Generic or vague descriptions are the number one reason WeChat rejects mini program updates containing Bluetooth code. Be explicit about the hardware type and the exact health parameters you are collecting.

---

## 3. Mini Program Privacy Agreement Verification (Code-Level)

Since late 2023, WeChat requires developers to implement a mandatory Privacy Agreement dialog. The app **cannot** invoke sensitive APIs (including Bluetooth initialization) until the user has explicitly accepted the updated privacy guide.

### Implementation Flow:
1. Listen for the privacy authorization state:
   ```javascript
   wx.onNeedPrivacyAuthorization((resolve, eventInfo) => {
     // Trigger custom modal showing the privacy consent view
     this.setData({ showPrivacyModal: true, privacyResolve: resolve })
   })
   ```
2. In the modal, use the official button with the `agreePrivacyAuthorization` type:
   ```html
   <button open-type="agreePrivacyAuthorization" bindagreeprivacyauthorisation="handleAgree">
     同意并继续
   </button>
   ```
3. Call `wx.openBluetoothAdapter` only *after* `handleAgree` resolves.

---

## 4. Platform-Specific System Gotchas

### Android Location Requirement
On Android devices, the Android OS restricts Bluetooth device scanning to apps that also have **Location access** enabled. 
* **GPS/Location Switch**: If a user on Android cannot scan or discover the ring, verify that their phone's GPS/Location toggle is turned ON.
* **WeChat System Permission**: The user must also grant WeChat permission to access the phone's Location services.

### System-Level Bluetooth Authorization
If you receive the error `system permission denied` when calling `wx.openBluetoothAdapter` on iOS or Android, it means the operating system has blocked the WeChat app itself from using Bluetooth.
* **Troubleshooting**: Instruct the user to go to their phone's **Settings -> WeChat -> Permissions** and toggle **Bluetooth** to "Allowed".

---

## 5. Audit Review Submission Guidelines

When you submit a new build of Waven Nano for review:
1. **Provide a Demo Video**: Since WeChat's audit team does not own a physical Colmi Smart Ring, they cannot test the BLE scanning and synchronization flow in their test environment. 
   * Record a short video showing a user scanning, connecting, and syncing data with the ring.
   * Upload the video (e.g., to a cloud drive or public video site) and paste the link in the **审核备注 (Auditing Remarks)** field.
2. **Explain the Workflow**: Write a clear instruction in the audit notes:
   * *"本小程序提供智能戒指健康管理功能。若审核人员无真实戒指，请跳过蓝牙搜索连接步骤，可在首页使用 Kino 芯片模拟器测试健康报告流程。"* (This mini program connects to smart rings. If reviewers do not have a physical ring, they can skip the Bluetooth scanning step and use the Kino chip simulator on the main tab to test the health report generation flow).
