# Waven Dots System

Waven Dots are 24 mg precision nutrition cartridges. Each cartridge delivers one or more active compounds in an exact dose, calibrated to the user's biomarker profile. The system targets four biological age dimensions measured by the Kino chip.

---

## Cartridge Format

- **Payload:** 24 mg per dot
- **Pack size:** 800 dots per cartridge
- **Timing:** Morning or Evening (fixed per dot — set by the `timing` column in the `dots` table)
- **Types:** Isolates (single active compound) and Blends (two or more actives)

---

## The Four Biological Age Dimensions

Each dot targets exactly one dimension. The dimension is stored in `dots.sub_age_target` and drives dot prioritization in the nutrition plan and health advice.

| `sub_age_target` value | Display (EN)       | Display (ZH) | Biomarkers            |
| ------------------------ | ------------------ | ------------ | --------------------- |
| `Cellular Age`         | Cellular Age       | 细胞年龄     | GDF-15, CD38          |
| `Metabolic Age`        | Metabolic Age      | 代谢年龄     | Glycated Albumin (GA) |
| `Micro-Vascular Age`   | Micro-Vascular Age | 微血管年龄   | Cystatin C            |
| `Resilience Age`       | Resilience Age     | 抗压年龄     | hsCRP, IL-6           |

---

## Complete Dot Formulary

### Cellular Age — DOT01–04, DOT06, DOT10

| Key   | Name              | ZH       | Timing  | Type    | Ingredients (40 mg payload)                                                                        |
| ----- | ----------------- | -------- | ------- | ------- | -------------------------------------------------------------------------------------------------- |
| DOT01 | Cellular Fuel     | 细胞原力 | Morning | Isolate | NMN 24 mg                                                                                          |
| DOT02 | Cellular Guard    | 细胞守护 | Evening | Isolate | Apigenin 24 mg                                                                                     |
| DOT03 | Cellular Catalyst | 细胞催化 | Morning | Isolate | Trans-Resveratrol 24 mg                                                                            |
| DOT04 | Cellular Cleanup  | 细胞净化 | Evening | Blend   | Fisetin 8.4 mg · Pterostilbene 6.9 mg · Taxifolin 6.6 mg · Spermidine 2.1 mg                    |
| DOT06 | Dermal Radiance   | 紧致焕颜 | Evening | Blend   | Elastin 6 mg · Sturgeon Collagen 6 mg · Collagen Tripeptide 6 mg · N-Acetylneuraminic Acid 6 mg |
| DOT10 | Morning Ignition  | 晨间引擎 | Morning | Blend   | Dynamine (Methylliberine) 12 mg · TeaCrine (Theacrine) 12 mg                                      |

**Mechanism:** DOT01 restores the NAD+ pool. DOT02 blocks CD38-mediated NAD+ degradation. DOT03 activates Sirtuin pathways synergistically with NMN. DOT04 clears senescent cells via autophagy induction (Spermidine) and senolytic action (Fisetin, Pterostilbene). DOT06 rebuilds the extracellular matrix. DOT10 provides jitter-free cognitive energy (onset ~15 min).

---

### Metabolic Age — DOT05, DOT07, DOT11

| Key   | Name                 | ZH       | Timing  | Type    | Ingredients (40 mg payload)                       |
| ----- | -------------------- | -------- | ------- | ------- | ------------------------------------------------- |
| DOT05 | Metabolic Resilience | 代谢韧性 | Morning | Blend   | Urolithin A 12 mg · Ca-AKG 12 mg                 |
| DOT07 | Metabolic Power      | 代谢动力 | Morning | Isolate | PQQ 24 mg                                         |
| DOT11 | Athletic Peak        | 巅峰体能 | Morning | Blend   | Cordyceps Militaris 12 mg · Rhodiola Rosea 12 mg |

**Mechanism:** DOT05 drives mitophagy (Urolithin A) and extends cellular lifespan via alpha-ketoglutarate (Ca-AKG). DOT07 stimulates mitochondrial biogenesis through PQQ. DOT11 raises VO2 max (Cordyceps) and ATP production under fatigue (Rhodiola). A cross-dimension coupling rule applies: when ResilienceAge score < 4 (severe inflammation), Metabolic Age scoring takes a 10% penalty — address inflammation first.

---

### Micro-Vascular Age — DOT08, DOT13, DOT14

| Key   | Name                | ZH         | Timing  | Type  | Ingredients (40 mg payload)                                                    |
| ----- | ------------------- | ---------- | ------- | ----- | ------------------------------------------------------------------------------ |
| DOT08 | Vascular Awakening  | 血管唤醒   | Morning | Blend | Beta-Alanine 15 mg · Niacin 6 mg · Methyl-B Complex 3 mg                     |
| DOT13 | Vascular Flow       | 微血管通流 | Morning | Blend | CoQ10 15 mg · Nattokinase 9 mg                                                |
| DOT14 | Vascular Protection | 微血管保护 | Morning | Blend | Vitamin D3 0.03 mg · Vitamin K2 (MK-7) 0.03 mg · MCT Powder Carrier 23.94 mg |

**Mechanism:** DOT08 induces mild paresthesia (Beta-Alanine tingle) and niacin flush — physical feedback confirming microvascular dilation — while supporting homocysteine clearance via methylation (Methyl-B). DOT13 reduces fibrin buildup (Nattokinase) and energizes the vascular endothelium (CoQ10). DOT14 ensures calcium is directed to bone not arteries (K2-MK7) and is fat-soluble, so MCT acts as the carrier.

---

### Resilience Age — DOT09, DOT12, DOT15–18

