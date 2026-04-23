import admin from 'firebase-admin';

// 🔥 Load from ENV only (no JSON file)
const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined,
};

// 🧠 Debug (remove later if you want)
console.log("Firebase config check:", {
  project_id: serviceAccount.project_id,
  client_email: serviceAccount.client_email,
  hasPrivateKey: !!serviceAccount.private_key,
});

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export const auth = admin.auth();
export const db = admin.firestore();
export default admin;