# -*- coding: utf-8 -*-
"""Defaults shared by every notes.py. Import with: from common import *"""
BASE_TESTS = [
 ('静脉血：hsCRP · IL-6 · GDF-15 · 糖化白蛋白 · 胱抑素 C', 'Kino 四维度的真实输入（CD38 除外）', '首次基线；抽血同日可做 Kino 复扫对照', 'P1'),
 ('空腹血糖 · HbA1c · 血脂四项 + ApoB', '代谢与心血管的基础面', 'FPG <5.6 · HbA1c <5.7% · LDL <3.4', 'P1'),
 ('肝肾功能 · 血常规 · 尿常规', '常规基线', '—', 'P1'),
 ('TSH / FT4 · 25-OH 维生素 D · 铁蛋白 · B12 / 叶酸', '疲劳、睡眠、情绪最常见的可纠正原因', 'VD ≥75 nmol/L · 铁蛋白 ≥30 μg/L', 'P2'),
 ('家庭血压 7 天（上臂式，早晚各 2 次）', '戒指血压不可用；诊室单次不作数', '<135/85', 'P2'),
 ('穿戴设备连续佩戴 ≥28 天', '睡眠时长 / 节律 / 夜间心率的基线', '含运动时佩戴', 'P2'),
]
TESTS_NOTE_DEFAULT = '精准营养的第一条规则是不补没有测出缺乏的东西。App 里的六项与生物年龄目前是估算值，任何以它们为依据的配方都是在猜。一次空腹静脉血（约 400–800 元）能同时回答上面大部分问题，之后的 Dots 配方、饮食与复查节奏才有靶子。'
EXCLUDED_DEFAULT = [
 ('DOT-N6 / N9（尿石素 A / NMN）', '平台提案的核心，依据是估算的「细胞年龄」；无 GDF-15、NAD+ 实测'),
 ('DOT-N11 / N15 / N17（小檗碱 / 抗糖化 / 血脂）', '无血糖、HbA1c、血脂实测；小檗碱与降糖降脂药有相互作用，用药情况不明时不给'),
 ('DOT-N7（漆黄素脉冲）', '无任何衰老细胞负荷指标'),
 ('DOT-N2（D3 + K2 + 锌）', '维生素 D 未测；测了再定'),
]
LIMITS_DEFAULT = '① 平台上没有正式化验报告，本报告的「现状」判断以自述与穿戴数据为主，均需复查证实；② 消费级戒指 / 手环的心率、HRV、SpO₂ 未经医用设备验证，只使用同设备内的分布与趋势；③ Kino 面板除 hsCRP 外均为估算值，本报告不引用其数值作结论；④ 对话中的自述未经核实。'
WEAR_NOTE_DEFAULT = '戒指 / 手环数据只回答「每天怎么样」：睡眠时长与入睡时间是其中最可靠的两项；心率、HRV、SpO₂ 受佩戴松紧与算法影响，看趋势不看单点；「血压」为算法固定区间，不采用。佩戴不足 4 周的数据只能定位，不能下结论。'
SOURCES_STD = [
 ('Kino 扫描', '读数器原始读数 + 估算面板', '见第二篇', 'hsCRP 读数 B 级；其余估算 C 级', 'B/C'),
 ('入门问卷 · 对话', '身高体重、既往、自述症状与用药', '注册至今', '自述，未经核实', 'B'),
 ('Dots 药筒 · 配方提案 · 健康计划', '平台记录', '注册至今', '执行记录', 'B'),
]
def kino_meaning(name_hint=''):
    return f'过去几个月里 App 与对话中反复讨论的「GDF-15 偏高」「CD38 倍数」「糖化白蛋白」等，都来自这组估算值——它们反映的是您的年龄与 BMI，不是您的血液。本报告因此不把它们当作发现，也不据此推荐任何 Dots；第四篇的第一步是把这六项真正测一次。'

