'use strict';

/**
 * What each sub-age is actually computed from — stated to the model, once, from the same table
 * the calculator uses.
 *
 * Asked 「我的代谢年龄为什么是四个里最高的」 on dev (2026-09-15), Viva explained that 微血管年龄 is
 * 「由血流介导的血管舒张能力、毛细血管密度等推算」 and 抗压年龄 「由HRV、静息心率、睡眠结构共同建模」.
 * Neither is true: the calculator reads Cystatin C for one and hsCRP + IL-6 for the other
 * (CLAUDE.md §11, lib/biomarkerStatus.js DIMENSION_BIOMARKERS). The templates showed the model
 * the four values and never said what produces them, so it reached for plausible physiology.
 *
 * Rendered from DIMENSION_BIOMARKERS rather than written by hand so it cannot drift from the
 * calculator; labels honour the channel's sub_age_display_names like every other surface.
 */

const { DIMENSION_BIOMARKERS } = require('../../lib/biomarkerStatus');
const { subAgeLabel } = require('../../lib/subAgeLabels');

const MARKER_NAMES = { GDF15: 'GDF-15', CD38: 'CD38', GA: 'GA（糖化白蛋白）', CystatinC: 'Cystatin C（胱抑素C）', hsCRP: 'hsCRP', IL6: 'IL-6' };
const MARKER_NAMES_EN = { GDF15: 'GDF-15', CD38: 'CD38', GA: 'GA (glycated albumin)', CystatinC: 'Cystatin C', hsCRP: 'hsCRP', IL6: 'IL-6' };

function getSubAgeInputsBlock(isZh = true, overrides = null) {
  const lang = isZh ? 'zh' : 'en';
  const names = isZh ? MARKER_NAMES : MARKER_NAMES_EN;
  const lines = Object.entries(DIMENSION_BIOMARKERS)
    .map(([dim, keys]) => `- ${subAgeLabel(dim, lang, overrides)} ← ${keys.map(k => names[k] || k).join(isZh ? '、' : ', ')}`)
    .join('\n');
  if (isZh) {
    return `【四个子年龄的计算输入 — 只有这些】
${lines}
每个子年龄只由上面列出的 Kino 芯片指标计算得出。穿戴设备数据（HRV、静息心率、睡眠、步数）、体检化验、端粒、血流介导舒张、毛细血管密度等都**不是**任何子年龄的输入——可以作为关联背景讨论，但不得说某个子年龄"由它们计算/建模/推算"。解释某个子年龄为什么高或低时，只能归因于它自己的输入指标。`;
  }
  return `[WHAT EACH SUB-AGE IS COMPUTED FROM — nothing else]
${lines}
Each sub-age is calculated only from the Kino chip markers listed for it. Wearable data (HRV, resting HR, sleep, steps), lab panels, telomeres, flow-mediated dilation, capillary density and the like are NOT inputs to any sub-age — discuss them as related context, but never say a sub-age is "computed/modelled/derived from" them. When explaining why a sub-age is high or low, attribute it only to its own listed markers.`;
}

module.exports = { getSubAgeInputsBlock };
