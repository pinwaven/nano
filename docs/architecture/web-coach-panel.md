# Web coach panel

Last reviewed: 2026-09-23. Web VERSION `0923-4`. Implemented and verified locally against dev;
the chat-parity update is not yet deployed. Earlier panel versions were deployed to
`nano-user-app-dev` at https://nano-dev.gcn.net/app/; changes remain uncommitted.

The user webapp (`src/web/user-app`) opens **Coach Panel** from the header menu for coaches.
It uses the signed-in coach's session and channel, just like the miniapp's `pages/coach`.
The admin panel remains a separate application.

## Opening the panel

1. Sign into the user webapp with a regular account holding the `coach` role.
2. Open the channel/logo header menu and choose **教练面板 / Coach Panel**.
3. Use the bottom tabs: **我的客户 / My Clients**, **邀请码 / Invite Codes**,
   **我的收益 / My Earnings**, **问卷 / Forms**, and **客户管理 / CRM**.
4. Tap the coach panel's header to return to your own health app. The refresh button reloads
   the list; returning to a visible browser tab also refreshes the coach data.

For local development, run `npm run start:user` from the repository root and open
`http://127.0.0.1:5178/`. Vite proxies `/api` to `https://nano-dev.gcn.net` by default.
The coach panel is an in-app route, not a separate `/coach` URL. It loads on demand so
ordinary users do not download its view and styles until it is opened.

Managed-customer creation appears only when the coach-users response returns
`managed_customers_enabled: true`. See [Managed Customers](managed-customers.md) for
channel configuration, staff provisioning, validation and release rules.

## Source and synchronization

`src/web/user-app/scripts/sync-coach-from-miniapp.mjs` generates four files under
`src/web/user-app/src/coach/generated/`:

- `controller.js`: the miniapp page's state, translations, validation and endpoint calls, inside a page-local factory.
- `tools.js`: the miniapp's shared tool actions inside a browser-injected factory.
- `View.jsx`: the coach WXML compiled to React elements and events. Expressions are compiled at build time; there is no runtime eval.
- `coach.css`: the coach WXSS converted from rpx to px and scoped under `.web-coach`.

`npm run dev` and `npm run build` in the user-app regenerate these files automatically.
`npm run sync:coach` regenerates them explicitly. `npm test` in that directory includes a
staleness check; do not edit generated output directly. If the miniapp adds a new WXML
component, add an explicit mapping and browser primitive in the generator.

The deployment shell scripts currently invoke `npx vite build` directly, bypassing npm's
`prebuild` hook. Before a separately authorized deployment, explicitly run
`npm run sync:coach --prefix src/web/user-app` and the checks below. Direct `npx vite build`
alone does not regenerate the coach files.

Browser-specific files are `CoachPanel.jsx`, `controller.js`, `primitives.jsx` and `coach.css`.
They adapt navigation, native date/select controls, modal text inputs, scrolling, clipboard,
file uploads and QR scanning. The existing web scanner uses the camera where supported and
accepts a pasted code otherwise. The webapp's existing BLE limitation remains: wearable
hardware operations require the miniapp; stored customer health data remains readable.

## Workflows

| Area | Behavior |
| --- | --- |
| Clients | Search, stage filters, profile/health sheet, managed badge, questionnaire answers, reminders |
| Managed customers | Create/edit identity, ask Viva as coach, code redemption with shipping, box activation |
| Client detail | Health, plans/programs, chat, notes, goals, personal facts |
| Invitations | Generate with note, edit note, copy link, deactivate |
| Earnings | Monthly pending amount, available balance, payout history |
| Questionnaires | Assign active onboarding/custom forms to selected clients; inspect answers |
| CRM | Stage pipeline, appointments, activity, KPIs; touch long-press, right-click or Shift+F10 moves a stage |

### Client chat parity

The browser client-detail chat mounts the same `ChatTab` and `useChat` implementation as the
signed-in user's regular chat. It therefore shares rich Markdown/card rendering, day separators,
older-history loading, voice input, toolbox actions, program/lesson cards, typing state and the
durable `chat_messages` catch-up poll. The miniapp coach view keeps its native implementation.

