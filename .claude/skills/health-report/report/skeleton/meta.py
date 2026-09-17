# -*- coding: utf-8 -*-
# Per-report metadata read by build.py. Copy this directory to your working dir and fill in.
REPORT_TITLE    = '<姓名> · 全维度健康分析报告'
FOOTER          = '<姓名>（<昵称>）· 全维度健康分析报告 · <YYYY-MM-DD>'
OUTPUT_BASENAME = '<姓名>_全维度健康分析报告_<YYYY-MM-DD>'
# Section label (the `section` passed to page()) -> part number shown in the TOC.
PART_TITLES = {
    '结论与优先级': '第一篇', '我到底几岁？': '第二篇', '血液与代谢': '第三篇',
    '肠道 · 食物 · 营养素': '第四篇', '基因组与女性健康': '第五篇', '日常监测': '第六篇',
    '行动方案': '第七篇', '附录': '附录',
}
