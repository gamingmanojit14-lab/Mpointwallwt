const express = require('express');
const { authenticateIntegration } = require('../middleware/auth');
const { logIntegration } = require('../utils/txLogger');
const { getWallet } = require('../services/walletService');

const router = express.Router();

/**
 * GET /api/getBalance?walletId=W-XXXXXX
 */
router.get('/getBalance', authenticateIntegration, async (req, res) => {
  const { shopId } = req.integration;
  const { walletId } = req.query;

  if (!walletId) {
    return res.status(400).json({ success: false, error: 'walletId required' });
  }

  try {
    const w = await getWallet(walletId);
    if (!w) {
      await logIntegration({
        integrationId: shopId,
        action: 'balance',
        customerWalletId: walletId,
        success: false,
        error: 'Wallet not found',
        ip: req.ip,
        userAgent: req.headers['user-agent'] || '',
      });
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    await logIntegration({
      integrationId: shopId,
      action: 'balance',
      customerWalletId: walletId,
      success: true,
      ip: req.ip,
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({
      success: true,
      walletId,
      balance: Number(w.balance || 0),
      walletStatus: w.walletStatus,
      name: w.name || w.shopName || '',
      isMerchant: !!w.isMerchant,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