The signed-in coach session remains authoritative. For a managed customer, sending uses
`speaker: 'coach'` and `client: 'coach'`, so Viva answers the coach about that customer. For a
regular customer, sending uses `/coach-instruction`; it never impersonates the customer. Coach
mode reads `/chat-history` through the existing ownership gate. It reads `/notifications` only
for managed customers, who cannot log in, so async status updates match the user chat without
consuming a regular customer's destructive notification inbox. Formula purchase/submit CTAs
remain disabled in coach mode; managed-customer redemption and box activation stay in the coach
action row.

The miniapp currently exposes an appointment action without its WXML form. The web adapter
supplies that form using the existing appointment controller/API. Browser goal selectors
send the selected type string rather than the native selector index.

## Identity and authorization

Every API call still goes through the webapp's authenticated `api.js`; opening a client
never replaces the signed-in user or bearer. A missing coach record is repaired with
`/my-coach`, as in the miniapp. The backend remains responsible for channel and ownership checks.

The health sheet receives the selected client and coach ID explicitly. Self-only avatar,
profile and document-upload controls are hidden; report/document reads include coach scope.
Managed profile edits use `/managed-customers/:id`. Managed chat posts `speaker: 'coach'`
and `client: 'coach'` in the customer's context; regular clients use `/coach-instruction`.

The adapter rejects failed generic mutations so they cannot display success. Managed-customer,
redemption and box errors retain the miniapp's localized reason-code handling. Unmounting
stops Viva polling, suppresses late UI updates and prevents subsequent requests from that page.

## Maintenance map

All paths below are relative to `src/web/user-app/`.

| File | Responsibility |
| --- | --- |
| `src/shell/LogoMenu.jsx`, `src/App.jsx` | Menu entry, role gate and lazy-loaded route |
| `scripts/sync-coach-from-miniapp.mjs` | Compile the coach page and scope its styles |
| `src/coach/CoachPanel.jsx` | React lifecycle, event bridge, shared client-chat mount, visibility refresh, appointment form |
| `src/coach/controller.js` | Page-local browser services, authenticated requests, state patches, cleanup |
| `src/coach/primitives.jsx` | Scroll views, accessible native pickers, health/toolbox reuse, CRM long-press |
| `src/coach/coach.css` | Browser scrolling, safe layout, desktop notch clearance |
| `src/health/HealthTab.jsx` | Selected-client health view with explicit coach mode |
| `src/components/ui/ui.js`, `src/components/ui/UiHost.jsx` | Shared confirmations, editable invitation notes and scanner |
| `tests/coach.test.mjs`, `tests/chat-context.test.mjs` | Offline coach workflows, chat identity contracts and source synchronization |

Change shared coach copy, fields and visual styles in the miniapp source, then regenerate.
Changes under the miniapp directory also require its own VERSION bump. Keep browser-only
adaptations in the adapter files; do not put browser globals into the miniapp controller.

## Verification

Run from the repository root:

```sh
npm test --prefix src/web/user-app
npm run build:user
npm test
```

Live dev checks on 2026-09-23 used the SuperiorMed test coach ending **7931** in the browser
and WeChat DevTools. At 390px width, both managed forms have 168×46px name inputs,
350×46px pickers and a 692px panel. The footer accounts for each device's safe-area inset.
Mutation contracts are tested with offline fixtures; verification does not place real orders
or send messages to customers. Deployment is separate from building the web bundle.

### Recorded results — 2026-09-23

- Web production build passed. Vite still reports a size warning for the main application
  bundle; the coach panel itself is split into a separate lazy-loaded chunk.
- All **15** web coach tests passed, covering identity repair and role rejection, search,
  load failure, create/edit validation, managed versus regular chat, failed writes,
  assignable questionnaire types, program ownership, redemption shipping requirements,
  request timeout and page cleanup.
- All **1,057** existing repository tests passed; `git diff --check` passed.
- Live browser checks covered all five tabs, customer health and chat, managed-profile
  editing, plans/programs, notes/facts, goal selection, CRM stage selection and the
  appointment form. Forms were closed without saving test records or sending messages.
