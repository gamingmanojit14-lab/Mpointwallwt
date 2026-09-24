const express = require('express');
const { authenticateIntegration } = require('../middleware/auth');
const { logIntegration } = require('../utils/txLogger');
const { atomicTransfer } = require('../services/transactionService');
const { getWallet } = require('../services/walletService');

const router = express.Router();

/**
 * POST /api/creditPoints
 * Body: { customerWalletId, amount, externalRef?, note? }
 * Effect: merchant → customer transfer (loyalty earn)
 */
router.post('/creditPoints', authenticateIntegration, async (req, res) => {
  const { shopId, data } = req.integration;
  const { customerWalletId, amount, externalRef = '', note = '' } = req.body || {};
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  const amt = Number(amount);

  if (!customerWalletId || !Number.isFinite(amt) || amt <= 0) {
    await logIntegration({
      integrationId: shopId,
      action: 'credit',
      amount: amt,
      customerWalletId,
      success: false,
      error: 'Invalid params',
      ip,
      userAgent: ua,
    });
    return res.status(400).json({ success: false, error: 'Invalid params' });
  }

  if (!data.allowAutoCredit) {
    await logIntegration({
      integrationId: shopId,
      action: 'credit',
      amount: amt,
      customerWalletId,
      success: false,
      error: 'Auto credit not allowed',
      ip,
      userAgent: ua,
    });
    return res.status(403).json({ success: false, error: 'Auto credit not allowed' });
  }

  const merchantWallet = await getWallet(data.merchantWalletId);
  if (!merchantWallet) {
    await logIntegration({
      integrationId: shopId,
      action: 'credit',
      success: false,
      error: 'Merchant wallet missing',
      ip,
      userAgent: ua,
    });
    return res.status(500).json({ success: false, error: 'Merchant wallet missing' });
  }

  try {
    const result = await atomicTransfer({
      fromWalletId: data.merchantWalletId,
      toWalletId: customerWalletId,
      amount: amt,
      note: note || 'Loyalty earn',
      externalRef,
      source: `textilepos:${shopId}`,
    });

    await logIntegration({
      integrationId: shopId,
      action: 'credit',
      amount: amt,
      customerWalletId,
      merchantWalletId: data.merchantWalletId,
      externalRef,
      success: true,
      ip,
      userAgent: ua,
      meta: { txId: result.txId },
    });

    res.json({ success: true, txId: result.txId, newBalance: result.toBalanceAfter });
  } catch (e) {
    console.error('Credit error:', e);
    await logIntegration({
      integrationId: shopId,
      action: 'credit',
      amount: amt,
      customerWalletId,
      merchantWalletId: data.merchantWalletId,
      externalRef,
      success: false,
      error: e.message,
      ip,
      userAgent: ua,
    });
    const status = /Insufficient|not found|suspended/.test(e.message) ? 400 : 500;
    res.status(status).json({ success: false, error: e.message });
  }
});

module.exports = router;
