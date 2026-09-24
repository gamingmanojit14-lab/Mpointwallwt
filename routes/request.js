const express = require('express');
const crypto = require('crypto');
const { authenticateIntegration } = require('../middleware/auth');
const { db, FV } = require('../utils/firebase');
const { signPayload } = require('../utils/hashing');
const { logIntegration } = require('../utils/txLogger');

const router = express.Router();

/**
 * POST /api/createPaymentRequest
 * Body: { amount, invoiceNo?, expiresIn? }
 * Response: { success, requestId, paymentURL, expiresAt, signature }
 */
router.post('/createPaymentRequest', authenticateIntegration, async (req, res) => {
  const { shopId, data } = req.integration;
  const { amount, invoiceNo = '', expiresIn = 300 } = req.body || {};
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    await logIntegration({
      integrationId: shopId,
      action: 'create_request',
      success: false,
      error: 'Invalid amount',
      ip,
      userAgent: ua,
    });
    return res.status(400).json({ success: false, error: 'Invalid amount' });
  }

  const ttl = Math.min(Math.max(Number(expiresIn) || 300, 30), 3600); // 30s .. 1h
  const expiresAt = Date.now() + ttl * 1000;
  const requestId = 'PR-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');

  try {
    // HMAC signature binds request contents to the secret. Prevents tampering.
    const payload = `${shopId}|${data.merchantWalletId}|${amt}|${invoiceNo}|${expiresAt}`;
    const signature = signPayload(payload, req.apiKeyPlain);

    await db().collection('requests').doc(requestId).set({
      requestId,
      shopId,
      merchantWalletId: data.merchantWalletId,
      shopName: data.shopName || '',
      amount: amt,
      invoiceNo: String(invoiceNo || ''),
      signature,
      status: 'pending',
      expiresAt,
      createdAt: FV().serverTimestamp(),
    });

    const baseUrl = (process.env.WALLET_APP_URL || '').replace(/\/$/, '');
    const paymentURL = `${baseUrl}/pay.html?r=${encodeURIComponent(requestId)}`;

    await logIntegration({
      integrationId: shopId,
      action: 'create_request',
      amount: amt,
      merchantWalletId: data.merchantWalletId,
      externalRef: invoiceNo,
      success: true,
      ip,
      userAgent: ua,
      meta: { requestId },
    });

    res.json({ success: true, requestId, paymentURL, expiresAt, signature });
  } catch (e) {
    console.error('createPaymentRequest error:', e);
    await logIntegration({
      integrationId: shopId,
      action: 'create_request',
      amount: amt,
      success: false,
      error: e.message,
      ip,
      userAgent: ua,
    });
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/paymentStatus?requestId=PR-XXX
 * TextilePOS salesman.html polls this (or listens to Firestore directly).
 */
router.get('/paymentStatus', authenticateIntegration, async (req, res) => {
  const { shopId } = req.integration;
  const { requestId } = req.query;
  if (!requestId) return res.status(400).json({ success: false, error: 'requestId required' });

  try {
    const doc = await db().collection('requests').doc(requestId).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Request not found' });
    const r = doc.data();
    if (r.shopId !== shopId) {
      return res.status(403).json({ success: false, error: 'Request not for this shop' });
    }
    res.json({
      success: true,
      requestId,
      status: r.status,
      amount: r.amount,
      paidByWalletId: r.paidByWalletId || null,
      paidAt: r.paidAt || null,
      txId: r.txId || null,
      expiresAt: r.expiresAt,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
