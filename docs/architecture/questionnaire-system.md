# Questionnaire System

Questionnaires are a general-purpose data-collection mechanism delivered natively inside the chat interface. **Onboarding** is a built-in questionnaire of type `onboarding`; all other questionnaires are of type `custom` and can be created by channel admins and assigned to users by coaches at any time.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Questionnaire** | A named template with an ordered list of questions. Scoped to a channel or global (NULL). |
| **Assignment** | A specific questionnaire given to a specific user. Tracks status (`pending` → `in_progress` → `completed`). |
| **Response** | A single answer to a single question within an assignment. Stored in `questionnaire_responses`. |
| **save_target** | An optional mapping that writes an answer directly to the user's profile fields (used by onboarding questions). |

---

## Database Schema

### `questionnaires`

Named form templates. One row per questionnaire.

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `channel_id` | INTEGER FK | Owning channel; NULL = global |
| `name` | TEXT | Display name (English) |
| `name_zh` | TEXT | Display name (Chinese) |
| `description` | TEXT | Optional description (English) |
| `description_zh` | TEXT | Optional description (Chinese) |
| `type` | TEXT | `onboarding` or `custom` |
| `created_by` | TEXT FK | User ID of creator; NULL = system |
| `is_active` | BOOLEAN | Soft-delete flag |
| `created_at` / `updated_at` | TIMESTAMPTZ | — |

### `questionnaire_questions`

Ordered questions within a questionnaire.

| Column | Type | Description |
|---|---|---|
| `id` | SERIAL | Primary key |
| `questionnaire_id` | INTEGER FK | Parent questionnaire |
| `key` | TEXT | Semantic identifier (e.g. `nickname`, `birth_date`) |
| `sort_order` | INTEGER | Display order (ascending) |
| `is_active` | BOOLEAN | Exclude from delivery when false |
| `input_type` | TEXT | UI widget — see Input Types below |
| `prompt_zh` / `prompt_en` | TEXT | Question text shown in chat |
| `save_target` | TEXT | `user_field`, `bio_data_field`, or `biomarker` — optional |
| `save_field` | TEXT | Column or JSON key to write to |
| `save_biomarker_type` | TEXT | e.g. `body_composition` (used when `save_target = biomarker`) |
| `completion_check` | JSONB | Rule for detecting if a question was already answered (backward compat) |
| `config` | JSONB | Input-type-specific options (options list, slider config, date range, etc.) |

### `questionnaire_assignments`

A specific questionnaire assigned to a specific user.

| Column | Type | On delete |
|---|---|---|
| `id` | SERIAL PK | — |
| `questionnaire_id` | INTEGER FK → `questionnaires.id` | CASCADE |
| `user_id` | TEXT FK → `users.user_id` | **CASCADE** — assignment deleted with user |
| `assigned_by` | TEXT FK → `users.user_id` | **SET NULL** — preserved if assigner deleted |
| `status` | TEXT | `pending` → `in_progress` → `completed` |
| `assigned_at` | TIMESTAMPTZ | — |
| `started_at` / `completed_at` | TIMESTAMPTZ | Set automatically |

### `questionnaire_responses`

Individual answers. One row per question per assignment.

| Column | Type | On delete |
|---|---|---|
| `id` | SERIAL PK | — |
| `assignment_id` | INTEGER FK → `questionnaire_assignments.id` | **CASCADE** — deleted with assignment |
| `question_id` | INTEGER FK → `questionnaire_questions.id` | CASCADE |
| `answer` | JSONB | string, number, array, or object depending on input type |
| `answered_at` | TIMESTAMPTZ | — |

Unique constraint on `(assignment_id, question_id)` — answers are upserted, not appended.

---

## Input Types

| `input_type` | UI Widget | `answer` format |
|---|---|---|
| `text` | Single-line text input | `"string"` |
| `button_select` | Row of tap buttons | `"value_string"` |
| `date_picker` | Native date picker | `"YYYY-MM-DD"` |
| `slider_group` | Multiple sliders in one step | `{ "height": 172, "weight": 65.5 }` |
| `multi_select` | Chip-style multi-select | `["option_key1", "option_key2"]` |

Each input type has a corresponding `config` JSONB structure:

**`text`**: `{ "placeholder_zh": "…", "placeholder_en": "…", "max_length": 30 }`

