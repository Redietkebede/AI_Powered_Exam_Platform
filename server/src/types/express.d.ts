import type { DecodedIdToken } from "firebase-admin/auth";

declare global {
  namespace Express {
    interface UserPayload {
      uid: any;
      id: number;
      role: string;
      firebaseUid: string;
      token: DecodedIdToken;
    }
    interface Request {
      user?: UserPayload;
    }
  }
}
export {};
