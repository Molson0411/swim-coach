import "dotenv/config";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

type ServiceAccountInput = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const CORS_CONFIG = [
  {
    origin: ["*"],
    method: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    responseHeader: [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "User-Agent",
      "x-goog-resumable",
    ],
    maxAgeSeconds: 3600,
  },
];

async function main() {
  const serviceAccount = getServiceAccount();
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.projectId}.firebasestorage.app`;

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
      storageBucket: bucketName,
    });
  }

  const bucket = getStorage().bucket(bucketName);
  await bucket.setMetadata({ cors: CORS_CONFIG });

  const [metadata] = await bucket.getMetadata();
  console.log(`Firebase Storage CORS updated for bucket: ${bucketName}`);
  console.log(JSON.stringify(metadata.cors || [], null, 2));
}

function getServiceAccount(): ServiceAccount {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson) as ServiceAccountInput;
    return normalizeServiceAccount(parsed);
  }

  return normalizeServiceAccount({
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY,
  });
}

function normalizeServiceAccount(input: ServiceAccountInput): ServiceAccount {
  const missing = [
    !input.project_id ? "FIREBASE_PROJECT_ID or FIREBASE_SERVICE_ACCOUNT.project_id" : "",
    !input.client_email ? "FIREBASE_CLIENT_EMAIL or FIREBASE_SERVICE_ACCOUNT.client_email" : "",
    !input.private_key ? "FIREBASE_PRIVATE_KEY or FIREBASE_SERVICE_ACCOUNT.private_key" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing Firebase service account settings: ${missing.join(", ")}`);
  }

  return {
    projectId: input.project_id!,
    clientEmail: input.client_email!,
    privateKey: input.private_key!.replace(/\\n/g, "\n"),
  };
}

main().catch((error) => {
  console.error("Failed to update Firebase Storage CORS.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
