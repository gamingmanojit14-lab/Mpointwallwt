/**
 * routes/p2p.js
 * ==============================================================
 * P2P + Merchant payment routes.
 *
 * Endpoints:
 *   POST /api/p2pTransfer          → direct wallet→wallet
 *   POST /api/createPaymentRequest → POS creates a request
 *   POST /api/confirmPayment       → customer confirms & pays (with bridge)
 *   GET  /api/p2p/transactions     → history
 *   GET  /api/p2p/request/:id      → fetch request
 *
 * Auth: Bearer ID token from Firebase Auth (verifyAuth middleware)
 * ==============================================================
 */

const express = require('express');
const router = express.Router();
const {
  confirmPayment,
  directTransfer,
  createPaymentRequest,
  getRequest,
  getRecentTransactions
} = require('../services/transactionService');

// ---- Auth middleware (adjust path if yours is different) ----
let verifyAuth;
try {
  verifyAuth = require('../middleware/auth');
} catch (e) {
  // Fallback if middleware path differs
  verifyAuth = require('../middleware/verify');
}

/* ============================================================
 * POST /api/p2pTransfer
 * Body: { toWalletId, amount, note }
 * ============================================================ */
router.post('/p2pTransfer', verifyAuth, async (req, res) => {
  try {
    const { toWalletId, amount, note } = req.body || {};
    if (!toWalletId || !(amount > 0)) {
      return res.status(400).json({ success: false, error: 'Missing toWalletId or amount' });
    }

    // Resolve sender wallet from UID
    const { db } = require('../firebase-admin');
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }
    const userDoc = userSnap.data();
    const fromWalletId = userDoc.walletId;
    if (!fromWalletId) {
      return res.status(400).json({ success: false, error: 'No wallet linked' });
    }

    const result = await directTransfer({
      fromWalletId,
      toWalletId,
      amount: Number(amount),
      note: note || '',
      senderUid: req.user.uid,
      senderName: userDoc.name || null
    });

    return res.json(result);
  } catch (err) {
    console.error('[p2pTransfer] error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ============================================================
 * POST /api/createPaymentRequest
 * Body: { shopId, shopName, invoiceNo, amount, sessionId, upiId }
 * Called by POS when salesman generates QR.
 * ============================================================ */
router.post('/createPaymentRequest', verifyAuth, async (req, res) => {
  try {
    const { shopId, shopName, invoiceNo, amount, sessionId, upiId } = req.body || {};
    const result = await createPaymentRequest({
      shopId,
      shopName,
      invoiceNo,
      amount: Number(amount),
      salesmanId: req.user.uid,
      sessionId,
      upiId
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[createPaymentRequest] error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ============================================================
 * POST /api/confirmPayment
 * Body: { requestId }
 * Customer pays merchant — this is the main flow.
 *
 * After payment succeeds, invoiceBridge automatically notifies
 * the Textile POS via invoiceLookup collection.
 * ============================================================ */
router.post('/confirmPayment', verifyAuth, async (req, res) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) {
      return res.status(400).json({ success: false, error: 'requestId required' });
    }

    const { db } = require('../firebase-admin');
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: 'User profile not found' });
    }
    const userDoc = userSnap.data();
    const fromWalletId = userDoc.walletId;
    if (!fromWalletId) {
      return res.status(400).json({ success: false, error: 'No wallet linked' });
    }

    const result = await confirmPayment({
      requestId,
      fromWalletId,
      senderUid: req.user.uid,
      senderName: userDoc.name || null
    });

    return res.json(result);
  } catch (err) {
    console.error('[confirmPayment] error:', err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ============================================================
 * GET /api/p2p/request/:requestId
 * Fetch request details (used by pay.html on load).
 * ============================================================ */
router.get('/p2p/request/:requestId', async (req, res) => {
  try {
    const req_ = await getRequest(req.params.requestId);
    if (!req_) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, request: req_ });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ============================================================
 * GET /api/p2p/transactions
 * Query: ?limit=50
 * ============================================================ */
router.get('/p2p/transactions', verifyAuth, async (req, res) => {
  try {
    const { db } = require('../firebase-admin');
    const userSnap = await db.collection('users').doc(req.user.uid).get();
    if (!userSnap.exists) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const walletId = userSnap.data().walletId;
    if (!walletId) {
      return res.status(400).json({ success: false, error: 'No wallet' });
    }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const txs = await getRecentTransactions(walletId, limit);
    return res.json({ success: true, transactions: txs });
  } catch (err) {
    console.error('[p2p/transactions] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
