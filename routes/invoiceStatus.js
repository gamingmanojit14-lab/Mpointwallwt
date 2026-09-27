/**
 * routes/invoiceStatus.js
 * ============================================================
 * BRIDGE ENDPOINT — Textile POS polls this to detect payments.
 * 
 * Called by: 23.sep.new's payment.html / POS QR modal
 * Every 2 seconds with the current shopId + invoiceNo.
 * Returns { paid: true, ... } when wallet backend has received payment.
 *
 * Storage: Firestore collection "invoiceLookup" (in Mpoint's Firebase)
 *   Doc ID = `${shopId}_${invoiceNo}` (normalized, lowercase)
 * ============================================================
 */

const express = require('express');
const router = express.Router();
const { db } = require('../firebase-admin');

/**
 * GET /api/mpoint/paymentStatus?shopId=SHOP-AFEHCX&invoiceNo=INV-20260927-0005
 * Public endpoint. Reveals only paid/unpaid for a specific invoice.
 */
router.get('/paymentStatus', async (req, res) => {
  try {
    const shopId = String(req.query.shopId || '').trim().toUpperCase();
    const invoiceNo = String(req.query.invoiceNo || '').trim().toUpperCase();

    if (!shopId || !invoiceNo) {
      return res.status(400).json({ error: 'shopId and invoiceNo required' });
    }

    const docId = `${shopId}_${invoiceNo}`;
    const snap = await db.collection('invoiceLookup').doc(docId).get();

    if (!snap.exists) {
      return res.json({ paid: false, status: 'not_found' });
    }

    const d = snap.data();
    return res.json({
      paid: d.status === 'paid',
      status: d.status,
      txId: d.txId || null,
      txHash: d.txHash || null,
      amount: d.amount || 0,
      paidBy: d.paidBy || null,
      paidAt: d.paidAt || null,
      shopId,
      invoiceNo
    });
  } catch (err) {
    console.error('[paymentStatus] error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
