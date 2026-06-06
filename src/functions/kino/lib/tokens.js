const crypto = require('crypto');

function getTokenBytes() {
  const parsed = Number(process.env.KINO_TOKEN_BYTES || 32);
  return Number.isInteger(parsed) && parsed >= 16 ? parsed : 32;
}

function generateToken() {
  return crypto.randomBytes(getTokenBytes()).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function getEncryptionKey(value = process.env.KINO_ROOT_TOKEN_ENCRYPTION_KEY) {
  if (!value) {
    throw new Error('KINO_ROOT_TOKEN_ENCRYPTION_KEY not configured');
  }
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const raw = Buffer.from(value, 'base64');
  if (raw.length === 32) return raw;

  throw new Error('KINO_ROOT_TOKEN_ENCRYPTION_KEY must be 32 bytes as hex or base64');
}

function encryptToken(token, keyValue = process.env.KINO_ROOT_TOKEN_ENCRYPTION_KEY) {
  const key = getEncryptionKey(keyValue);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function decryptToken(payload, keyValue = process.env.KINO_ROOT_TOKEN_ENCRYPTION_KEY) {
  const parts = String(payload || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('invalid encrypted token payload');
  }

  const key = getEncryptionKey(keyValue);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function getCommTokenTtlDays(value = process.env.KINO_COMM_TOKEN_TTL_DAYS) {
  const parsed = Number(value || 7);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
}

function getExpiryIso(now = new Date(), ttlDays = getCommTokenTtlDays()) {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  decryptToken,
  encryptToken,
  generateToken,
  getCommTokenTtlDays,
  getExpiryIso,
  hashToken,
};
