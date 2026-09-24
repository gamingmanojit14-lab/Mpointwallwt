/**
 * Atomic P2P transfer between two wallets via Firestore runTransaction.
 * - Both wallets active কি check
 * - Sender এ পর্যাপ্ত balance আছে কি check
 * - tx doc লেখা হয় source দিয়ে (e.g., "textilepos:SHOP-XXX" বা "wallet-app")
 * - Returns { txId, fromBalanceAfter, toBalanceAfter }
 */
const { db, FV } = require('../utils/firebase');
const { randomId } = require('../utils/hashing');

async function atomicTransfer({
  fromWalletId,
  toWalletId,
  amount,
  note = '',
  externalRef = '',
  source = 'wallet-app',
  skipInsufficientCheck = false, // for loyalty credits from merchant, still needs balance
}) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('Invalid amount');
  if (!fromWalletId || !toWalletId) throw new Error('fromWalletId and toWalletId required');
  if (fromWalletId === toWalletId) throw new Error('Cannot transfer to same wallet');

  const txId = 'TX-' + Date.now() + '-' + randomId(6);
  const fromRef = db().collection('wallets').doc(fromWalletId);
  const toRef = db().collection('wallets').doc(toWalletId);
  const txRef = db().collection('transactions').doc(txId);

  const result = await db().runTransaction(async (tx) => {
    const [fromDoc, toDoc] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);

    if (!fromDoc.exists) throw new Error('Source wallet not found');
    if (!toDoc.exists) throw new Error('Destination wallet not found');

    const fromData = fromDoc.data();
    const toData = toDoc.data();

    if (fromData.walletStatus !== 'active') throw new Error('Source wallet suspended');
    if (toData.walletStatus !== 'active') throw new Error('Destination wallet suspended');

    const fromBal = Number(fromData.balance || 0);
    const toBal = Number(toData.balance || 0);

    if (!skipInsufficientCheck && fromBal < amt) throw new Error('Insufficient balance');

    const fromAfter = fromBal - amt;
    const toAfter = toBal + amt;

    tx.update(fromRef, { balance: fromAfter, updatedAt: FV().serverTimestamp() });
    tx.update(toRef, { balance: toAfter, updatedAt: FV().serverTimestamp() });

    tx.set(txRef, {
      txId,
      fromWalletId,
      fromName: fromData.name || fromData.shopName || '',
      toWalletId,
      toName: toData.name || toData.shopName || '',
      amount: amt,
      note: String(note || ''),
      externalRef: String(externalRef || ''),
      source,
      status: 'completed',
      fromBalanceAfter: fromAfter,
      toBalanceAfter: toAfter,
      createdAt: FV().serverTimestamp(),
    });

    return { txId, fromBalanceAfter: fromAfter, toBalanceAfter: toAfter };
  });

  return result;
}

module.exports = { atomicTransfer };
