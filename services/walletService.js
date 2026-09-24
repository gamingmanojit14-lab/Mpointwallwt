/**
 * Wallet helpers used by routes/services.
 */
const { db } = require('../utils/firebase');

async function getWallet(walletId) {
  const doc = await db().collection('wallets').doc(walletId).get();
  if (!doc.exists) return null;
  return { walletId: doc.id, ...doc.data() };
}

async function walletExists(walletId) {
  const doc = await db().collection('wallets').doc(walletId).get();
  return doc.exists;
}

/**
 * Generate a wallet ID of the requested prefix + 6 chars.
 * e.g., "M-", "W-" → "M-AB12CD"
 * Not bulletproof unique — caller should retry on collision. 36^6 ≈ 2B combos.
 */
function generateWalletId(prefix = 'W-') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = prefix;
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Find wallet by linked email or phone via walletIndex.
 */
async function findWalletByKey(key) {
  const doc = await db().collection('walletIndex').doc(key).get();
  if (!doc.exists) return null;
  const data = doc.data();
  return data.walletId || null;
}

module.exports = { getWallet, walletExists, generateWalletId, findWalletByKey };
