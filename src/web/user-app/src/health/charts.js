// The health tab's canvas charts — user-health.js's _chartPalette / _drawCrosshairOverlay /
// _drawBioAgeChart / _drawWeightFullChart / _drawGenericChart / _drawBpChart, ported onto a
// standard 2D context through a shim for the legacy wx canvas API they were written against
// (setStrokeStyle / setLineWidth / setFillStyle / setFontSize / setTextAlign / draw), so the
// drawing code below is the miniapp's line for line. Colours are literal because canvas paints
// cannot read CSS custom properties — hence a palette per theme.

export function legacyCtx(canvas, W, H) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.font = '11px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
  c.textBaseline = 'alphabetic';
  return Object.assign(c, {
    setStrokeStyle(v) { c.strokeStyle = v; }, setFillStyle(v) { c.fillStyle = v; }, setLineWidth(v) { c.lineWidth = v; },
    setFontSize(px) { c.font = `${px}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`; },
    setTextAlign(v) { c.textAlign = v; }, draw() {},
  });
}

export function chartPalette(theme) {
  const isLight = theme === 'light';
  return isLight ? {
    bg: '#FFFFFF', accent: '#C9956A', accentRgb: '201,149,106', textPrimary: '#2C2C2C',
    textMuted55: 'rgba(139,110,78,0.65)', textMuted75: 'rgba(139,110,78,0.8)', textMuted45: 'rgba(139,110,78,0.5)',
    textMuted50: 'rgba(139,110,78,0.55)', textMuted28: 'rgba(139,110,78,0.35)', gridLine: 'rgba(201,149,106,0.15)',
    fillLight: 'rgba(201,149,106,0.12)', fillMed: 'rgba(201,149,106,0.22)', dotRing: 'rgba(255,255,255,0.9)',
    glow10: 'rgba(201,149,106,0.12)', glow22: 'rgba(201,149,106,0.28)', glow60: 'rgba(201,149,106,0.7)', line85: 'rgba(201,149,106,0.85)',
  } : {
    bg: '#0a1228', accent: '#6375EC', accentRgb: '99,117,236', textPrimary: '#EEF2FF',
    textMuted55: 'rgba(166,196,229,0.55)', textMuted75: 'rgba(166,196,229,0.75)', textMuted45: 'rgba(166,196,229,0.45)',
    textMuted50: 'rgba(166,196,229,0.5)', textMuted28: 'rgba(166,196,229,0.28)', gridLine: 'rgba(99,117,236,0.12)',
    fillLight: 'rgba(99,117,236,0.1)', fillMed: 'rgba(99,117,236,0.22)', dotRing: 'rgba(10,15,30,0.9)',
    glow10: 'rgba(99,117,236,0.10)', glow22: 'rgba(99,117,236,0.22)', glow60: 'rgba(99,117,236,0.60)', line85: 'rgba(99,117,236,0.85)',
  };
}

