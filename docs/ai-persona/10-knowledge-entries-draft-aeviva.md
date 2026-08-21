# Knowledge Entries Draft — Aeviva/Viva, Sourced From Real Prod Questions

**Status: proposal, not shipped.** Unlike docs 01–09 in this directory, this file does not describe committed code — it's a batch of candidate `knowledge_entries` rows (see [05-knowledge-base.md](05-knowledge-base.md)) drafted for human review. Nothing here has been inserted into the DB. Every entry is written with `status: draft` and no `reviewed_by` — the schema and admin panel already refuse to serve a row with `status='active'` and no reviewer, so these are inert until someone signs off via the Knowledge tab.

## Sourcing methodology

Queried prod (`DATABASE_URL_PROD`, read-only, no writes) for every `chat_messages` row with `role = 'user'`, `persona_type = 'viva'`, joined through `users` → `channels` for `channels.key_name IN ('aeviva', 'aeviva-china')`: **1,470 real user messages**, 2026-05-24 through 2026-08-20. Read a representative sample of ~950 spanning the full date range (not just the most recent window).

**Privacy:** everything below is a synthesized theme, not a quote. The raw sample contained at least one phone number and one full name typed as free text in the chat box — real PII passes through this channel — so no verbatim message, and nothing that could identify a specific user, appears anywhere in this file or was used to write the entries below.

## What real questions show that the existing 14 entries don't cover

The current KB (1 essential guardrail row + 13 optional rows: 5 TCM-gene-variant, 4 nutrition-protocol, 4 longevity-science) is science trivia. It does not touch the things users actually ask about most:

| Theme | Approx. signal in the sample | Example asks (paraphrased, not quoted) |
|---|---|---|
| "What is [biomarker]? What's the normal range?" | Largest single category — dozens of hits per biomarker | CD38, GDF-15, IL-6, hsCRP, GA, Cystatin C |
| "What is [sub-age]? Why is mine high? How do I fix it?" | Very frequent | CellularAge / MetabolicAge / MicroVascularAge / ResilienceAge |
| "Can I eat X?" | Large long tail, one-off foods | wood ear fungus, snow frog fat, fish maw, chives, red yeast rice, offal, jellyfish, honey, oats... |
| Dot/原粒 composition & dosing | Very frequent, especially August | "what's in D01–D18/N1–N18", full ingredient dumps requested |
| TCM: acupuncture points, moxibustion, solar terms | Distinct recurring cluster | moxibustion timing/contraindications, specific meridian points, "what solar term is it today" |
| Trust / methodology pushback | Recurring, pointed | "6 biomarkers can't predict 5 ages, can they?", "why did my two tests disagree?", "you said insulin resistance but there's no HOMA-IR in my panel" |
| Deep chronic-condition threads | One ~25-message thread went very deep | Hepatitis B carrier (iron overload, "can a supplement kill the virus", fatty liver) — the single deepest and highest-stakes thread found; also hypothyroidism, sleep apnea, uterine fibroids/menstrual irregularity |
| Sleep: 2–4am waking | Recurring, often phrased in TCM terms | meridian-clock framing of early waking |
| Polypharmacy audits | Recurring | long supplement/medication lists, "which of these overlap or conflict" |

Not included below: "请分析我目前的健康状态，并给我专业的健康建议" (the single most-repeated literal message in the sample) — that validates the existing PLAN→GENERATE flow's job, it isn't a knowledge-content gap.

---

## Proposed entries

All rows: `persona_type: viva`, `tier: optional`, `status: draft`, `reviewed_by: null`, `last_reviewed: null`, `sort_order: 0` unless noted. `evidence_level` uses the same 5-value set the admin panel already offers (`rct`, `meta_analysis`, `observational`, `mechanistic_plausible`, `insufficient`).

### Category: `biomarker_reference`

Reference ranges below are copied verbatim from CLAUDE.md §11 (the canonical source) — nothing here is invented.

#### `biomarker-hscrp-reference`
- **topic:** `["hsCRP", "hs-crp", "超敏C反应蛋白", "C反应蛋白", "炎症指标", "抗压年龄"]`
- **evidence_level:** observational

