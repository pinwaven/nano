# Academy System

## Overview

The Academy is a structured learning system for coaches. Coaches progress through courses made up of lessons (video, text, or interactive case studies), earn credits for completing lessons and passing quizzes, and unlock certifications as they advance. A tier system translates credit totals into a visible rank. Admins curate the content library, define certifications, and assemble learning paths.

---

## Tier System

Tiers are computed on the fly from a coach's total credit balance — never stored. The helper `_getTier(totalCredits)` in `src/functions/worker/index.js` implements this:

| Tier | Min Credits |
|------|-------------|
| `foundation` | 0 |
| `intermediate` | 100 |
| `advanced` | 300 |
| `expert` | 700 |

---

## Database Schema

Migration file: `src/schemas/migration_academy_overhaul.sql`

### Extended existing tables

**`academy_courses`** — added columns:
- `credit_value INT DEFAULT 10` — credits awarded on course completion
- `level TEXT CHECK(foundation/intermediate/advanced/expert) DEFAULT 'foundation'`
- `prerequisite_course_id INT REFERENCES academy_courses(id) ON DELETE SET NULL`
- `thumbnail_oss_key TEXT`

**`academy_lessons`** — added columns:
- `content_type TEXT CHECK(video/text/interactive) DEFAULT 'video'`
- `text_content TEXT` — body text for text and interactive lessons
- `credit_value INT DEFAULT 5` — credits awarded on lesson completion
- `min_watch_seconds INT` — minimum video watch time before marking complete (video only)

**`academy_coach_progress`** — added columns:
- `credits_earned INT DEFAULT 0`
- `quiz_best_score INT` — highest score (0–100) across all attempts for this lesson
- `time_spent_seconds INT DEFAULT 0`

### New tables

**`academy_lesson_quizzes`** — quiz questions attached to a lesson:
- `lesson_id` FK → `academy_lessons`
- `scenario TEXT` — case study context paragraph shown before the question (optional)
- `question TEXT NOT NULL`
- `options JSONB NOT NULL` — array of `{text, is_correct, explanation}`; `explanation` shown only for the correct option after submission
- `sort_order INT DEFAULT 0`
- `credit_value INT DEFAULT 5` — credits awarded for answering this question correctly on a passing attempt

**`academy_quiz_attempts`** — one row per coach quiz submission:
- `coach_user_id TEXT`
- `lesson_id` FK → `academy_lessons`
- `answers JSONB` — `{question_id: selected_option_index}`
- `score INT` — 0–100 percentage of correct answers
- `passed BOOLEAN` — pass threshold is 70
- `credits_earned INT DEFAULT 0`

**`academy_credit_ledger`** — append-only credit event log (separate from the monetary `credit_ledger`):
- `coach_user_id TEXT`
- `amount INT`
- `reason TEXT` — one of `lesson_complete`, `quiz_pass`, `cert_earned`, `bonus`
- `ref_type TEXT` — `lesson`, `quiz`, or `certification`
- `ref_id INT`

**`academy_certifications`** — admin-defined certification definitions:
- `required_course_ids INT[]` — all listed courses must be completed to qualify
- `min_credits INT DEFAULT 0` — additional credit threshold
- `tier TEXT CHECK(bronze/silver/gold/platinum) DEFAULT 'bronze'`
- `badge_image_url TEXT`
- `is_active BOOLEAN DEFAULT TRUE`

**`academy_coach_certifications`** — certifications earned by coaches:
- `UNIQUE(coach_user_id, certification_id)` — prevents duplicate awards

**`academy_learning_paths`** — curated ordered sequences of courses:
- `tier TEXT CHECK(foundation/intermediate/advanced/expert)`
- `sort_order INT`
- `is_active BOOLEAN DEFAULT TRUE`

**`academy_learning_path_courses`** — junction table:
- `path_id` FK → `academy_learning_paths`
- `course_id` FK → `academy_courses`
- `sort_order INT`
- `UNIQUE(path_id, course_id)`

---

## Credit & Certification Logic

### Earning credits

1. **Lesson completion** (`POST /api/academy/progress`) — awards `lesson.credit_value` credits on first completion only. Inserts a row in `academy_credit_ledger` with `reason=lesson_complete`.

2. **Quiz pass** (`POST /api/academy/quiz-attempts`) — awards the sum of `credit_value` for each correctly answered question. Credits are awarded only on the first passing attempt for a given coach+lesson pair. Updates `academy_coach_progress.quiz_best_score` if the new score is higher.

3. **Certification award** — 50 bonus credits added automatically when a certification is earned.

### Certification auto-award

After every lesson completion or quiz submission, `_checkAndAwardCertifications(coachUserId)` runs:
1. Fetches all active certifications not yet earned by the coach
2. For each cert, checks whether all `required_course_ids` appear in the coach's `academy_coach_progress` (completed=true) and whether the coach's total credits meet `min_credits`
3. If eligible, inserts into `academy_coach_certifications` and appends a 50-credit `cert_earned` row to `academy_credit_ledger`