function drawCrosshairOverlay(ctx, c, { W, pT, plotH, x, dots, labelLines }) {
  ctx.beginPath(); ctx.setStrokeStyle(c.textMuted45); ctx.setLineWidth(1);
  ctx.moveTo(x, pT); ctx.lineTo(x, pT + plotH); ctx.stroke();
  dots.forEach(d => { ctx.beginPath(); ctx.setFillStyle(d.color); ctx.setStrokeStyle(c.dotRing); ctx.setLineWidth(1.5); ctx.arc(d.x, d.y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
  const textWidth = s => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 11 : 6.2), 0);
  const lineH = 14;
  const boxH = labelLines.length * lineH + 10;
  const boxW = Math.max(...labelLines.map(textWidth)) + 16;
  const flip = x > W * 0.7;
  let boxX = flip ? x - boxW - 8 : x + 8;
  boxX = Math.max(4, Math.min(W - boxW - 4, boxX));
  const boxY = Math.max(pT, 4);
  ctx.beginPath(); ctx.setFillStyle(c.bg); ctx.setStrokeStyle(c.gridLine); ctx.setLineWidth(1);
  ctx.rect(boxX, boxY, boxW, boxH); ctx.fill(); ctx.stroke();
  ctx.setTextAlign('left'); ctx.setFontSize(11);
  labelLines.forEach((line, i) => { ctx.setFillStyle(i === 0 ? c.textMuted55 : c.textPrimary); ctx.fillText(line, boxX + 8, boxY + 16 + i * lineH); });
}

// Returns the layout { pL, plotW, len } used by the crosshair hit-test, or null.
export function drawBioAgeChart(canvas, { bioAgeHistory, W, bAge, cAge, bAgeColor, t, theme }, crosshairIdx = null) {
  const c = chartPalette(theme);
  const H = 200, headerH = 62, pL = 28, pR = 10, pT = headerH + 12, pB = 24;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const ctx = legacyCtx(canvas, W, H);
  ctx.clearRect(0, 0, W, H); ctx.setFillStyle(c.bg); ctx.fillRect(0, 0, W, H);
  ctx.setTextAlign('left'); ctx.setFontSize(30); ctx.setFillStyle(bAgeColor || c.accent); ctx.fillText(bAge || '—', 14, 34);
  ctx.setFontSize(10); ctx.setFillStyle(c.textMuted55); ctx.fillText((t.bioAge || 'Bio Age').toUpperCase(), 14, 52);
  ctx.setTextAlign('right'); ctx.setFontSize(22); ctx.setFillStyle(c.textMuted75); ctx.fillText(cAge || '—', W - 14, 32);
  ctx.setFontSize(10); ctx.setFillStyle(c.textMuted45); ctx.fillText((t.chronoAge || 'Chrono Age').toUpperCase(), W - 14, 52);
  ctx.beginPath(); ctx.setStrokeStyle(c.gridLine); ctx.setLineWidth(0.5); ctx.moveTo(0, headerH); ctx.lineTo(W, headerH); ctx.stroke();
  const cr = 11;
  const drawGlowBorder = () => {
    const rrPath = (inset, r) => {
      const x = inset, y = inset, w = W - inset * 2, h = H - inset * 2;
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
      ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2); ctx.lineTo(x + r, y + h);
      ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI); ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2); ctx.closePath();
    };
    rrPath(4, cr - 3); ctx.setStrokeStyle(c.glow10); ctx.setLineWidth(10); ctx.stroke();
    rrPath(2, cr - 1); ctx.setStrokeStyle(c.glow22); ctx.setLineWidth(5); ctx.stroke();
    rrPath(1, cr); ctx.setStrokeStyle(c.glow60); ctx.setLineWidth(1.5); ctx.stroke();
  };
  if (bioAgeHistory.length < 2) { drawGlowBorder(); return null; }
  const allVals = bioAgeHistory.map(r => r.bioAge);
  bioAgeHistory.forEach(r => { if (r.chronoAge != null) allVals.push(r.chronoAge); });
  const minV = Math.floor(Math.min(...allVals)) - 2, maxV = Math.ceil(Math.max(...allVals)) + 2;
  const range = maxV - minV || 1;
  const toX = i => pL + (i / Math.max(bioAgeHistory.length - 1, 1)) * plotW;
  const toY = v => pT + ((maxV - v) / range) * plotH;
  const pts = bioAgeHistory.map((r, i) => ({ x: toX(i), y: toY(r.bioAge) }));
  ctx.beginPath(); ctx.setFillStyle(c.fillMed); ctx.moveTo(pts[0].x, pT + plotH); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(pts[pts.length - 1].x, pT + plotH); ctx.closePath(); ctx.fill();
  const cPts = bioAgeHistory.map((r, i) => (r.chronoAge != null ? { x: toX(i), y: toY(r.chronoAge) } : null)).filter(Boolean);
  for (let i = 0; i < cPts.length - 1; i++) {
    const x1 = cPts[i].x, y1 = cPts[i].y, x2 = cPts[i + 1].x, y2 = cPts[i + 1].y;
    const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    let dd = 0;
    while (dd < len) {
      const t1 = dd / len, t2 = Math.min((dd + 3) / len, 1);
      ctx.beginPath(); ctx.setStrokeStyle(c.textMuted28); ctx.setLineWidth(1);
      ctx.moveTo(x1 + t1 * (x2 - x1), y1 + t1 * (y2 - y1)); ctx.lineTo(x1 + t2 * (x2 - x1), y1 + t2 * (y2 - y1)); ctx.stroke();
      dd += 6;
    }
  }
  ctx.beginPath(); ctx.setStrokeStyle(c.accent); ctx.setLineWidth(2); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  ctx.setFillStyle(c.accent); ctx.setStrokeStyle(c.dotRing); ctx.setLineWidth(1.5);
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
  const step = Math.max(1, Math.floor(bioAgeHistory.length / 4));
  ctx.setFontSize(9); ctx.setFillStyle(c.textMuted45); ctx.setTextAlign('center');
  bioAgeHistory.forEach((r, i) => { if (i % step === 0 || i === bioAgeHistory.length - 1) ctx.fillText(r.date.substring(5), pts[i].x, H - pB + 14); });
  ctx.setTextAlign('right'); ctx.fillText(maxV, pL - 4, pT + 9); ctx.fillText(minV, pL - 4, pT + plotH + 4);
  drawGlowBorder();
  if (crosshairIdx != null) {
    const idx = Math.max(0, Math.min(bioAgeHistory.length - 1, crosshairIdx));
    const r = bioAgeHistory[idx];
    const dots = [{ x: pts[idx].x, y: pts[idx].y, color: c.accent }];
    const labelLines = [r.date, `${t.bioAge || 'BioAge'}: ${r.bioAge.toFixed(1)}`];
    if (r.chronoAge != null) { dots.push({ x: pts[idx].x, y: toY(r.chronoAge), color: c.textMuted75 }); labelLines.push(`${t.chronoAge || 'ChronoAge'}: ${Number(r.chronoAge).toFixed(1)}`); }
    drawCrosshairOverlay(ctx, c, { W, pT, plotH, x: pts[idx].x, dots, labelLines });
  }
  return { pL, plotW, len: bioAgeHistory.length };
}

