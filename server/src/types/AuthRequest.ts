import { Request } from "express";
import { DecodedIdToken } from "firebase-admin/auth";

export type UserPayload = {
  uid: string;          // Firebase UID
  id: number;       // local users.id
  role: string;
  firebaseUid: string;
  token: DecodedIdToken;
};

export type AuthRequest = Request & { user?: UserPayload };
