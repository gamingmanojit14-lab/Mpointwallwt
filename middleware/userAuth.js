/**
 * Authenticate a Firebase user via ID token (Bearer).
 * Attaches req.user = { uid, email } and req.walletId
 */
const { auth, db } = require('../utils/firebase');

async function authenticateUser(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, error: 'Missing ID token' });

    const decoded = await auth().verifyIdToken(token);
    const uref = db().collection('users').doc(decoded.uid);
    const udoc = await uref.get();
    if (!udoc.exists || !udoc.data().walletId) {
      return res.status(403).json({ success: false, error: 'User has no wallet' });
    }
    req.user = { uid: decoded.uid, email: decoded.email || '' };
    req.walletId = udoc.data().walletId;
    next();
  } catch (e) {
    console.error('User auth error:', e.message);
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

module.exports = { authenticateUser };
