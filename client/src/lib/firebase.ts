import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";

const fbConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app  = getApps().length ? getApp() : initializeApp(fbConfig);
export const auth = getAuth(app);

// dev helpers
if (import.meta.env.DEV) {
  (window as any).__auth = auth;
  (window as any).__signIn  = (email: string, pw: string) => signInWithEmailAndPassword(auth, email, pw);
  (window as any).__signOut = () => signOut(auth);
  (window as any).__fb      = fbConfig; // lets you see the apiKey at runtime
}