---

## API Endpoints

All paths are under `/api/` and require a Bearer token.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/academy/courses` | any | List courses with level, credits, prerequisite |
| `GET` | `/academy/lessons?course_id=X` | any | List lessons for a course — includes `content_type`, `has_quiz` boolean |
| `GET` | `/academy/lessons/:id` | any | Lesson detail + array of quiz questions |
| `GET` | `/academy/library` | any | List downloadable library items |
| `GET` | `/academy/certifications` | admin | All certification definitions |
| `GET` | `/academy/learning-paths` | any | Active learning paths with ordered courses |
| `GET` | `/academy/leaderboard` | any | Top 20 coaches ranked by total credits |
| `GET` | `/academy/coach-dashboard?coach_user_id=X` | any | Credits, tier, completed lessons, passed quizzes, cert count |
| `GET` | `/academy/coach-credits?coach_user_id=X` | any | Total credits, tier, last 50 ledger entries |
| `GET` | `/academy/coach-certifications?coach_user_id=X` | any | Earned certifications for a coach |
| `POST` | `/academy/courses` | admin | Create course |
| `PUT` | `/academy/courses/:id` | admin | Update course (including nullable `prerequisite_course_id`) |
| `DELETE` | `/academy/courses/:id` | admin | Delete course |
| `POST` | `/academy/lessons` | admin | Create lesson |
| `PUT` | `/academy/lessons/:id` | admin | Update lesson |
| `DELETE` | `/academy/lessons/:id` | admin | Delete lesson |
| `POST` | `/academy/progress` | any | Mark lesson complete — awards credits, triggers cert check |
| `POST` | `/academy/quiz-attempts` | any | Submit quiz answers → `{score, passed, credits_earned, correct_answers[]}` |
| `POST` | `/academy/lesson-quizzes` | admin | Create quiz question |
| `PUT` | `/academy/lesson-quizzes/:id` | admin | Update quiz question |
| `DELETE` | `/academy/lesson-quizzes/:id` | admin | Delete quiz question |
| `POST` | `/academy/certifications` | admin | Create certification definition |
| `PUT` | `/academy/certifications/:id` | admin | Update certification |
| `DELETE` | `/academy/certifications/:id` | admin | Delete certification |
| `POST` | `/academy/learning-paths` | admin | Create learning path |
| `PUT` | `/academy/learning-paths/:id` | admin | Update path + reorder courses (`course_ids` array sets order) |
| `DELETE` | `/academy/learning-paths/:id` | admin | Delete learning path |

---

## Admin Panel

`src/web/admin-panel/src/App.jsx` — `AcademyTab` component. Five subtabs:

| Subtab | What it does |
|--------|-------------|
| **Courses** | Course table with Level and Credits columns. Course modal adds level selector, credit_value, prerequisite dropdown. Lesson rows show content type icon, credits, quiz badge. Lesson modal adds content_type toggle (Video/Text/Interactive), text editor, credit_value, min_watch_seconds. Inline `QuizEditorSection` per lesson row for managing quiz questions. |
| **Library** | Existing library items — unchanged. |
| **Certifications** | Table of certification definitions with tier badge chip, required course count, active toggle. `CertificationModal` manages title, description, tier, required courses checklist, min_credits, badge URL. |
| **Paths** | Table of learning paths with tier, course count, active toggle, sort_order. `LearningPathModal` manages title, description, tier, ordered course list with up/down reordering. |
| **Progress** | Per-coach progress table with credits_earned and quiz_best_score columns. Side panel shows top-20 leaderboard ranked by total credits with tier badges. |

`TierBadge({ credits })` — colored chip: Foundation (gray) / Intermediate (blue) / Advanced (purple) / Expert (gold).

---

## Coach Mini-App

`src/mini/nano-miniapp/pages/coach/` — Training tab enhancements:

### Credit dashboard (top of Training tab)
Fetched from `GET /api/academy/coach-dashboard`. Displays:
- Total credits (large number)
- Tier badge
- Completed lessons count, passed quizzes count, certifications earned

### Learning paths
Fetched from `GET /api/academy/learning-paths`. Displayed as cards with tier label and a progress bar (completed courses / total courses in path).

### Lesson player

**Content routing** — after `trainingOpenLesson()` fetches `GET /api/academy/lessons/:id`:
- `content_type === 'video'` → presign OSS URL and play video
- `content_type === 'text'` or `'interactive'` → render `text_content` in a scrollable text block

**Quiz panel** — shown when `has_quiz: true`:
1. Case study scenario text (if present)
2. Multiple-choice question list with radio option buttons
3. Submit → `POST /api/academy/quiz-attempts` → shows score, pass/fail banner, and per-question explanations
4. Mark-complete button is only enabled after quiz passed (or no quiz exists)

### Certifications section
Fetched from `GET /api/academy/coach-certifications`. Grid of earned badge cards; certifications not yet earned are shown grayed out with a lock indicator.
