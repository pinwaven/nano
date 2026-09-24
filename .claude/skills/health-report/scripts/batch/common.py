# -*- coding: utf-8 -*-
"""Defaults shared by every notes.py. Import with: from common import *"""
BASE_TESTS = [
 ('Kino 复扫（hsCRP · IL-6 · GDF-15 · 糖化白蛋白 · 胱抑素 C · CD38）', '追踪四维度与生物年龄的变化', '每 3 个月一次；与静脉血基础面板同期更易解读', 'P2'),
 ('空腹血糖 · HbA1c · 血脂四项 + ApoB', '代谢与心血管的基础面', 'FPG <5.6 · HbA1c <5.7% · LDL <3.4', 'P1'),
 ('肝肾功能 · 血常规 · 尿常规', '常规基线', '—', 'P1'),
 ('TSH / FT4 · 25-OH 维生素 D · 铁蛋白 · B12 / 叶酸', '疲劳、睡眠、情绪最常见的可纠正原因', 'VD ≥75 nmol/L · 铁蛋白 ≥30 μg/L', 'P2'),
 ('家庭血压 7 天（上臂式，早晚各 2 次）', '戒指血压不可用；诊室单次不作数', '<135/85', 'P2'),
 ('穿戴设备连续佩戴 ≥28 天', '睡眠时长 / 节律 / 夜间心率的基线', '含运动时佩戴', 'P2'),
]
TESTS_NOTE_DEFAULT = '精准营养的第一条规则是不补没有测出缺乏的东西。Kino 六项已经给出了炎症、细胞、代谢、微血管四个维度的实测基线，Dots 配方据此而定；但血脂、血糖、维生素 D、甲功等常规项目仍未测过，一次空腹静脉血（约 400–800 元）能同时补齐上面大部分空白，之后的饮食与复查节奏才完整。'
EXCLUDED_DEFAULT = [
 ('DOT-N11 / N15 / N17（小檗碱 / 抗糖化 / 血脂）', '无血糖、HbA1c、血脂实测；小檗碱与降糖降脂药有相互作用，用药情况不明时不给'),
 ('DOT-N7（漆黄素脉冲）', '无任何衰老细胞负荷指标'),
 ('DOT-N2（D3 + K2 + 锌）', '维生素 D 未测；测了再定'),
]
LIMITS_DEFAULT = '① 目前除 Kino 扫描外没有正式化验报告，血脂、血糖、维生素 D 等项目的「现状」判断以自述与穿戴数据为主，均需检测证实；② 消费级戒指 / 手环的心率、HRV、SpO₂ 未经医用设备验证，只使用同设备内的分布与趋势；③ Kino 六项为单次或少数几次测量，趋势判断需要至少两次相隔 3 个月的扫描；④ 对话中的自述未经核实。'
WEAR_NOTE_DEFAULT = '戒指 / 手环数据只回答「每天怎么样」：睡眠时长与入睡时间是其中最可靠的两项；心率、HRV、SpO₂ 受佩戴松紧与算法影响，看趋势不看单点；「血压」为算法固定区间，不采用。佩戴不足 4 周的数据只能定位，不能下结论。'
SOURCES_STD = [
 ('Kino 扫描', '六项衰老标志物 + 生物年龄', '见第二篇', '实测结果', 'A'),
 ('入门问卷 · 对话', '身高体重、既往、自述症状与用药', '注册至今', '自述，未经核实', 'B'),
 ('Dots 药筒 · 配方提案 · 健康计划', '平台记录', '注册至今', '执行记录', 'B'),
]
def kino_meaning(name_hint=''):
    return f'这六项分别对应炎症（hsCRP、IL-6）、细胞衰老（GDF-15、CD38）、糖代谢（糖化白蛋白）与微血管 / 肾功能（胱抑素 C）四个维度，是本报告判断「哪一项偏高」和推荐 Dots 的直接依据；第四篇的配方与复查节奏都建立在这组结果之上。'