| Key   | Name                   | ZH               | Timing  | Type    | Ingredients (40 mg payload)                                                           |
| ----- | ---------------------- | ---------------- | ------- | ------- | ------------------------------------------------------------------------------------- |
| DOT09 | Resilience Support     | 抗压支持         | Morning | Isolate | Curcumin 24 mg                                                                        |
| DOT12 | Deep Sleep & Recovery  | 深度睡眠与恢复   | Evening | Blend   | Mag Threonate 6 mg · Mag Glycinate 6 mg · Ashwagandha Lactones 6 mg · Glycine 6 mg |
| DOT15 | Zen & Stress Resonance | 禅意与抗压共振   | Evening | Blend   | Kanna Extract (Zembrin) 12 mg · Saffron Extract 6 mg · Magnesium Glycinate 6 mg     |
| DOT16 | Resilience Defense     | 抗压防御         | Evening | Blend   | Glutathione 9 mg · NAC 6 mg · Milk Thistle 6 mg · L-Ergothioneine 3 mg             |
| DOT17 | Gut & Microbiome       | 肠道屏障与微生态 | Evening | Blend   | L-Glutamine 9 mg · Akkermansia 7.5 mg · Digestive Enzymes 7.5 mg                    |
| DOT18 | Immunity & Gastric     | 免疫与胃部防御   | Morning | Blend   | Liposomal Vit C 9 mg · EGCG 6 mg · Zinc Glycinate 4.5 mg · Zinc Carnosine 4.5 mg   |

**Mechanism:** DOT09 is the direct acute-phase hsCRP suppressor (Curcumin bioavailability requires formulation). DOT12 lowers core body temperature and evening cortisol for non-hormonal deep sleep (Mag Threonate crosses the BBB; Ashwagandha reduces cortisol). DOT15 produces rapid mood elevation and physical calm (Kanna/Zembrin acts on PDE4 and serotonin reuptake; Saffron on monoamines). DOT16 replenishes the master antioxidant trio (Glutathione, NAC precursor, Milk Thistle recycler) plus the longevity antioxidant L-Ergothioneine. DOT17 repairs the gut lining (L-Glutamine) and seeds the microbiome with Akkermansia. DOT18 provides front-line immune defense with bioavailable Vit C and dual-zinc gastric protection.

---

## Store Bundles

Bundles are sold as cartridge sets in the store (`store_items` table). Pricing reflects a ~14% discount on 6-packs and ~17% on the complete set versus individual cartridge price (¥500 / $70 each).

| Bundle               | `key_name`               | Contents                           | Price            |
| -------------------- | -------------------------- | ---------------------------------- | ---------------- |
| BioAge Reducing      | `set-cellular-age`       | DOT01–04, DOT06, DOT10            | ¥2,580 / $360   |
| Energy Boost         | `set-metabolic-vascular` | DOT05, DOT07–08, DOT11, DOT13–14 | ¥2,580 / $360   |
| System Optimization  | `set-resilience-age`     | DOT09, DOT12, DOT15–18            | ¥2,580 / $360   |
| Complete Collection  | `set-complete-18`        | DOT01–18                          | ¥7,500 / $1,050 |
| Individual cartridge | `DOTxx-cartridge`        | Single dot type, 800 dots          | ¥500 / $70      |

---

## Data Flow

```
Kino chip scan
  → BioAgeCalculator produces SubAges { CellularAge, MetabolicAge, MicroVascularAge, ResilienceAge }
  → stored in biomarkers.data.bioage_profile.SubAges
  → handlePostFormulaDots: scores each biomarker, assigns dot counts per dimension
  → dot_schedules table: morning_cup / evening_cup slots per day (7-day plan)
  → dots.sub_age_target: maps each dot to its dimension for health advice prioritization
```

## Database Schema (relevant columns)

```sql
-- dots table
dots (
  id              INT PRIMARY KEY,
  key_name        TEXT,          -- 'DOT01'–'DOT18'
  name            TEXT,          -- English name
  name_zh         TEXT,
  description     TEXT,
  ingredients     JSONB,         -- [{ name, mg, max_mg_per_day, ... }]
  ingredients_zh  JSONB,
  ingredients_summary TEXT,      -- short display string
  sub_age_target  TEXT,          -- 'Cellular Age' | 'Metabolic Age' | 'Micro-Vascular Age' | 'Resilience Age'
  sub_age_target_zh TEXT,
  group_name      TEXT,          -- 'BioAge Reducing' | 'Energy Boost' | 'System Optimization'
  group_name_zh   TEXT,
  timing          TEXT,          -- 'Morning' | 'Evening'
  color           TEXT,
  color_hex       TEXT,
  is_isolate      BOOLEAN,
  sort_order      INT
)
```

## Scoring & Dot Assignment

`_calcDotCounts()` in `worker/index.js` scores each biomarker 0–10 using a linear scale between its normal and elevated thresholds. Dots are assigned counts proportional to their dimension's score. The LLM (`systemNutrition` prompt) then refines per-dot counts within the 7-day schedule.

Reference ranges used for scoring:

| Biomarker  | Normal          | Elevated        | Dimension          |
| ---------- | --------------- | --------------- | ------------------ |
| hsCRP      | < 1 mg/L        | 1–3 mg/L       | Resilience Age     |
| IL-6       | < 3 pg/mL       | 3–6 pg/mL      | Resilience Age     |
| GDF-15     | < 750 pg/mL     | 750–1500 pg/mL | Cellular Age       |
| CD38       | ~1.0× baseline | > 1.0×         | Cellular Age       |
| GA         | < 15%           | 15–20%         | Metabolic Age      |
| Cystatin C | < 0.9 mg/L      | 0.9–1.2 mg/L   | Micro-Vascular Age |