- Chinese and English, light and dark themes, and 320×640, 390×844 and 1280×900 browser
  viewports were checked. Date selection, the first gender option and body scrolling worked.
- Camera scanning, physical hardware, image-upload analysis and the complete live
  redemption-to-box-activation sequence were not exercised by this verification.
- Nutrition Customization was exercised from the browser coach chat against managed customer
  赵云. The focus sheet opened, “直接定制” submitted in the customer's context, async status
  updates arrived, and Viva returned the expected BioAge prerequisite response. The live test
  also exposed and fixed an optimistic-message echo that briefly showed the coach request twice.

### Troubleshooting

| Symptom | Check |
| --- | --- |
| Menu still opens the admin site | Confirm web VERSION `0923-1` or later; rebuild and reload the correct webapp environment |
| Coach identity cannot be resolved | Re-login; inspect `/my-coach` and the linked `coaches` row before assuming the customer list is empty |
| No managed-customer button | Inspect `managed_customers_enabled` and the coach's actual channel; the flag is server-derived |
| Web page differs after a miniapp edit | Run `npm run sync:coach --prefix src/web/user-app`, then build; never patch generated files |
| Cannot change a CRM stage | Long-press on touch, right-click on desktop, or focus the card and press Shift+F10 |
| QR camera unavailable | Use the scanner's manual/paste-code option; the same raw code goes to the existing API |
| Footer differs from DevTools | Compare content dimensions separately from OS/browser safe-area insets |

### Dev deployment — 2026-09-23

Deployed web VERSION `0923-1` after all 15 coach tests and 1,057 repository tests passed.
The public dev URL returned HTTP 200; its HTML, main JS/CSS and lazy coach JS/CSS
matched the local build byte-for-byte. Production was not deployed.

The normal deploy script was blocked during configuration parsing by missing
`TWIN_API_TOKEN` for the unrelated twin resource. Deployment succeeded using a temporary
configuration containing only the unchanged `user-app` resource and shared vars from
`s.yaml`, with an absolute code directory. No twin or worker deployment was performed.

## Channel-branded login links

The web login page supports `/app?channel=superiormed` (or another channel's `key_name`). It fetches `GET /api/channel-branding?key_name=superiormed` without a session and displays the returned channel name and inherited logo. Explicit URL branding takes precedence over the previous session's branding; missing or unknown channels and failed requests retain the normal login fallback. Existing numeric `id` lookups used by miniapp QR codes remain supported.

This is display-only: it does not assign users to a channel or override the channel returned on login. Signed-in visitors keep their account's channel. The worker endpoint update and web VERSION `0923-2` were deployed to dev on 2026-09-23. Verified `/app?channel=superiormed`, the public slug lookup (SuperiorMed), logo HTTP 200, and deployed asset hashes against the local build. Validation: 1,059 backend tests and 15 web tests passed. Production has not been updated.

Browser login always offers phone, email and WeChat regardless of landing-page branding (web `0923-3`). The email endpoint still applies its existing account eligibility checks.

## Production web deployment — 2026-09-23

Web VERSION `0923-3` deployed to `nano-user-app` at https://nano.gcn.net/app/. All 1,059 backend and 15 web tests passed; the public index and JS/CSS asset hashes match the local build. Only the webapp was deployed. Production `GET /api/channel-branding?key_name=superiormed` currently returns 401 Unauthorized, so URL-selected pre-login branding still requires the production backend update.

## Full production deployment — 2026-09-23

All resources in `s-prod.yaml` deployed after confirmed Curia cutover, including worker, dispatcher, agent, lab, Kino, media, admin panel, user app, twin and domain routing. Chat/coach simulators were rebuilt and admin redeployed. Applied the two dev-tested pending migrations: managed customers and phone OTP send log. All 1,074 tests passed. SuperiorMed branding now returns HTTP 200, all twin credential scopes pass, and web assets match the build. `DATABASE_URL_PROD` actually resolves to `nano_db` (verified with `current_database()`), matching the worker configuration; both required schema additions are present there. Earlier production branding limitation is resolved.
