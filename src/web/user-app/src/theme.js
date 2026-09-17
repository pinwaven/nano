// Status colours for text are picked in code (BIOMARKER_META, stressColor, …) and applied
// inline, which no .theme-light rule can reach. Mirrors the `tc.c()` WXS map in
// components/user-health/user-health.wxml: each dark-tuned hex → a darker same-hue variant
// for the cream light surface. Chart fills keep the bright hexes (shapes, not text).
const LIGHT = {
  '#0ea5e9': '#0369A1', '#10b981': '#0A7350', '#f97316': '#B45309',
  '#ef4444': '#C0392B', '#f472b6': '#BE185D', '#c084d4': '#8B3FA8',
  '#6375ec': '#4F46E5', '#a855f7': '#7E22CE', '#34d399': '#0F7A52',
  '#f59e0b': '#8A5A06', '#a6c4e5': '#556F8A',
  'rgba(166,196,229,0.55)': '#556F8A',
};
export function themeColor(hex, theme) {
  if (theme !== 'light' || !hex) return hex;
  return LIGHT[String(hex).toLowerCase()] || hex;
}