**`button_select`**: `{ "options": [{ "value": "male", "label_zh": "男", "label_en": "Male" }, …] }`

**`date_picker`**: `{ "min_date": "1920-01-01", "max_date": "2015-12-31" }`

**`slider_group`**: `{ "sliders": [{ "key": "height", "label_zh": "身高", "label_en": "Height", "unit": "cm", "min": 140, "max": 220, "step": 1, "default": 165 }, …] }`

**`multi_select`**: `{ "options": [{ "key": "diabetes", "label_zh": "糖尿病", "label_en": "Diabetes" }, …], "other_key": "health_conditions_other" }`

---

## Save Targets

When a question has a `save_target`, submitting an answer also writes to the user's structured profile. This is how onboarding data reaches the fields that the AI uses for personalization.

| `save_target` | Writes to | Example |
|---|---|---|
| `user_field` | `users` table column specified by `save_field` | `save_field: "nickname"` → `UPDATE users SET nickname = $1` |
| `bio_data_field` | `users.bio_data` JSONB key specified by `save_field` | `save_field: "health_conditions"` → `bio_data->'health_conditions'` |
| `biomarker` | New row in `biomarkers` table | `save_biomarker_type: "body_composition"` → inserts body composition record |

---

## Onboarding Questionnaire

The global default onboarding questionnaire (`type = 'onboarding'`, `channel_id = NULL`) is seeded at migration time. Its 5 questions match the previous hard-coded onboarding flow exactly:

| sort | key | input_type | save_target | save_field |
|---|---|---|---|---|
| 0 | `nickname` | `text` | `user_field` | `nickname` |
| 1 | `gender` | `button_select` | `user_field` | `gender` |
| 2 | `birth_date` | `date_picker` | `user_field` | `birth_date` |
| 3 | `body_composition` | `slider_group` | `biomarker` | — |
| 4 | `health_conditions` | `multi_select` | `bio_data_field` | `health_conditions` |

### Backward Compatibility

Existing users who completed onboarding before the questionnaire system was introduced already have answers stored in their user profile — not in `questionnaire_responses`. The `completion_check` JSONB on each question tells the miniapp where to look for an existing answer:

| `completion_check.type` | Check |
|---|---|
| `user_field` | `user[field]` is truthy |
| `bio_data_field` | `user.bio_data[field]` is not undefined |
| `biomarker` | A biomarker record exists with matching `test_type` and data path |

The miniapp checks `questionnaire_responses` first; if an answer is found there the question is skipped. If not, it falls back to the `completion_check` rule. This means existing users skip already-answered questions without being re-prompted.

---

## Delivery — Chat-Native Flow

Questionnaires are delivered inline in the main chat interface, not as a separate screen. The flow on miniapp init (`_initChat`):

```
1. GET /api/pending-questionnaires?openid={user_id}
   → Returns all non-completed assignments with full question lists + existing responses
   → Auto-creates onboarding assignment for new users if none exists
   → Onboarding assignment is always first in the list

2. GET /api/biomarkers (needed for biomarker completion check)

3. Walk pending assignments in order:
   For each assignment → walk questions in sort_order
   → _isQuestionAnswered(q, user, biomarkers, existingResponseIds)
   → First unanswered question found → start that questionnaire

4. Non-onboarding questionnaires show an intro AI message:
   "Your coach has sent you a few quick questions…"

5. Each question is shown as an AI chat message + the appropriate input widget.

6. On answer: POST /api/questionnaire-responses → advance to next unanswered question.

7. When all questions in an assignment are answered → check for next pending assignment.

8. When all assignments are done → show completion screen.
```

Partial completion is fully supported: assignments and responses are persisted per-question, so a user who closes the app mid-questionnaire resumes exactly where they left off on the next session.

### Real-Time Detection (`onShow`)

When a questionnaire is assigned while the user already has the chat open, the miniapp detects it the moment the user returns to the chat tab — without requiring an app restart.

`onShow` calls `_checkForPendingQuestionnaire()` whenever `obStep === 'done'`. This silently re-fetches pending questionnaires and starts the first unanswered one if found. Unlike `_advanceOnboarding`, it stops silently if nothing is pending (no duplicate completion messages or phone prompts).

---

## AI Integration

