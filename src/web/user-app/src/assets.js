// Resolves a miniapp-style absolute asset path (`/assets/icons/chat.svg`) against Vite's base
// (`/app/` in production, `/` in dev). The files are copied by scripts/sync-css-from-miniapp.mjs.
export const asset = p => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`;
