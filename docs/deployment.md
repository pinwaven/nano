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

## VPC configuration

All functions share the same VPC to allow internal communication between dispatcher → worker:

| Setting | Value |
|---|---|
| VPC ID | `vpc-uf6oezl8wt6efyczo7wa4` |
| vSwitch | `vsw-uf6438oo047ucsbmlvmxw` |
| Security Group | `sg-uf6hwn97w4pz60mmfgwz` |
| IAM Role | `acs:ram::1719995052853530:role/aliyunfcdefaultrole` |
