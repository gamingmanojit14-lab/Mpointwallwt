/**
 * services/transactionService.js
 * ==============================================================
 * Atomic wallet transfer + payment confirmation service.
 *
 * Handles:
 *   - createPaymentRequest()  → POS creates a request
 *   - confirmPayment()        → wallet confirms & pays
 *   - directTransfer()        → P2P direct wallet-to-wallet
 *   - getWallet()             → wallet fetch
 *   - getRequests()           → request listing
 *
 * Integration:
 *   - Automatically writes to `invoiceLookup` for Textile bridge
 *   - Uses Firestore transaction for atomicity
 * ==============================================================
 */

const admin = require('firebase-admin');
const { db } = require('../firebase-admin');
const { markInvoicePaid } = require('./invoiceBridge');

const FV = admin.firestore.FieldValue;

/* ============================================================
 * Helpers
 * ============================================================ */

function norm(s) { return String(s || '').trim().toUpperCase(); }

function nowMs() { return Date.now(); }

/**
 * Fetch a wallet document by walletId.
 */
async function getWallet(walletId) {
  if (!walletId) return null;
  const snap = await db.collection('wallets').doc(walletId).get();
  if (!snap.exists) return null;
  return { walletId: snap.id, ...snap.data() };
}

/**
 * Fetch a request document by requestId.
 */
async function getRequest(requestId) {
  if (!requestId) return null;
  const snap = await db.collection('requests').doc(requestId).get();
  if (!snap.exists) return null;
  return { requestId: snap.id, ...snap.data() };
}

/* ============================================================
 * createPaymentRequest
 * Called by POS when salesman generates QR.
 * ============================================================ */
async function createPaymentRequest({
  shopId,
  shopName,
  invoiceNo,
  amount,
  salesmanId,
  sessionId,
  upiId
}) {
  if (!shopId || !invoiceNo || !(amount > 0)) {
    throw new Error('Missing shopId, invoiceNo, or amount');
  }

  const requestId = 'req_' + nowMs() + '_' + Math.random().toString(36).slice(2, 8);
  const expiresAt = nowMs() + (5 * 60 * 1000); // 5 min

  await db.collection('requests').doc(requestId).set({
    requestId,
    shopId: norm(shopId),
    shopName: shopName || 'Shop',
    invoiceNo: norm(invoiceNo),
    amount: Number(amount),
    salesmanId: salesmanId || null,
    sessionId: sessionId || null,
    upiId: upiId || null,
    status: 'pending',
    createdAt: nowMs(),
    expiresAt
  });

  return { requestId, expiresAt };
}

/* ============================================================
 * confirmPayment — the main function
 * Called from /api/confirmPayment when customer pays.
 *
 * Flow:
 *   1. Load request, validate status
 *   2. Load sender wallet, verify balance
 *   3. Atomic Firestore transaction:
 *        - debit sender
 *        - credit merchant
 *        - write transaction record
 *        - update request status = 'paid'
 *   4. Bridge: write invoiceLookup for Textile POS
 * ============================================================ */
