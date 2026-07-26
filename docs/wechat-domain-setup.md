# WeChat Domain Setup

## Request Domain Whitelist

WeChat enforces a strict request domain whitelist. Any `wx.request` call to a domain not on the list produces the error **`fail url not in domain list`** and the request never leaves the device. This is the most common cause of miniapp API failures that look like server issues but are actually client-side blocks.

**Both domains must be whitelisted** in the WeChat developer platform:
- `https://nano.gcn.net` (prod / trial / release)
- `https://nano-dev.gcn.net` (develop / IDE)

**When a developer reports "unable to sign in", "API calls failing", or any network error in the miniapp — check this first:**

1. **Quick local bypass (dev tools only):** WeChat DevTools → **Details → Local Settings** → check **"不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书"**. Disables domain validation for the current dev session only.

2. **Permanent fix:** [mp.weixin.qq.com](https://mp.weixin.qq.com) → Development → Development Settings → Server Domain → **request合法域名** → add both `https://nano.gcn.net` and `https://nano-dev.gcn.net`. Takes effect after the next miniapp upload.

The error message WeChat shows may truncate the domain — this is a WeChat display artifact, not a URL typo in the code.

## Business Domain Verification

Business domains allow `<web-view>` components to load external URLs inside the miniapp. WeChat requires ownership verification before a domain can be used.

**Verified business domains (as of the 2026-07 `fros.cc` → `gcn.net` migration):**
- `https://nano.gcn.net` / `https://nano-dev.gcn.net` — used by `pages/webadmin/webadmin.wxml`'s hardcoded `<web-view>`
- `https://aeviva.gcn.net` / `https://aeviva-dev.gcn.net` — used by `pages/main/main.js`'s `_openAevivaStore()` for the Aeviva GCN storefront handoff. **This is the domain that actually matters for the Store tab flow** — an earlier version of this migration pointed that flow at `edge(-dev).gcn.net` instead, which was never verified and produced a "不支持打开" `<web-view>` error; see nano's `CHANGELOG.md`.

Each host needs its own verification pass (steps below) — but the same verification **file content** can be reused across multiple domains/hosts in one WeChat account (confirmed working: `certs/QJaeMN3iR8.txt`, content `e038f3e1651b72fc26feaf9eb6cf30e7`, is hosted and verified on all four domains above without WeChat rejecting the reuse).

### How verification works

1. Download the verification `.txt` file from [mp.weixin.qq.com](https://mp.weixin.qq.com) → Development → Development Settings → Business Domain → Download verification file.
2. The file (e.g. `QJaeMN3iR8.txt`) must be accessible at `https://<domain>/<filename>.txt` for **each** domain being verified.
3. Save the file to `./certs/<filename>.txt` in this repo (nano side) — the GCN sibling repo hosts its own copy at `gcn/src/functions/web/site/aeviva/<filename>.txt` for the `aeviva(-dev).gcn.net` domains, served as a static file (not a worker route) via `web/index.js`'s catch-all; make sure `.txt` is in that file's `MIME_TYPES` map or it serves as `application/octet-stream`.
4. On the nano side: add a public route in `src/functions/worker/index.js` **before the auth check**, matching `rawPath === '/<filename>.txt'` and returning the file content as `text/plain`.
5. Add the path to the domain `routeConfig` for **every** `s*.yaml` that needs it (`s.yaml` for `nano-dev.gcn.net`, `s-prod.yaml` for `nano.gcn.net` — these are tracked independently, adding it to one doesn't add it to the other):
   ```yaml
   - path: /<filename>.txt
     functionName: nano-worker    # or nano-worker-dev
   ```
6. Deploy the worker and then the domain component (nano side) — or `s web deploy -t s-shanghai.yaml/s-shanghai-prod.yaml -y` (gcn's actual live deploy target, not the default `s.yaml`/`s-prod.yaml` — see gcn's own `CLAUDE.md`) for the aeviva domains:
   ```bash
   npm run deploy:worker:prod
   source .env && s nano-domain deploy -t s-prod.yaml -y
   ```
7. Verify the file is reachable on **every** domain: `curl https://<domain>/<filename>.txt`
8. Back in the WeChat platform, click **Verify** for each domain to complete registration.
