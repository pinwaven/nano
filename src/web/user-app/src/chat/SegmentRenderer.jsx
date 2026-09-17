// One AI bubble = an array of typed segments from the miniapp's mdToSegments (utils/markdown.js).
// Prose (`html`) is the segmenter's own HTML; the designed cards are native markup carrying the
// miniapp's class names (mini-css/main.css) so both clients render the same thing. Mirrors
// pages/main/main.wxml's chat block.
import { useLang } from '../i18n/index.js';
import { rpxToPx } from './messages.js';

function Html({ h, className = 'msg-html' }) {
  // Links: the miniapp copies (it cannot navigate); the web opens a new tab.
  const onClick = e => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    e.preventDefault();
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener');
  };
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: rpxToPx(h) }} />;
}

function MetricCard({ seg }) {
  return (
    <div className="mcard">
      {seg.items.map((mi, mj) => (
        <div key={mj} className={`mcard-tile mcard-${mi.s}`}>
          <span className="mcard-label">{mi.label}</span>
          <div className="mcard-valrow">
            <span className="mcard-val">{mi.value}</span>
            {mi.unit && <span className="mcard-unit">{mi.unit}</span>}
            {mi.spark && (
              <div className={`spark spark-t-${mi.spark.tone}`}>
                {mi.spark.bars.map((sb, sk) => <div key={sk} className={`spark-bar${sb.last ? ' spark-bar-last' : ''}`} style={{ height: `${sb.h}%` }} />)}
              </div>
            )}
          </div>
          {(mi.sl || mi.spark) && (
            <div className="mcard-footrow">
              {mi.sl && <span className="mcard-pill">{mi.sl}</span>}
              {mi.spark && mi.spark.delta && <span className={`spark-delta spark-d-${mi.spark.tone}`}>{mi.spark.arrow}{mi.spark.delta}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FormulaCard({ seg, mi, si, isAeviva, onToggleTier, onSubmit, onOrder }) {
  const { t } = useLang();
  const tiers = seg.tiers || [];
  const rungs = seg.rungs || [];
  return (
    <div className="fcard">
      <div className="fcard-head">
        <span className="fcard-title">{t.formulaCardTitle}</span>
        <span className="fcard-note">{t.formulaEvalNote}</span>
      </div>
      {tiers.map((ft, fti) => (
        <div key={ft.width ?? fti} className={`fcard-tier${ft.open ? ' fcard-tier-open' : ''}`}>
          {ft.label && (
            <div className="fcard-tier-head" onClick={() => onToggleTier(mi, si, fti)}>
              <div className="fcard-tier-name">
                <span className="fcard-tier-label">{ft.label}</span>
                {ft.recommended && <span className="fcard-tier-rec">{t.formulaTierRecommended}</span>}
              </div>
              <span className="fcard-tier-chev">{ft.open ? '⌃' : '⌄'}</span>
            </div>
          )}
          {ft.note && <div className="fcard-tier-note" onClick={() => onToggleTier(mi, si, fti)}><span>{ft.note}</span></div>}
          {!ft.open && (
            <div className="fcard-legend fcard-tier-dots" onClick={() => onToggleTier(mi, si, fti)}>
              {(ft.dots || []).map(fd => (
                <div key={fd.key} className="fcard-leg"><div className="fcard-swatch" style={{ background: fd.color }} /><span className="fcard-leg-name">{fd.name}</span></div>
              ))}
            </div>
          )}
          {ft.open && (
            <>
              {(ft.groups || []).map((fg, fgi) => (
                <div key={fg.days || fgi} className="fcard-group">
                  {fg.days && (
                    <div className="fcard-days">
                      <span className="fcard-daylabel">{t.formulaDayWord} {fg.days}</span>
                      {fg.kind === 'n7' && <span className="fcard-daytag">{t.formulaResetDay}</span>}
                    </div>
                  )}
                  {[['am', t.formulaAm, 'amPct'], ['pm', t.formulaPm, 'pmPct']].map(([slot, label, pctKey]) => (
                    <div key={slot} className="fcard-row">
                      <span className="fcard-slot">{label}</span>
                      <div className="fcard-track">
                        {fg.items.map(fi => <div key={fi.key} className="fcard-seg" style={{ width: `${fi[pctKey]}%`, background: fi.color }} />)}
                      </div>
                      <span className="fcard-num">{fg[slot]}</span>
                    </div>
                  ))}
                  <div className="fcard-legend">
                    {fg.items.map(fi => (
                      <div key={fi.key} className="fcard-leg">
                        <div className="fcard-swatch" style={{ background: fi.color }} />
                        <span className="fcard-leg-name">{fi.name}</span>
                        <span className="fcard-leg-num">{fi.am}·{fi.pm}</span>
                      </div>
                    ))}
                  </div>
                  <span className="fcard-foot">{t.formulaTotalLabel} {fg.total}</span>
                </div>
              ))}
              {ft.pitch && <span className="fcard-tier-pitch">{ft.pitch}</span>}
            </>
          )}
        </div>
      ))}
      {seg.cycleDays ? <span className="fcard-cycle">{seg.cycleDays}{t.formulaDaysUnit} · {seg.cycleCapsules}{t.formulaCapsulesUnit}</span> : null}
      {tiers.length > 1 && <span className="fcard-tier-hint">{t.formulaTierHint}</span>}
      {rungs.length > 0 && (
        <div className="fcard-upgrades">
          <span className="fcard-uphead">{t.formulaUpgradeTitle}</span>
          {rungs.map((fr, fri) => (
            <div key={fr.width ?? fri} className="fcard-rung">
              <div className="fcard-rung-head"><span className="fcard-rung-label">{fr.label}</span><span className="fcard-rung-add">+{fr.items.length}</span></div>
              <div className="fcard-legend fcard-rung-dots">
                {fr.items.map(ri => (
                  <div key={ri.key} className="fcard-leg">
                    <div className="fcard-swatch" style={{ background: ri.color }} />
                    <span className="fcard-leg-name">{ri.name}</span>
                    <span className="fcard-leg-num">{ri.am}·{ri.pm}</span>
                    {ri.weeks && <span className="fcard-leg-weeks">{t.formulaWeekPrefix}{ri.weeks}{t.formulaWeekSuffix}</span>}
                  </div>
                ))}
              </div>
              {fr.pitch && <span className="fcard-rung-pitch">{fr.pitch}</span>}
            </div>
          ))}
          <span className="fcard-rung-hint">{t.formulaUpgradeHint}</span>
        </div>
      )}
      {seg.planId && isAeviva && seg.orderMode === 'submit' ? (
        <div className="fcard-cta" onClick={() => onSubmit(seg.planId)}><span>{t.formulaSubmitCta}</span></div>
      ) : seg.planId && isAeviva && seg.orderMode === 'buy' ? (
        <>
          {seg.cta?.owned && <span className="fcard-owned">{seg.cta.owned}</span>}
          <div className="fcard-cta" onClick={() => onOrder(seg)}><span>{seg.cta?.btn || t.formulaOrderCta}</span></div>
        </>
      ) : seg.orderMode === 'ag' ? (
        <span className="fcard-agnote">{t.formulaAgPending}</span>
      ) : null}
    </div>
  );
}

function LessonCard({ seg, mi, si, onPlay, onEnded }) {
  const { t } = useLang();
  return (
    <div className="lcard">
      {seg.url ? (
        <video className="lcard-video" src={seg.url} poster={seg.poster || undefined} controls playsInline onEnded={() => onEnded(seg.lessonId)} />
      ) : (
        <div className="lcard-cover" onClick={() => onPlay(mi, si)}>
          <span className="lcard-play">{seg.loading ? t.loading : `▶  ${t.programLessonPlay}`}</span>
        </div>
      )}
      <div className="lcard-meta">
        <span className="lcard-title">{seg.title}</span>
        {seg.done && <span className="lcard-done">✓ {t.programLessonDone}</span>}
      </div>
    </div>
  );
}

export default function SegmentRenderer({ msg, mi, ctx }) {
  const { t } = useLang();
  const { isAeviva, onToggleTier, onFormulaSubmit, onFormulaOrder, onProductTap, onPlayLesson, onLessonEnded, onCheckinStart } = ctx;
  return (
    <>
      {(msg.segments || []).map((seg, si) => {
        let body = null;
        if (seg.t === 'html') body = <Html h={seg.h} />;
        else if (seg.t === 'rule') body = <div className="msg-rule" />;
        else if (seg.t === 'metric') body = <MetricCard seg={seg} />;
        else if (seg.t === 'takeaway') body = (
          <div className="tcard"><span className="tcard-title">{seg.title || t.mdTakeaway}</span><Html h={seg.h} className="msg-html tcard-body" /></div>
        );
        else if (seg.t === 'dots') body = (
          <div className="dcard">
            {seg.items.map((di, dj) => (
              <div key={dj} className="dcard-chip"><span className="dcard-id">{di.id}</span>{di.name && <span className="dcard-name">{di.name}</span>}{di.note && <span className="dcard-note">{di.note}</span>}</div>
            ))}
          </div>
        );
        else if (seg.t === 'formula') body = <FormulaCard seg={seg} mi={mi} si={si} isAeviva={isAeviva} onToggleTier={onToggleTier} onSubmit={onFormulaSubmit} onOrder={onFormulaOrder} />;
        else if (seg.t === 'product') body = (
          <div className="pcard">
            <span className="pcard-title">{t.productCardTitle}</span>
            {seg.items.map(pi => (
              <div key={pi.sku} className="pcard-row" onClick={() => onProductTap(pi.sku)}>
                <div className="pcard-main"><span className="pcard-name">{pi.name}</span>{pi.reason && <span className="pcard-reason">{pi.reason}</span>}</div>
                <span className="pcard-price">{pi.price}</span><span className="pcard-arrow">›</span>
              </div>
            ))}
          </div>
        );
        else if (seg.t === 'lesson') body = <LessonCard seg={seg} mi={mi} si={si} onPlay={onPlayLesson} onEnded={onLessonEnded} />;
        else if (seg.t === 'checkin') body = (
          <div className="ccard">
            {seg.done ? <div className="ccard-done"><span>✓ {t.programCheckinDone}</span></div>
              : <div className={`ccard-cta${seg.active ? '' : ' ccard-cta-off'}`} onClick={() => onCheckinStart(seg.programId, seg.dayIndex)}><span>{seg.label || t.programCheckinCta}</span></div>}
          </div>
        );
        return <div key={si} className="msg-seg">{body}</div>;
      })}
    </>
  );
}
