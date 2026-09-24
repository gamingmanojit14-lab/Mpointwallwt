/**
 * Cryptographic helpers — SHA-256 secret hashing, secret generation, HMAC signing.
 */
const crypto = require('crypto');

/**
 * SHA-256 hex hash of a plaintext secret.
 */
function hashSecret(code) {
  return crypto.createHash('sha256').update(String(code), 'utf8').digest('hex');
}

/**
 * Generate a fresh "sk_live_" + 32 base62 chars secret.
 */
function generateSecretCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(32);
  let s = 'sk_live_';
  for (let i = 0; i < 32; i++) s += chars[bytes[i] % chars.length];
  return s;
}

/**
 * HMAC-SHA256 sign a payload string with a secret. Returns hex digest.
 */
function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(String(payload), 'utf8').digest('hex');
}

/**
 * Timing-safe compare two hex strings of same length.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Generate random ID string (e.g., for txId suffixes, requestIds).
 */
function randomId(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
  return s;
}

module.exports = { hashSecret, generateSecretCode, signPayload, safeEqual, randomId };