# ---------------------------------------------------------------------------
COND_ZH = {'blood_lipids_high': '血脂高', 'cholesterol_high': '胆固醇高', 'blood_sugar_high': '血糖高', 'blood_pressure_high': '血压高', 'kidney_disease': '肾病', 'sleep_deficiency': '睡眠不足', 'heart_issues': '心脏问题', 'other': '其他', 'none': '无'}
def minimal(name, birth, sex, height, weight, conds, role, first_scan, n_scans, kino_summary, chat_lines, self_reports, extra_problems, tests_extra=(), prio_extra=(), d30_extra=(), created='2026-05', wearable=None, ba=None, other_zh=''):
    """Baseline notes for a user whose only results are Kino scans (plus questionnaire and chat). Returns a dict of module attributes.
    kino_summary: short text of the latest validated six-item panel, e.g. 'hsCRP 1.0 · IL-6 1.8 · GDF-15 620 · GA 14.1 · CysC 0.8 · CD38 1.6'."""
    from lib import C
    from datetime import date
    age = round((date(2026, 9, 16) - date.fromisoformat(birth)).days / 365.25, 1)
    bmi = round(weight / (height / 100) ** 2, 1) if height and weight else None
    cz = '、'.join(COND_ZH.get(c, c) for c in conds if c != 'other') + (f'、{other_zh}' if other_zh else '') if conds else '无'
    if cz == '无' and other_zh: cz = other_zh
    s = '女' if sex == 'female' else '男'
    d = {}
    d['MODE'] = 'baseline'; d['NAME'] = name; d['BIRTH'] = birth; d['HEIGHT'] = height; d['WEIGHT'] = weight
    d['COVER_SUB'] = f'融合入门问卷、{n_scans} 次 Kino 扫描、{chat_lines} 条对话' + ('、穿戴设备数据' if wearable else '')
    d['HERO'] = (str(ba or n_scans), f'{"岁 · Kino 生物年龄" if ba else "次 Kino 扫描"} · {kino_summary}')
    d['SPAN'] = f'{created} → 2026-09'
    d['GUIDE_SUB'] = f'这份报告把您的全部记录——入门问卷、{n_scans} 次 Kino 扫描结果、{chat_lines} 条对话' + ('、穿戴设备记录' if wearable else '') + '——放在一起阅读，并如实说明哪些已被测量、哪些还是自述。'
    d['STRUCTURE'] = '全书分四篇。<b>第一篇</b>结论与优先级；<b>第二篇</b>数据与检测：Kino 六项与生物年龄怎么读、还缺哪些数据；<b>第三篇</b>日常监测（有穿戴数据时）；<b>第四篇</b>行动方案：Dots 怎么用、还要测什么、复查日历。'
    d['CONFLICTS'] = f'<b>② Kino 之外还没有正式化验、影像或体检报告</b>；问卷勾选的「{cz}」是自述，没有对应的数值。<b>③</b> 因此 Dots 只针对 Kino 六项中偏高的维度给剂量，其余（血脂、血糖、维生素 D）等检测结果回来再定。'
    d['PART1_DESC'] = f'先看结论：Kino 六项给出了您四个衰老维度的实测基线；问卷里勾选的「{cz}」还只是自述。这份报告要做的，是把已测的变成行动、把未测的变成一张本月能完成的清单。'
    d['SUMMARY_SUB'] = '综合全部记录得出的核心判断'
    d['STATS'] = [(f'{age:g}<small style="font-size:11pt"> 岁</small>', '实际年龄', f'{s} · BMI {bmi}' if bmi else s, C['blue']), (str(ba or '—'), 'Kino 生物年龄', f'{n_scans} 次扫描', C['good']), ('0', '其他化验 / 报告', '尚未上传', C['critical']), (str(chat_lines), '对话消息', '自述来源', C['muted'])]
    d['OVERALL'] = f'您 {age:g} 岁，{s}，BMI {bmi}。入门问卷勾选：<b>{cz}</b>。{n_scans} 次 Kino 扫描给出六项衰老标志物（最近一次：{kino_summary}）与生物年龄 {ba or "—"}——这是本报告判断「哪一项偏高」和推荐 Dots 的依据。Kino 之外，血脂、血糖、维生素 D 等常规项目尚未测过，第四篇给出本月能完成的补测清单。'
    d['PROBLEMS_TITLE'] = '三件真正需要处理的事'
    d['PROBLEMS'] = list(extra_problems) + ['<b>按 Kino 六项行动</b>：偏高的维度对应第四篇的 Dots 与饮食 / 运动调整；3 个月后复扫看趋势。', '<b>把自述变成数值</b>：一次空腹静脉血（血糖 / HbA1c / 血脂四项 / 肝肾 / 血常规 / 甲功 / 维生素 D）加 7 天家庭血压，补齐 Kino 之外的空白。']
    d['PRIORITIES'] = list(prio_extra) + [('P1', '按 Kino 六项启动第四篇的 Dots 与生活方式调整'), ('P1', '空腹静脉血基础面板（一次抽血）'), ('P2', '家庭血压 7 天；如有穿戴设备连续佩戴 4 周'), ('P2', '把已有的体检报告 / 化验单拍照上传到「健康文档」'), ('P3', '3 个月后 Kino 复扫')]
    d['ONE_LINE'] = 'Kino 已经告诉我们从哪里开始；一管血能把这份报告从「基线」变成完整的「分析」。'
    d['DOCTOR'] = dict(profile=[('姓名', f'{name} · {s} · {birth} · {age:g} 岁'), ('体格', f'{height} cm · {weight} kg · BMI {bmi}（自述）'), ('既往（问卷）', cz), ('用药 / 补剂', '未记录'), ('自述', '；'.join(x[1] for x in self_reports[:3]) if self_reports else '无')],
        problems=list(extra_problems) + [f'Kino 六项（最近一次）：{kino_summary}；生物年龄 {ba or "—"}（实际 {age:g}）。偏高项见第二篇。', f'问卷自述「{cz}」，尚无对应化验。→ 基础面板见下。'],
        labs_title=None, labs=None, aging=f'Kino {n_scans} 次扫描（首次 {first_scan}）：最近一次 {kino_summary}；生物年龄 {ba or "—"}，四个子年龄见第二篇。', wear=None,
        workup='空腹静脉血：FPG、HbA1c、血脂四项 + ApoB、肝肾功能、血常规、TSH / FT4、25-OH VD、铁蛋白；尿常规；家庭血压 7 天；3 个月后 Kino 复扫。在血糖血脂结果与用药情况明确前不建议启动含小檗碱、植物固醇等成分的 Dots。')
    d['SCORECARD'] = None
    d['PART2_DESC'] = '这一篇逐次列出您的 Kino 六项与生物年龄、解释它们是怎么算出来的、哪些项目偏高，以及 Kino 之外还缺什么数据。'
    d['PROFILE'] = [('姓名', name), ('性别 / 出生', f'{s} · {birth}（{age:g} 岁）'), ('身高 / 体重', f'{height} cm · {weight} kg · BMI {bmi}'), ('既往（问卷）', cz), ('穿戴设备', wearable or '未绑定 / 无数据'), ('渠道 / 角色', f'aeviva-china · 用户 / 教练 · {role}')]
    d['TRACK'] = [f'{created} 注册并完成入门问卷', f'{first_scan} 首次 Kino 扫描（共 {n_scans} 次）', f'对话 {chat_lines} 条']
    d['INVENTORY'] = [('入门问卷', '身高体重、既往', 'B', '自述'), (f'Kino 扫描 ×{n_scans}', f'{first_scan} 起', 'A', f'六项 + 生物年龄 {ba or "—"}'), (f'对话 {chat_lines} 条', '注册至今', 'B', '自述与提问')] + ([('穿戴设备', wearable, 'B', '见第三篇')] if wearable else [])
    d['TIMELINE'] = None
    d['KINO_MEANING'] = kino_meaning()
    d['DATA_PAGES'] = []
    d['SELF_REPORTS'] = self_reports
    d['SELF_NOTE'] = '对话里的提问是本报告理解您关注点的主要来源；如果您手里有任何体检报告或化验单，请拍照上传到「健康文档」，下一版报告会围绕它们重写。'
    d['PART3_DESC'] = '穿戴设备记录只回答「每天怎么样」——这一篇按原始记录逐日重算。'
    d['WEAR_NOTE'] = WEAR_NOTE_DEFAULT; d['HR_NOTE'] = ''
    d['PART4_DESC'] = '这一篇把 Kino 六项变成配方与日程，再把「不知道」变成「知道」：补测清单按对您年龄段与自述问题的解释力排序。'
    d['TESTS_SUB'] = '一次空腹抽血 + 一次家庭血压监测 · 约 500–900 元 · 3 个月后 Kino 复扫'
    d['TESTS'] = list(tests_extra) + BASE_TESTS
    d['TESTS_NOTE'] = TESTS_NOTE_DEFAULT
    d['PLAN_PAGES'] = []
    d['DOTS'] = dict(sub='按 Kino 六项开方 · 其余等检测结果回来再加', principle='配方库里每一款都对应一个可测的指标。Kino 六项中偏高的项目按下表给剂量（在 notes.py 里填 am / pm）；血糖、血脂、维生素 D 相关的 Dots 等对应检测回来再定。', am=[], pm=[],
        conditional=[('hsCRP >1.0 或 IL-6 >3（Kino）', 'DOT-N16 早 4；先找炎症来源'), ('GDF-15 >600 pg/mL 或 CD38 偏高（Kino）', 'DOT-N6 早 17 / DOT-N9'), ('糖化白蛋白 >15%（Kino）或 HbA1c ≥5.7%', 'DOT-N11 早 17 起 + DOT-N15 晚 37；与降糖药合用需医生确认'), ('胱抑素 C >1.0 mg/L（Kino）', '先复查肾功能，再决定'), ('LDL-C ≥3.4 mmol/L', 'DOT-N17 晚 28 + DOT-N14 早 7'), ('25-OH VD <75 nmol/L', 'DOT-N2 晚 3–5'), ('睡眠中位 <6.5 h 或入睡 >00:30（穿戴证实）', 'DOT-N3 晚 2 + 作息方案')],
        excluded=EXCLUDED_DEFAULT, platform_note='平台的自动配方同样以 Kino 六项为输入；本报告与之的差异及原因见下表。')
    d['CALENDAR'] = [('本周', '按第四篇启动 Dots；空腹静脉血基础面板', '补齐 Kino 之外的基线', 'P1'), ('本周起 7 天', '家庭血压（上臂式）', '<135/85', 'P2'), ('本月', '上传既有体检报告 / 化验单', '让下一版报告有材料', 'P2'), ('4 周', '穿戴设备连续佩戴（如有）', '睡眠与心率基线', 'P2'), ('结果回来后 1 周', '按第四篇规则补充血糖 / 血脂 / 维生素 D 相关 Dots', '—', 'P1'), ('3 个月后', 'Kino 复扫 + 复查异常项', '按目标值', 'P2'), ('12 个月后', '年度体检', '—', 'P3')]
    d['D30'] = list(d30_extra) + ['一次空腹抽血', '7 天家庭血压', '上传既有报告', '固定起床时间；每天 30 分钟步行']
    d['D90'] = ['Kino 复扫：偏高项回落', '按结果补充第二批 Dots（若有指征）', '穿戴设备 ≥28 夜']
    d['D365'] = ['基础面板全部在理想区间', 'Kino 六项全部在参考范围内、生物年龄不高于实际年龄', '年度体检无新发现']
    d['SUCCESS'] = '一年后：Kino 四个维度都不高于实际年龄，化验单上没有红字——配方与生活方式都围绕实测数据调整，这才是「精准」两个字。'
    d['SOURCES'] = SOURCES_STD
    d['LIMITS'] = LIMITS_DEFAULT
    d['SUMMARY_TXT'] = f'{name}，这是一份 {{PAGES}} 页的健康数据基线报告。已读取的数据：{n_scans} 次 Kino 扫描（最近一次六项：{kino_summary}；生物年龄 {ba or "—"}）、入门问卷与自述「{cz}」、{chat_lines} 条对话。报告按 Kino 六项给出了 Dots 配方与生活方式调整，并列出一张本月能完成的补测清单（一次空腹抽血 + 7 天家庭血压），补齐血脂、血糖、维生素 D 等 Kino 之外的空白。' + ('报告第一篇另有针对您自述问题的具体建议。' if extra_problems else '')
    return d