# ---------------------------------------------------------------------------
COND_ZH = {'blood_lipids_high': '血脂高', 'cholesterol_high': '胆固醇高', 'blood_sugar_high': '血糖高', 'blood_pressure_high': '血压高', 'kidney_disease': '肾病', 'sleep_deficiency': '睡眠不足', 'heart_issues': '心脏问题', 'other': '其他', 'none': '无'}
def minimal(name, birth, sex, height, weight, conds, role, first_scan, n_scans, hs_readings, chat_lines, self_reports, extra_problems, tests_extra=(), prio_extra=(), d30_extra=(), created='2026-05', wearable=None, ba=None, other_zh=''):
    """Baseline notes for a user whose only data is the questionnaire, a few Kino scans and chat. Returns a dict of module attributes."""
    from lib import C
    from datetime import date
    age = round((date(2026, 9, 16) - date.fromisoformat(birth)).days / 365.25, 1)
    bmi = round(weight / (height / 100) ** 2, 1) if height and weight else None
    cz = '、'.join(COND_ZH.get(c, c) for c in conds if c != 'other') + (f'、{other_zh}' if other_zh else '') if conds else '无'
    if cz == '无' and other_zh: cz = other_zh
    s = '女' if sex == 'female' else '男'
    d = {}
    d['MODE'] = 'baseline'; d['NAME'] = name; d['BIRTH'] = birth; d['HEIGHT'] = height; d['WEIGHT'] = weight
    d['COVER_SUB'] = f'融合入门问卷、{n_scans} 次 Kino 扫描原始读数核对、{chat_lines} 条对话' + ('、穿戴设备数据' if wearable else '')
    d['HERO'] = (str(n_scans), f'次 Kino 扫描 · {hs_readings} · 生物年龄 {ba or "—"} 为估算值')
    d['SPAN'] = f'{created} → 2026-09'
    d['GUIDE_SUB'] = f'这份报告把您在平台上的全部记录——入门问卷、{n_scans} 次 Kino 扫描的原始读数、{chat_lines} 条对话' + ('、穿戴设备记录' if wearable else '') + '——放在一起阅读，并如实说明哪些是测量、哪些是估算。'
    d['STRUCTURE'] = '全书分四篇。<b>第一篇</b>结论与优先级；<b>第二篇</b>数据与检测：手里有哪些真实数据、App 里的生物年龄为什么不算数；<b>第三篇</b>日常监测（有穿戴数据时）；<b>第四篇</b>行动方案：先测什么、Dots 怎么用、复查日历。'
    d['CONFLICTS'] = f'<b>② 平台上没有任何正式化验、影像或体检报告</b>；问卷勾选的「{cz}」是自述，没有对应的数值。<b>③</b> 因此本报告不给出针对性的 Dots 剂量——只给出一张本月可以完成的检测清单。'
    d['PART1_DESC'] = f'先看结论：您在平台上被真正测量过的东西几乎没有——问卷里勾选的「{cz}」还只是自述。这份报告的全部价值，在于把它变成一张本月能完成的清单。'
    d['SUMMARY_SUB'] = '综合平台全部记录得出的核心判断'
    d['STATS'] = [(f'{age:g}<small style="font-size:11pt"> 岁</small>', '实际年龄', f'{s} · BMI {bmi}' if bmi else s, C['blue']), (str(n_scans), 'Kino 扫描', hs_readings, C['warning']), ('0', '正式化验 / 报告', '平台上未上传', C['critical']), (str(chat_lines), '对话消息', '自述来源', C['muted'])]
    d['OVERALL'] = f'您 {age:g} 岁，{s}，BMI {bmi}。入门问卷勾选：<b>{cz}</b>。平台上的 {n_scans} 次 Kino 扫描只有 hsCRP 一项被读数器测量（{hs_readings}），其余五项与 App 里的生物年龄都是系统按年龄和 BMI 估算的——所以本报告无法告诉您「哪一项偏高」，也不会据此推荐配方。能负责任说的是：您的年龄段最值得先做的检查是什么、以及在结果回来之前哪些事不需要数据也成立。'
    d['PROBLEMS_TITLE'] = '三件真正需要处理的事'
    d['PROBLEMS'] = list(extra_problems) + ['<b>把自述变成数值</b>：一次空腹静脉血（血糖 / HbA1c / 血脂四项 / 肝肾 / 血常规 / 甲功 / 维生素 D）加 7 天家庭血压，是所有后续建议的地基。', '<b>让 App 里的六项变成真的</b>：hsCRP、IL-6、GDF-15、糖化白蛋白、胱抑素 C 在静脉血中都能测；测完再谈四维度。']
    d['PRIORITIES'] = list(prio_extra) + [('P1', '空腹静脉血基础面板 + Kino 五项静脉血（一次抽血）'), ('P2', '家庭血压 7 天；如有穿戴设备连续佩戴 4 周'), ('P2', '把已有的体检报告 / 化验单拍照上传到「健康文档」'), ('P3', 'Dots：等检测结果回来再定配方；已持有的先不开封')]
    d['ONE_LINE'] = '现在最有价值的一步不是补什么，而是测一次——一管血能把这份报告从「基线」变成「分析」。'
    d['DOCTOR'] = dict(profile=[('姓名', f'{name} · {s} · {birth} · {age:g} 岁'), ('体格', f'{height} cm · {weight} kg · BMI {bmi}（自述）'), ('既往（问卷）', cz), ('用药 / 补剂', '未记录'), ('自述', '；'.join(x[1] for x in self_reports[:3]) if self_reports else '无')],
        problems=list(extra_problems) + [f'问卷自述「{cz}」，平台无任何对应化验。→ 基础面板见下。', f'Kino {n_scans} 次扫描均无有效面板（{hs_readings}）；App 生物年龄 {ba or "—"} 为估算。'],
        labs_title=None, labs=None, aging=f'Kino {n_scans} 次扫描：hsCRP 读数 {hs_readings}；面板其余五项为估算。App 生物年龄与四个子年龄不代表实测。', wear=None,
        workup='空腹静脉血：FPG、HbA1c、血脂四项 + ApoB、肝肾功能、血常规、TSH / FT4、25-OH VD、铁蛋白；hsCRP、IL-6、GDF-15、糖化白蛋白、胱抑素 C；尿常规；家庭血压 7 天。在检测结果与用药情况明确前不建议启动含小檗碱、植物固醇、睡茄等成分的 Dots。')
    d['SCORECARD'] = None
    d['PART2_DESC'] = '这一篇列出您真正被测量过的东西（很少），并解释 App 里那个生物年龄是怎么算出来的、为什么它不能回答您的问题。'
    d['PROFILE'] = [('姓名', name), ('性别 / 出生', f'{s} · {birth}（{age:g} 岁）'), ('身高 / 体重', f'{height} cm · {weight} kg · BMI {bmi}'), ('既往（问卷）', cz), ('穿戴设备', wearable or '未绑定 / 无数据'), ('渠道 / 角色', f'aeviva-china · 用户 / 教练 · {role}')]
    d['TRACK'] = [f'{created} 注册并完成入门问卷', f'{first_scan} 首次 Kino 扫描（共 {n_scans} 次）', f'对话 {chat_lines} 条']
    d['INVENTORY'] = [('入门问卷', '身高体重、既往', 'B', '自述'), (f'Kino 扫描 ×{n_scans}', f'{first_scan} 起', 'B/C', f'hsCRP 读数 {hs_readings}'), (f'对话 {chat_lines} 条', '注册至今', 'B', '自述与提问')] + ([('穿戴设备', wearable, 'B', '见第三篇')] if wearable else [])
    d['TIMELINE'] = None
    d['KINO_MEANING'] = kino_meaning()
    d['DATA_PAGES'] = []
    d['SELF_REPORTS'] = self_reports
    d['SELF_NOTE'] = '对话里的提问是本报告理解您关注点的主要来源；如果您手里有任何体检报告或化验单，请拍照上传到「健康文档」，下一版报告会围绕它们重写。'
    d['PART3_DESC'] = '穿戴设备记录只回答「每天怎么样」——这一篇按原始记录重算，不使用平台的滚动平均值。'
    d['WEAR_NOTE'] = WEAR_NOTE_DEFAULT; d['HR_NOTE'] = ''
    d['PART4_DESC'] = '这一篇只做一件事：把「不知道」变成「知道」。清单按对您年龄段与自述问题的解释力排序；Dots 在结果回来之前不给剂量。'
    d['TESTS_SUB'] = '一次空腹抽血 + 一次家庭血压监测 · 约 500–900 元'
    d['TESTS'] = list(tests_extra) + BASE_TESTS
    d['TESTS_NOTE'] = TESTS_NOTE_DEFAULT
    d['PLAN_PAGES'] = []
    d['DOTS'] = dict(sub='结果回来之前不给剂量 · 已持有的药筒先不开封', principle='配方库里每一款都对应一个可测的指标；您目前没有任何一项被测过。平台的自动配方以估算面板为输入，等于按年龄和 BMI 开方。下面是检测结果回来后的决策规则。', am=[], pm=[],
        conditional=[('HbA1c ≥5.7% 或 FPG ≥6.1', 'DOT-N11 早 17 起 + DOT-N15 晚 37；与降糖药合用需医生确认'), ('LDL-C ≥3.4 mmol/L', 'DOT-N17 晚 28 + DOT-N14 早 7'), ('hsCRP >1.0 或 IL-6 >3（静脉血）', 'DOT-N16 早 4；先找炎症来源'), ('25-OH VD <75 nmol/L', 'DOT-N2 晚 3–5'), ('睡眠中位 <6.5 h 或入睡 >00:30（穿戴证实）', 'DOT-N3 晚 2 + 作息方案'), ('GDF-15 >600 pg/mL（静脉血）', 'DOT-N6 早 17')],
        excluded=EXCLUDED_DEFAULT, platform_note='该提案以估算面板为输入，本报告不采用其剂量。')
    d['CALENDAR'] = [('本周', '空腹静脉血基础面板 + Kino 五项', '建立真实基线', 'P1'), ('本周起 7 天', '家庭血压（上臂式）', '<135/85', 'P2'), ('本月', '上传既有体检报告 / 化验单', '让下一版报告有材料', 'P2'), ('4 周', '穿戴设备连续佩戴（如有）', '睡眠与心率基线', 'P2'), ('结果回来后 1 周', '按第四篇规则决定 Dots；开始对应的饮食 / 运动调整', '—', 'P1'), ('3 个月后', '复查异常项', '按目标值', 'P2'), ('12 个月后', '年度体检', '—', 'P3')]
    d['D30'] = list(d30_extra) + ['一次空腹抽血', '7 天家庭血压', '上传既有报告', '固定起床时间；每天 30 分钟步行']
    d['D90'] = ['按结果启动第一批 Dots（若有指征）', '异常项复查', '穿戴设备 ≥28 夜']
    d['D365'] = ['基础面板全部在理想区间', '一次真实的 Kino 六项基线', '年度体检无新发现']
    d['SUCCESS'] = '一年后：一份真实的化验单上没有红字，App 里的生物年龄第一次建立在实测之上——那时的配方才配得上「精准」两个字。'
    d['SOURCES'] = SOURCES_STD
    d['LIMITS'] = LIMITS_DEFAULT
    d['SUMMARY_TXT'] = f'{name}，这是一份 {{PAGES}} 页的健康数据基线报告。先说实话：平台上属于您的硬数据只有问卷里的身高体重与自述「{cz}」；{n_scans} 次 Kino 扫描的原始读数在仪器有效窗口外（{hs_readings}），App 里的生物年龄 {ba or "—"} 是系统按年龄和 BMI 推算的，不是测量。所以报告没有给配方，而是给了一张本月能完成的检测清单（一次空腹抽血 + 7 天家庭血压），以及结果回来后决定 Dots 的规则。' + ('报告第一篇另有针对您自述问题的具体建议。' if extra_problems else '')
    return d
