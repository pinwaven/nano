#!/usr/bin/env python3
"""
Pull the result tables out of a 量康 个人基因组全外显子测序 report (≈200 pages) from its
pdftotext -layout output, so the 77 trait results and the disease-risk overview do not have to be
read by hand.

    python parse_exome.py <outdir>/txt/*全外显子*.txt > <outdir>/data/exome.json

Output:
    traits:        [{title, result, tip}]   — 77 特质基因 (饮食/营养/运动/性格/外貌/体质), each with
                                              the lab's one-line 检测结果 and its "您的…" tip line
    risk_overview: raw text of the 疾病风险 summary spread (risk multiples + lifetime risks)
    counts:        the "N项疾病风险高 / 较高 / 一般 …" line and the 单基因病 / 精准用药 headline counts

The trait section starts at the LAST "特质基因报告结果说明" heading; each trait block has a
人群分布 line whose NEXT line begins with the trait title, then a bare "检测结果" line, then the
result. Layout-dependent — verify the count comes out at 77 and spot-check a few against the PDF.
"""
import re, sys, json

fn = sys.argv[1]
lines = [l for l in open(fn, encoding='utf-8').read().split('\n') if l.strip()]

# ---- traits ----
starts = [i for i, l in enumerate(lines) if '特质基因报告结果说明' in l]
traits = []
i = starts[-1] if starts else 0
while i < len(lines):
    if '人群分布' in lines[i] and i + 1 < len(lines):
        title = lines[i + 1].strip().split()[0] if lines[i + 1].strip() else '?'
        j = i + 1
        while j < len(lines) and not re.match(r'^\s*检测结果\s*$', lines[j]): j += 1
        k = j + 1
        while k < len(lines) and ('生活建议' in lines[k] or not lines[k].strip()): k += 1
        result = lines[k].strip() if k < len(lines) else ''
        tip = ''
        for m in range(k, min(k + 15, len(lines))):
            if lines[m].strip().startswith('您的') and len(lines[m].strip()) < 60:
                tip = lines[m].strip(); break
        traits.append({'title': title, 'result': result[:80], 'tip': tip})
        i = k
    i += 1

# ---- disease risk overview + headline counts ----
counts = [l.strip() for l in lines if re.search(r'\d+项疾病风险|项遗传病|项需要您重点关注', l)]
ov = [i for i, l in enumerate(lines) if '您的患病风险倍数' in l or '疾病风险检测结果概述' in l]
risk_overview = '\n'.join(lines[ov[-1]: ov[-1] + 60]) if ov else ''

print(f'traits parsed: {len(traits)} (expect 77)', file=sys.stderr)
json.dump({'traits': traits, 'risk_overview': risk_overview, 'counts': counts}, sys.stdout, ensure_ascii=False, indent=1)
