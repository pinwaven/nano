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
function generatePresignedPutUrl(key, expiresSeconds = 3600, bucket = null) {
    const client = getClient(bucket);
    return client.signatureUrl(key, {
        method: 'PUT',
        expires: expiresSeconds,
        'Content-Type': 'application/octet-stream',
    });
}

// Returns a signed URL the client can GET from (time-limited).
// Pass cnameDomain to produce a URL on a custom domain instead of *.oss-cn-shanghai.aliyuncs.com
// (required for APK distribution — Aliyun blocks APKs on the default OSS endpoint).
function generatePresignedGetUrl(key, expiresSeconds = 86400, bucket = null, cnameDomain = null) {
    const client = getClient(bucket, cnameDomain);
    return client.signatureUrl(key, { method: 'GET', expires: expiresSeconds });
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

module.exports = { generateKey, generatePresignedPutUrl, generatePresignedGetUrl, deleteObject, getObjectBuffer };
