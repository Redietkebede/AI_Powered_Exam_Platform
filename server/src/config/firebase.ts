import service_account from "../../firebase-adminsdk.json"; // Your downloaded key
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

admin.initializeApp({
  credential: admin.credential.cert(service_account as admin.ServiceAccount),
});

export const auth = admin.auth();