export function drawWeightFullChart(canvas, { weightHistory, W, theme }) {
  if (weightHistory.length < 1) return null;
  const c = chartPalette(theme);
  const H = 200, pL = 44, pR = 16, pT = 20, pB = 44;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const weights = weightHistory.map(r => r.weight);
  const minW = Math.floor(Math.min(...weights)) - 2, maxW = Math.ceil(Math.max(...weights)) + 2;
  const range = maxW - minW;
  const toX = i => pL + (i / Math.max(weightHistory.length - 1, 1)) * plotW;
  const toY = w => pT + ((maxW - w) / range) * plotH;
  const pts = weightHistory.map((r, i) => ({ x: toX(i), y: toY(r.weight) }));
  const ctx = legacyCtx(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i <= 4; i++) {
    const y = pT + (i / 4) * plotH, val = maxW - (i / 4) * range;
    ctx.setStrokeStyle(c.gridLine); ctx.setLineWidth(0.5); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke();
    ctx.setFillStyle(c.textMuted45); ctx.setFontSize(10); ctx.setTextAlign('left'); ctx.fillText(val.toFixed(1), 0, y + 4);
  }
  ctx.beginPath(); ctx.setFillStyle(c.fillLight); ctx.moveTo(pts[0].x, pT + plotH); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(pts[pts.length - 1].x, pT + plotH); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.setStrokeStyle(c.accent); ctx.setLineWidth(2); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  const labelStep = Math.max(1, Math.floor(weightHistory.length / 5));
  ctx.setFontSize(10); ctx.setFillStyle(c.textMuted50);
  weightHistory.forEach((r, i) => { if (i % labelStep === 0 || i === weightHistory.length - 1) ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16); });
  ctx.setFillStyle(c.textPrimary); ctx.setStrokeStyle(c.accent); ctx.setLineWidth(1.5);
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
  ctx.setStrokeStyle(c.glow22); ctx.setLineWidth(1); ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke();
  return null;
}

