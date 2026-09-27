/**
 * services/invoiceBridge.js
 * ==============================================================
 * BRIDGE MODULE — Wallet → Textile payment handoff
 *
 * Purpose: When /api/confirmPayment succeeds, this module writes
 * a record to Firestore collection `invoiceLookup` so the Textile
 * POS app can poll it and show "✅ Payment Successful".
 *
 * Key = `${shopId}_${invoiceNo}` (uppercase, normalized)
 *
 * Usage:
 *   const { markInvoicePaid, cancelInvoice } = require('../services/invoiceBridge');
 *   await markInvoicePaid({ shopId, invoiceNo, amount, txId, txHash, paidBy });
 * ==============================================================
 */

const { db } = require('../firebase-admin');

function norm(s) {
  return String(s || '').trim().toUpperCase();
}

function docIdFor(shopId, invoiceNo) {
  return `${norm(shopId)}_${norm(invoiceNo)}`;
}

/**
 * Mark an invoice as paid. Called from /api/confirmPayment success path.
 * @returns {Promise<{ok:boolean, docId?:string, error?:string}>}
 */
async function markInvoicePaid({ shopId, invoiceNo, amount, txId, txHash, paidBy, requestId }) {
  try {
    if (!shopId || !invoiceNo) {
      return { ok: false, error: 'Missing shopId or invoiceNo' };
    }
    const docId = docIdFor(shopId, invoiceNo);
    await db.collection('invoiceLookup').doc(docId).set({
      shopId: norm(shopId),
      invoiceNo: norm(invoiceNo),
      status: 'paid',
      amount: Number(amount || 0),
      txId: txId || null,
      txHash: txHash || null,
      paidBy: paidBy || null,
      requestId: requestId || null,
      paidAt: Date.now(),
      updatedAt: Date.now()
    }, { merge: true });

    console.log('[invoiceBridge] ✅ Marked paid:', docId, 'txId:', txId);
    return { ok: true, docId };
  } catch (err) {
    console.error('[invoiceBridge] ❌ markInvoicePaid failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Mark an invoice as cancelled (POS closes QR without payment).
 */
async function cancelInvoice({ shopId, invoiceNo }) {
  try {
    const docId = docIdFor(shopId, invoiceNo);
    await db.collection('invoiceLookup').doc(docId).set({
      shopId: norm(shopId),
      invoiceNo: norm(invoiceNo),
      status: 'cancelled',
      cancelledAt: Date.now(),
      updatedAt: Date.now()
    }, { merge: true });
    return { ok: true, docId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { markInvoicePaid, cancelInvoice };
