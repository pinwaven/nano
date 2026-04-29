const OSS = require('ali-oss');
const crypto = require('crypto');

const getClient = () => new OSS({
    region:          process.env.OSS_REGION || 'oss-cn-shanghai',
    accessKeyId:     process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
    bucket:          process.env.OSS_BUCKET,
    secure:          true,
});

function generateKey(type, filename, category = 'academy') {
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'bin';
    const id  = crypto.randomBytes(8).toString('hex');
    return `${category}/${type}/${id}.${ext}`;
}

// Returns a signed URL the client can PUT to directly (no credentials needed).
// Content-Type must be signed and matched by the caller, otherwise OSS returns SignatureDoesNotMatch.
function generatePresignedPutUrl(key, expiresSeconds = 3600) {
    const client = getClient();
    return client.signatureUrl(key, {
        method: 'PUT',
        expires: expiresSeconds,
        'Content-Type': 'application/octet-stream',
    });
}

// Returns a signed URL the client can GET from (time-limited)
function generatePresignedGetUrl(key, expiresSeconds = 86400) {
    const client = getClient();
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

module.exports = { generateKey, generatePresignedPutUrl, generatePresignedGetUrl, deleteObject };
