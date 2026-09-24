# Avatar Gallery System

Users pick a profile avatar from a gallery of 40 pregenerated characters instead of uploading a real photo. Each character has 4 mood variants (engaged / relaxed / restored / stressed); in the health tab's self view, the displayed image reacts live to the user's synced wearable data.

Replaced WeChat's native `open-type="chooseAvatar"` (photo upload) flow entirely — see `CHANGELOG.md` "Avatar gallery picker replaces photo upload" (2026-07) for the migration.

---

## 1. Source Images & OSS Storage

**Source:** `temp/avatar/moods/avatar-NN-mood.png` (40 characters × 4 moods, 512×512 originals — not checked into the miniapp bundle, only used at upload time).

**One-off upload script:** `temp/upload-avatar-gallery.js`

```bash
node temp/upload-avatar-gallery.js
```

For each of the 40 characters, resizes with `jimp` and uploads two variants per mood image to the `waven-nano` OSS bucket (`oss-cn-shanghai`):

| Variant | Size | Quality | OSS key | Used for |
|---|---|---|---|---|
| Full | 300×300 JPEG | 82 | `avatars/gallery/{id}-{mood}.jpg` | Actual displayed avatar (health hero renders at 240rpx) |
| Thumb | 160×160 JPEG | 75 | `avatars/gallery/{id}-thumb.jpg` | Picker grid thumbnail — only the character's `relaxed` mood is used as its thumb |

URLs are 10-year presigned GET links (`ossLib.generatePresignedGetUrl(key, 315360000)`), same convention as user-uploaded `avatar_url`s (see `temp/fix-dev-user-avatar-urls.js`).

**Output manifest:** `src/mini/nano-miniapp/utils/avatar-gallery.js` (auto-generated, ~44KB, bundled with the miniapp — do not hand-edit):

```js
const MOODS = ['engaged', 'relaxed', 'restored', 'stressed']
const AVATAR_GALLERY = [
  { id: 'avatar-01', thumb: 'https://...-thumb.jpg', moods: { engaged: '...', relaxed: '...', restored: '...', stressed: '...' } },
  // ...40 entries
]
module.exports = { MOODS, AVATAR_GALLERY }
```

To regenerate (e.g. new/updated source art), replace the PNGs under `temp/avatar/moods/` and re-run the script — it overwrites the same OSS keys and rewrites the manifest in place.

---

## 2. Mood Computation

`src/mini/nano-miniapp/utils/mood.js`

```js
computeMood(ringRaw) → 'engaged' | 'relaxed' | 'restored' | 'stressed'
resolveAvatarUrl(avatarId, mood) → string | null
```

`computeMood` takes the same raw ring-data shape `user-health.js` already builds from a synced wearable (`stress` 0-100, `sleepMinutes`, `hrv` ms, `steps`) and applies fixed thresholds:

1. No data at all (`raw` is `null`) → `relaxed` (default — **no wearable attached always shows relaxed**, by product decision)
2. `stress > 60` → `stressed`
3. Well-rested (`sleepMinutes / 60 >= 6.5` and `hrv >= 50` or missing) → `restored`
4. `steps >= 6000` → `engaged`
5. Otherwise → `relaxed`

**Purely client-side, never persisted.** Mood is recomputed every time `user-health.js` sets `ringData` (live BLE sync, local snapshot on load, or server-hydrated fallback for coach view) and stored in the component's own `mood` data field. The `'user'` and `'mood'` observers call `_refreshAvatarDisplay()`, which resolves `avatarDisplayUrl` from `user.avatar_character` + current `mood` and swaps the rendered `<image>` — no request to the backend is made on a mood change. This keeps wearable syncs free of extra write traffic and means the DB's `avatar_url` always reflects the character's `relaxed` variant (see §3).

Because mood is computed from whatever `user` prop the `user-health` component receives, a coach viewing a client's health tab (`mode="coach"`) also sees that client's live mood if the client has synced ring data server-side — same code path, no special-casing.

---

## 3. Database

**Column:** `users.avatar_character` (`TEXT`, nullable) — migration `src/schemas/migration_avatar_character.sql`.

Stores the picked character id (e.g. `'avatar-07'`). `avatar_url` is unchanged in shape/meaning — it keeps storing a single resolved image URL exactly as before, just now pointed at the character's **relaxed** variant. This means every read site that isn't the self-view health hero (coach client list, admin/superadmin panels, referral list, qrlogin) needs no changes — they keep rendering `avatar_url` as a plain image URL, always showing the relaxed default.

`avatar_character` is `NULL` for:
- Users who signed up before this feature (legacy uploaded-photo avatars) — `avatar_url` alone still works as their avatar.
- Users who skipped avatar selection.

