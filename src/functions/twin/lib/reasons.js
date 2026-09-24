'use strict';
// Machine-readable failure reasons. Every response is HTTP 200 with {success, reason} except
// auth (401/403) — the same posture as /viva-ag/* and /doc-extract/*.
const REASONS = {
    MISSING_PARAMS: 'missing_params',
    NOT_FOUND: 'not_found',
    SUBJECT_NOT_FOUND: 'subject_not_found',
    DOCUMENT_NOT_FOUND: 'document_not_found',
    UNSUPPORTED_KIND: 'unsupported_kind',
    UNSUPPORTED_FILE_TYPE: 'unsupported_file_type',
    INVALID_FILE_KEY: 'invalid_file_key',
    FILE_MISSING: 'file_missing',
    TOO_MANY_FILES: 'too_many_files',
    INVALID_ORIGIN: 'invalid_origin',
    CONFLICT: 'contribution_conflict',
    INTERNAL_ERROR: 'internal_error',
};

function fail(reason, error) {
    return { success: false, reason, ...(error ? { error } : {}) };
}

module.exports = { REASONS, fail };
