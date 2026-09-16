# 健康文档 — Health Documents Are Twin Data

The upload/list/open/delete surface for a user's health records (`health_documents`, twin layer 3
— Medical Records), shared by the 数字孪生 subtab and the Viva AG panel through one component,
readable by a coach and writable only by the user. The rules that must hold are summarised in
`CLAUDE.md` §38; this file is the record of why.

| Neighbours | Where |
|---|---|
| What happens to a document after upload (extraction, food panels) | [doc-extraction.md](doc-extraction.md) |
| The AG panel that used to own this surface, and the OSS/authorization rules | [viva-ag.md](viva-ag.md) |
| The twin layer taxonomy | [digital-twin.md](digital-twin.md) |

Moved verbatim from `CLAUDE.md` §38 on 2026-09-15.

---

## 38. 健康文档 Is Twin Data, Not an AG Feature (2026-09-08)

Uploading a health record — a clinic note, a 体检报告 PDF, a photo of a paper printout — used to
be reachable from exactly one place, the **Viva AG** subtab, and all five
`/api/health-documents` endpoints required the AG entitlement. But `health_documents` is **twin
layer 3, Medical Records** (§34), not an AG artifact. The 数字孪生 subtab — the one every user
sees — now ends with the same 健康文档 section, and the endpoints ask only who the caller is.

### One component, two hosts

`components/health-documents/` is the whole manager (list, upload, open, delete), extracted from
`viva-ag-panel` rather than copied into `user-health`. Two copies would be two upload paths
drifting apart against one backend, and `user-health` is already 3800 lines — the same reason its
own comment gives for keeping the AG body out of it.

No `variant` property was needed: `.ag-section` and `.health-section` are byte-identical, and
`.ag-section-title` differs from `.section-title` only by 4rpx of bottom margin, so one set of
section chrome reads as native in both hosts. `--fs-*` and the colour vars come from `app.wxss`
and inherit through the component boundary; the `.theme-light` **class** does not, which is why
the component carries its own root theme hook.

Both hosts sit behind a `wx:if`, so an AG holder toggling subtabs gets a fresh mount and a fresh
fetch — there is no cross-instance refresh to build. A user with **no** AG subtab mounts it once
per app launch (the health tab is `display:none`, never unmounted), which is why it has a `lang`
observer that `viva-ag-panel` lacks: without it a language switch leaves the section in the old
language, and `typeLabel` is baked into each row at fetch time so the rows are relabelled too.

### A coach reads, and never writes

`can-upload="{{mode === 'self'}}"` hides the upload button **and** the per-row delete, and
`deleteDocument` re-checks it — a WXML gate is one edit from gone. `coach-id` travels to the
server, where `_resolveOwner` runs the same coarse ownership check `handleGetUserFacts` and
`handleGetCoachUserChat` already use (`SELECT 1 FROM users WHERE user_id=$1 AND coach_id=$2`),
**only when the caller supplies one** — the admin panel and the user's own miniapp omit it and
address themselves.

`this._coachId` in `pages/coach/coach.js` lives **outside `data`**, so WXML cannot read it. It is
mirrored into `data.coachId` at **both** sites it is assigned (`onLoad` and
`_repairCoachSession`); miss the second and a repaired session reads unscoped.

`_refuseCoach` makes presign/register/delete reject a `coach_id` outright. That is a statement of
intent, **not enforcement** — a caller can always omit the param and send a bare `openid`, the
same as any caller of any endpoint here. Do not mistake it for a barrier.

### What the entitlement drop did and did not change

Nothing but Viva AG reads `health_documents` (`lib/twinBundle.js` and `handlers/viva_ag.js`), so
for a user without the add-on this is an archive that pays off the moment they buy one. The
section's footnote says as much without naming a product they may not have.

The AG check was an **entitlement** gate, never access control: it never stopped one AG user from
passing another user's openid. What protects the object is unchanged — server-minted keys under
`health-documents/<user_id>/`, `oss_key` never returned to the client, 300s URLs, and never
routing through `/oss/presign`. `health_documents.js`'s security header says this in place of the
claim that is no longer true; keep it honest if the gate ever changes again.

### Files

New: `src/mini/nano-miniapp/components/health-documents/`, `tests/health-documents-access.test.js`.
Modified: `worker/handlers/health_documents.js` (`_resolveOwner`/`_refuseCoach` replacing
`requireVivaAgAccess`; **no route changes** — `coach_id` already arrives in `query`/`parsedBody`),
`components/viva-ag-panel/*` (section replaced by the component; `_sizeLabel` and
`DOC_EXTENSIONS` kept, the job/report viewer still needs them), `components/user-health/*`
(`coachId` property + the section, last in the twin body), `pages/coach/{coach.js,coach.wxml}`,
`utils/config.js` (VERSION).

