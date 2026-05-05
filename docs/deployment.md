# Deployment Guide

All deployments use [Serverless Devs](https://www.serverless-devs.com/) (`s` CLI) and the configuration in `s.yaml`.

> [!CAUTION]
> **Domain Configuration Warning:** Running `s deploy` or `s nano-domain deploy` will reconcile the domain state on Alibaba Cloud to match `s.yaml`. 
> 
> If you are using HTTPS with a custom certificate, you **MUST** ensure your certificate files are present in the `./certs` folder before deploying. If they are missing, the Aliyun configuration will be reset to HTTP only, disabling HTTPS.

## Local Certificate Setup

To maintain HTTPS support during deployment:
1. Ensure the `./certs` directory exists (it is git-ignored).
2. Place your certificate files in `./certs/fullchain.pem` and `./certs/privkey.key`.

## Dev vs Prod

| | Dev | Prod |
|---|---|---|
| DB | `nano_db_dev` | `nano_db_prod` |
| s.yaml | `s.yaml` | `s-prod.yaml` |
| Deploy suffix | _(none)_ | `-prod` |
| DB migrate | `npm run migrate:dev` | `npm run migrate:prod` |

Always deploy and test on dev first. See [Database Migrations](architecture/database-migrations.md) for the full migration workflow.

## Functions

| Name | s.yaml key | Description |
|---|---|---|
| `nano-dispatcher` | `dispatcher` | Cron-triggered user scanner |
| `nano-worker` | `worker` | AI processing + HTTP API |
| `nano-admin-panel` | `admin-panel` | Admin SPA + simulator host |
| Domain config | `nano-domain` | Custom domain routing for `nano.fros.cc` |

## Deploy commands

```bash
# Deploy everything
s deploy -y

# Deploy a single function
s dispatcher deploy  -y
s worker deploy -y
s admin-pane deployl -y

# Deploy only the domain routing
s nano-domain deploy -y
```

## Environment variables

All sensitive values are set in `s.yaml` under each function's `environmentVariables`. The shared variables are:

| Variable | Used by | Description |
|---|---|---|
| `DATABASE_URL` | All functions | PostgreSQL connection string (takes precedence over individual DB_* vars) |
| `DB_HOST` | dispatcher, worker | PolarDB host (fallback when DATABASE_URL not set) |
| `DB_NAME` | dispatcher, worker | Database name |
| `DB_USER` | dispatcher, worker | Database user |
| `DB_PASS` | dispatcher, worker | Database password |
| `DB_SSL` | dispatcher, worker | Set to `"false"` for internal VPC connections |
| `TZ` | All functions | Timezone — set to `Asia/Shanghai` |
| `DASHSCOPE_API_KEY` | worker | Aliyun DashScope API key for LLM calls |
| `MODEL` | worker | LLM model name (default: `qwen-turbo`) |
| `WORKER_URL` | dispatcher, admin-panel | Internal VPC URL of `nano-worker` |
| `WORKER_FUNCTION_NAME` | dispatcher | FC function name of the worker |

## Domain routing (`nano.fros.cc`)

Defined in `s.yaml` under `nano-domain`. Current routes:

```yaml
routes:
  - path: /admin      → nano-admin-panel
  - path: /admin/*    → nano-admin-panel
  - path: /admin/api/* → nano-admin-panel (proxied to worker)
  - path: /worker     → nano-worker
```

> `/api/*` is intentionally left free for future use.

## Admin panel deployment notes

The admin panel serves both the compiled React SPA (`dist/`) and the simulator builds (`sim/`). When updating simulators, rebuild them first before deploying:

```bash
cd tests/chat-simulator && npx vite build
cd ../kino-simulator    && npx vite build
cd ../coach-simulator     && npx vite build
cd ../..
s deploy admin-panel -y
```

See [Simulator Build & Deploy](simulator-build-deploy.md) for full details.

## Logging

Logs stream to Aliyun SLS (`nano-ai-logs` / `nano-ai-logstore`). Tail live:

```bash
s logs -f worker --tail
s logs -f dispatcher --tail
s logs -f admin-panel --tail
```

See [FC Logging Setup](fc-logging-setup.md) for first-time SLS provisioning.

## WeChat miniapp domain configuration

The miniapp makes outbound network requests to two distinct external services. Both domains must be registered in the WeChat admin console under **开发 → 开发管理 → 服务器域名**, or all requests to them will be silently blocked in production.

### Required domains

| 类型 | Domain | Why |
|---|---|---|
| request合法域名 | `nano.fros.cc` | All API calls (`wx.request` to the FC worker) |
| request合法域名 | `waven-nano.oss-cn-shanghai.aliyuncs.com` | Presigned PUT uploads for user avatars |
| downloadFile合法域名 | `wx.qlogo.cn` | WeChat profile picture downloads (older WeChat versions where `chooseAvatar` returns an HTTP URL instead of a local temp path) |


### Why this matters

`"urlCheck": false` is set in `src/mini/nano-miniapp/project.config.json`. This disables domain validation in the DevTools simulator, so every domain works locally. In production (any uploaded/released build), WeChat strictly enforces the whitelist — requests to unlisted domains call the `fail` callback without ever leaving the device, with no visible error.

**Symptom of missing OSS domain:** `avatar_url` stays `null` in the DB after guest sign-up. The avatar preview appears in the sheet (it shows the local WeChat temp path), but the OSS upload never completes. The Continue button re-enables as if the upload succeeded, and the save step is silently skipped.

### How to add domains

1. Log in to [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. 开发 → 开发管理 → 服务器域名
3. Click **修改** next to request合法域名
4. Add each domain on its own line (scheme must be `https://`)
5. Save — changes take effect immediately for production builds; DevTools requires a re-open

## VPC configuration

All functions share the same VPC to allow internal communication between dispatcher → worker:

| Setting | Value |
|---|---|
| VPC ID | `vpc-uf6oezl8wt6efyczo7wa4` |
| vSwitch | `vsw-uf6438oo047ucsbmlvmxw` |
| Security Group | `sg-uf6hwn97w4pz60mmfgwz` |
| IAM Role | `acs:ram::1719995052853530:role/aliyunfcdefaultrole` |
