/**
 * Audit logger — integrationLogs collection এ প্রতিটি API call লিখে রাখে।
 * কখনো throw করে না (best-effort) — main flow break করা উচিত না।
 */
const { db } = require('./firebase');

async function logIntegration({
  integrationId,
  action,
  amount = null,
  customerWalletId = null,
  merchantWalletId = null,
  externalRef = '',
  success = true,
  error = null,
  ip = '',
  userAgent = '',
  meta = null,
}) {
  try {
    const entry = {
      integrationId: integrationId || 'unknown',
      action,
      success: !!success,
      ip: ip || '',
      userAgent: userAgent || '',
      createdAt: new Date(),
    };
    if (amount !== null && amount !== undefined) entry.amount = Number(amount);
    if (customerWalletId) entry.customerWalletId = customerWalletId;
    if (merchantWalletId) entry.merchantWalletId = merchantWalletId;
    if (externalRef) entry.externalRef = externalRef;
    if (error) entry.error = String(error);
    if (meta && typeof meta === 'object') entry.meta = meta;

    await db().collection('integrationLogs').add(entry);
  } catch (e) {
    console.error('txLogger failed (non-fatal):', e.message);
  }
}

module.exports = { logIntegration };
