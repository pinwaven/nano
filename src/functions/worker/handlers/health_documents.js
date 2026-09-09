'use strict';

/**
 * User-uploaded health record documents (PDFs of hospital records, discharge summaries,
 * imaging reports, ...). This is twin layer 3, Medical Records (CLAUDE.md §34) — part of the
 * digital twin, not part of Viva AG. Two surfaces host the same manager: the 数字孪生 subtab
 * (every user) and the Viva AG subtab (add-on holders), both via the shared
 * components/health-documents/ miniapp component.
 *
 * SECURITY NOTE — read before adding an endpoint here.
 *
 * API_BEARER_TOKEN is both nano's superadmin bearer AND the token compiled into the miniapp,
 * so every end-user endpoint in this codebase is "authorized" by an ?openid= parameter alone.
 * These are the most sensitive documents in the system, so this file does NOT lean on that:
 *
 *   1. It never routes through handleGetOssPresign (/oss/presign). That endpoint performs zero
 *      authorization on action=get&key=… — it hands a signed URL for ANY OSS key to any caller
 *      holding the app token. Documents must not widen that pre-existing hole.
 *   2. Keys are minted server-side under 'health-documents/<user_id>/', and the register
 *      endpoint rejects any key outside the resolved caller's own prefix — otherwise a caller
 *      could register someone else's object into their own list.
 *   3. oss_key is never returned to the client. Documents are referenced by id only.
 *   4. User-facing GET URLs expire in 300s, not the 10-year links /oss/presign mints for images.
 *
 * These endpoints used to additionally require the Viva AG entitlement. As of 2026-09-08 they do
 * not, so every user can build an archive. Be clear-eyed about what that changed: the AG check
 * was an ENTITLEMENT gate, never an access-control one — it never stopped one AG user from
 * passing another user's openid. What is left is exactly the authorization strength of every
 * other end-user endpoint here (/api/biomarkers?openid= and the rest) plus items 1-4 above,
 * which are the parts that actually protect the object.
 */

const crypto = require('crypto');
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');

const VALID_DOC_TYPES = new Set([
    'hospital_record', 'lab_report', 'imaging', 'discharge_summary', 'prescription', 'other',
]);

// Matches the miniapp's own client-side cap. Enforced here too because the client-side check
// is trivially bypassable and an unbounded blob is a cost problem, not just a UX one.
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

// Short by design — this URL is a bearer credential for a medical record with no further auth.
// Long enough to hand to wx.downloadFile, short enough to be worthless if it leaks.
const USER_URL_TTL_SECONDS = 300;

// A "health record" is whatever the clinic handed the user: a PDF report, a Word discharge
// summary, an Excel panel of results, or a photo of a paper printout. Accepting only PDFs meant
// asking users to convert files on a phone, which they will not do.
//
// This map is the single source of truth for what may be uploaded — the extension gates the
// upload, and the value is what gets SIGNED into the presigned PUT (this bucket refuses a
// content-type override at download time, so upload is the only chance to set it correctly).
// Anything added here is automatically accepted, stored with a real content type, and reported
// to the external agent, which branches on `content_type`.
const CONTENT_TYPE_BY_EXT = {
    // Documents
    pdf:  'application/pdf',
    doc:  'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:  'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt:  'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Images — photographs of paper records
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', heic: 'image/heic', heif: 'image/heif',
    webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif',
};
const ALLOWED_EXTENSIONS = new Set(Object.keys(CONTENT_TYPE_BY_EXT));

// wx.openDocument can render these; anything else the miniapp previews as an image instead.
const OFFICE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

// Resolves the document owner from ?openid=, and — when the caller supplies its own coach_id
// — checks that the target really is one of that coach's clients. Same coarse ownership pattern
// as handleGetUserFacts / handleGetCoachUserChat: the check only runs when coach_id is present,
// so the admin panel and the user's own miniapp omit it and address themselves.
async function _resolveOwner(openid, coachId) {
    if (!openid) {
        return { ok: false, error: { success: false, reason: 'missing_openid', error: 'openid is required', statusCode: 400 } };
    }
    const { rows } = await pool.query(
        // language rides along so an extraction queued here can snapshot it, and the result
        // message localises without a second read at delivery time.
        'SELECT user_id, language FROM users WHERE user_id = $1 OR external_id = $1 LIMIT 1', [openid]
    );
    const userId = rows[0]?.user_id;
    if (!userId) {
        return { ok: false, error: { success: false, reason: 'user_not_found', error: 'User not found', statusCode: 404 } };
    }
    if (coachId) {
        const check = await pool.query('SELECT 1 FROM users WHERE user_id = $1 AND coach_id = $2', [userId, coachId]);
        if (check.rows.length === 0) {
            return { ok: false, error: { success: false, reason: 'access_denied', error: 'Access denied', statusCode: 403 } };
        }
    }
    return { ok: true, userId, language: rows[0].language || 'zh' };
}