async function confirmPayment({
  requestId,
  fromWalletId,
  senderUid,
  senderName
}) {
  if (!requestId) throw new Error('requestId required');
  if (!fromWalletId) throw new Error('fromWalletId required');

  // ---- 1. Load request ----
  const requestRef = db.collection('requests').doc(requestId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) throw new Error('Payment request not found');
  const request = requestSnap.data();

  if (request.status === 'paid') throw new Error('Already paid');
  if (request.status !== 'pending') throw new Error('Request is ' + request.status);
  if (nowMs() > request.expiresAt) throw new Error('Request expired');

  // ---- 2. Load merchant wallet ----
  const shopSnap = await db.collection('shops').doc(norm(request.shopId)).get();
  if (!shopSnap.exists) throw new Error('Shop not found: ' + request.shopId);
  const shop = shopSnap.data();
  const merchantWalletId = shop.merchantWalletId;
  if (!merchantWalletId) throw new Error('Merchant wallet not configured');

  if (merchantWalletId === fromWalletId) {
    throw new Error('Cannot pay to your own wallet');
  }

  const amount = Number(request.amount);
  const txId = 'tx_' + nowMs() + '_' + Math.random().toString(36).slice(2, 8);

  // ---- 3. Atomic transfer ----
  const result = await db.runTransaction(async (t) => {
    const senderRef = db.collection('wallets').doc(fromWalletId);
    const merchantRef = db.collection('wallets').doc(merchantWalletId);
    const reqRef = db.collection('requests').doc(requestId);

    const [senderDoc, merchantDoc, reqDoc] = await Promise.all([
      t.get(senderRef),
      t.get(merchantRef),
      t.get(reqRef)
    ]);

    if (!senderDoc.exists) throw new Error('Sender wallet not found');
    if (!merchantDoc.exists) throw new Error('Merchant wallet not found');
    if (!reqDoc.exists) throw new Error('Request disappeared');
    if (reqDoc.data().status !== 'pending') throw new Error('Request no longer pending');

    const senderBalance = Number(senderDoc.data().balance || 0);
    if (senderBalance < amount) throw new Error('Insufficient balance');

    const merchantBalance = Number(merchantDoc.data().balance || 0);

    // Debit sender
    t.update(senderRef, {
      balance: senderBalance - amount,
      updatedAt: FV.serverTimestamp()
    });

    // Credit merchant
    t.update(merchantRef, {
      balance: merchantBalance + amount,
      updatedAt: FV.serverTimestamp()
    });

    // Write transaction record
    const txRef = db.collection('transactions').doc(txId);
    t.set(txRef, {
      txId,
      type: 'merchant_payment',
      fromWalletId,
      toWalletId: merchantWalletId,
      fromUid: senderUid || null,
      toUid: shop.ownerUid || null,
      amount,
      shopId: norm(request.shopId),
      shopName: request.shopName || '',
      invoiceNo: norm(request.invoiceNo),
      requestId,
      note: 'Payment for ' + (request.invoiceNo || requestId),
      status: 'completed',
      createdAt: nowMs(),
      createdAtServer: FV.serverTimestamp()
    });

    // Mark request paid
    t.update(reqRef, {
      status: 'paid',
      txId,
      paidAt: nowMs(),
      paidBy: fromWalletId,
      paidByName: senderName || null
    });

    return {
      txId,
      amount,
      merchantWalletId,
      shopId: norm(request.shopId),
      invoiceNo: norm(request.invoiceNo)
    };
  });

  // ---- 4. Bridge to Textile (outside transaction) ----
  try {
    if (result.shopId && result.invoiceNo) {
      await markInvoicePaid({
        shopId: result.shopId,
        invoiceNo: result.invoiceNo,
        amount: result.amount,
        txId: result.txId,
        txHash: null,
        paidBy: fromWalletId,
        requestId
      });
    } else {
      console.warn('[transactionService] bridge skipped — missing shopId/invoiceNo');
    }
  } catch (bridgeErr) {
    console.error('[transactionService] bridge error:', bridgeErr.message);
    // Payment already succeeded — don't fail
  }

  return {
    success: true,
    txId: result.txId,
    amount: result.amount,
    shopId: result.shopId,
    invoiceNo: result.invoiceNo
  };
}

/* ============================================================
 * directTransfer — wallet → wallet (no invoice)
 * ============================================================ */
async function directTransfer({
  fromWalletId,
  toWalletId,
  amount,
  note,
  senderUid,
  senderName
}) {
  if (!fromWalletId || !toWalletId) throw new Error('Both wallets required');
  if (fromWalletId === toWalletId) throw new Error('Cannot send to yourself');
  if (!(amount > 0)) throw new Error('Amount must be positive');

  const txId = 'tx_' + nowMs() + '_' + Math.random().toString(36).slice(2, 8);

  await db.runTransaction(async (t) => {
    const senderRef = db.collection('wallets').doc(fromWalletId);
    const recipientRef = db.collection('wallets').doc(toWalletId);

    const [senderDoc, recipientDoc] = await Promise.all([
      t.get(senderRef),
      t.get(recipientRef)
    ]);

    if (!senderDoc.exists) throw new Error('Sender wallet not found');
    if (!recipientDoc.exists) throw new Error('Recipient wallet not found');

    const senderBalance = Number(senderDoc.data().balance || 0);
    if (senderBalance < amount) throw new Error('Insufficient balance');

    t.update(senderRef, {
      balance: senderBalance - amount,
      updatedAt: FV.serverTimestamp()
    });
    t.update(recipientRef, {
      balance: Number(recipientDoc.data().balance || 0) + amount,
      updatedAt: FV.serverTimestamp()
    });

    t.set(db.collection('transactions').doc(txId), {
      txId,
      type: 'p2p_transfer',
      fromWalletId,
      toWalletId,
      fromUid: senderUid || null,
      fromName: senderName || null,
      amount,
      note: note || '',
      status: 'completed',
      createdAt: nowMs(),
      createdAtServer: FV.serverTimestamp()
    });
  });

  return { success: true, txId, amount };
}

/* ============================================================
 * getRecentTransactions
 * ============================================================ */
async function getRecentTransactions(walletId, limit = 50) {
  const snap = await db.collection('transactions')
    .where('fromWalletId', '==', walletId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const sent = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const snap2 = await db.collection('transactions')
    .where('toWalletId', '==', walletId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const received = snap2.docs.map(d => ({ id: d.id, ...d.data() }));

  const all = [...sent, ...received].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return all.slice(0, limit);
}

module.exports = {
  getWallet,
  getRequest,
  createPaymentRequest,
  confirmPayment,
  directTransfer,
  getRecentTransactions
};
