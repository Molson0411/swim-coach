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

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    const parsed = JSON.parse(serviceAccount) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.");
    }

    return initializeApp({
      credential: cert({
        projectId: parsed.project_id,
        clientEmail: parsed.client_email,
        privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      }),
    });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const missing = [
    !projectId ? "FIREBASE_PROJECT_ID" : "",
    !clientEmail ? "FIREBASE_CLIENT_EMAIL" : "",
    !privateKey ? "FIREBASE_PRIVATE_KEY" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Firebase Admin environment variables are not configured. Missing: ${missing.join(", ")}. You can alternatively set FIREBASE_SERVICE_ACCOUNT.`);
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
