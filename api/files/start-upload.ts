import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, createSign, randomUUID } from "node:crypto";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 15 * 60;

type StartUploadBody = {
  fileName?: string;
  contentType?: string;
  size?: number;
};

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ message: "Method not allowed." });
      return;
    }

    const uploadSession = await handleStartUpload(req);
    res.status(200).json(uploadSession);
  } catch (error) {
    setCorsHeaders(req, res);
    console.error("API Crash Error:", error);

    const message = error instanceof Error ? error.message : "Failed to create upload session.";
    const status = getErrorStatus(message);

    res.status(status).json({
      message,
      error: message,
      name: error instanceof Error ? error.name : "UnknownError",
      stack: process.env.NODE_ENV === "production"
        ? undefined
        : error instanceof Error ? error.stack : undefined,
    });
  }
}

async function handleStartUpload(req: VercelRequest) {
  const { fileName, contentType, size } = req.body as StartUploadBody;

  if (!fileName || !contentType) {
    throw new BadRequestError("fileName and contentType are required.");
  }

  if (!contentType.startsWith("video/")) {
    throw new BadRequestError("Only video uploads are supported.");
  }

  if (typeof size === "number" && (size <= 0 || size > MAX_VIDEO_BYTES)) {
    throw new BadRequestError("Video must be 1GB or smaller.");
  }

  const uid = getUidHint(req) || "anonymous";
  return createStorageSignedUploadUrl({
    uid,
    fileName,
    contentType,
  });
}

async function createStorageSignedUploadUrl(input: {
  uid: string;
  fileName: string;
  contentType: string;
}) {
  const serviceAccount = getServiceAccount();
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.projectId}.firebasestorage.app`;
  await assertBucketExists(bucket);

  const storagePath = [
    "uploads",
    sanitizePathPart(input.uid),
    `${Date.now()}-${randomUUID()}-${sanitizeFileName(input.fileName)}`,
  ].join("/");

  const uploadUrl = createV4SignedUrl({
    bucket,
    objectName: storagePath,
    contentType: input.contentType,
    serviceAccount,
  });

  return {
    uploadUrl,
    storagePath,
    bucket,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
    },
  };
}

function createV4SignedUrl(input: {
  bucket: string;
  objectName: string;
  contentType: string;
  serviceAccount: ServiceAccount;
}) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeUriPath(input.bucket)}/${encodeUriPath(input.objectName)}`;
  const signedHeaders = "content-type;host";

  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${input.serviceAccount.clientEmail}/${credentialScope}`,
    "X-Goog-Date": timestamp,
    "X-Goog-Expires": String(SIGNED_URL_TTL_SECONDS),
    "X-Goog-SignedHeaders": signedHeaders,
  });
  query.sort();

  const canonicalHeaders = `content-type:${input.contentType}\nhost:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query.toString(),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signature = createSign("RSA-SHA256")
    .update(stringToSign)
    .sign(input.serviceAccount.privateKey, "hex");

  return `https://${host}${canonicalUri}?${query.toString()}&X-Goog-Signature=${signature}`;
}

function getServiceAccount(): ServiceAccount {
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

    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
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
    throw new Error(`Firebase service account environment variables are not configured. Missing: ${missing.join(", ")}. You can alternatively set FIREBASE_SERVICE_ACCOUNT.`);
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function getUidHint(req: VercelRequest) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const [, payload] = authorization.slice("Bearer ".length).split(".");
  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const decoded = JSON.parse(json) as { user_id?: string; sub?: string };
    return decoded.user_id || decoded.sub || null;
  } catch {
    return null;
  }
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "anonymous";
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "video";
}

function encodeUriPath(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getErrorStatus(message: string) {
  if (
    message.includes("fileName and contentType are required") ||
    message.includes("Only video uploads are supported") ||
    message.includes("Video must be 1GB or smaller")
  ) {
    return 400;
  }

  return 500;
}

async function assertBucketExists(bucket: string) {
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`,
    { method: "GET" }
  );

  if (response.status === 404) {
    throw new Error(
      `Firebase Storage bucket "${bucket}" does not exist. Enable Firebase Storage for the swimcoach-e7ddf project or set FIREBASE_STORAGE_BUCKET to the real bucket name in Vercel.`
    );
  }

  if (response.status === 403 || response.status === 401) {
    return;
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Unable to verify Firebase Storage bucket "${bucket}" (${response.status}): ${detail}`);
  }
}

class BadRequestError extends Error {
  name = "BadRequestError";
}

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  const fallbackOrigin = "https://molson0411.github.io";

  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", fallbackOrigin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedOrigin(origin: string) {
  if (origin === "https://molson0411.github.io") {
    return true;
  }

  const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return extraOrigins.includes(origin)
    || /^http:\/\/localhost:\d+$/.test(origin)
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    || /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
}
