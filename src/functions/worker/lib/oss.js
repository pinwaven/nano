const OSS = require('ali-oss');
const crypto = require('crypto');

const getClient = (bucket = null, cnameDomain = null) => {
    const opts = {
        region:          process.env.OSS_REGION || 'oss-cn-shanghai',
        accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
        bucket:          bucket || process.env.OSS_BUCKET,
        secure:          true,
    };
    if (cnameDomain) {
        opts.cname    = true;
        opts.endpoint = cnameDomain;
    }
    return new OSS(opts);
};

function generateKey(type, filename, category = 'academy') {
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'bin';
    const id  = crypto.randomBytes(8).toString('hex');
    return `${category}/${type}/${id}.${ext}`;
}

// Returns a signed URL the client can PUT to directly (no credentials needed).
// Content-Type must be signed and matched by the caller, otherwise OSS returns SignatureDoesNotMatch.
//
// contentType is optional and defaults to the historical 'application/octet-stream', so every
// pre-existing caller is unchanged. Pass the real type (e.g. 'application/pdf') when you know
// it: OSS stores whatever was signed, and this bucket REFUSES a response-content-type override
// at download time ("Can not override response header on content-type", confirmed live), so
// signing it here is the only way an object ends up served with a correct Content-Type.
function generatePresignedPutUrl(key, expiresSeconds = 3600, bucket = null, contentType = 'application/octet-stream') {
    const client = getClient(bucket);
    return client.signatureUrl(key, {
        method: 'PUT',
        expires: expiresSeconds,
        'Content-Type': contentType,
    });
}

// Returns a signed URL the client can GET from (time-limited).
// Pass cnameDomain to produce a URL on a custom domain instead of *.oss-cn-shanghai.aliyuncs.com
// (required for APK distribution — Aliyun blocks APKs on the default OSS endpoint).
//
// `opts` is optional and additive — every pre-existing call site keeps its exact behavior:
//   filename → sets Content-Disposition: attachment; filename="…" on the response, so a
//              downloaded file lands with its real name instead of the hex OSS key. RFC 5987
//              encoded, since these filenames are routinely Chinese.
//   inline   → Content-Disposition: inline instead of attachment.
//
// There is deliberately NO content-type override here: this bucket rejects one outright with
// 400 InvalidRequest, "Can not override response header on content-type" (confirmed live
// 2026-08-23 — a signed URL carrying response-content-type fails for the object entirely, it
// does not degrade gracefully). Content-Type is instead fixed at UPLOAD time by passing the
// real type to generatePresignedPutUrl above.
//
// A presigned OSS GET honours HTTP Range regardless of any of this, which is what lets a large
// PDF be fetched in chunks or resumed rather than restarted.
function generatePresignedGetUrl(key, expiresSeconds = 86400, bucket = null, cnameDomain = null, opts = null) {
    const client = getClient(bucket, cnameDomain);
    const signOpts = { method: 'GET', expires: expiresSeconds };
    if (opts && opts.filename) {
        const disposition = opts.inline ? 'inline' : 'attachment';
        const ascii = opts.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
        signOpts.response = {
            'content-disposition':
                `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
        };
    }
    return client.signatureUrl(key, signOpts);
}

// Reads an object's metadata without downloading it. Used to capture size/ETag at registration
// time so a downloader can verify a large, possibly resumed, multi-hour fetch completed intact.
// Returns null rather than throwing — a missing ETag is a degraded but usable state.
async function headObject(key, bucket = null) {
    try {
        const client = getClient(bucket);
        const res = await client.head(key);
        const headers = res.res?.headers || {};
        return {
            // OSS returns the ETag uppercase and quoted; every md5 tool a consumer will reach
            // for emits lowercase, so normalise here rather than making each caller remember.
            etag: (headers.etag || '').replace(/"/g, '').toLowerCase() || null,
            size_bytes: headers['content-length'] ? parseInt(headers['content-length'], 10) : null,
            content_type: headers['content-type'] || null,
        };
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'OSS head failed', key, error: err.message }));
        return null;
    }
}

async function deleteObject(key) {
    try {
        const client = getClient();
        await client.delete(key);
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'OSS delete failed', key, error: err.message }));
    }
}

// Downloads an OSS object and returns its content as a Buffer.
async function getObjectBuffer(key) {
    const client = getClient();
    const result = await client.get(key);
    return result.content;
}

// Uploads a Buffer directly from the server (no presigned round-trip needed).
async function putObjectBuffer(key, buffer, contentType = 'application/octet-stream') {
    const client = getClient();
    await client.put(key, buffer, { mime: contentType });
    return key;
}

module.exports = { generateKey, generatePresignedPutUrl, generatePresignedGetUrl, headObject, deleteObject, getObjectBuffer, putObjectBuffer };
