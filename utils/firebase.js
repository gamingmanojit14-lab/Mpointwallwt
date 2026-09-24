/**
 * Firebase Admin SDK init
 * একবারই initialize হবে, নাহলে hot-reload এ crash করবে।
 */
const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
  if (initialized || admin.apps.length) {
    initialized = true;
    return admin.app();
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      '❌ Firebase credentials missing. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY in env.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, privateKey, clientEmail }),
    projectId,
  });

  initialized = true;
  console.log('🔥 Firebase Admin initialized for project:', projectId);
  return admin.app();
}

// Lazy accessors — initFirebase() আগে call হয়ে গেলে এগুলো ঠিকঠাক কাজ করবে
const db = () => admin.firestore();
const auth = () => admin.auth();
const FV = () => admin.firestore.FieldValue;

module.exports = { initFirebase, admin, db, auth, FV };
