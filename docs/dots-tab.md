# Dots Tab — Miniapp Feature Reference

The Dots tab (`tab === 'dots'`) is the central interface for the Waven Nano nutrition system. It covers three areas: cartridge inventory, the weekly nutrition plan, and on-demand dispensing.

---

## 1. Cartridges Section (原粒盒)

Displays the user's active cartridges as ink-bar widgets — modelled on an inkjet printer's ink level display.

### Data source
- `GET /api/my-cartridges?openid=<openid>`
- Returns all `user_cartridges` rows where `status != 'removed'` for the user.

### Mapping (`mapCartridges`)
Each cartridge is mapped to a display object:

| Field | Source | Notes |
|---|---|---|
| `dotKey` | `dot_key.replace('DOT','D')` | Display label, e.g. `D01` |
| `dotName` | `dot_name` / `dot_name_zh` | Language-aware |
| `remaining` | `remaining_dots` | Integer, max 800 |
| `percent` | `remaining / total * 100` | Used for ink-bar fill height |
| `barColor` | `color_hex` → amber → red | Green when >25%, amber `#F5A623` when 10–25%, red `#FF4D4D` when <10% |
| `isEmpty` | `status === 'empty'` | Applies `.cart-slot-empty` class |

### Layout
- 9-per-row grid, each slot 70rpx wide (9×70 + 8×6 gap = 678rpx, fits in 750rpx screen minus 72rpx padding).
- Ink bar is a vertical fill bar (110rpx tall, 44rpx wide) with the fill height driven by `percent`.

### Cartridge Simulator (`+` button)
Opens a bottom sheet (`simCartOpen`) for testing without a physical dispenser. Presents the three cartridge sets:

| Set | Keys | i18n key |
|---|---|---|
| BioAge Reducing | DOT01–DOT06 | `set-bioage-reducing` |
| Energy Boost | DOT07–DOT12 | `set-energy-boost` |
| System Optimization | DOT13–DOT18 | `set-system-optimization` |

On selection, the handler (`handleSelectCartSet`):
1. Marks any existing cartridges for the same dot keys as `removed` (via `POST /api/cartridge-insert` with the `auto_remove_existing` flag handled server-side).
2. Generates a synthetic NFC tag for each dot: `SIM-DOTxx-{timestamp}-{index}`.
3. Calls `POST /api/cartridge-insert` in parallel for all 6 dots.
4. Reloads cartridges on completion.

---

## 2. Weekly Nutrition Plan

### Data source
- `GET /api/nutrition-plan?openid=<openid>`
- Returns `plan` (LLM text), `structured_plan`, `schedules` (DB rows), and `dots` (metadata array).

### Week range
`getWeekRange()` computes the current Monday–Sunday using **device local time** (`localISODate`, not `toISOString`). This is critical for users in non-UTC timezones (e.g. UTC+8).

### Parsing
Two code paths exist depending on what the API returns:

| Condition | Parser |
|---|---|
| `structured_plan` + `schedules` present | `mapStructuredSchedules(schedules, dotsMap, lang)` — reads from `nutrition_schedules` DB rows |
| Only `plan` text | `parsePlan(plan, dotsMap, lang)` — regex-parses the LLM text format `D01x3 D02x2 …` |

Both produce an array of day objects:
```js
{
  label: string,        // e.g. "Mon Apr 28" / "4月28日 周一"
  dateStr: string,      // "YYYY-MM-DD" in local time
  isToday: boolean,
  morning: DotChip[],
  evening: DotChip[],
}
```

Each `DotChip`:
```js
{ displayKey: 'D01', count: 3, color: '#4A90D9' }
```

Results are filtered to Mon–Sun of the current week before display.

### Horizontal scroll
The days render in a `scroll-x` `scroll-view` with `enhanced="{{true}}"`. On load, `_loadDots` computes `todayScrollLeft` to center today's card:

```js
const r = windowWidth / 750
const cardPx = windowWidth * 0.7   // 70vw
const gapPx  = 16 * r
const padPx  = 28 * r
todayScrollLeft = max(0, todayIndex * (cardPx + gapPx) + padPx - (windowWidth - cardPx) / 2)
```

### Day card
- Width: `70vw` — adapts to any screen.
- Today's card gets `.day-today` (stronger border + blue tint).
- The **current time slot** (morning if `hour < 12`, otherwise evening) gets `.meal-slot-active` — a blue-tinted highlight with border — only on today's card.

### Dot chips
- Layout: 4-column flex wrap, each chip fixed at `100rpx`.
- Each chip shows a color swatch, the dot key (`D01`), and the count (`×3`).
- Color comes from `dots.color_hex` (not the English `color` name column).

---

## 3. Dispense Section

Appears below the plan scroll when `dispenseHasToday === true` (today is in the scheduled week).

### Slot detection
Computed in `_loadDots` from device local time:
- `hour < 12` → `morning_cup`
- `hour >= 12` → `evening_cup`

### Button states

| `dispenseStatus` | Appearance | Label key |
|---|---|---|
| `''` | Indigo gradient | `dispenseBtn` |
| `'loading'` | Dimmed indigo | `dispensing` |
| `'done'` | Green gradient | `dispenseOk` |
| `'error'` | Red gradient | `dispenseErr` (tap to retry) |

### Dispense flow (`dispenseToday`)
1. Builds a `dispensed` map from `dispenseSlotDots`: `{ DOT01: 3, DOT02: 2, … }` (reconstructs full key from `displayKey` via `'DOT' + dot.displayKey.slice(1)`).
2. Calls `POST /api/dispense` with `{ openid, slot, date, dispensed }`.
3. On success: sets status to `'done'`, reloads cartridges (ink levels update).
4. On failure: sets status to `'error'`; tapping retries.

### Server-side (`handlePostDispense`)
- Deducts `count` from `user_cartridges.remaining_dots` per dot key.
- Sets cartridge `status = 'empty'` if `remaining_dots` reaches 0.
- Updates `nutrition_schedules.dispensed_at` and `dispense_log` for the matching `(user_id, date, slot_name)` row.

---

## State loaded on tab entry

Both `_loadDots` and `_loadCartridges` are called together on:
- `onLoad`
- `switchTab` to `'dots'`
- Language toggle
- Incoming message action targeting the dots tab

---

## Relevant files

| File | Role |
|---|---|
| `pages/main/main.js` | All logic: `_loadDots`, `_loadCartridges`, `dispenseToday`, `openCartSim`, `handleSelectCartSet`, helpers `getWeekRange`, `localISODate`, `mapCartridges`, `mapStructuredSchedules`, `parsePlan` |
| `pages/main/main.wxml` | Cartridge grid, plan scroll-view, day cards, meal slots, dispense button |
| `pages/main/main.wxss` | `.cart-*`, `.dots-*`, `.day-card`, `.meal-slot*`, `.dot-chip*`, `.dispense-*`, `.csim-*` |
| `src/functions/worker/index.js` | `handleGetMyCartridges`, `handlePostCartridgeInsert`, `handlePostCartridgeRemove`, `handlePostDispense`, `handleGetNutritionPlan` |
| `src/schemas/migration_cartridges.sql` | `user_cartridges` table definition |
| `docs/dots-system.md` | Full dot formulary, groups, store bundles, scoring |
