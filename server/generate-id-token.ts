import * as admin from "firebase-admin";
import service_account from "./firebase-adminsdk.json"; 

admin.initializeApp({
  credential: admin.credential.cert(service_account as admin.ServiceAccount),
});

const testUID = "YyFJuPTa74dAgPJxtbbasnvr1Av1"; 

async function generateIdToken() {
  try {
    const customToken = await admin.auth().createCustomToken(testUID);
    console.log("✅ Custom Token:\n", customToken);

    console.log(
      `\n👉 Copy this token and exchange it using Firebase Auth REST API:\n`
    );
    console.log(`POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=AIzaSyDsAhs7FBOCPN2Jz_67wemrbGVxqwCrL9s`);
  } catch (error) {
    console.error("❌ Error generating token:", error);
  }
}

generateIdToken();
