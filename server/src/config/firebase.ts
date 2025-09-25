import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config();

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, "\n");
}

function initAdmin() {
  if (admin.apps.length) return;

  const hasEnv =
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY;

  if (hasEnv) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY!),
      }),
    });
    return;
  }
  const serviceAccount = require(path.resolve(
    __dirname,
    "../../firebase-adminsdk.json"
  ));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    projectId: (serviceAccount as any).project_id,
  });
}

initAdmin();
export default admin;