### Where it's read

Every backend query that returns the **logged-in user's own row** (used to populate `app.globalData.user` client-side) selects `avatar_character` alongside `avatar_url`:

- `handlers/login.js` — `handleWxLogin` (existing-user select, invite-refresh select, phone-match select, new-user `RETURNING`), `handleWxAppLogin` (`bundleSelect`, new-user `RETURNING`), `handleExchangeWebviewToken` (`WEBVIEW_USER_SELECT`)
- `handlers/phone-otp.js` — shared `USER_SELECT`, new-user `RETURNING`
- `handlers/users.js` — `handleGetUser`

Deliberately **not** added to other-user listing queries (`handleGetUsers`, `handleGetMyReferrals`, dashboard `recent_users`) — those only ever render the static `avatar_url`, so there's no functional need for the character id there.

### Where it's written

`handlers/users.js` `handlePutUser` accepts `avatar_character` in the request body and persists it with `COALESCE($n, avatar_character)`, same pattern as `avatar_url` — a partial update that omits it never nulls out an existing value.

---

## 4. Miniapp Components

### `components/avatar-picker/`

Reusable bottom-sheet grid of all 40 characters (their `thumb` image). Matches the app's existing `.modal-overlay` / `.modal-sheet` visual pattern (see `pages/main/main.wxss`).

Properties: `visible` (Boolean), `selected-id` (String — highlights the current character), `lang` (`'zh'` / `'en'`), `theme` (`'dark'` / `'light'`).
Events: `select` → `{ avatarId }`, `close`.

Used from two places:

| Page/component | Trigger | On select |
|---|---|---|
| `pages/verify-phone/` | Optional avatar step right after brand-new signup (`?new=1`) | Resolves the `relaxed` URL, PUTs `avatar_url` + `avatar_character` directly (account already exists at this point) |
| `components/user-health/` | "Change avatar" pill in the health hero (`mode === 'self'` only) | Emits `chooseavatar` with `{ avatarId }` up to the parent page |

### `pages/main/main.js` — `handleHealthChooseAvatar`

Receives the `chooseavatar` event from `user-health`, resolves the `relaxed` URL via `resolveAvatarUrl(avatarId, DEFAULT_MOOD)`, and calls the existing `_saveUser()` helper (`PUT /api/users/:id`) with `{ avatar_url, avatar_character }`. No file upload/download round trip — the image is already hosted on OSS, so picking an avatar is just a URL resolve + one PUT.

---

## 5. Environment Variables

Same OSS credentials as the rest of the app (see `docs/architecture/digital-assets.md` §6) — `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_REGION`, `OSS_BUCKET` (`waven-nano`). No new env vars.

---

## 6. Custom Avatars — "My photo" (2026-09-20)

In the health tab's self view, the picker's first tile lets the user upload a photo of themselves;
the worker generates a personal 4-mood set in the gallery's art style and the user previews and
applies it. The gallery itself is unchanged, and so is every read site of `avatar_url`.

### What the spike established (`temp/avatar-gen-spike.js`, 2026-09-19)

- **Model:** DashScope `qwen-image-3.0` on the synchronous `multimodal-generation/generation`
  endpoint — 1–3 input images + one instruction, PNG result URL valid 24 h, billed per generated
  image. `AVATAR_GEN_MODEL` selects it. **The quota is requests/minute, account-wide**
  (help.aliyun.com/zh/model-studio/rate-limit): `qwen-image-2.0-pro` looked best in the first
  spike but allows 2/min — a single 4-call set needs two minutes and a second user 429s — so it
  was replaced after a live failure. Compared on a real photo (2026-09-20): `qwen-image-2.0`
  (2/s) renders grainy with textured backgrounds; `qwen-image-edit-plus` (2/s) drifts the face
  and ignores the background; `qwen-image-3.0` (20/min) gave the best likeness, ~32 s per set.
- **Prompts:** the subject is Chinese unless the photo clearly shows otherwise (most customers
  are), with the East Asian features to preserve spelled out in the base step and repeated on
  every mood edit. **Never name an accessory** — "same glasses / glasses if any" made the edit
  model paint glasses on three of four variants; it is "keep accessories as in the photo, add
  none".
- **Two steps, not one:** photo + the gallery style reference (`avatars/style-ref/relaxed.png`, a
  512 px gallery PNG uploaded once; **last** in the image list because the API takes the output
  aspect from it) → the `relaxed` base; then three edits **of the base** for engaged / restored /
  stressed. Editing the base, not the photo, is what holds identity and style across the row.