export function drawGenericChart(canvas, { history, valKey, unit, color, W, theme }, crosshairIdx = null) {
  if (!history.length) return null;
  const c = chartPalette(theme);
  const H = 200, pL = 44, pR = 16, pT = 20, pB = 44;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const vals = history.map(r => r[valKey]);
  const minV = Math.floor(Math.min(...vals)), maxV = Math.ceil(Math.max(...vals));
  const range = maxV - minV || 1;
  const toX = i => pL + (i / Math.max(history.length - 1, 1)) * plotW;
  const toY = v => pT + ((maxV - v) / range) * plotH;
  const pts = history.map((r, i) => ({ x: toX(i), y: toY(r[valKey]) }));
  const ctx = legacyCtx(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const hex = parseInt(color.replace('#', ''), 16);
  const [cr, cg, cb] = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  for (let i = 0; i <= 4; i++) {
    const y = pT + (i / 4) * plotH, val = maxV - (i / 4) * range;
    ctx.setStrokeStyle(c.gridLine); ctx.setLineWidth(0.5); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke();
    ctx.setFillStyle(c.textMuted45); ctx.setFontSize(10); ctx.setTextAlign('left'); ctx.fillText(Number.isInteger(val) ? val : val.toFixed(1), 0, y + 4);
  }
  ctx.beginPath(); ctx.setFillStyle(`rgba(${cr},${cg},${cb},0.1)`); ctx.moveTo(pts[0].x, pT + plotH); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(pts[pts.length - 1].x, pT + plotH); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.setStrokeStyle(color); ctx.setLineWidth(2); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  const labelStep = Math.max(1, Math.floor(history.length / 5));
  ctx.setFontSize(10); ctx.setFillStyle(c.textMuted50);
  history.forEach((r, i) => { if (i % labelStep === 0 || i === history.length - 1) ctx.fillText(r.date.substring(5), pts[i].x - 14, H - pB + 16); });
  ctx.setFillStyle(c.textPrimary); ctx.setStrokeStyle(color); ctx.setLineWidth(1.5);
  pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
  ctx.setStrokeStyle(c.glow22); ctx.setLineWidth(1); ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke();
  if (crosshairIdx != null) {
    const idx = Math.max(0, Math.min(history.length - 1, crosshairIdx));
    const val = history[idx][valKey];
    const valStr = Number.isInteger(val) ? String(val) : val.toFixed(1);
    drawCrosshairOverlay(ctx, c, { W, pT, plotH, x: pts[idx].x, dots: [{ x: pts[idx].x, y: pts[idx].y, color }], labelLines: [history[idx].date, unit ? `${valStr} ${unit}` : valStr] });
  }
  return { pL, plotW, len: history.length };
}

export function drawBpChart(canvas, { bpHistory, W }) {
  if (bpHistory.length < 1) return null;
  const H = 200, pL = 44, pR = 16, pT = 20, pB = 44;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const allVals = bpHistory.flatMap(r => [r.systolic, r.diastolic]);
  const minV = Math.floor(Math.min(...allVals)) - 5, maxV = Math.ceil(Math.max(...allVals)) + 5;
  const range = maxV - minV || 1;
  const toX = i => pL + (i / Math.max(bpHistory.length - 1, 1)) * plotW;
  const toY = v => pT + ((maxV - v) / range) * plotH;
  const sysPts = bpHistory.map((r, i) => ({ x: toX(i), y: toY(r.systolic) }));
  const diaPts = bpHistory.map((r, i) => ({ x: toX(i), y: toY(r.diastolic) }));
  const ctx = legacyCtx(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  for (let i = 0; i <= 4; i++) {
    const y = pT + (i / 4) * plotH, val = maxV - (i / 4) * range;
    ctx.setStrokeStyle('rgba(99,117,236,0.12)'); ctx.setLineWidth(0.5); ctx.beginPath(); ctx.moveTo(pL, y); ctx.lineTo(pL + plotW, y); ctx.stroke();
    ctx.setFillStyle('rgba(166,196,229,0.45)'); ctx.setFontSize(10); ctx.setTextAlign('left'); ctx.fillText(Math.round(val), 0, y + 4);
  }
  const drawLine = (pts, color) => {
    ctx.beginPath(); ctx.setStrokeStyle(color); ctx.setLineWidth(2); ctx.moveTo(pts[0].x, pts[0].y); pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    ctx.setFillStyle('#EEF2FF'); ctx.setStrokeStyle(color); ctx.setLineWidth(1.5);
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
  };
  drawLine(sysPts, '#ef4444'); drawLine(diaPts, '#6375EC');
  ctx.setFontSize(10); ctx.setFillStyle('rgba(166,196,229,0.5)');
  const labelStep = Math.max(1, Math.floor(bpHistory.length / 5));
  bpHistory.forEach((r, i) => { if (i % labelStep === 0 || i === bpHistory.length - 1) ctx.fillText(r.date.substring(5), sysPts[i].x - 14, H - pB + 16); });
  ctx.setStrokeStyle('rgba(99,117,236,0.3)'); ctx.setLineWidth(1); ctx.beginPath(); ctx.moveTo(pL, pT); ctx.lineTo(pL, pT + plotH); ctx.lineTo(pL + plotW, pT + plotH); ctx.stroke();
  return null;
}
