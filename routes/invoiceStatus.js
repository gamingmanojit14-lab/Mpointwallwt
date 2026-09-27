/**
 * routes/invoiceStatus.js
 * ==============================================================
 * Public polling endpoint for Textile POS.
 * No auth — only reveals paid/unpaid for a specific invoice.
 * ==============================================================
 */

const express = require('express');
const router = express.Router();
const { db } = require('../firebase-admin');
const { cancelInvoice } = require('../services/invoiceBridge');

function norm(s) { return String(s || '').trim().toUpperCase(); }

/**
 * GET /api/mpoint/paymentStatus?shopId=SHOP-AFEHCX&invoiceNo=INV-20260927-0005
 */
router.get('/paymentStatus', async (req, res) => {
  try {
    const shopId    = norm(req.query.shopId);
    const invoiceNo = norm(req.query.invoiceNo);

    if (!shopId || !invoiceNo) {
      return res.status(400).json({ paid: false, error: 'shopId and invoiceNo required' });
    }

    const docId = `${shopId}_${invoiceNo}`;
    const snap  = await db.collection('invoiceLookup').doc(docId).get();

    if (!snap.exists) {
      return res.json({ paid: false, status: 'not_found', shopId, invoiceNo });
    }

    const d = snap.data();
    return res.json({
      paid:      d.status === 'paid',
      status:    d.status,
      txId:      d.txId      || null,
      txHash:    d.txHash    || null,
      amount:    d.amount    || 0,
      paidBy:    d.paidBy    || null,
      paidAt:    d.paidAt    || null,
      shopId,
      invoiceNo
    });
  } catch (err) {
    console.error('[paymentStatus] error:', err);
    return res.status(500).json({ paid: false, error: 'Server error' });
  }
});

/**
 * POST /api/mpoint/cancelInvoice
 * Body: { shopId, invoiceNo }
 * Called by POS when salesman cancels QR.
 */
router.post('/cancelInvoice', express.json(), async (req, res) => {
  try {
    const { shopId, invoiceNo } = req.body || {};
    if (!shopId || !invoiceNo) {
      return res.status(400).json({ ok: false, error: 'shopId and invoiceNo required' });
    }
    const result = await cancelInvoice({ shopId, invoiceNo });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/mpoint/health — sanity check
 */
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'mpoint-bridge', time: Date.now() });
});

module.exports = router;