**content_zh:**
> 超敏C反应蛋白（hs-CRP）是评估全身低度炎症水平的常用血液标志物，也是抗压年龄（ResilienceAge）的两项输入指标之一。参考区间：<1 mg/L 为正常，1–3 mg/L 为轻度升高，>3 mg/L 提示存在较高水平的系统性炎症。数值越高，说明身体长期处于炎症负担之下，可能与压力、睡眠不足、感染、肥胖或慢性疾病有关。单次数值偏高不代表确诊某种疾病，需结合其他指标及临床病史综合判断；若持续显著升高，建议咨询医生进一步排查。

#### `biomarker-il6-reference`
- **topic:** `["IL-6", "IL6", "白介素6", "白细胞介素6", "炎症因子", "抗压年龄"]`
- **evidence_level:** observational

**content_zh:**
> 白介素-6（IL-6）是一种促炎细胞因子，与hs-CRP共同构成抗压年龄（ResilienceAge）的评分依据。参考区间：<3 pg/mL 为正常，3–6 pg/mL 为轻度升高，>6 pg/mL 提示炎症水平较高。IL-6短期波动可能与近期感染、剧烈运动、睡眠质量或情绪压力有关，长期偏高则与慢性炎症负担相关。该指标本身不能单独诊断具体疾病。

#### `biomarker-gdf15-reference`
- **topic:** `["GDF-15", "GDF15", "生长分化因子15", "细胞年龄", "衰老因子"]`
- **evidence_level:** observational

**content_zh:**
> GDF-15（生长分化因子15）反映细胞层面的应激负担，是细胞年龄（CellularAge）的核心输入指标之一。参考区间：<750 pg/mL 为正常，750–1500 pg/mL 为轻度升高，>1500 pg/mL 提示细胞衰老相关应激较为明显。GDF-15会随年龄自然上升，也会因线粒体应激、慢性炎症或某些疾病状态而升高，是较为敏感但非特异性的衰老相关标志物。

