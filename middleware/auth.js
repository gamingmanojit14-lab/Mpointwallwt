/**
 * Integration authentication:
 *   Headers: x-api-key + x-shop-id
 *   → Firestore config/integrations/list/{shopId} doc থেকে SHA-256 hash match করা হয়
 *   → status active কিনা check
 *   → lastUsedAt update
 */
const { db } = require('../utils/firebase');
const { hashSecret, safeEqual } = require('../utils/hashing');
const { logIntegration } = require('../utils/txLogger');

async function authenticateIntegration(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const shopId = req.headers['x-shop-id'];
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  if (!apiKey || !shopId) {
    await logIntegration({
      integrationId: shopId || 'unknown',
      action: 'auth_failed',
      success: false,
      error: 'Missing credentials',
      ip,
      userAgent: ua,
    });
    return res.status(401).json({ success: false, error: 'Missing credentials' });
  }

  try {
    const ref = db().collection('config').doc('integrations').collection('list').doc(shopId);
    const doc = await ref.get();

    if (!doc.exists) {
      await logIntegration({
        integrationId: shopId,
        action: 'auth_failed',
        success: false,
        error: 'Integration not found',
        ip,
        userAgent: ua,
      });
      return res.status(401).json({ success: false, error: 'Integration not found' });
    }

    const data = doc.data();

    if (data.status !== 'active') {
      await logIntegration({
        integrationId: shopId,
        action: 'auth_failed',
        success: false,
        error: `Integration ${data.status}`,
        ip,
        userAgent: ua,
      });
      return res.status(403).json({ success: false, error: 'Integration paused or disabled' });
    }

    const incomingHash = hashSecret(apiKey);
    if (!safeEqual(incomingHash, data.secretCodeHash || '')) {
      await logIntegration({
        integrationId: shopId,
        action: 'auth_failed',
        success: false,
        error: 'Invalid secret code',
        ip,
        userAgent: ua,
      });
      return res.status(401).json({ success: false, error: 'Invalid secret code' });
    }

    // lastUsedAt update (best-effort — errors ignored)
    ref.update({ lastUsedAt: new Date() }).catch(() => {});

    // expose integration info to route handlers
    req.integration = { shopId, data };
    // expose plaintext apiKey for HMAC signing in /createPaymentRequest
    req.apiKeyPlain = apiKey;

    next();
  } catch (e) {
    console.error('Auth middleware error:', e);
    await logIntegration({
      integrationId: shopId,
      action: 'auth_failed',
      success: false,
      error: e.message,
      ip,
      userAgent: ua,
    });
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
}

module.exports = { authenticateIntegration };
