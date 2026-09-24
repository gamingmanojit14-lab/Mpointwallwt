const express = require('express');
const { authenticateIntegration } = require('../middleware/auth');
const { logIntegration } = require('../utils/txLogger');

const router = express.Router();

/**
 * POST /api/verifyConnection
 * Headers: x-api-key, x-shop-id
 * Response: { success, shopName, shopId, merchantWalletId, status, allowAutoDebit, allowAutoCredit }
 */
router.post('/verifyConnection', authenticateIntegration, async (req, res) => {
  const { shopId, data } = req.integration;

  await logIntegration({
    integrationId: shopId,
    action: 'verify',
    success: true,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
  });

  res.json({
    success: true,
    shopName: data.shopName || '',
    shopId,
    merchantWalletId: data.merchantWalletId,
    status: data.status,
    allowAutoDebit: !!data.allowAutoDebit,
    allowAutoCredit: !!data.allowAutoCredit,
  });
});

module.exports = router;