#### `biomarker-cd38-reference`
- **topic:** `["CD38", "NAD+", "NAD", "烟酰胺", "消耗酶", "细胞年龄"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> CD38是一种NAD+消耗酶，其活性水平（以基线1.0倍数表示）是细胞年龄（CellularAge）的另一项输入指标。基线约为1.0倍，数值每高出1.0一定幅度，代表NAD+被消耗的速度更快，理论上会加速与NAD+相关的细胞代谢与修复过程衰退。目前没有像hs-CRP/GDF-15那样明确分段的参考区间，解读时应结合个体基线变化趋势，而非套用固定切点。

#### `biomarker-ga-reference`
- **topic:** `["糖化白蛋白", "GA", "血糖", "代谢年龄", "血糖代谢"]`
- **evidence_level:** observational

**content_zh:**
> 糖化白蛋白（GA）反映近2-3周的平均血糖控制水平，是代谢年龄（MetabolicAge）的核心输入指标。参考区间：<15% 为正常，15–20% 为轻度升高，>20% 提示代谢功能紊乱风险较高。需注意：当抗压年龄评分较低（提示炎症负担较重）时，代谢年龄评分会额外承受约10%的耦合惩罚——这是因为长期炎症会加速代谢功能紊乱，这也是为什么改善抗压/炎症状态有时能连带改善代谢年龄表现。

#### `biomarker-cystatinc-reference`
- **topic:** `["胱抑素C", "Cystatin C", "肾功能", "微血管年龄", "肾小球滤过率"]`
- **evidence_level:** observational

**content_zh:**
> 胱抑素C（Cystatin C）反映肾小球滤过功能及微血管健康状况，是微血管年龄（MicroVascularAge）的核心输入指标。参考区间：<0.9 mg/L 为正常，0.9–1.2 mg/L 为轻度升高，>1.2 mg/L 提示血管/肾脏功能存在一定压力，最优参考阈值约为0.68 mg/L。该指标升高可能与微循环灌注不足、肾脏负担增加或年龄相关血管弹性下降有关，若同时伴有其他肾功能指标异常，建议就医评估。

---

### Category: `subage_dimension`

#### `subage-cellular-age-explained`
- **topic:** `["细胞年龄", "CellularAge", "细胞衰老"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 细胞年龄（CellularAge）反映细胞层面的活力状态，主要由GDF-15（细胞应激负担）和CD38（NAD+消耗速率）两项指标综合计算。细胞年龄偏高，通常意味着细胞层面的能量代谢（NAD+相关通路）与修复能力有所下降，可能表现为容易疲劳、恢复变慢等。改善方向包括：规律作息、减少慢性炎症来源、避免长期熬夜和过度饮酒等消耗NAD+的行为；对应的原粒配方以NMN、CD38抑制剂、白藜芦醇、清除衰老细胞的复合成分及胶原基质为主。

#### `subage-metabolic-age-explained`
- **topic:** `["代谢年龄", "MetabolicAge", "代谢"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 代谢年龄（MetabolicAge）反映身体的供能效率与线粒体代谢通量，核心依据是糖化白蛋白（GA）。代谢年龄偏高，通常提示近期血糖控制欠佳或代谢负担较重，可能与饮食结构（精制碳水/糖分偏高）、久坐、睡眠不足或慢性炎症（见抗压年龄的耦合惩罚机制）有关。改善方向包括：调整进食顺序（先菜后主食）、规律运动（尤其是中低强度有氧）、控制精制糖摄入；对应原粒配方以尿石素A+α-酮戊二酸、PQQ、虫草红景天复合为主。

#### `subage-microvascular-age-explained`
- **topic:** `["微血管年龄", "MicroVascularAge", "血管年龄", "微循环"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 微血管年龄（MicroVascularAge）反映毛细血管健康状况及向组织输送营养/氧气的效率，核心依据是胱抑素C。数值偏高，通常提示微循环灌注可能不足，长期可能与皮肤暗沉、四肢发凉、运动耐力下降等主观感受相关（这些属于身体信号的合理关联，不构成诊断）。改善方向包括：规律的有氧运动、避免久坐、充足饮水；对应原粒配方以血管唤醒复合（β-丙氨酸+烟酸+甲基化B族）、CoQ10+纳豆激酶、D3+K2+MCT为主。

#### `subage-resilience-age-explained`
- **topic:** `["抗压年龄", "ResilienceAge", "抗炎", "压力"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 抗压年龄（ResilienceAge）反映身体缓冲慢性压力、抑制系统性炎症的能力，由hs-CRP和IL-6共同计算。数值偏高，通常提示身体长期处于低度炎症或压力负荷之下，可能与睡眠质量差、长期精神压力、感染或代谢紊乱有关。抗压年龄还会影响代谢年龄的评分（耦合惩罚机制），因此改善炎症状态往往能带来多重收益。改善方向包括：规律优质睡眠、压力管理（冥想/呼吸训练）、抗炎饮食；对应原粒配方以姜黄素、深度睡眠复合、南非醉茄+藏红花、谷胱甘肽+NAC、肠道菌群及免疫相关配方为主。

---

### Category: `methodology_trust`

These two directly target the recurring skepticism/pushback pattern in the sample.

#### `methodology-six-biomarkers-to-bioage`
- **topic:** `["六项指标", "6个指标", "准确性", "为什么", "检测差异", "两次检测", "方法"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 系统通过6项指尖血指标（hs-CRP、IL-6、GDF-15、CD38、糖化白蛋白GA、胱抑素C）计算生物年龄及四个维度的子年龄，这6项指标是经过筛选的、与特定衰老通路有明确机制关联的生物标志物（分别对应炎症/抗压、细胞应激、代谢、微血管四个方向），而不是随机挑选的通用体检指标。需要坦诚说明：这是一种基于有限生物标志物的间接推算模型，不等同于全面的临床衰老评估，结果应作为长期趋势参考，而非唯一诊断依据。两次检测结果存在差异是正常现象，可能受采血时间、近期饮食/饮酒/睡眠状况、感染或运动等因素影响而产生生理性波动，并不一定代表检测错误。如果用户对某次结果有疑问，应如实说明这属于正常的生物学变异范围，并建议保持规律检测节奏观察趋势，而不是断言某次结果一定准确或一定有误。

#### `methodology-insulin-resistance-clarification`
- **topic:** `["胰岛素抵抗", "HOMA-IR", "糖化白蛋白", "代谢年龄"]`
- **evidence_level:** insufficient

**content_zh:**
> 本系统的6项检测指标中不包含空腹胰岛素、空腹血糖或HOMA-IR，因此不能直接诊断或量化"胰岛素抵抗"。糖化白蛋白（GA）反映的是近2-3周的平均血糖水平，是代谢年龄评分的依据，但血糖控制欠佳只是胰岛素抵抗可能的表现之一，二者不能划等号。当用户的代谢年龄偏高或GA数值偏高时，只能说明"存在代谢功能紊乱的迹象"，不应表述为"检测出胰岛素抵抗"或给出具体的胰岛素抵抗分型（如"肝脏型胰岛素抵抗"）——这类具体诊断需要HOMA-IR、空腹胰岛素等专项检测，应建议用户如有相关担忧，可就医补充检测。

*(Found live: a real user correctly caught the model implying insulin resistance without the data to support it, then asked the model to classify a specific subtype. This entry exists to stop that specific overreach.)*

---

### Category: `food_compatibility`

General rules, not a per-food list — individual foods are an unbounded long tail (~20+ distinct foods asked about by name in the sample alone).

#### `food-compat-fermented-and-allergen-foods`
- **topic:** `["黑木耳", "雪蛤", "鱼胶", "海蜇", "发酵", "过敏", "能不能吃", "可以吃吗"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 针对"某个具体食物能不能吃"类问题，无法对每一种食材给出穷举式的允许/禁止清单，但可参考以下通用原则：发酵类、菌菇类、胶质类食材（如黑木耳、雪蛤、鱼胶、海蜇等）本身营养价值因人而异，关键在于个体是否有食物不耐受、过敏史或特定消化系统敏感（结合用户已记录的饮食限制/过敏信息）。若无已知不耐受或过敏史，且用户没有炎症、代谢或消化系统方面的高风险指标，这类食材通常可以适量食用；若用户已提示消化功能较弱、慢性肠道问题或食物不耐受史，应建议减量试吃并观察反应，而不是直接判定"能"或"不能"。回答具体食物问题时，应优先结合用户当前的生物年龄画像和已记录的饮食限制给出个性化建议，而不是给出脱离个体情况的通用结论。

#### `food-compat-high-purine-fat-meats`
- **topic:** `["红肉", "内脏", "护心肉", "红曲米", "饱和脂肪", "嘌呤"]`
- **evidence_level:** observational

**content_zh:**
> 红肉及动物内脏类食材（如护心肉等）富含饱和脂肪与嘌呤，长期大量摄入与胰岛素敏感性下降、炎症水平升高、糖尿病及痛风风险增加存在关联，但"完全戒断"并非必要，关键在于控制总量并适当替换。建议：将部分红肉替换为白肉（鸡、鱼、鸭）或豆制品，同时搭配全谷物和蔬菜；已有血脂/尿酸/炎症指标偏高的用户，建议减少加工红肉及内脏摄入频率。红曲米因含天然他汀类成分（洛伐他汀），与他汀类药物同服存在叠加风险，已在服用他汀类药物的用户应避免自行同时使用红曲米，建议咨询医生。

#### `food-compat-alcohol-and-metabolism`
- **topic:** `["喝酒", "饮酒", "啤酒", "果酒", "红酒", "还能喝酒吗"]`
- **evidence_level:** observational

**content_zh:**
> 酒精代谢会加重肝脏负担，长期或大量饮酒与糖化终产物（AGEs）沉积、炎症水平升高、代谢紊乱存在关联，尤其对代谢年龄和抗压年龄评分不利。急性饮酒后出现的体温轻微升高、次日不适等属于常见生理反应，与酒精代谢过程中的炎症反应有关，通常在24-48小时内可自行缓解；若症状持续或用户有肝脏基础疾病（如乙肝病毒携带、脂肪肝），应更严格控制饮酒频率与量，并建议关注肝功能指标变化。不应将"是否能喝酒"简化为单一是/否结论，需结合用户已知的肝脏/代谢基础状况给出分层建议。

#### `food-compat-intermittent-fasting-window`
- **topic:** `["16+8", "轻断食", "间歇性禁食", "晚餐时间", "进食窗口"]`
- **evidence_level:** observational

**content_zh:**
> 限时进食（如16:8模式）对代谢健康有一定支持性证据，核心机制是延长夜间空腹时间、避免晚间高血糖负荷影响睡眠及代谢修复。但实际执行中用户常因工作时间无法严格卡点（如晚餐无法在18:30前完成），此时不应要求用户"必须"完成理想时间窗口，而应给出可执行的折中方案：例如将进食窗口整体后移（如12:00-20:00），保持"总空腹时长"基本达标即可，或建议晚餐清淡化、减少精制碳水占比以降低较晚进食带来的血糖负荷。灵活性优先于机械套用固定时间点——反复要求用户"提前吃晚饭"而无视其实际作息限制，是应当避免的回答方式。

*(Found live: a real user pushed back twice on being told to move dinner earlier when their work schedule made that impossible, and the model repeated the same advice both times.)*

---

### Category: `tcm_practice`

#### `tcm-moxibustion-basics-and-contraindications`
- **topic:** `["艾灸", "灸法", "月经期艾灸", "针灸"]`
- **evidence_level:** insufficient

**content_zh:**
> 艾灸是中医传统外治法之一，其效果目前缺乏高质量循证医学证据支持，回答时应以"传统中医理论认为..."的方式表述，而非断言确切疗效。常见注意事项（传统中医理论框架内）：月经期间通常建议避免在腹部/腰骶部施灸（部分体质可在专业中医师指导下调整），发热、皮肤破损、局部炎症急性期不宜施灸；施灸频率因人而异，没有统一的"每周必须几次"标准，不应替用户设定强制性的固定频率要求。艾灸不能替代药物治疗或医疗干预，若用户描述的症状可能提示需要就医（如持续疼痛、异常出血等），应建议优先咨询医生或专业中医师，而非仅通过艾灸自行处理。

#### `tcm-meridian-points-general`
- **topic:** `["穴位", "经络", "阴陵泉", "涌泉穴", "命门", "太冲", "刮痧"]`
- **evidence_level:** insufficient

**content_zh:**
> 关于具体穴位（如阴陵泉、涌泉穴、命门、太冲等）的定位和传统功效，可以给出传统中医理论中的一般性说明（所属经络、传统认为的作用方向），但不应给出具体的施针操作指导——实际针灸治疗涉及精确取穴、进针深度、手法等专业技能，必须由持证中医师操作，自行或非专业指导下的针灸存在感染、损伤风险。回答应聚焦于"传统理论认为这个穴位/经络与什么功能相关"的科普性说明，并明确建议：如需实际针灸/推拿等有创或手法治疗，请前往正规医疗机构由持证中医师操作。

#### `tcm-solar-terms-and-nutrition`
- **topic:** `["节气", "立秋", "立春", "养生", "季节"]`
- **evidence_level:** insufficient

**content_zh:**
> 中国传统养生理论强调"顺应节气"调整饮食起居，例如立秋后传统建议减少寒凉/生冷食物摄入、适当"贴秋膘"但避免过度进补；不同节气的具体养生建议属于传统经验总结，而非现代循证营养学的直接结论，回答时应以"传统养生理论认为..."方式表述。可结合当前节气给出一般性、温和的饮食/作息调整建议（如清淡饮食、规律作息、适度保暖等），但不应过度渲染节气与具体疾病风险之间的因果关系，也不应用节气来解释某项检测指标异常的直接原因（指标异常应优先从饮食、睡眠、压力、慢性疾病等实际生理因素解释）。

*(This one pairs naturally with the `current_solar_term` context already fetched every turn — §29/`docs/ai-persona/07-proactive-messaging.md` — and with real user asks like "今天是什么节气" / "健康建议和节气有关系吗".)*

---

### Category: `sleep_tcm`

#### `sleep-early-morning-waking`
- **topic:** `["凌晨醒", "早醒", "三点醒", "四点醒", "睡不着", "入睡困难"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 凌晨2-4点易醒是常见的睡眠维持问题，现代生理学角度可能与皮质醇昼夜节律（凌晨皮质醇开始回升）、夜间血糖波动（晚餐过早或碳水不足导致夜间低血糖反跳）、压力/焦虑水平升高或睡眠环境因素（温度、光线、噪音）有关。中医理论则常将此类"定时早醒"与相应时辰对应的脏腑经络联系（如凌晨1-3点对应肝经、3-5点对应肺经），可作为传统理论视角的补充说明，但不应作为唯一解释。改善建议：保持规律作息时间、睡前2-3小时避免高强度运动和大量进食、必要时可评估晚餐碳水化合物是否过低导致夜间血糖波动；若长期严重影响生活质量，建议就医评估是否存在其他睡眠障碍或内分泌问题。

---

### Category: `chronic_condition_context` — ⚠️ requires clinical review before activation

These four are the highest-liability entries in this batch — they touch real diagnosed conditions, not general wellness. **Do not flip `status` to `active` on any of these without a named clinical reviewer**, per §26's still-open "who vets new KB entries" question. This is not boilerplate caution: the HBV entry below exists specifically to correct a real medical misconception a real user asked about live.

#### `condition-hbv-carrier-nutrition-considerations`
- **topic:** `["乙肝", "HBV", "乙肝病毒携带者", "肝炎", "铁过载", "脂肪肝"]`
- **evidence_level:** insufficient

**content_zh:**
> 乙肝病毒（HBV）感染/携带是明确的医学诊断和管理范畴，必须强调：目前没有任何膳食补充剂（包括甘草酸制剂、灵芝孢子粉、胸腺肽等）能够"杀死"或清除乙肝病毒——控制病毒复制、保护肝功能需要依靠医生处方的抗病毒药物（如恩替卡韦、替诺福韦等）及规范的肝病专科随访，营养干预只能作为辅助支持，绝不能替代或暗示可以替代抗病毒治疗。乙肝病毒携带者若合并铁蛋白升高或转氨酶异常，补铁、大剂量维生素C等可能加重肝脏氧化应激负担，应避免在未经医生评估的情况下自行补铁或大剂量补充维C；灵芝孢子粉、维生素C等补充剂与乙肝病情的相互作用缺乏充分证据，应建议用户使用前咨询感染科/肝病科医生。回答涉及乙肝病毒管理的具体问题时，应明确引导用户以医生的检查结果和治疗方案为准，本系统仅可提供一般性的生活方式/营养支持建议。

*(Found live: a real user directly asked "can [a named supplement] kill the hepatitis B virus" and "how else can I kill the virus, only by boosting immunity?" This is the single most medically consequential misconception found in the entire sample — worth flagging by name to whoever reviews this.)*

#### `condition-thyroid-metabolic-age-interplay`
- **topic:** `["甲减", "甲状腺", "优甲乐", "甲状腺炎症"]`
- **evidence_level:** insufficient

**content_zh:**
> 甲状腺功能减退（甲减）会显著影响基础代谢率，可能是代谢年龄评分偏高的重要背景因素之一，但本系统的6项检测指标不包含甲状腺功能相关指标（如TSH、FT3、FT4），无法直接评估甲状腺功能状态。已确诊甲减并规律服用左甲状腺素（优甲乐）等药物的用户，代谢年龄的解读应结合"甲状腺功能是否已被药物控制在正常范围"这一背景，而不能简单归因于饮食或生活方式问题；甲状腺功能是否达标需要定期复查甲功五项，属于内分泌科随访范畴，本系统不能替代该随访。

#### `condition-sleep-apnea-lifestyle-context`
- **topic:** `["睡眠呼吸暂停", "打鼾", "呼吸机", "打呼噜"]`
- **evidence_level:** insufficient

**content_zh:**
> 睡眠呼吸暂停综合征（尤其是需要佩戴呼吸机/CPAP的中重度患者）是明确的医学诊断，其管理必须以睡眠医学专科随访为主。本系统可提供的辅助性生活方式建议包括：控制体重（超重是常见风险因素之一）、侧卧睡姿、睡前避免饮酒（酒精会加重上气道松弛）；但不应承诺"通过营养素/饮食方案可以脱离呼吸机"或给出类似暗示，这类表述可能延误必要的医疗随访。若用户提出希望脱离呼吸机等目标，应明确说明这需要由睡眠专科医生评估病情严重程度后决定，营养干预只能作为辅助。

*(Found live: a real user explicitly asked for a diet/exercise plan to "get off the ventilator," promising to follow it strictly.)*

#### `condition-menstrual-irregularity-fibroid-context`
- **topic:** `["子宫肌瘤", "月经量大", "痛经", "月经不规律"]`
- **evidence_level:** insufficient

**content_zh:**
> 月经周期紊乱、经量异常增多或痛经，可能与子宫肌瘤、内分泌紊乱、慢性炎症等多种因素相关，具体病因需要妇科检查（如超声）及激素水平检测才能明确，本系统的6项检测指标不能用于诊断妇科疾病或判断月经异常的具体原因。已确诊子宫肌瘤的用户，其经量/经期症状的处理应以妇科随访意见为主；本系统可提供一般性的抗炎、代谢支持类生活方式建议，但不应对肌瘤本身的大小变化、是否需要手术等问题给出判断，应建议用户遵循妇科医生的随访计划。

---

### Category: `dots_formulation_faq`

#### `dots-formulation-methodology-faq`
- **topic:** `["原粒方案", "怎么配置", "D01", "N1", "dots方案", "营养素方案", "怎么生成的"]`
- **evidence_level:** mechanistic_plausible

**content_zh:**
> 每期原粒（Dots）方案是根据用户最新一次检测的6项生物标志物及既往趋势、当前健康关注重点等数据综合生成的：系统会先判断哪些维度（细胞/代谢/微血管/抗压年龄）偏离目标较多，再在每个原粒自身允许的最小-最大剂量区间内，按异常严重程度调整具体数量，并尝试平衡早晚总粒数。每个具体原粒（D01-D18/N1-N18）的确切成分、剂量和默认服用时段，应始终从系统当前的原粒配方库查询获取，而不是凭记忆复述——配方库内容可能随产品迭代更新，直接背诵固定成分列表存在信息过时的风险。若用户询问某个编号原粒的具体成分，应基于当前查询到的真实配方数据回答，而非依赖预设的静态清单。

**Deliberately does not hardcode D01–D18/N1–N18 ingredient/dosage data.** That already has a live source of truth — the `get_dots` agentic tool / `dots` table (§28) — and duplicating it here would just create a second copy that goes stale the next time the formulary changes.

---

## Before activating any of these

1. **The 4 `chronic_condition_context` rows need a named clinical reviewer**, not just an admin-panel click — they're the ones a wrong answer could actually hurt someone over. Everything else is normal wellness/science content at the same risk level as the 13 rows already live.
2. For everything else: the standard path is the Knowledge tab (Content → Knowledge, superadmin-only) — open each draft, set `reviewed_by`, flip `status` to `active`. `sort_order` can stay at 0 unless a display order matters (only the `essential` tier concatenates in `sort_order` order — these are all `optional`, matched by `findRelevantEntries`'s substring/tag check, not concatenated).
3. Numeric claims (biomarker ranges, sub-age scoring logic) were cross-checked against CLAUDE.md §11 before writing — if §11 ever changes, these 10 entries (6 `biomarker_reference` + 4 `subage_dimension`) need a matching pass.
4. This batch is Viva-only (`persona_type: 'viva'`), matching every existing row. Nano has zero seeded rows today (the known gap documented in [05-knowledge-base.md](05-knowledge-base.md)) — out of scope here.
