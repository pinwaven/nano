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