// Upload, register and delete are the owner's alone — a coach reads a client's records, it never
// adds to or removes from them. This refusal is a statement of intent, not enforcement: a caller
// can always omit coach_id and send a bare openid, the same as any caller of any endpoint here.
// "A coach cannot upload" actually lives in the UI, as can-upload="{{mode === 'self'}}" on
// <health-documents> in user-health.wxml.
function _refuseCoach(coachId) {
    if (!coachId) return null;
    return { success: false, reason: 'coach_cannot_write', error: 'A coach cannot upload or delete a client\'s records', statusCode: 403 };
}

function _keyPrefix(userId) {
    return `health-documents/${userId}/`;
}

function _extensionOf(filename) {
    const ext = String(filename || '').includes('.')
        ? String(filename).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';
    return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

function _publicRow(row) {
    // oss_key deliberately absent — see the header note.
    return {
        id: Number(row.id),
        filename: row.filename,
        content_type: row.content_type,
        size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
        doc_type: row.doc_type,
        doc_date: row.doc_date,
        institution: row.institution,
        note: row.note,
        uploaded_by: row.uploaded_by,
        created_at: row.created_at,
    };
}

// Mints a presigned PUT the miniapp uploads to directly. The key is built here, never accepted
// from the client, so it always lands under the caller's own prefix.
async function handleGetHealthDocumentPresign(query) {
    try {
        const refusal = _refuseCoach(query?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(query?.openid, null);
        if (!owner.ok) return owner.error;

        const filename = String(query?.filename || '').trim();
        if (!filename) return { success: false, error: 'filename is required', statusCode: 400 };
        const ext = _extensionOf(filename);
        if (!ext) {
            return { success: false, error: `Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`, statusCode: 400 };
        }
        const declaredSize = parseInt(query?.size_bytes, 10);
        if (declaredSize && declaredSize > MAX_DOCUMENT_BYTES) {
            return { success: false, error: 'File exceeds the 20 MB limit', statusCode: 400 };
        }

        const key = `${_keyPrefix(owner.userId)}${crypto.randomBytes(12).toString('hex')}.${ext}`;
        // Sign the REAL content type, not octet-stream. This bucket refuses a
        // response-content-type override at download time, so upload is the only chance to get
        // it right — otherwise every PDF is served as an opaque binary and neither a browser
        // nor wx.openDocument can tell what it is.
        const contentType = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
        return {
            success: true,
            key,
            put_url: ossLib.generatePresignedPutUrl(key, 3600, null, contentType),
            // The PUT must send exactly this header — it is part of the signature, and any
            // mismatch yields SignatureDoesNotMatch. Returned explicitly so the client never
            // has to infer it.
            put_content_type: contentType,
            max_bytes: MAX_DOCUMENT_BYTES,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthDocumentPresign failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// Registers an object the client has already PUT to OSS. Size/ETag come from a HEAD against the
// real object rather than the client's claim, so the stored metadata always describes what is
// actually in the bucket.
async function handlePostHealthDocument(body) {
    try {
        const refusal = _refuseCoach(body?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(body?.openid, null);
        if (!owner.ok) return owner.error;
        const userId = owner.userId;

        const ossKey = String(body?.oss_key || '').trim();
        const filename = String(body?.filename || '').trim();
        if (!ossKey || !filename) return { success: false, error: 'oss_key and filename are required', statusCode: 400 };
        if (!ossKey.startsWith(_keyPrefix(userId))) {
            // A caller trying to attach someone else's object to their own list.
            return { success: false, error: 'Invalid oss_key', statusCode: 403 };
        }

        const docType = VALID_DOC_TYPES.has(body?.doc_type) ? body.doc_type : 'other';
        const docDate = body?.doc_date || null;
        const institution = body?.institution ? String(body.institution).trim().slice(0, 200) : null;
        const note = body?.note ? String(body.note).trim().slice(0, 1000) : null;

        const head = await ossLib.headObject(ossKey);
        if (!head) {
            // Object isn't there — almost always a failed/aborted PUT. Better to say so than to
            // register a row pointing at nothing.
            return { success: false, error: 'Uploaded file not found in storage', statusCode: 400 };
        }
        if (head.size_bytes && head.size_bytes > MAX_DOCUMENT_BYTES) {
            await ossLib.deleteObject(ossKey);
            return { success: false, error: 'File exceeds the 20 MB limit', statusCode: 400 };
        }

        // head.content_type is now authoritative — the presign signed the real type, so what
        // OSS reports is what will actually be served on download.
        const contentType = head.content_type || CONTENT_TYPE_BY_EXT[_extensionOf(filename)] || null;

        const { rows: [row] } = await pool.query(
            `INSERT INTO health_documents
                (user_id, oss_key, filename, content_type, size_bytes, etag, doc_type, doc_date, institution, note, uploaded_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'user')
             RETURNING *, doc_date::text AS doc_date`,
            [userId, ossKey, filename.slice(0, 300), contentType, head.size_bytes, head.etag, docType, docDate, institution, note]
        );
        // Queue an extraction. A document nobody reads is the problem this feature exists to
        // solve, so this is automatic rather than a button the user has to find.
        //
        // Required at CALL TIME, not at module load: handlers/doc_extraction.js pulls in
        // handlers/chat.js (for deliverTerminalMessage) and with it the whole prompt/LLM graph,
        // which has no business on the upload path of a warm container. Same reason
        // handlers/users.js requires './chat' at its call site (CLAUDE.md 28c).
        //
        // A failure here must never fail the upload: the document is safely stored either way and
        // the user can re-run extraction by hand.
        try {
            const { enqueueDocExtraction } = require('./doc_extraction');
            await enqueueDocExtraction(row.id, userId, { language: owner.language });
        } catch (queueErr) {
            console.error(JSON.stringify({ level: 'WARN', msg: 'doc extraction enqueue failed', document_id: row.id, error: queueErr.message }));
        }

        return { success: true, document: _publicRow(row) };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'This file is already registered', statusCode: 409 };
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthDocument failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleGetHealthDocuments(query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows } = await pool.query(
            // doc_date::text, not the raw DATE: node-postgres turns a DATE into a JS Date at
            // local midnight, which serializes to a UTC instant and can read as the previous
            // day on the client. Same cast lib/twinBundle.js applies for the same reason.
            `SELECT *, doc_date::text AS doc_date FROM health_documents
             WHERE user_id = $1 AND status = 'active'
             ORDER BY COALESCE(doc_date, created_at::date) DESC, id DESC LIMIT 200`,
            [owner.userId]
        );

        // The extraction state, joined on the newest job per document. DISTINCT ON rather than a
        // correlated subquery because a re-run leaves the previous job in place as history.
        //
        // Degrades to no extraction state rather than failing the list. This endpoint predates
        // extraction and is the user's only view of their own records: it must keep working if
        // doc_extraction_jobs is missing (worker deployed ahead of its migration) or the query
        // fails for any other reason.
        let byDoc = new Map();
        try {
            const { rows: jobs } = await pool.query(
                `SELECT DISTINCT ON (document_id) document_id, status, result, rejected, health_report_id
                   FROM doc_extraction_jobs
                  WHERE user_id = $1
                  ORDER BY document_id, created_at DESC`,
                [owner.userId]
            );
            byDoc = new Map(jobs.map(j => [Number(j.document_id), j]));
        } catch (jobErr) {
            console.error(JSON.stringify({ level: 'WARN', msg: 'extraction state unavailable', error: jobErr.message }));
        }

        return {
            success: true,
            documents: rows.map(r => {
                const pub = _publicRow(r);
                pub.summary = r.summary || null;
                const job = byDoc.get(Number(r.id));
                pub.extraction = job ? {
                    status: job.status,
                    // Counts only. The values themselves are already visible as the document's
                    // own metadata and in the Medical Records layer; repeating them here would be
                    // a second copy to keep in step.
                    accepted: job.result?.counts?.observations_accepted ?? 0,
                    findings: job.result?.counts?.findings_accepted ?? 0,
                    unmapped: job.result?.counts?.unmapped ?? 0,
                    rejected: Array.isArray(job.rejected) ? job.rejected.length : 0,
                    has_report: job.health_report_id != null,
                } : null;
                return pub;
            }),
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthDocuments failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// The authorized read path. Resolves the owner server-side and checks it against the row,
// rather than trusting a client-supplied key (which is what /oss/presign does).
async function handleGetHealthDocumentUrl(documentId, query) {
    try {
        const owner = await _resolveOwner(query?.openid, query?.coach_id);
        if (!owner.ok) return owner.error;
        const { rows: [doc] } = await pool.query(
            `SELECT *, doc_date::text AS doc_date FROM health_documents
             WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, owner.userId]
        );
        if (!doc) return { success: false, error: 'Document not found', statusCode: 404 };
        return {
            success: true,
            url: ossLib.generatePresignedGetUrl(doc.oss_key, USER_URL_TTL_SECONDS, null, null, {
                filename: doc.filename,
            }),
            expires_in: USER_URL_TTL_SECONDS,
            filename: doc.filename,
            content_type: doc.content_type,
            size_bytes: doc.size_bytes != null ? Number(doc.size_bytes) : null,
        };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthDocumentUrl failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// SOFT delete. A running viva_ag_jobs row can hold a 6-hour presigned URL to this object and
// snapshots its id in document_ids; hard-deleting either would break an in-flight job. The row
// disappears from every user-facing list immediately; the object is left for a future purge.
async function handleDeleteHealthDocument(documentId, query) {
    try {
        const refusal = _refuseCoach(query?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(query?.openid, null);
        if (!owner.ok) return owner.error;
        const { rowCount } = await pool.query(
            `UPDATE health_documents SET status = 'deleted', deleted_at = NOW()
             WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, owner.userId]
        );
        if (rowCount === 0) return { success: false, error: 'Document not found', statusCode: 404 };
        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteHealthDocument failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

/**
 * POST /health-documents/:id/extract — re-run extraction, or run it for the first time on a
 * document uploaded before this feature existed.
 *
 * The previous extraction is cleared BEFORE the new job is queued, and that ordering is
 * mandatory rather than tidy: health_events dedupes on (user_id, source, external_id) with
 * ON CONFLICT DO NOTHING, so a corrected value for the same marker and date would otherwise be a
 * silent no-op and the re-run would appear to change nothing.
 */
async function handlePostHealthDocumentExtract(documentId, body) {
    try {
        const refusal = _refuseCoach(body?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(body?.openid, null);
        if (!owner.ok) return owner.error;

        const { rows: [doc] } = await pool.query(
            `SELECT id FROM health_documents WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, owner.userId]
        );
        if (!doc) return { success: false, reason: 'document_not_found', error: 'Document not found', statusCode: 404 };

        const { clearExtraction, enqueueDocExtraction } = require('./doc_extraction');
        const removed = await clearExtraction(doc.id, owner.userId);
        const jobUid = await enqueueDocExtraction(doc.id, owner.userId, { language: owner.language });
        // A null job_uid means one is already in flight for this document — a double tap, not an
        // error. Report it so the client can say "already running" rather than "queued".
        return { success: true, queued: !!jobUid, ...removed };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthDocumentExtract failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

/**
 * DELETE /health-documents/:id/extraction — the user's 解析有误.
 *
 * Removes everything the extraction wrote and marks the job 'rejected', which is deliberately a
 * different terminal state from 'failed': a failure may legitimately be retried, but a result the
 * user has explicitly thrown away must not be silently recreated. The DOCUMENT itself is
 * untouched — they are saying the reading was wrong, not that the file was.
 */
async function handleDeleteHealthDocumentExtraction(documentId, query) {
    try {
        const refusal = _refuseCoach(query?.coach_id);
        if (refusal) return refusal;
        const owner = await _resolveOwner(query?.openid, null);
        if (!owner.ok) return owner.error;

        const { rows: [doc] } = await pool.query(
            `SELECT id FROM health_documents WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, owner.userId]
        );
        if (!doc) return { success: false, reason: 'document_not_found', error: 'Document not found', statusCode: 404 };

        const { clearExtraction } = require('./doc_extraction');
        const removed = await clearExtraction(doc.id, owner.userId);
        await pool.query(
            `UPDATE doc_extraction_jobs
                SET status = 'rejected', result_token = NULL, completed_at = NOW(), updated_at = NOW()
              WHERE document_id = $1 AND status <> 'rejected'`,
            [doc.id]
        );
        return { success: true, ...removed };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteHealthDocumentExtraction failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = {
    handlePostHealthDocumentExtract,
    handleDeleteHealthDocumentExtraction,
    handleGetHealthDocumentPresign,
    handlePostHealthDocument,
    handleGetHealthDocuments,
    handleGetHealthDocumentUrl,
    handleDeleteHealthDocument,
    MAX_DOCUMENT_BYTES,
    VALID_DOC_TYPES,
    ALLOWED_EXTENSIONS,
    OFFICE_EXTENSIONS,
};
