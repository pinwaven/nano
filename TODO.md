# Waven Nano — TODO

## Bugs

- [ ] **Web admin `KinoScanModal` posts the wrong field and misreports soft failures as success** (`src/web/user-app/src/tabs/HealthTab.jsx`) — `handleScan` POSTs `{ chip_code: code, openid }` to `/kino-scan`, but `handlePostKinoScan` (`src/functions/worker/handlers/kino.js`) expects `chip_id`, so the chip code never actually reaches the handler correctly. Separately, `handleScan` only distinguishes success/failure by whether the request threw — it never reads `response.data.status`, so any non-throwing response (`invalid_chip`, `used`, `already_linked`, and now `claimed_by_other`, see CHANGELOG "Kino chip scan silently reassigned ownership...") is shown to the admin as a generic success message. Found while fixing the related chip-ownership-reassignment bug; left unfixed since it's a separate, pre-existing defect in a different component.

## Security

- [ ] **Read-only DB user for worker/agent in production** — the NL2SQL `query_database` tool call in `handlePostChat` executes LLM-generated SQL against PolarDB. The application DB user should be granted `SELECT`-only on user-facing tables so a prompt injection or LLM error can't mutate data. Create a read-only PolarDB account, grant `SELECT` on `biomarkers`, `nutrition_schedules`, `reminders`, `chat_messages`, `dots`, `questionnaire_*`, and set it as `DB_USER` / `DB_PASS` for the worker and agent functions. The dispatcher and worker mutation paths (INSERT/UPDATE) should use a separate write-capable account.

## Coach Academy _(not yet implemented)_

Mandatory continuing education system for coaches, with a paid course model and title progression.

**Background:** Coaches provide health advice that complements AI; their competency and ongoing training is critical to service quality. Coaches pay for courses — this is also a revenue stream.

### Title Ladder (aligned with the 4 sub-age dimensions)

| Title | Requirement | Unlocks |
|---|---|---|
| Nano Associate | Foundation course, 0 specializations | Basic coaching tools |
| Nano Practitioner | 1 sub-age specialization + assessment | Featured in that specialty |
| Nano Specialist | 2–3 specializations + assessment | Priority user matching |
| Nano Expert | All 4 + practical review | Can mentor other coaches |
| Nano Fellow | Expert + 2 years active + peer review | Co-create courses, top referral tier |

### Specialization Tracks (maps to existing sub-age dimensions)
- Cellular Health
- Metabolic Health
- Micro-Vascular Health
- Resilience & Stress

### Payment Model
- Hybrid: Foundation course is required and paid; specialization tracks are à la carte after that.
- Reuse existing store/payment system.

### Reference Models
- **IFM** — tiered certs, mandatory CECs, annual recertification (most relevant)
- **NASM** — specialization tracks + continuing education credits
- **ACE** — multiple specialty certs simultaneously, each with own renewal clock
- **Harvard Extension** — pay-per-course, stackable certificates
- **Coursera** — peer-graded case study assessments (fits biomarker interpretation)

### Open Questions
1. Who creates/maintains course content — internal team or third-party instructors?
2. Live/physical component (workshops, webinars) or fully async?
3. Should a coach's title be visible to users in the mini-program?
4. What happens to a lapsed coach — lose system capabilities, or just the title?
5. Should channel admins see the academy status of their coaches?

### Existing Assets
- Online video courses already exist — need to be integrated into the academy structure.
