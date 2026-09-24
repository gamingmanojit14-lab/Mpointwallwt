/**
 * P2P Wallet API — Express server for Render.com
 * Hosted at https://mpointwallwt-1.onrender.com
 *
 * Routes:
 *   POST /api/verifyConnection
 *   POST /api/debitPoints
 *   POST /api/creditPoints
 *   GET  /api/getBalance
 *   POST /api/createPaymentRequest
 *   GET  /api/paymentStatus
 *   POST /api/p2pTransfer        ← Wallet App → Wallet App
 *   POST /api/confirmPayment     ← Wallet App pays merchant request
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const { initFirebase } = require('./utils/firebase');
const { globalLimiter, authFailLimiter } = require('./middleware/rateLimit');

// ---------- Route imports ----------
const verifyRoute = require('./routes/verify');
const debitRoute = require('./routes/debit');
const creditRoute = require('./routes/credit');
const balanceRoute = require('./routes/balance');
const requestRoute = require('./routes/request');
const p2pRoute = require('./routes/p2p');           // ⬅️ NEW

const app = express();

// ---------- Init Firebase (fail-fast) ----------
try {
  initFirebase();
} catch (e) {
  console.error('❌ Firebase init failed:', e.message);
  process.exit(1);
}

// ---------- Global middleware ----------
app.set('trust proxy', 1); // Render sits behind a proxy — needed for req.ip
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// ---------- Health check ----------
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'P2P Wallet API',
    version: '1.0.0',
    time: new Date().toISOString(),
  });
});

// ---------- Rate limiting ----------
app.use('/api/', globalLimiter);
app.use('/api/', authFailLimiter);

// ---------- Routes ----------
app.use('/api', verifyRoute);
app.use('/api', debitRoute);
app.use('/api', creditRoute);
app.use('/api', balanceRoute);
app.use('/api', requestRoute);
app.use('/api', p2pRoute);                          // ⬅️ NEW

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ---------- Error handler ----------
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Server error',
  });
});

// ---------- Start server ----------
const PORT = Number(process.env.PORT || 10000);
const server = app.listen(PORT, () => {
  console.log(`✅ P2P Wallet API running on port ${PORT}`);
  console.log(`   NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Wallet URL = ${process.env.WALLET_APP_URL || '(not set)'}`);
});

// ---------- Graceful shutdown ----------
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
