'use strict';

/**
 * Self-documenting endpoints for the external Viva AG API.
 *
 * Both files live under src/functions/worker/docs/ and ship with the function — s.yaml's
 * worker entry is `code: ./src/functions/worker`, so the whole directory is deployed. That is
 * the point: the contract cannot drift away from the code the way a wiki page or a README in
 * another repo would, and whoever is building the external agent can read it from the live
 * endpoint they are already authenticating against.
 *
 * Read once at module load, not per request (CLAUDE.md 6 — keep work out of the handler so a
 * warm container reuses it).
 *
 * Both are behind the VIVA_AG_API_TOKEN allowlist rather than public: the operator holds the
 * token anyway, and an unauthenticated endpoint describing how to reach medical records is
 * free reconnaissance.
 */

const fs = require('fs');
const path = require('path');

function _load(filename) {
    try {
        return fs.readFileSync(path.join(__dirname, '..', 'docs', filename), 'utf8');
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'viva_ag docs load failed', filename, error: err.message }));
        return null;
    }
}

const API_MARKDOWN = _load('viva-ag-api.md');
const API_OPENAPI = _load('viva-ag-openapi.json');

// _rawText routes through index.js's text/plain envelope branch, so this renders readably in a
// terminal via curl and in a browser rather than arriving as a JSON-escaped blob.
async function handleGetVivaAgDocs() {
    if (!API_MARKDOWN) return { success: false, error: 'Documentation unavailable' };
    return { _rawText: true, content: API_MARKDOWN };
}

async function handleGetVivaAgOpenApi() {
    if (!API_OPENAPI) return { success: false, error: 'Specification unavailable' };
    // _rawBinary lets us set a real application/json content type and emit the file verbatim,
    // rather than re-serializing a parsed object (which would reorder keys and drop formatting).
    return {
        _rawBinary: true,
        contentType: 'application/json; charset=utf-8',
        content: Buffer.from(API_OPENAPI, 'utf8').toString('base64'),
    };
}

module.exports = { handleGetVivaAgDocs, handleGetVivaAgOpenApi };
