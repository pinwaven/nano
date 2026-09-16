// The one formulation-submit path (main.js:_submitFormulation), shared by the chat's :::formula
// card and Plans ▸ Dots so the two surfaces can never disagree about what a reason code means.
// `report` is how each surface talks to its user. Returns true only on a real success.
import { api } from '../api.js';
import { ui } from '../components/ui/ui.js';

let submitting = false;
export function isFormulaSubmitting() { return submitting; }

export async function submitFormulation(app, planId, orderId, report) {
  const { user, t } = app;
  if (submitting) return false;
  submitting = true;
  ui.loading(t.formulaSubmitCta, true);
  try {
    const body = { openid: user.user_id, plan_id: planId };
    if (orderId) body.order_id = orderId;
    const d = await api.post('/formulation-submit', body);
    if (d?.success) { report(t.formulaSubmitOk); return true; }
    if (d?.reason === 'no_awaiting_order') report(t.formulaSubmitNoOrder);
    else if (d?.reason === 'order_not_available') report(t.pkgOrderGone);
    else if (d?.reason === 'order_requires_expert_review') report(t.formulaSubmitExpert);
    else if (d?.reason === 'formulation_exceeds_package') report(t.formulaSubmitOverTier);
    else report(t.formulaSubmitFailed);
    return false;
  } catch { report(t.formulaSubmitFailed); return false; }
  finally { ui.loading('', false); submitting = false; }
}
