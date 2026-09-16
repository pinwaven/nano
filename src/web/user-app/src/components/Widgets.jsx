// Login-screen language toggle. The onboarding widgets that used to live here are gone: the
// chat tab now runs the server-driven questionnaire engine (chat/Questionnaire.jsx).

export function LangToggle({ lang, onChange }) {
  return (
    <button className="lang-toggle" onClick={() => onChange(lang === 'zh' ? 'en' : 'zh')}>
      <span className={lang === 'zh' ? 'lang-active' : ''}>中</span>
      <span className="lang-sep">/</span>
      <span className={lang === 'en' ? 'lang-active' : ''}>EN</span>
    </button>
  );
}
