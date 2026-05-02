import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { setCorsHeaders } from "../cors";
import {
  assertUserHasCredits,
  getAdminStorageBucket,
  verifyFirebaseToken,
} from "../firebase-admin";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
const NO_CREDITS_MESSAGE = "免費額度已用完。";

type StartUploadBody = {
  fileName?: string;
  contentType?: string;
  size?: number;
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
  const user = await verifyFirebaseToken(req);
  await assertUserHasCredits(user.uid);

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

  return createStorageSignedUploadUrl({
    uid: user.uid,
    fileName,
    contentType,
  });
}

async function createStorageSignedUploadUrl(input: {
  uid: string;
  fileName: string;
  contentType: string;
}) {
  const bucket = getAdminStorageBucket();
  const storagePath = [
    "uploads",
    input.uid,
    `${Date.now()}-${randomUUID()}-${sanitizeFileName(input.fileName)}`,
  ].join("/");
  const expiresAt = Date.now() + SIGNED_URL_TTL_MS;
  const file = bucket.file(storagePath);

  const [uploadUrl] = await file.getSignedUrl({
    action: "write",
    version: "v4",
    expires: expiresAt,
    contentType: input.contentType,
  });

  return {
    uploadUrl,
    storagePath,
    bucket: bucket.name,
    expiresAt: new Date(expiresAt).toISOString(),
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
    },
  };
}

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "video";
}

function getErrorStatus(message: string) {
  if (message === NO_CREDITS_MESSAGE) {
    return 402;
  }

  if (message.includes("Firebase ID token") || message.includes("Missing Firebase ID token")) {
    return 401;
  }

  if (
    message.includes("fileName and contentType are required") ||
    message.includes("Only video uploads are supported") ||
    message.includes("Video must be 1GB or smaller")
  ) {
    return 400;
  }

  return 500;
}

class BadRequestError extends Error {
  name = "BadRequestError";
}
