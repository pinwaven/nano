# Analysis rules — how to reason, what to recommend, what never to do

## Stance
The report is a synthesis a careful clinician-nutritionist would write after reading every file:
numbers with dates and units, sources named, disagreements surfaced, and recommendations that
follow from *this* person's data. It is explicitly not a diagnosis (say so on the cover verso and
in the appendix) and every supplement/dose is "discuss with your doctor".

## Read everything before writing anything
Do the extraction, download every document, read every text file and render the graphic pages,
and only then decide the story. The three real problems in Mary's report (vitamin D, NAD+, gut +
IgG) were invisible in the platform's own summaries and only emerged from the PDFs. Skimming the
first few documents and extrapolating is the failure mode to avoid.

## Cross-source reconciliation (the part that makes it trustworthy)
- List every measurement of the same marker across all sources on one axis, unit-converted.
- Where two sources disagree by more than assay noise, decide which to trust, say why, and put
  the decision on the 阅读指南 page. The usual culprit is a legacy `annual_lab` import.
- Where a platform record has no source document (`lab_api` epigenetics), present it but grade
  it B and say there is no PDF behind it.
- Old panels (2017 organic acids, hair elements) are "体质倾向" — show them, then ask whether
  today's data echoes them (it often does: yeast markers → today's yeast IgG; carnitine markers →
  today's NAD+ and fatigue). That echo is the finding, not the 2017 value.
- A lab's own "immune age 42" is a printed value; a Kino BioAge is a computed one. Chart them
  together but say which is which and how the computed one is computed (data-sources.md).

## What "priority" means
Rank problems by **certainty × intervenability**, not by how dramatic they sound: five concordant
vitamin D results outrank one striking genetic risk multiple. A genetics page should end with
"and here is the phenotype, which is fine" whenever that is true — "生活方式赢了基因" is a real
and motivating conclusion when the data supports it.

## Anti-aging framing
- Use the 12 hallmarks of aging (López-Otín 2023) as the organising table: hallmark · this
  user's evidence · status · strategy. Map the four Kino dimensions onto mechanisms
  (NAD+/sirtuins/mitophagy for 细胞; AMPK/glycation/muscle mass for 代谢; endothelial NO/Hcy/K2
  for 微血管; barrier/Treg/HPA axis for 抗压) and give each a **measurable target and recheck
  interval**.
- Explain every marker in two halves: what it does in aging biology (mechanism, why it rises
  with age) and what this person's value means. No mechanism without the person; no value
  without the mechanism.
- Never promise year-counts of rejuvenation. Frame targets as "move MetabolicAge toward the other
  three dimensions", "NAD+ into C grade in 3 months".

## Dots recipe rules (the formulary is in data/dots.json)
- **Every dot must be justified by a specific finding in this report** (a value, a genotype, a
  reported symptom) and the justification is printed in its row. If you cannot name the finding,
  leave the dot out — precision nutrition means not supplementing what isn't missing. List the
  excluded dots with reasons on the mechanisms page.
- Counts stay inside each dot's `target_dots_min`–`target_dots_max`; each capsule ≤ 72 dots;
  morning/evening per `timing`, and `timing_flexible=false` dots (N3 evening, N4/N12 morning)
  cannot move. N7 is a pulse (`dosing_protocol='pulse'`, 2 consecutive days per 28-day cycle,
  taken alone) — describe it as a protocol, never as a daily count.
- Show per-dot mg from `ingredients_zh`; you may total a single clinically meaningful ingredient
  (e.g. D3 IU/day) but do not invent elemental conversions you cannot verify.
- Mark which dots the user already holds (`user_cartridges`) and start the ramp with those: an
  unopened 800/800 cartridge is an adherence problem, and a 4-week ramp from 2 dots is more
  useful than a perfect 12-dot day-one plan.
- Diet/ethics flags: for a vegetarian/vegan, note D3 (lanolin vs lichen), K2 MK-7 (natto/soy
  origin), ceramides, CoQ10/NMN (fermentation), ergothioneine (mushroom); exclude fish oil and
  collagen. For an IgG-positive user, check ingredients against the positive foods.
- Compare against the platform's latest `nutrition_plans` proposal in a table (dot · platform ·
  yours · reason). The platform formulates from six Kino markers and two plan goals; you have
  read 22 documents — say that.

## Lifestyle and diet
- Exercise: read the exome exercise traits (VO2max response, power, injury/disc protection,
  recovery) and the wearable history; give a weekly structure with heart-rate zones and the
  genetic constraints spelled out.
- Sleep: derive the person's own dose-response from their wearable data (bedtime vs HRV/score)
  before quoting population advice. Caffeine/alcohol advice from CYP1A2/ALDH2 genotypes.
- Diet: honour `user_memory_facts` and self-reported restrictions absolutely (vegetarian, no
  alliums, religious rules). When IgG says avoid the person's main protein sources, provide the
  replacement matrix (protein/100 g, leucine, IgG class per source) and a 7-day menu that
  actually complies — that is the difference between advice and a plan.
- IgG: the report's own 戒断 tiers (class 3 ≥120 days then recheck; class 2 60–90 days; class 1
  rotate every 4 days). Frame it as a verifiable experiment with a recheck date, not a life
  sentence, and note IgG ≠ IgE.

## Follow-up calendar
Every recommendation that changes something gets a recheck: what, when, target value. Overdue
screenings (HPV/TCT, dental, eye) go first regardless of the report's theme.

## Doctor-facing page
Written for a physician: problem list in priority order with dates and reference ranges, the
latest full panel, pharmacogenomic drugs to check before prescribing, and an interaction warning
for the supplements you recommend (berberine ↔ CYP3A4/P-gp is the common one).

## Language and tone
Chinese unless told otherwise; the person's real name from the reports in the clinical summary,
nickname elsewhere if that is how the platform knows them. Address the reader as 您. No
marketing adjectives; no exclamation marks; numbers carry the emphasis.