Completed questionnaire responses are automatically included in every AI chat prompt. The chat handler always fetches all completed responses for the user alongside the conditional biomarker/dots/plan fetches, then passes them to `formatQuestionnaireContext()`.

`formatQuestionnaireContext(rows, language)` groups responses by questionnaire name and formats them as a readable text block:

```
QUESTIONNAIRE RESPONSES (collected by care team):
[Food Preferences]
  What best describes your eating style?: Keto
  Any food allergies or intolerances?: Dairy, Gluten
  Which cuisines do you enjoy most?: Japanese, Mediterranean
  How many meals do you typically eat per day?: 3
  Any specific foods you want to avoid?: Processed sugar
```

This block is injected into five prompt templates (`casual`, `biomarker`, `nutrition`, `emotional`, `science`) as an optional section — it renders nothing when a user has no completed questionnaire responses. The `record` prompt is excluded as it only handles weight logging.

No code changes are required when new questionnaires are created or assigned — all responses flow into the AI context automatically.

---

## Channel Scoping

When the API is queried with a `channel_id`, it returns questionnaires belonging to that channel **plus** all global questionnaires (`channel_id IS NULL`). Querying with `channel_id=global` returns only globals. Querying with no filter returns all questionnaires.

This means global questionnaires (like onboarding and the built-in Food Preferences questionnaire) are always visible to all coaches regardless of their channel.

---

## Role-Based Access

| Role | Can do |
|---|---|
| **User** | Answers questionnaires delivered in their chat |
| **Coach** | Views active questionnaires (channel + global); assigns to their own clients; views responses for their clients |
| **Admin** | Full CRUD on questionnaires and questions; can assign to any user in their channel; views all responses |
| **Superadmin** | Full access across all channels |

Coaches cannot create questionnaires — only admins can. The server enforces coach ownership: a coach can only assign to users where `users.coach_id` matches their own coach record.

---

## Seeded Questionnaires

Two questionnaires are seeded out of the box:

| id | Name | Type | Scope | Questions |
|---|---|---|---|---|
| 1 | Onboarding / 入门问卷 | `onboarding` | Global | nickname, gender, birth_date, body_composition, health_conditions |
| 3 | Food Preferences / 饮食偏好 | `custom` | Global | dietary_style, food_allergies, cuisine_preferences, meal_frequency, foods_to_avoid |

The Food Preferences questionnaire writes all answers to `users.bio_data` via `save_target: bio_data_field`. Coaches can assign it to any user from the coach panel → Forms tab.

---

## User Deletion

When a user is deleted, all questionnaire data is cleaned up automatically by the database:

- `questionnaire_assignments` where `user_id = deleted_user` → **CASCADE deleted**
- `questionnaire_responses` within those assignments → **CASCADE deleted** (via assignment cascade)
- `questionnaire_assignments` where `assigned_by = deleted_user` → **preserved**, `assigned_by` set to NULL

No application-level cleanup is required. See [`user-deletion.md`](user-deletion.md) for the full deletion lifecycle.

---

## Component Map

| Component | File | Role |
|---|---|---|
| DB schema | `src/schemas/migration_questionnaire_system.sql` | Creates 4 tables + seeds onboarding |
| FK cascade fix | `temp/migration_questionnaire_fk_cascade.sql` | Adds ON DELETE rules to questionnaire FKs |
| Migration runner | `temp/run-migration-questionnaire-system.js` | One-shot schema runner |
| FK runner | `temp/run-migration-questionnaire-fk-cascade.js` | One-shot FK fix runner |
| Food Preferences seed | `temp/seed-food-preferences-questionnaire.js` | Seeds the built-in custom questionnaire |
| API handlers | `src/functions/worker/index.js` | All questionnaire endpoints + AI context formatter |
| Chat prompts | `src/functions/worker/prompts/chat/*.js` | Receive `questionnaire_context` (all except `record`) |
| Admin panel | `src/web/admin-panel/src/App.jsx` | Questionnaires tab (Builder + Assignments + Responses) |
| Miniapp chat | `src/mini/nano-miniapp/pages/main/main.js` / `main.wxml` | Chat-native delivery engine + `onShow` real-time check |
| Coach panel | `src/mini/nano-miniapp/pages/coach/coach.js` / `coach.wxml` | Assignment UI + response viewer |
