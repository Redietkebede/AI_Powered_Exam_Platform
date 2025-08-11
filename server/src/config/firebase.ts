import service_account from "../../firebase-adminsdk.json"; // Your downloaded key
import * as admin from 'firebase-admin';
import * as dotenv from 'dotenv';

dotenv.config();

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(service_account as admin.ServiceAccount),
    projectId: (service_account as any).project_id, // explicit, helps avoid mismatches
  });
}


export default admin;
export const auth = admin.auth();