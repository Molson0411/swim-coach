import type { VercelRequest } from "@vercel/node";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  FieldValue,
  Firestore,
  getFirestore,
} from "firebase-admin/firestore";

type AuthenticatedUser = {
  uid: string;
  email?: string;
};

function getFirebaseAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin environment variables are not configured.");
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export function getAdminDb(): Firestore {
  return getFirestore(getFirebaseAdminApp());
}

export { FieldValue };

export async function verifyFirebaseToken(req: VercelRequest): Promise<AuthenticatedUser> {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing Firebase ID token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("Missing Firebase ID token.");
  }

  const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(token);
  return {
    uid: decoded.uid,
    email: decoded.email,
  };
}

export async function assertUserHasCredits(uid: string) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const snapshot = await userRef.get();
  const freeCredits = snapshot.data()?.freeCredits;

  if (typeof freeCredits !== "number" || freeCredits <= 0) {
    throw new Error("免費額度已用完");
  }
}

export async function debitUserCredit(uid: string) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const freeCredits = snapshot.data()?.freeCredits;

    if (typeof freeCredits !== "number" || freeCredits <= 0) {
      throw new Error("免費額度已用完");
    }

    transaction.update(userRef, {
      freeCredits: FieldValue.increment(-1),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

export async function refundUserCredit(uid: string) {
  await getAdminDb().collection("users").doc(uid).update({
    freeCredits: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
