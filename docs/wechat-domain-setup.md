# WeChat Domain Setup

## Request Domain Whitelist

WeChat enforces a strict request domain whitelist. Any `wx.request` call to a domain not on the list produces the error **`fail url not in domain list`** and the request never leaves the device. This is the most common cause of miniapp API failures that look like server issues but are actually client-side blocks.

**Both domains must be whitelisted** in the WeChat developer platform:
- `https://nano.fros.cc` (prod / trial / release)
- `https://nano-dev.fros.cc` (develop / IDE)

**When a developer reports "unable to sign in", "API calls failing", or any network error in the miniapp — check this first:**

1. **Quick local bypass (dev tools only):** WeChat DevTools → **Details → Local Settings** → check **"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**. Disables domain validation for the current dev session only.

2. **Permanent fix:** [mp.weixin.qq.com](https://mp.weixin.qq.com) → Development → Development Settings → Server Domain → **request合法域名** → add both `https://nano.fros.cc` and `https://nano-dev.fros.cc`. Takes effect after the next miniapp upload.

The error message WeChat shows may truncate the domain (e.g. `nao-dev.fros..cc` instead of `nano-dev.fros.cc`) — this is a WeChat display artifact, not a URL typo in the code.

## Business Domain Verification

Business domains allow `<web-view>` components to load external URLs inside the miniapp. WeChat requires ownership verification before a domain can be used.

**Verified business domain:** `https://nano.fros.cc`

### How verification works

1. Download the verification `.txt` file from [mp.weixin.qq.com](https://mp.weixin.qq.com) → Development → Development Settings → Business Domain → Download verification file.
2. The file (e.g. `QJaeMN3iR8.txt`) must be accessible at `https://nano.fros.cc/<filename>.txt`.
3. Save the file to `./certs/<filename>.txt` in this repo.
4. Add a public route in `src/functions/worker/index.js` **before the auth check**, matching `rawPath === '/<filename>.txt'` and returning the file content as `text/plain`.
5. Add the path to the domain `routeConfig` in `s-prod.yaml` so the FC custom domain routes it to `nano-worker`:
   ```yaml
   - path: /<filename>.txt
     functionName: nano-worker
   ```
6. Deploy the worker and then the domain component:
   ```bash
   npm run deploy:worker:prod
   source .env && s nano-domain deploy -t s-prod.yaml -y
   ```
7. Verify the file is reachable: `curl https://nano.fros.cc/<filename>.txt`
8. Back in the WeChat platform, click **Verify** to complete domain registration.

**Current verification file:** `./certs/QJaeMN3iR8.txt` (content: `e038f3e1651b72fc26feaf9eb6cf30e7`)
