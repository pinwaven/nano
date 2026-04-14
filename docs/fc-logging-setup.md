# FC Logging Setup (Aliyun SLS)

Enables `s logs --tail` for live log streaming from deployed FC functions.

## Prerequisites

- `aliyun` CLI installed and configured with a valid default profile
- `s` (Serverless Devs) CLI installed and configured

---

## 1. Create the SLS Log Project

```bash
aliyun sls CreateProject --region cn-shanghai \
  --body '{"projectName":"nano-ai-logs","description":"Nano AI FC logs"}'
```

If the project already exists you will see `ProjectAlreadyExist` — that is fine, continue.

## 2. Create the Logstore

```bash
aliyun sls CreateLogStore --region cn-shanghai --project nano-ai-logs \
  --body '{"logstoreName":"nano-ai-logstore","ttl":30,"shardCount":1}'
```

`ttl` is the log retention period in days.

## 3. Create the Full-Text Index

Without this step `s logs --tail` fails with `logstore without index config`.

```bash
aliyun sls CreateIndex --region cn-shanghai --project nano-ai-logs \
  --logstore nano-ai-logstore \
  --body '{
    "ttl": 30,
    "line": {
      "token": [",", " ", "'"'"'", "\"", ";", "=", "(", ")", "[", "]", "{", "}", "?", "@", "&", "<", ">", "/", ":", "\n", "\t", "\r"],
      "caseSensitive": false,
      "chn": false
    }
  }'
```

## 4. Verify

```bash
aliyun sls GetIndex --region cn-shanghai --project nano-ai-logs --logstore nano-ai-logstore
```

A JSON response with a `"line"` block confirms the index is active.

## 5. Deploy Functions with logConfig

`s.yaml` already contains the `logConfig` block for both functions referencing the project and logstore above. Deploy to apply:

```bash
s deploy -y
```

## 6. Stream Logs

```bash
s logs --tail                    # all functions
s logs -f worker --tail          # worker only
s logs -f dispatcher --tail      # dispatcher only
```

---

## Reference: s.yaml logConfig snippet

```yaml
vars:
  logProject: nano-ai-logs
  logStore: nano-ai-logstore

resources:
  my-function:
    component: fc3
    props:
      logConfig:
        project: ${vars.logProject}
        logstore: ${vars.logStore}
        enableRequestMetrics: true
        enableInstanceMetrics: true
```
