const express = require('express');
const { authenticateUser } = require('../middleware/userAuth');
const { atomicTransfer } = require('../services/transactionService');
const { db, FV } = require('../utils/firebase');

const router = express.Router();

/**
 * POST /api/p2pTransfer
 * Auth: Firebase ID token
 * Body: { toWalletId, amount, note? }
 */
router.post('/p2pTransfer', authenticateUser, async (req, res) => {
  const { toWalletId, amount, note = '' } = req.body || {};
  const amt = Number(amount);
  if (!toWalletId || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid params' });
  }
  try {
    const result = await atomicTransfer({
      fromWalletId: req.walletId,
      toWalletId,
      amount: amt,
      note,
      source: 'wallet-app',
    });
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/confirmPayment
 * Auth: Firebase ID token
 * Body: { requestId }
 * Effect: pay a merchant payment request from the authenticated user's wallet
 */
router.post('/confirmPayment', authenticateUser, async (req, res) => {
  const { requestId } = req.body || {};
  if (!requestId) return res.status(400).json({ success: false, error: 'requestId required' });

  try {
    const ref = db().collection('requests').doc(requestId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'Request not found' });
    const r = doc.data();

    if (r.status === 'paid') return res.status(409).json({ success: false, error: 'Already paid' });
    if (r.status !== 'pending') return res.status(409).json({ success: false, error: 'Request not pending' });
    if (Date.now() > r.expiresAt) return res.status(410).json({ success: false, error: 'Request expired' });
    if (r.merchantWalletId === req.walletId) return res.status(400).json({ success: false, error: 'Cannot pay own merchant wallet' });

    const result = await atomicTransfer({
      fromWalletId: req.walletId,
      toWalletId: r.merchantWalletId,
      amount: r.amount,
      note: `POS payment · ${r.shopName}`,
      externalRef: r.invoiceNo || '',
      source: `wallet-app:${r.shopId}`,
    });

    // Mark request as paid
    await ref.update({
      status: 'paid',
      paidByWalletId: req.walletId,
      paidAt: FV().serverTimestamp(),
      txId: result.txId,
    });

    // Mirror to TextilePOS side for real-time listener
    const shopRef = db().collection('shops').doc(r.shopId).collection('walletPayments').doc(result.txId);
    await shopRef.set({
      txId: result.txId,
      requestId,
      shopId: r.shopId,
      amount: r.amount,
      invoiceNo: r.invoiceNo || '',
      customerWalletId: req.walletId,
      merchantWalletId: r.merchantWalletId,
      status: 'completed',
      createdAt: FV().serverTimestamp(),
    });

    res.json({ success: true, ...result, requestId });
  } catch (e) {
    console.error('confirmPayment error:', e);
    res.status(400).json({ success: false, error: e.message });
  }
});

module.exports = router;
