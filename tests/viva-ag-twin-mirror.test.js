'use strict';
// The twin mirror's version hash: stable across mints of an unchanged twin, moved by content.
const test = require('node:test');
const assert = require('node:assert/strict');
const { twinVersionOf, _stripVolatile, mintSubjectRef, SUBJECT_REF_PREFIX } = require('../src/functions/worker/lib/twinMirror');

function bundle(overrides = {}) {
    return {
        success: true,
        generated_at: '2026-09-20 10:00:00',
        bundle_version: 5,
        subject: { ref: 'job-1', age: 40, gender: 'male', language: 'zh' },
        layers: { medical_records: { documents: [
            { document_id: 7, etag: 'e7', filename: 'a.pdf', url: 'https://oss/1?sig=x', url_expires_at: '2026-09-20 16:00:00' },
        ] }, daily_monitoring: { health_twin: { avg_hrv_ms: 51 } } },
        job: { job_uid: 'job-1' },
        job_questionnaires: [{ round: 1 }],
        ...overrides,
    };
}

test('two mints of the same twin hash the same', () => {
    const a = bundle();
    const b = bundle({
        generated_at: '2026-09-21 09:00:00',
        subject: { language: 'zh', gender: 'male', age: 40, ref: 'vs_abc' },   // key order + ref differ
        job: null, job_questionnaires: [],
    });
    b.layers.medical_records.documents[0].url = 'https://oss/1?sig=y';
    b.layers.medical_records.documents[0].url_expires_at = '2026-09-21 15:00:00';
    assert.equal(twinVersionOf(a), twinVersionOf(b));
});

test('content moves the version', () => {
    const a = bundle();
    const b = bundle(); b.layers.daily_monitoring.health_twin.avg_hrv_ms = 52;
    const c = bundle(); c.layers.medical_records.documents[0].etag = 'e8';
    const d = bundle(); d.layers.medical_records.documents = [];
    const vs = new Set([a, b, c, d].map(twinVersionOf));
    assert.equal(vs.size, 4);
});

test('stripping removes every volatile field and nothing else', () => {
    const s = _stripVolatile(bundle());
    assert.equal(s.generated_at, undefined);
    assert.equal(s.job, undefined);
    assert.equal(s.job_questionnaires, undefined);
    assert.equal(s.subject.ref, undefined);
    assert.equal(s.subject.age, 40);
    const doc = s.layers.medical_records.documents[0];
    assert.equal(doc.url, undefined);
    assert.equal(doc.url_expires_at, undefined);
    assert.equal(doc.etag, 'e7');
    assert.equal(s.bundle_version, 5);
});

test('a subject_ref is prefixed, random and not derivable', () => {
    const a = mintSubjectRef(), b = mintSubjectRef();
    assert.ok(a.startsWith(SUBJECT_REF_PREFIX) && a.length === SUBJECT_REF_PREFIX.length + 24);
    assert.notEqual(a, b);
});
