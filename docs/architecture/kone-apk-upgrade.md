# Kone APK Remote Upgrade System

Admin-driven upgrade flow: upload an APK to Aliyun OSS via the admin panel → mark it active → Kone devices detect and download the new version from the API Test screen in Settings.

---

## 1. Database

Table: `kone_apk_releases`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | |
| `version` | `TEXT NOT NULL UNIQUE` | Semantic version string e.g. `0.2.1` |
| `oss_key` | `TEXT NOT NULL` | Path inside the `kone-apk` bucket e.g. `apk/15e3c862.apk` |
| `download_url` | `TEXT NOT NULL` | Presigned GET URL (10-year expiry, CNAME domain) |
| `notes` | `TEXT` | Optional release notes |
| `is_active` | `BOOLEAN DEFAULT false` | At most one row can be `true` (enforced by partial unique index) |
| `created_at` | `TIMESTAMPTZ DEFAULT now()` | |

A partial unique index (`kone_apk_releases_one_active_idx`) ensures only one release is active at a time. Setting a new release active is done in two steps: clear all rows first, then set the target — required to work around the unique index.

Migration: `temp/migration_kone_apk_releases.sql`

---

## 2. OSS Bucket

Bucket: `kone-apk` (region: `oss-cn-shanghai`)

**Custom domain:** `kone-apk.fros.cc`

Aliyun OSS blocks APK distribution via the default `*.oss-cn-shanghai.aliyuncs.com` endpoint (`ApkDownloadForbidden`). All presigned GET URLs for this bucket must use the custom CNAME domain. This is controlled by the `KONE_APK_CNAME_DOMAIN` environment variable on the worker.

DNS: `kone-apk.fros.cc` → `kone-apk.oss-cn-shanghai.aliyuncs.com` (CNAME)

The OSS lib (`lib/oss.js`) accepts an optional `cnameDomain` parameter on `generatePresignedGetUrl`. When set, it initialises the OSS client with `{ cname: true, endpoint: cnameDomain }` so the signed URL uses the custom domain.

---

## 3. API Endpoints

### `GET /api/kino-upgrade` — public, no auth required

Returns the currently active release. Called by Kone devices on the API Test screen.

**Response (active release exists)**
```json
{ "version": "0.2.1", "url": "https://kone-apk.fros.cc/apk/15e3c862.apk?..." }
```

**Response (no active release)**
```json
{ "version": "", "url": "" }
```

Returns empty strings (not `null`) because `NanoUpgradeResp` on the Kone side has non-nullable `String` fields.

---

### `GET /api/kone-apk-releases` — admin auth required

Returns all releases ordered by `created_at DESC`.

---

### `POST /api/kone-apk-releases` — admin auth required

Creates a new release record. The APK file must already be in OSS (uploaded via presign flow).

**Body**
```json
{
  "version": "0.2.1",
  "oss_key": "apk/15e3c862ac6bf2a6.apk",
  "download_url": "https://kone-apk.fros.cc/apk/15e3c862ac6bf2a6.apk?...",
  "notes": "Optional release notes"
}
```

---

### `PUT /api/kone-apk-releases/:id` — admin auth required

Sets a release as active (clears all others first), or updates notes.

**Body**
```json
{ "is_active": true }
```

---

### `DELETE /api/kone-apk-releases/:id` — admin auth required

Deletes a release. Blocked if the release is currently active — deactivate it first.

---

### `GET /api/oss/kone-apk/presign` — admin auth required

Generates a presigned PUT URL (for browser → OSS upload) and a presigned GET URL (stored in DB as `download_url`).

**Response**
```json
{
  "put_url": "https://kone-apk.oss-cn-shanghai.aliyuncs.com/apk/15e3c862.apk?...",
  "get_url": "https://kone-apk.fros.cc/apk/15e3c862.apk?...",
  "key": "apk/15e3c862ac6bf2a6.apk"
}
```

- `put_url` uses the raw OSS endpoint (PUT uploads do not hit the APK restriction)
- `get_url` uses `kone-apk.fros.cc` (CNAME) to bypass Aliyun's APK distribution block
- PUT URL expires in 1 hour; GET URL expires in 10 years (~315360000 s)

---

## 4. Upload Flow (Admin Panel)

1. Admin opens Kino tab → APK 版本管理 section
2. Click "上传新版本" → `KoneApkUploadModal` opens
3. Fill version string, optional notes, select `.apk` file
4. On submit:
   a. `GET /api/oss/kone-apk/presign` → receive `{ put_url, get_url, key }`
   b. Browser XHR PUT directly to `put_url` with `Content-Type: application/octet-stream` (uses the `uploadToOSS()` helper — NOT axios, to avoid header conflicts with OSS signature verification)
   c. `POST /api/kone-apk-releases` with `{ version, oss_key: key, download_url: get_url, notes }`
5. If "上传后设为当前版本" checkbox is checked, `PUT /api/kone-apk-releases/:newId { is_active: true }` is called immediately after

---

## 5. Environment Variables

| Variable | Value | Notes |
|---|---|---|
| `KONE_APK_OSS_BUCKET` | `kone-apk` | Defaults to `kone-apk` if unset |
| `KONE_APK_CNAME_DOMAIN` | `kone-apk.fros.cc` | Required — presigned GET URLs use this domain |

Both must be present in `.env` and in `s.yaml` / `s-prod.yaml` under `environmentVariables`.

---

## 6. Related Files

| File | Purpose |
|---|---|
| `src/functions/worker/index.js` | `handleGetKinoUpgrade`, `handleGetKoneApkReleases`, `handlePostKoneApkRelease`, `handlePutKoneApkRelease`, `handleDeleteKoneApkRelease`, `handleGetKoneApkPresign` |
| `src/functions/worker/lib/oss.js` | `generatePresignedGetUrl` with optional `cnameDomain` parameter |
| `src/web/admin-panel/src/App.jsx` | `KinoTab` APK releases table + `KoneApkUploadModal` |
| `temp/migration_kone_apk_releases.sql` | DB table + partial unique index |
| `temp/run-migration-kone-apk-releases.js` | One-shot migration runner |
| `s.yaml` / `s-prod.yaml` | `KONE_APK_CNAME_DOMAIN` env var |
