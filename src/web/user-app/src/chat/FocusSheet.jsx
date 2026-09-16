// The health-plan focus sheet shown before 营养定制 (main.wxml focus-sheet, main.js:_startFormulaDots).
import { useLang } from '../i18n/index.js';

export default function FocusSheet({ sheet, onGo, onSkip, onChoose, onClose }) {
  const { t } = useLang();
  if (!sheet) return null;
  const plans = sheet.plans || [];
  return (
    <div className="overlay-mask" onClick={onClose}>
      <div className="focus-sheet" onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span className="overlay-title">{t.focusTitle}</span>
          <div className="overlay-close" onClick={onClose}><span className="close-x">✕</span></div>
        </div>
        {plans.length > 0 ? (
          <>
            <span className="focus-intro">{t.focusHasIntro}</span>
            {plans.map(p => (
              <div key={p.id} className="focus-plan-row">
                <div className={`plan-type-badge plan-type-${p.plan_type}`}><span className="plan-type-text">{p.plan_type === 'primary' ? t.plansPrimary : t.plansSecondary}</span></div>
                <div className="focus-plan-body"><span className="focus-plan-name">{p.name}</span>{p.goal && <span className="focus-plan-goal">{p.goal}</span>}</div>
              </div>
            ))}
            <span className="focus-hint">{t.focusHasHint}</span>
            <div className="focus-btn focus-btn-primary" onClick={onGo}><span>{t.focusGo}</span></div>
            <div className="focus-btn-row">
              <div className="focus-btn focus-btn-ghost" onClick={onChoose}><span>{t.focusChoose}</span></div>
              <div className="focus-btn focus-btn-ghost" onClick={onSkip}><span>{t.focusSkip}</span></div>
            </div>
          </>
        ) : (
          <>
            <span className="focus-intro">{t.focusNoneIntro}</span>
            <span className="focus-hint">{t.focusNoneHint}</span>
            <div className="focus-btn focus-btn-primary" onClick={onChoose}><span>{t.focusChoose}</span></div>
            <div className="focus-btn focus-btn-ghost" onClick={onGo}><span>{t.focusGoNoPlan}</span></div>
          </>
        )}
      </div>
    </div>
  );
}
