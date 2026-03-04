import * as admin from 'firebase-admin';

// Initialize without explicit credentials to rely on GOOGLE_APPLICATION_CREDENTIALS
// or GCP metadata server (Cloud Run).
// For local testing without GCP auth, this will fail unless GOOGLE_APPLICATION_CREDENTIALS is set.
admin.initializeApp({
    storageBucket: process.env.STORAGE_BUCKET || 'carlos-millan-captures'
});

export const db = admin.firestore();
export const bucket = admin.storage().bucket();
