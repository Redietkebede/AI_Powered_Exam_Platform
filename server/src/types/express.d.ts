import type { DecodedIdToken } from "firebase-admin/auth";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
      uid: string;
      role: "admin" | "editor" | "recruiter" | "candidate";
      firebaseUid: string;
      email?: string | null;
      token?: DecodedIdToken;
    };
  }
}

export {};
