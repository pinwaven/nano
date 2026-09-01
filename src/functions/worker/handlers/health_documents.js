'use strict';

/**
 * User-uploaded health record documents (PDFs of hospital records, discharge summaries,
 * imaging reports, ...). Backs the Viva AG subtab's document manager.
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
 *   5. Every endpoint re-checks the Viva AG entitlement server-side; the miniapp's subtab
 *      gating is cosmetic.
 */

const crypto = require('crypto');
const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const { requireVivaAgAccess } = require('../lib/vivaAgAccess');

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
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;

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

        const key = `${_keyPrefix(gate.user.user_id)}${crypto.randomBytes(12).toString('hex')}.${ext}`;
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
        const gate = await requireVivaAgAccess(body?.openid);
        if (!gate.ok) return gate.error;
        const userId = gate.user.user_id;

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
        return { success: true, document: _publicRow(row) };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'This file is already registered', statusCode: 409 };
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handlePostHealthDocument failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

async function handleGetHealthDocuments(query) {
    try {
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        const { rows } = await pool.query(
            // doc_date::text, not the raw DATE: node-postgres turns a DATE into a JS Date at
            // local midnight, which serializes to a UTC instant and can read as the previous
            // day on the client. Same cast lib/twinBundle.js applies for the same reason.
            `SELECT *, doc_date::text AS doc_date FROM health_documents
             WHERE user_id = $1 AND status = 'active'
             ORDER BY COALESCE(doc_date, created_at::date) DESC, id DESC LIMIT 200`,
            [gate.user.user_id]
        );
        return { success: true, documents: rows.map(_publicRow) };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleGetHealthDocuments failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

// The authorized read path. Resolves the owner server-side and checks it against the row,
// rather than trusting a client-supplied key (which is what /oss/presign does).
async function handleGetHealthDocumentUrl(documentId, query) {
    try {
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        const { rows: [doc] } = await pool.query(
            `SELECT *, doc_date::text AS doc_date FROM health_documents
             WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, gate.user.user_id]
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
        const gate = await requireVivaAgAccess(query?.openid);
        if (!gate.ok) return gate.error;
        const { rowCount } = await pool.query(
            `UPDATE health_documents SET status = 'deleted', deleted_at = NOW()
             WHERE id = $1 AND user_id = $2 AND status = 'active'`,
            [documentId, gate.user.user_id]
        );
        if (rowCount === 0) return { success: false, error: 'Document not found', statusCode: 404 };
        return { success: true };
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'handleDeleteHealthDocument failed', error: err.message }));
        return { success: false, error: err.message };
    }
}

module.exports = {
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
