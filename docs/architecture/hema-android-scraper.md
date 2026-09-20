# 盒马 catalog scraper — driving the Android app over adb

How the first grocery catalog (CLAUDE.md §46, `supplier_key='hema'`) was collected: a real
Android phone running the 盒马 app, controlled from the Mac over USB with `adb`, read through
Android's accessibility tree rather than screenshots. Script: [`temp/hema/scrape.py`](../../temp/hema/scrape.py).
Result: 6,286 products with price, unit, tags, every subcategory they appear in, and a 242 px
thumbnail each — 141 subcategories across 10 food categories, from the 徐汇·中凯城市之光名邸
(裕德路) store, 2026-09-17, ~7 hours of wall clock including interruptions.

Hema has no public product API and its app is a Weex/custom-rendered single-activity app
(`com.wudaokou.hippo`, `SplashActivity` for everything), so neither a web scrape nor a
conventional Android view hierarchy was available. What did work is below, in the order it was
discovered, with the dead ends kept so they are not retried.

## 1. Setup

- Phone: OnePlus PJZ110, Android 16, USB debugging on. First `adb devices` shows
  `unauthorized` until the phone's "Allow USB debugging" prompt is accepted.
- `adb` lives at `~/Library/Android/sdk/platform-tools/adb` (Android Studio's SDK); it was added
  to `PATH` in `~/.zshrc`. The script uses the absolute path (`ADB` constant), so it runs the same
  from any shell.
- Screen is **1080 × 2376**. Every coordinate in the script is for this device at this
  resolution; another phone means re-measuring the anchors in §3.
- Python 3.9 + Pillow (only for cropping thumbnails). No Appium, no uiautomator2 package — plain
  `adb shell` commands.
- The phone must stay unlocked, on the 盒马 app, and undisturbed. See §7.

## 2. Reading the screen: the accessibility tree

Screenshots alone are not enough — the product name, price and tags have to come out as text.
The app's Weex views are not real Android widgets, but they **do** populate the accessibility
tree (`content-desc` on most nodes, `text` on the TextViews), which is what makes this possible.

```bash
adb shell uiautomator dump --compressed /sdcard/ui.xml
adb exec-out cat /sdcard/ui.xml
```

- **`--compressed` is required.** A plain `uiautomator dump` is killed by the system on this app
  (the tree is too large) and returns an empty file. Compressed takes ~2.3 s and drops nothing the
  scraper needs.
- The dump is occasionally empty or truncated (mid-animation, or when a notification shade / call
  overlay is on top). `dump()` retries three times and returns `[]`; **callers never navigate on
  an empty dump** (see §6 for the bug that rule came from).
- Parse with `xml.etree`; every node has `class`, `text`, `content-desc`, `bounds` (`[x1,y1][x2,y2]`)
  and `clickable`. Python pitfall that cost an hour: an `Element` with no children is **falsy**,
  so checks must be `if node is None`, never `if not node`.

Screenshots (`adb exec-out screencap -p`) are used only to crop the product thumbnail from the
image box whose bounds the tree gives.

## 3. Category page anatomy

Everything happens on the 分类 tab. Measured layout (y grows downward):

| Region | Where | How it is recognised |
|---|---|---|
| Bottom nav 分类 | tap `(325, 2170)` | node with desc `分类，按钮` or text `分类` |
| Top category strip | y 247–438 | clickable FrameLayouts, desc `未选中，<name>` / `已选中，<name>` |
| 展开全部分类 button | tap `(1028, 342)` | desc `展开全部分类` |
| Category overlay | full screen when open | clickable LinearLayouts with desc `未选中，<name>`; the **selected one has the bare name** as desc; close via text `点击收起` |
| Left rail (subcategories) | x ≤ 242, y ≥ 430 | FrameLayouts with desc `未选中，<sub>` / `已选中，<sub>` |
| Product list | RecyclerView, x 242→1080, bottom 2088 | `find_list()`: RecyclerView with `x1 ≥ 240`, `x2 ≥ 1000`, height > 600 |

A product **row** is a clickable full-width FrameLayout inside the list. Within it:

- name — a TextView whose `text == content-desc`, at x > 500
- image — a FrameLayout 230–260 px wide at x < 300 (cropped from the screenshot)
- price — TextViews starting with `¥`, at **x > 500** (the x-bound matters: promo stickers on the
  image like `立省¥2.63` also start with ¥ and were being captured as the price)
- chips — any other described node at x > 500 except `加入购物车`; stickers on the image are
  kept with an `IMG:` prefix so the import can drop them
- only rows **fully inside** the list viewport are parsed, so a half-scrolled row is read on the
  next screen instead of with a clipped name

Price regex: `¥\s*([\d.]+)\s*(?:/|每)?\s*(\S*)` → price + unit (`¥7.99/盒`, `¥12.9每份`).

## 4. Moving around

`adb shell input tap x y` for taps; `keyevent 4` for back. Scrolling is the part that took
iteration:

- **`input swipe` flings.** A swipe with any speed keeps scrolling after the finger lifts, so the
  scroll distance is unpredictable and rows get skipped. Only used where distance does not matter
  (scrolling the rail or the overlay to an end).
- **The product list uses an exact-distance drag** built from raw motion events:
  ```
  input motionevent DOWN x y1; input motionevent MOVE x y1±40; input motionevent MOVE x y2; sleep 0.4; input motionevent UP x y2
  ```
  The small first MOVE gets past touch slop, the pause before UP kills the fling. A 1200 px drag
  scrolls ~1140 px; the list call is `drag(660, 1950, 750)` — under one viewport, so consecutive
  screens overlap and no row can fall between them. (A `drag(x, y1, x2, y2)`-style call once
  passed `750` as the `wait` argument and slept 12.5 minutes per screen. The signature is
  `drag(x, y1, y2, wait)`.)
- **Over-scrolling flips subcategories.** Pulling past the top or bottom of a list makes the app
  jump to the previous/next rail item. That killed the obvious "scroll to top first" step
  (removed) and became the end-of-list signal instead: after each screen the scraper reads the
  selected rail item and stops when it changes. A `None` (selection scrolled out of view in the
  rail) is *not* a flip.
- **Selecting a rail item must be verified.** The first attempt tapped and trusted; the first 167
  "叶菜/花菜" products were actually 热卖推荐, because the tap had landed during a rail animation.
  `select_rail()` now scrolls the rail to top, waits 1 s, taps only an item whose bounds are fully
  on screen (`y1 ≥ 430`, `y2 ≤ 2085` — the first item sits at y = 438, so `> 430` missed it), and
  re-dumps to confirm `已选中`. Three attempts, then the subcategory is skipped and logged.
- **Selecting a top category** opens the overlay and taps the item; if the item is already
  selected (bare-name desc) tapping does nothing and the overlay stays open, so it is closed with
  `点击收起` instead. Items below y 1850 are off the overlay's visible area — swipe it and re-dump.
- `ensure_category_page()` is the recovery routine: close a stray overlay, tap 分类 if on home,
  otherwise Back — at most 8 rounds, and only ever on a non-empty dump.

## 5. The walk, and why it is resumable

```
for category in CORE_CATS:            # 10 food categories, fixed list
    select_top_category
    subs = rail_all()                 # enumerate the rail by scrolling it
    for sub in subs (skip 热卖推荐 and anything in progress.json):
        select_rail(sub)
        loop ≤ 80 screens:
            dump → flip check → parse rows → add new products → save catalog.json
            2 screens with nothing new → done
            drag one screen
        mark (category, sub) done in progress.json
```

- `catalog.json` is keyed by whitespace-stripped name; `id = md5(name)[:12]`. A product seen in
  a second subcategory gets that pair appended to `categories` (3,305 of 6,286 sit in more than
  one), so the full membership is preserved. Saved after **every screen**, so a crash loses under
  a minute.
- `progress.json` records finished `(category, subcategory)` pairs; a re-run skips them. A
  subcategory that yields 0 products is deliberately **left undone** so it is retried next run
  (that is how the two first-item rail failures were backfilled later).
- Rail contents shift by time of day (餐饮熟食 vanished from the overlay in the evening —
  already scraped, no loss; 营养早餐 appeared under 快手菜面点 at night). A later re-scrape will
  see a slightly different set; that is expected and the import retires ids that disappear.
- `--details` opens each product page for description / 保质期 / variants / hero image.
  `scrape_detail()` is written against the detail-page anatomy (`返回，按钮`, `可选,…` variants,
  `保质期 …`, a long LinearLayout desc for the description, 1080×1080 hero) but **has not been
  run end-to-end** — list-level data was enough for the chat card. The hero crop may catch a
  video frame on products with a video.

## 6. Bugs that shaped the script

| Symptom | Cause | Fix |
|---|---|---|
| `uiautomator dump` returns nothing / "Killed" | tree too big | `--compressed` |
| Overlay stuck open after selecting a category | tapping the already-selected item is a no-op | detect bare-name desc, close with `点击收起` |
| `parse_rows` found no rows | childless `Element` is falsy | `is None` |
| Script pressed Back out of the app | acted on a transient empty dump | retry, never navigate blind |
| `立省¥2.63` stored as the price | sticker on the image starts with ¥ | price nodes must be at x > 500 |
| 12.5-minute pause per screen | `750` passed as `wait` | fixed call signature |
| 167 wrong products under one subcategory | rail tap not applied | verify `已选中` after tap, 1 s settle, bounds check |
| Scrape kept reading the hot list | scroll-to-top over-scrolled into the previous rail item | no scroll-to-top; rail-change = end of list |

## 7. Interruptions

The phone is a real phone. Over the run it received WeChat video calls, an incoming-call overlay,
a WeChat webview, a notification shade pull and a screen lock. Each makes the dump empty or
unrecognisable, and each was handled the same way: stop the scraper (a monitor watched
`scrape.log` for silence), let the user clear the phone, resume from the checkpoint. The scraper
never dismisses another app's UI, never unlocks the phone and never types into it — a Back press
during a call would be the wrong app's Back.

Practical numbers: ~7 s per screen (2.3 s dump, 1 s settle, drag, screenshot only when a new
product needs its thumbnail), 6–20 screens per subcategory, ~3 minutes per subcategory.

## 8. From scrape to database

```bash
python3 temp/hema/scrape.py                       # resumes from progress.json
node temp/import-supplier-catalog.js --supplier hema --dir temp/hema        # dev
node temp/import-supplier-catalog.js --supplier hema --dir temp/hema --env prod --skip-images
```

The import normalises what the list page mixed into the tags (delivery chips, promotions,
popularity counters, `,按钮` suffixes, `IMG:` stickers are all dropped), decides `is_food` from
subcategory and name (flowers, plants, alcohol out), converts the PNG thumbnails to 240 px JPEG
on OSS, and upserts by `(supplier_key, product_id)`. Images already on OSS are skipped on a
re-run, which is why `--skip-images` is right for prod once dev has uploaded them: the bucket is
shared.

## 9. Doing it again, or for another supermarket

- Same phone, same app: run the scraper as-is; delete `progress.json` for a full pass, or leave
  it to fill gaps.
- A different phone: re-measure the anchors in §3 (screen size, tab bar, 展开全部分类 button,
  rail width, list bottom) — everything else is relative to the tree.
- A different supermarket app: the approach transfers if the app exposes its content through the
  accessibility tree (check with one `uiautomator dump --compressed` on a product list). The
  recognisers in §3 will not — they are Hema's layout — but the walk, the checkpointing, the
  exact-distance drag and the "verify every selection" discipline are the reusable parts. Give it
  its own `supplier_key`; the import script and everything downstream are already generic.
