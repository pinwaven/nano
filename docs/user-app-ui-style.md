# Nano User App — UI Style Guide

**Source:** `src/web/user-app/`  
**Live URL:** `https://nano.fros.cc/app/`  
**Stack:** React 18 + Vite, plain CSS (no CSS framework)

---

## Design Principles

- **Dark navy theme** — immersive, clinical, premium feel
- **Mobile-first** — the app is built for phone screens; on desktop it renders inside a phone frame silhouette (390 × 844 px)
- **Glassmorphism** — frosted-glass surfaces with `backdrop-filter: blur()` throughout
- **Subtle glow** — blue glow effects (`box-shadow`, radial gradients) to give depth without being distracting

---

## Color Tokens

Defined in `:root` in `style.css`. All components consume these variables — never hardcode colors.

| Token | Value | Usage |
|---|---|---|
| `--blue` | `#6375EC` | Primary accent, buttons, active states |
| `--blue-glow` | `rgba(99,117,236,0.45)` | Button shadows, glow effects |
| `--blue-dim` | `rgba(99,117,236,0.12)` | Button backgrounds, focus rings |
| `--wave` | `#A6C4E5` | Secondary text, AI message highlights, subtitles |
| `--navy` | `#0B1C2E` | Base background |
| `--navy-card` | `#0F2540` | Card surfaces, trend cards |
| `--navy-lift` | `#162E4A` | Elevated surfaces, input backgrounds |
| `--navy-border` | `rgba(99,117,236,0.18)` | All borders and dividers |
| `--text` | `#EEF2FF` | Primary text |
| `--text-sub` | `#A6C4E5` | Secondary text, labels |
| `--text-muted` | `rgba(166,196,229,0.4)` | Placeholder text, section titles |

**Background:** `radial-gradient(ellipse at 50% 0%, #1a3155 0%, var(--navy) 65%)` — a top-lit deep navy that gives the app a luminous quality.

---

## Typography

**Font:** Inter (Google Fonts), with `-apple-system, BlinkMacSystemFont` as fallback.  
**Rendering:** `-webkit-font-smoothing: antialiased`

| Role | Size | Weight | Notes |
|---|---|---|---|
| App title (header) | 12px | 700 | 4px letter-spacing, all caps |
| Login title | 26px | 800 | 8px letter-spacing, gradient text clip |
| Login subtitle | 12px | 400 | 0.5px letter-spacing |
| Section titles | 10px | 700 | 2px letter-spacing, all caps, `--text-muted` |
| Body / chat messages | 14px | 400 | 1.55 line-height |
| Card labels | 11px | 600 | 1.5px letter-spacing, all caps |
| Field labels | 10px | 600 | 1.8px letter-spacing, all caps |
| Biomarker values | 15–16px | 700–800 | Colored per biomarker |
| Bio Age number | 26px | 800 | Color-coded green/amber/red |

---

## Layout

### Phone Frame (Desktop)

On screens ≥ 640px, the app renders inside a simulated phone shell:

- **Size:** 390 × 844 px (iPhone-like)
- **Bezel:** Triple `box-shadow` ring — `#08111f` / `#1d3354` / `#08111f`
- **Notch:** CSS `::before` pseudo-element, 120 × 34px, centered at top
- **Corner radius:** 50px
- **Glow:** `0 0 80px rgba(99,117,236,0.12)` ambient

On screens < 640px (real mobile), the frame is removed and the app takes 100% of the viewport.

### App Chrome

```
┌─────────────────────────┐
│  App Header             │  Fixed, blurred glass
├─────────────────────────┤
│                         │
│  Tab Content            │  flex: 1, scrollable inside
│  (Chat or Health)       │
│                         │
├─────────────────────────┤
│  Bottom Tab Bar         │  Fixed, blurred glass
└─────────────────────────┘
```

---

## Screens & Components

### Login Screen

Centered vertically inside the phone frame with `gap: 32px` between sections.

**Sections (top → bottom):**
1. **Lang toggle** — absolute top-right, pill button `中/EN`
2. **Brand block** — glowing logo ring (80px, circular), `NANO` title with gradient text clip, subtitle
3. **Login card** — frosted glass card with phone input + submit button
4. **Footer** — "Harvard Innovation Labs · Member Company"

**Login card details:**
- Background: `rgba(15,37,64,0.6)` + `backdrop-filter: blur(12px)`
- Border: `1px solid var(--navy-border)`
- Border-radius: 20px
- Input: 17px font, 15px vertical padding, radius 13px
- Button: full-width, gradient `#6375EC → #8B9FFF`, radius 13px, lifts `-1px` on hover