- **Sequential, never parallel:** three concurrent mood calls returned `429 Throttling.RateQuota`
  live. `generateImage` retries 429 with backoff and retries the result download once (an
  `ECONNRESET` was seen). ≈ 8–10 s per call on 3.0, 35–60 s per attempt end to end.
- **No image library in the worker:** the 300 px / 160 px JPEG derivatives come from OSS image
  processing (`ossLib.processObjectSave`, confirmed on `waven-nano`), same spec as
  `temp/upload-avatar-gallery.js`.

### Pipeline — `worker/lib/avatarGen.js`

`runAvatarGeneration(genId, deps)` is pure over injected `{pool, ossLib, llmClient, http, apiKey}`:

1. **Gate** — `qwen-vl-plus` over the photo answers JSON; `evaluateGate` requires exactly one
   real, frontal, clearly visible human face, else `status='rejected'` with `error_code`
   `no_face | multiple_faces | not_a_photo | not_frontal` and **no image call is spent**.
2. **Base** (relaxed) → 3. **Moods** → 4. **Store** originals to `avatars/custom/<user_id>/<gen_id>-<mood>-src.png`,
   derive `…-<mood>.jpg` (300 px q82) and `…-thumb.jpg` (160 px q75, from relaxed), delete the originals.
5. **Finish** — `mood_keys`, `status='done'`. Any throw → `status='failed'` (`gen_failed` / `store_failed`).

**The source photo is deleted in a `finally`, on every outcome**, and `source_oss_key` is NULLed —
a face photo never outlives the job (product decision: delete after generation).

### Data — `migration_avatar_generations.sql`

`avatar_generations` (one row per attempt; `uniq_avatar_generations_active` = one in-flight row per
user, enforced by Postgres, not by a check) and `users.avatar_moods JSONB`
(`{engaged, relaxed, restored, stressed, thumb}` → 10-year presigned URLs, the gallery convention).
`avatar_character = 'custom'` is the only value that makes `avatar_moods` resolve; `handlePutUser`
sets `avatar_moods = NULL` whenever any *other* character is written, so a stale set can never render.
`avatar_moods` rides every self-row select that already carries `avatar_character` (§3).

### Endpoints — `worker/handlers/avatar_generation.js` (app bearer + `openid`)

| | |
|---|---|
| `POST /api/avatar-generation/presign` | server-minted key `avatar-uploads/<user_id>/<hex>.jpg`, `image/jpeg` signed, 10-min PUT. **Not** `/api/oss/presign` (authorizes nothing). |
| `POST /api/avatar-generation {oss_key}` | refuses a key outside the caller's prefix (403), a missing upload, `> 6 MB`, the daily cap (`AVATAR_GEN_MAX_PER_DAY`, default 3; 429 `daily_limit`) and a concurrent job (409 `in_progress`); a refused upload is deleted. Publishes `kind:'avatar_generate'` on the existing `chat.generate` CloudEvent (§22 — no trigger change) and returns `{processing:true}`; on publish failure runs inline. |
| `GET /api/avatar-generation` | the caller's latest row: `{gen_id, status, error_code, moods?}` — `moods` only when `done`, never a key. |
| `POST /api/avatar-generation/apply {gen_id}` | row must be the caller's and `done`; writes `avatar_character='custom'`, `avatar_moods`, `avatar_url = relaxed`. |

`handleChatGenerateEvent` branches on `kind === 'avatar_generate'` right after the dedupe claim,
before any chat machinery.

### Miniapp — `components/avatar-picker/`

The component owns the flow (self view only — `allow-upload="{{mode === 'self'}}"`): tile →
`wx.chooseMedia` (compressed) → `wx.cropImage` 1:1 when available → presign → PUT → create →
5 s poll of `GET /api/avatar-generation` while pending/running (timer cleared on hide; the sheet
may be closed, the job continues) → 4-up preview (restored | relaxed | engaged | stressed) with
使用 / 重新生成 → apply → `customapplied` event → `user-health` `customavatar` →
`main.js handleHealthCustomAvatar` mirrors the fields into the local user. Rejections render the
`err_<code>` copy (both languages in the component's `T`).

`utils/mood.js resolveAvatarUrl(avatarId, mood, customMoods)` — `'custom'` resolves from
`customMoods` only. The web user-app follows through the shared module (`useHealthData.js`) and
shows an applied set as a tile in `HealthTab.jsx`; the upload flow itself is miniapp-only for now.

### Not done / known

- No WeChat `mediaCheckAsync` (needs the 消息推送 callback, not configured) and no human review;
  the gate is the only moderation. Output is a stylized cartoon of the input.
- Cost ≈ 4 billed image calls per successful attempt; check the current per-image price.
- A user-app upload UI, and re-rolling from a kept photo, are follow-ups (the photo is deleted).
