# Waven Nano — TODO

## Lab Service Purchase And Fulfillment _(planned)_

- [x] **Stage 1: Current-flow inventory** — Inspect `src/mini/nano-miniapp/`, `src/functions/worker`, `src/functions/lab`, payment integration, order/product tables, admin order visibility, and current detection flow. Produce the implementation map before changing behavior.
- [x] **Stage 2: Mini-program address management** — Add user address CRUD, default address support, order-time address selection, and add-address-then-resume-order behavior.
- [x] **Stage 3: Home lab service list** — Add a home-page lab service list call to the lab API while keeping the existing detection flow unchanged.
- [x] **Stage 4: Lab product multi-select checkout prep** — After selecting a lab, load products from `lab_products` by `lab_name`, display the goods list, allow multi-select, and collect phone/address before order submission.
- [x] **Stage 5: Worker order and transaction creation** — Add worker order creation that inserts `orders` as the summary record and `transactions` as purchase detail records linked to the order, including a source field for later status updates.
- [x] **Stage 6: Payment and admin fulfillment** — Call the payment interface, update paid statuses, show paid orders to `superadmin` and `admin` in `admin_panel`, and allow `superadmin` to add tracking numbers, ship, and update status.
- [ ] **Stage 7: Aliyun express integration** — Add Aliyun express service support, scheduled tracking status polling, express callback handling, and order logistics status synchronization.
- [ ] **Stage 8: Receipt confirmation and lab order flow** — Let users confirm receipt, then start detection from the mini-program order by scanning barcode, sampling, selecting fasting status, calling the lab order API with barcode, `user_id`, `lab_name`, goods, and fasting status, then synchronizing `transactions` and `orders` statuses.

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