**Error state:** Red-tinted pill (`rgba(239,68,68,0.1)` bg, `#fca5a5` text)

---

### App Header

- **Height:** ~48px (plus notch padding on desktop)
- **Background:** `rgba(11,28,46,0.85)` + `backdrop-filter: blur(24px)`
- **Left:** Waven logo (18px, white-inverted) + "NANO" title
- **Right:** User nickname (truncated at 100px) + logout icon button

---

### Bottom Tab Bar

- **Background:** `rgba(8,18,32,0.92)` + `backdrop-filter: blur(24px)`
- **Active indicator:** 32px wide, 2px tall gradient line at top of active tab (`var(--blue) → #8B9FFF`)
- **Inactive color:** `--text-muted`; active: `--blue`
- **Tabs:** Chat (speech bubble icon), Health (ECG waveform icon)

---

### Chat Tab

**Message bubbles:**

| Type | Background | Alignment | Corner |
|---|---|---|---|
| User | Gradient `--blue → #7B8FFF` | Right-aligned | Bottom-right: 4px |
| AI | `--navy-lift` + border | Left-aligned | Bottom-left: 4px |

- Max width: 80% of container
- Markdown rendered inside AI bubbles (bold → `--wave`, headings → `--wave`, code → blue-dim bg)

**Typing indicator:** Three animated dots (scale + opacity bounce, 1.2s cycle, staggered 0.2s)

**Input area:**
- `--navy-lift` textarea, radius 12px, grows up to 100px
- Send button: 40 × 40px square, gradient, radius 12px

**Onboarding quick-reply chips** (shown during profile collection):
- Full-width row above input area
- Two equal-width pill buttons, `--blue-dim` background, radius 12px
- Glow focus ring on hover

---

### Health Tab

**Hero section:**
- Radial blue glow background
- 68px circular avatar (gradient fill, initial letter)
- Name + Bio Age / Chrono Age chips side by side
- Bio Age chip color: green (`#10b981`) if younger than chrono, red (`#ef4444`) if older, amber (`#f59e0b`) if close

**Profile section:** 2-column grid (90px label column + value column), 8px row gap

**Biomarkers section:** Flat list with colored dot indicator per marker

| Biomarker | Color |
|---|---|
| hsCRP | `#ef4444` (red) |
| GDF-15 | `#f97316` (orange) |
| IL-6 | `#a855f7` (purple) |
| Glycated Albumin | `#6375EC` (blue) |
| Cystatin C | `#0ea5e9` (sky) |
| CD38 | `#10b981` (green) |

**Trends section:** 2-column grid of cards, each with label, current value, and SVG sparkline

---

## Internationalisation

The app supports **English** and **Chinese (Simplified)**. Language is toggled on the login screen and set automatically from `user.language` after login.

All user-facing strings live in the `T` constant in `App.jsx`:

```js
T.en  // English strings
T.zh  // Chinese strings
```

**Localised display values:**

| Field | EN | ZH |
|---|---|---|
| Gender: male | Male | 男 |
| Gender: female | Female | 女 |
| Language: zh | Chinese | 中文 |
| Language: en | English | English |
| Date format | `en-US` locale | `zh-CN` locale |

---

## Onboarding Flow

If `user.gender` or `user.birth_date` is missing after login, the chat tab enters an onboarding state before allowing free chat.

**Step order:**
1. Greeting message
2. If gender missing → AI asks → quick-reply chips (Male / Female)
3. If birthday missing → AI asks → textarea with `YYYY-MM-DD` placeholder
4. Completion message → normal chat

Each step calls `PUT /api/users/{id}` and updates the local user state immediately. The Health tab reflects the new data without requiring a re-login.

---

## Animations

| Name | Usage |
|---|---|
| `dot-bounce` | Typing indicator and health loading dots |
| `spin` | Login button spinner during verification |
| Button hover | `translateY(-1px)` + brightness on primary buttons |
| Send button active | `scale(0.95)` |
| Quick-reply active | `scale(0.97)` |

All transitions use `0.18–0.2s` duration for a snappy, responsive feel.

---

## Key Files

| File | Purpose |
|---|---|
| `src/web/user-app/src/App.jsx` | All React components + i18n strings |
| `src/web/user-app/src/style.css` | All styles, CSS variables, layout |
| `src/web/user-app/src/main.jsx` | React root entry |
| `src/web/user-app/index.html` | HTML shell, viewport meta, Inter font |
| `src/web/user-app/public/favicon.png` | Browser tab icon (Waven logo) |
| `src/web/user-app/vite.config.js` | Build config, dev proxy to `nano.fros.cc` |
| `src/functions/user-app/index.js` | FC 3.0 static file server for production |
