# End User Guide

This guide covers the WeChat Mini Program experience for everyday users — chatting with your AI health companion, testing your biomarkers, managing your personalized nutrition, joining health plan focuses, connecting a wearable ring, and using the store and learning content.

Some features vary by channel. If your channel is connected to **Aeviva**, you'll see an extra store checkout flow and a "Buy This Formulation" option that other channels don't have. Your AI companion's name and personality may also differ by channel (for example, some channels use "Nano," others use a different persona) — the features below work the same either way.

## Contents

1. [Getting Started](#getting-started)
2. [Chatting with Your AI Companion](#chatting-with-your-ai-companion)
3. [The Chat Toolbox](#the-chat-toolbox)
4. [Scanning a Kino Chip](#scanning-a-kino-chip)
5. [Your Health Tab](#your-health-tab)
6. [Connecting a Wearable Ring](#connecting-a-wearable-ring)
7. [Health Plans (Focuses)](#health-plans-focuses)
8. [Your Nutrition Plan (Dots)](#your-nutrition-plan-dots)
9. [Buying a Custom Formulation (Aeviva channels)](#buying-a-custom-formulation-aeviva-channels)
10. [The Store](#the-store)
11. [Learn: Academy & Box](#learn-academy--box)
12. [Notifications & Reminders](#notifications--reminders)
13. [Inviting Friends](#inviting-friends)
14. [Account & Settings](#account--settings)

---

## Getting Started

### Signing in

Opening the Mini Program signs you in automatically using your WeChat account — there's no separate password to create. Depending on how you arrived:

- **Via a channel's own QR code or menu**: you're signed in (or a new account is created) automatically.
- **Via an invite link or code** (from a friend, a coach, or an admin): the invite ties your new account to that person, and you'll be asked to verify your phone number right after signing up.
- **As a guest**: if no account/invite applies, you may land in **guest mode** — you can chat and browse, but data-driven features (Plans, Store, Learn) are locked behind account activation.

### Verifying your phone number

Brand-new accounts created through an invite or coach link are asked to verify a phone number (via a one-time SMS code) right after sign-up. This step confirms your health data is tied to you. You can also pick an avatar at this point (see [Account & Settings](#account--settings)).

If you skip verification, some actions (like using the Store) will prompt you to complete it later.

### Switching accounts / logging out

Opening the menu (tap the logo/header) and choosing **Logout** takes you to a "continue as previous account" screen the next time you open the app — you can resume your old session with one tap, or sign in with a different phone number if you need to switch accounts.

### Activating a guest account

If you're browsing as a guest, tap the lock icon on the Plans tab (or "Sign Up" in the menu) to open the activation sheet. Enter a valid invite code to unlock your full account — chat history, health data, and features start working immediately after activation.

### Answering onboarding questions

The first time you chat, your AI companion will ask a few quick questions (name, gender, date of birth, height/weight, and any relevant health conditions) to personalize your experience. These only need to be answered once.

---

## Chatting with Your AI Companion

The **Chat** tab is your home screen. Type a message (or use the microphone button to record voice) and your AI health companion will respond — answering questions about your biomarkers, nutrition, longevity science, or just having a casual conversation.

- Older messages load automatically as you scroll up, or pull down to fetch more history.
- Some replies take longer to generate (in-depth analyses). A status caption ("Building your research plan…") shows while it works — if it's taking a while, you'll still get a notification when it's ready, so it's safe to leave the app and come back later.
- A disclaimer at the bottom reminds you that responses are AI-generated and for reference only.

## The Chat Toolbox

Below the message box is a toolbox with quick-access tools:

| Tool | What it does |
|---|---|
| **Upload Image** | Send a photo — useful for lab/checkup reports. If the AI detects a lab report, it will ask whether it's your own and offer to save it to your Health tab. |
| **Use Kino Chip** | Opens your camera to scan a Kino chip's QR code (see [Scanning a Kino Chip](#scanning-a-kino-chip)). |
| **Formulate Dots** | Generates your personalized 7-day nutrition (Dots) plan from your latest biomarkers. |
| **Health Advice** | Asks your AI companion to analyze your current health data and give you personalized advice. |

Formulate Dots and Health Advice can take anywhere from a few seconds to a couple of minutes to fully generate (especially for more advanced AI companions). You'll see a "still working" message if it's taking a while, and a notification lands automatically once it's done — no need to keep the chat open and wait.

## Scanning a Kino Chip

The Kino chip is a single-use biomarker test that measures markers tied to your biological age.

1. In the chat toolbox, tap **Use Kino Chip**.
2. Scan the QR code printed on your chip.
3. Once registered, insert the chip into the Kino Analyzer device (at your clinic/partner location) to begin the test.
4. When the test finishes, your results appear automatically — your biomarkers, BioAge, and the four sub-ages update, and your AI companion can walk you through what changed.

Each chip can only be used once. If the QR code shows an error (already used, already registered to another account, or not a valid chip), the chat will explain what happened.

## Your Health Tab

The **Health** tab is your **Digital Twin** — the complete picture of your health that Waven builds and keeps up to date. It is not any single device or test: it has four layers, and the tab is organised around them. A strip at the top shows which layers currently have data.

### 1. Precision Testing

The high-precision layer, measured by the Kino chip.

- **BioAge** — your calculated biological age vs. chronological age, shown with a trend chart over time.
- **The Four Sub-Ages** — Cellular Age, Metabolic Age, Micro-Vascular Age, and Resilience Age each get their own score and a short description of what they measure.
- **Latest Biomarkers** — the raw values from your most recent Kino test (hs-CRP, GDF-15, IL-6, Glycated Albumin, Cystatin C, CD38), plus your test history.

### 2. Daily Monitoring

The continuous layer, synced from your wearable ring or band: sleep, activity, vitals (heart rate, HRV, SpO₂, blood pressure, temperature), and body composition, as rolling averages and trends. See [Connecting a Wearable Ring](#connecting-a-wearable-ring).

### 3. Medical Records

Lab and checkup reports from outside Waven — annual physicals, blood panels, imaging, doctor's notes. Markers are flagged as normal/high/low against reference ranges. Reports arrive here in three ways: photographed and uploaded in chat, imported directly from a connected lab, or imported as a FHIR record. Values that overlap with the Kino panel also feed your BioAge.

### 4. Personal Profile

What you've told us about yourself, rather than what a device measured.

- Your name, gender, date of birth, height/weight/BMI, coach (if assigned), and any noted health conditions. Tap **Edit Profile** to update these, or tap your avatar to pick a new one from the [avatar gallery](#account--settings).
- Your questionnaire answers.
- **Things you've mentioned in chat** — dietary restrictions, allergies, preferences and goals the AI has noted are listed here so you can see what it remembers about you. This list is read-only; to correct something, just say so in chat.

## Connecting a Wearable Ring

Only **Halo** rings (also sold as X3/X6/X9, and the V4 band) and **V8** smart bands are currently supported.

1. On the Health tab, find the **Wearable Device** section and tap **Bind Smart Ring**.
2. The app scans for nearby devices — make sure your ring/band is powered on and nearby.
3. Select your device from the list to connect and bind it to your account.
4. Once bound, tap **Sync Now** any time to pull the latest data, or let it sync automatically.
5. You can adjust monitoring intervals (how often the ring measures HR, SpO₂, etc.) and save them back to the ring.
6. To disconnect, tap **Unbind**.

Once connected, your steps, sleep, heart rate, HRV, stress, SpO₂, temperature, and (on supported rings) blood pressure all feed the **Daily Monitoring** layer of your Digital Twin.

## Health Plans (Focuses)

A **Health Plan** (referred to as a "focus" in this guide) is a structured, multi-week program targeting a specific goal.

- **Joining a plan**: On the **Plans** tab (inside Plans + Dots), tap **+ Join Plan** to browse available plans, then choose to join as your **Primary** or **Secondary** focus. If a slot is already taken, you'll be asked whether to replace the existing plan.
- **Plan details**: Tapping a plan card opens tabs for **Overview** (goal, target sub-ages, recommended dots, start date), **Progress** (adherence percentage and BioAge change vs. your baseline), **Activities** (any linked events), and **Guidance**.
- **Daily check-in**: Each plan can have daily tasks — taking your dots, logging your weight, or answering a short daily questionnaire (energy, sleep, mood). Complete them from the plan card to mark today's check-in done.
- **Switching primary/secondary**: From a plan's detail view, tap **Switch Type** to swap which plan is your primary focus.
- **Abandoning a plan**: Tap **Abandon Plan** to leave it — you can always rejoin later.
- **Reminders**: Each plan can have its own reminders, which you can pause or resume from the plan detail view.

## Your Nutrition Plan (Dots)

The **Dots** sub-tab (inside Plans + Dots) shows your personalized 7-day nutrition schedule, generated from your biomarkers via the **Formulate Dots** chat tool. Each day is broken into a morning and evening dose; use the week navigation arrows to look at other days.

If you have a Neo dispenser bound to your account, this tab also shows your loaded cartridges and lets you dispense today's dose directly. (If no dispenser is bound, some channels — see below — let you order pre-mixed dot capsules from the Store instead.)

## Buying a Custom Formulation (Aeviva channels)

If your channel is connected to **Aeviva**, and you've generated a Dots formulation while a health plan focus is active, that plan's detail view shows a **Buy This Formulation** button under a "Your personalized formulation is ready" section, listing exactly which dots and quantities were formulated for you. Tapping it opens the Aeviva store to purchase that exact recipe (you'll be asked to verify your phone number first, if you haven't already).

If you haven't formulated dots yet for the active focus, you'll instead see a hint pointing you to the **Formulate Dots** tool in the chat toolbox.

## The Store

(Hidden in guest mode — activate your account first.)

- Browse products under the **Products** sub-tab; some items have size/variant options.
- Add items to your cart, then tap the cart bar to review and check out.
- At checkout, provide a recipient name, phone number, and shipping address (or use your saved WeChat address).
- If you don't have enough credits for an order, you'll be told exactly how many more you need.
- Track past orders under the **Orders** sub-tab — pending orders can be cancelled, and shipped orders show a tracking number you can copy.
- Your credit balance is shown at the top of the Store tab and in the menu.

## Learn: Academy & Box

The **Learn** tab (hidden in guest mode) has two sections:

- **Academy** — courses and learning paths, each with lessons and (where provided) short quizzes. Completing lessons earns credits; some courses unlock certificates you can view and download. A status card shows your tier, total credits, completed lessons, and certificate count.
- **Box** — reference material: guided audio (e.g. sleep tracks), videos, and documents, plus (where available) a download link for a companion device app.

## Notifications & Reminders

Reminders set by you, your coach, or your AI companion appear under **Upcoming Reminders** on the Plans tab. Longer-running AI tasks (Formulate Dots, Health Advice, and some chat replies) deliver their result as a notification once ready, even if you've since left the chat screen — check back and it'll be waiting in your conversation.

## Inviting Friends

Open **Invite Friends** from the menu to find your personal referral code. Share your invite card via WeChat; when a friend signs up through your link, they're linked to you, and you earn credits whenever they make a purchase. Credits can later be requested for withdrawal.

## Account & Settings

From the menu (tap the header/logo):

- **Light/Dark Mode** — toggle the app's color theme.
- **Language** — switch between Chinese and English; all content re-renders in the selected language.
- **Avatar** — pick from a gallery of pre-made character avatars (Health tab, tap your avatar or "Edit Profile"). There's no photo upload — everyone chooses from the gallery instead.
- **Logout** — signs you out to the "continue as previous account" screen.

If you're also a **coach**, **channel admin**, or **superadmin**, you'll see extra menu entries (Coach Panel, Channel Admin, Super Admin) — see the [Coach Guide](coach-guide.md) and [Admin Guide](admin-guide.md).
