# Digital Assets System (Magic Box / 魔盒)

Channel-scoped distribution of large digital files — sleep audio, video guides, APKs, documents — via Aliyun OSS presigned URLs. Surfaced in the miniapp as the **Box (魔盒)** tab and managed from the **Media** tab in the admin panel.

---

## 1. Database

Table: `digital_assets`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `type` | `TEXT NOT NULL` | Free-form category string e.g. `sleep_music`, `guide_video`, `apk` |
| `title` | `TEXT NOT NULL` | English display title |
| `title_zh` | `TEXT` | Chinese display title (optional) |
| `oss_key` | `TEXT NOT NULL` | Path inside the `waven-nano` bucket e.g. `assets/media/abc123.mp3` |
| `content_type` | `TEXT NOT NULL DEFAULT 'audio/mpeg'` | MIME type — drives `mediaType` routing in the miniapp |
| `duration_seconds` | `INTEGER` | Audio/video duration, displayed as `mm:ss` |
| `channel_id` | `INTEGER REFERENCES channels(id) ON DELETE SET NULL` | NULL = available to all channels |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | Soft-delete / visibility toggle |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Ascending sort within the tab |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |

Migration: `src/schemas/migration_digital_assets.sql`

---

## 2. OSS Storage

**Bucket:** `waven-nano` (Shanghai `oss-cn-shanghai`)  
**Key prefix:** `assets/media/`

### Custom domain (CNAME)

| DNS record | Value |
|---|---|
| `nano-oss.fros.cc` CNAME | `waven-nano.oss-cn-shanghai.aliyuncs.com` |
| `_dnsauth.nano-oss.fros.cc` TXT | Aliyun domain-ownership token (used once for cert binding) |

The `*.fros.cc` wildcard SSL cert (stored at `./certs/cert.pem` + `./certs/key.pem`) is bound to the OSS custom domain. To rebind after cert renewal:

```bash
# 1. If Aliyun requires re-verification, get a new token:
aliyun oss bucket-cname --method put --item token \
  --access-key-id $OSS_ACCESS_KEY_ID \
  --access-key-secret $OSS_ACCESS_KEY_SECRET \
  --endpoint oss-cn-shanghai.aliyuncs.com \
  oss://waven-nano nano-oss.fros.cc

# 2. Update _dnsauth.nano-oss.fros.cc TXT record with new token (via fros.cc account)

# 3. Bind cert:
python3 -c "
cert = open('certs/cert.pem').read().strip()
key  = open('certs/key.pem').read().strip()
xml  = f'''<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<BucketCnameConfiguration>
  <Cname>
    <Domain>nano-oss.fros.cc</Domain>
    <CertificateConfiguration>
      <Certificate>{cert}</Certificate>
      <PrivateKey>{key}</PrivateKey>
      <Force>true</Force>
    </CertificateConfiguration>
  </Cname>
</BucketCnameConfiguration>'''
open('/tmp/oss-cname-cert.xml','w').write(xml)
"

aliyun oss bucket-cname --method put --item certificate \
  --access-key-id $OSS_ACCESS_KEY_ID \
  --access-key-secret $OSS_ACCESS_KEY_SECRET \
  --endpoint oss-cn-shanghai.aliyuncs.com \
  oss://waven-nano /tmp/oss-cname-cert.xml
```

> **Note:** `fros.cc` DNS is managed under a separate Aliyun account. The TXT record for domain verification must be added manually from that account's DNS console.

### URL expiry

Presigned GET URLs are generated with a **7-day** (604 800 s) expiry. Regenerated on each `GET /api/digital-assets` call — no caching needed at the client level.

---

## 3. API Endpoints

All routes require a valid bearer token. Channel admin routes are scoped to `adminCtx.channelId`.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/digital-assets` | Any admin | List active assets. Accepts `?channel_id=` filter. Returns presigned `url` per asset. |
| `POST` | `/api/digital-assets` | Superadmin / Channel admin | Create asset record. Channel admins have `channel_id` set automatically. |
| `PUT` | `/api/digital-assets/:id` | Superadmin / Channel admin (own) | Update metadata or active flag. |
| `DELETE` | `/api/digital-assets/:id` | Superadmin / Channel admin (own) | Hard delete (does not remove OSS object). |
| `GET` | `/api/digital-assets/presign` | Any admin | Returns a presigned PUT URL + final `oss_key` for direct-to-OSS upload. |

### Presign upload flow

```
Admin picks file
  → GET /api/digital-assets/presign?filename=sleep.mp3&content_type=audio/mpeg
  → { uploadUrl, ossKey }
  → PUT uploadUrl (file bytes, no auth header needed)
  → POST /api/digital-assets { oss_key: ossKey, ... }
```

### `GET /api/digital-assets` response shape

```json
{
  "assets": [
    {
      "id": 1,
      "type": "sleep_music",
      "title": "Deep Sleep",
      "title_zh": "深度睡眠",
      "oss_key": "assets/media/abc123.mp3",
      "content_type": "audio/mpeg",
      "duration_seconds": 3600,
      "channel_id": 5,
      "is_active": true,
      "sort_order": 0,
      "url": "https://nano-oss.fros.cc/assets/media/abc123.mp3?..."
    }
  ]
}
```

---

## 4. Miniapp — Box Tab

**Tab key:** `wellness`  
**Tab label:** Box (EN) / 魔盒 (ZH)  
**Icon:** `assets/icons/box.svg`

### `mediaType` routing

Derived client-side from `content_type`:

| `content_type` prefix | `mediaType` | Miniapp behaviour |
|---|---|---|
| `audio/` | `audio` | Sleep-track card; `wx.getBackgroundAudioManager()` — plays in background / on lock screen |
| `video/` | `video` | Media-asset card with video icon; taps copy presigned URL to clipboard |
| anything else | `other` | Media-asset card with doc icon; taps copy presigned URL to clipboard |

### Background audio permission

`app.json` must include:
```json
"requiredBackgroundModes": ["audio"]
```

This is already set.

---

## 5. Admin Panel — Media Tab

**Location:** Bottom of the sidebar (after Lab).  
**Permission:** Included in `CHANNEL_ADMIN_FULL_PERMS` and `LEGACY_TAB_EXPANSION`.

| Role | Behaviour |
|---|---|
| Superadmin | Sees all assets across all channels; channel filter dropdown |
| Channel admin | Sees only own channel's assets; no channel selector in upload modal |

Upload modal fields: title (EN + ZH), type, content type, duration, sort order, file picker (presign → direct-to-OSS).

---

## 6. Environment Variables

| Variable | Description |
|---|---|
| `OSS_CNAME_DOMAIN` | Custom domain for presigned URLs. Set to `nano-oss.fros.cc`. Falls back to raw OSS endpoint if unset. |
| `OSS_ACCESS_KEY_ID` | Aliyun OSS access key |
| `OSS_ACCESS_KEY_SECRET` | Aliyun OSS secret |
| `OSS_REGION` | `oss-cn-shanghai` |
| `OSS_BUCKET` | `waven-nano` |

Set in `.env` (dev) and referenced via `${env(...)}` in `s.yaml` / `s-prod.yaml`.
